import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import type { Db } from "mongodb";
import type { RedisClientType } from "redis";
import { MemoryStore } from "@relay/memory";
import {
  CORRELATION_HEADER,
  createTicketSchema,
  correlationIdFromRequest,
  tenantIdSchema,
  withCorrelation,
  type Env,
  type Logger,
} from "@relay/shared";
import { authMiddleware, type AuthedRequest } from "./auth.js";
import { streamBackpressure } from "./backpressure.js";
import { httpDuration, promClient } from "./metrics.js";
import { consumeRateLimit } from "./rate-limit.js";
import { openSse, subscribeTenantEvents } from "./sse.js";
import { getMongoClient } from "./mongo.js";

type TicketDoc = {
  _id: string;
  tenantId: string;
  customerId: string;
  subject: string;
  body: string;
  status: string;
  createdAt: Date;
};

type OutboxDoc = {
  _id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  published: boolean;
  createdAt: Date;
};

export type AppDeps = {
  env: Env;
  log: Logger;
  db: Db;
  redis: RedisClientType;
  memory: MemoryStore;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const correlationId = correlationIdFromRequest(req);
    res.setHeader(CORRELATION_HEADER, correlationId);
    req.log = deps.log.child(withCorrelation({}, correlationId));
    res.on("finish", () => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      httpDuration
        .labels(req.method, req.route?.path ?? req.path, String(res.statusCode))
        .observe(elapsed);
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api" });
  });

  app.get("/metrics", async (_req, res) => {
    res.type("text/plain").send(await promClient.register.metrics());
  });

  const requireAuth = authMiddleware(deps.db);

  app.get("/events", requireAuth, async (req, res) => {
    const tenantId = (req as AuthedRequest).tenantId;
    openSse(res);
    const controller = new AbortController();
    req.on("close", () => controller.abort());
    await subscribeTenantEvents(
      deps.redis,
      tenantId,
      res,
      controller.signal,
    );
  });

  app.post("/tickets", requireAuth, async (req, res) => {
    const tenantId = (req as AuthedRequest).tenantId;
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const allowed = await consumeRateLimit(deps.redis, tenantId);
    if (!allowed) {
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    const pressure = await streamBackpressure(deps.redis);
    if (pressure.blocked) {
      res.setHeader("Retry-After", "30");
      res.status(429).json({
        error: "backpressure",
        pending: pressure.pending,
      });
      return;
    }
    const ticketId = randomUUID();
    const now = new Date();
    const session = getMongoClient().startSession();
    try {
      session.startTransaction();
      await deps.db.collection<TicketDoc>("tickets").insertOne(
        {
          _id: ticketId,
          tenantId,
          customerId: parsed.data.customerId,
          subject: parsed.data.subject,
          body: parsed.data.body,
          status: "open",
          createdAt: now,
        },
        { session },
      );
      await deps.db.collection<OutboxDoc>("outbox").insertOne(
        {
          _id: randomUUID(),
          tenantId,
          type: "ticket.created",
          payload: {
            ticketId,
            tenantId,
            customerId: parsed.data.customerId,
            subject: parsed.data.subject,
            body: parsed.data.body,
          },
          published: false,
          createdAt: now,
        },
        { session },
      );
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      req.log.error({ err }, "ticket transaction failed");
      res.status(500).json({ error: "failed to create ticket" });
      return;
    } finally {
      await session.endSession();
    }
    res.status(201).json({ ticketId, status: "queued" });
  });

  app.get("/runs/:runId/explain", requireAuth, async (req, res) => {
    const tenantId = (req as AuthedRequest).tenantId;
    const runId = Array.isArray(req.params.runId)
      ? req.params.runId[0]
      : req.params.runId;
    if (!runId || runId.length === 0) {
      res.status(400).json({ error: "runId required" });
      return;
    }
    const result = await deps.memory.explain(tenantId, runId);
    res.json(result);
  });

  app.get("/tenants/:tenantId/graph", requireAuth, async (req, res) => {
    const authTenant = (req as AuthedRequest).tenantId;
    const tenantParse = tenantIdSchema.safeParse(req.params.tenantId);
    if (!tenantParse.success || tenantParse.data !== authTenant) {
      res.status(403).json({ error: "tenant mismatch" });
      return;
    }
    const customerId = req.query.customerId;
    if (typeof customerId !== "string" || customerId.length === 0) {
      res.status(400).json({ error: "customerId required" });
      return;
    }
    const graph = await deps.memory.getCustomerGraph(
      authTenant,
      customerId,
    );
    res.json(graph);
  });

  return app;
}

declare module "express-serve-static-core" {
  interface Request {
    log: Logger;
  }
}

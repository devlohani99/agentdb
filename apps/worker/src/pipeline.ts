import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { RedisClientType } from "redis";
import { runFollowup, runResolver, runTriage } from "@relay/agents";
import { MemoryStore } from "@relay/memory";
import type { HandoffMessage } from "@relay/shared";
import {
  STREAM_FOLLOWUP,
  STREAM_RESOLVE,
  STREAM_TRIAGE,
} from "@relay/shared";
import type { TaskMessage } from "@relay/agents";
import { publishProgress } from "./events.js";
import { scheduleFollowup } from "./followup-scheduler.js";
import { StreamConsumer } from "./stream-consumer.js";

export type PipelineDeps = {
  db: Db;
  redis: RedisClientType;
  redisUrl: string;
  memory: MemoryStore;
  consumerName: string;
};

export async function startPipeline(deps: PipelineDeps): Promise<{
  stop: () => Promise<void>;
}> {
  const ctx = {
    store: deps.memory,
    publish: async (event: Record<string, unknown>) => {
      const tenantId = String(event.tenantId ?? "");
      if (tenantId) {
        await publishProgress(deps.redis, tenantId, event);
      }
    },
  };

  const triage = new StreamConsumer({
    redisUrl: deps.redisUrl,
    stream: STREAM_TRIAGE,
    group: "triage-workers",
    consumerName: deps.consumerName,
    concurrency: 2,
    handler: async (msg) => {
      const ticketId = msg.ticketId;
      if (!ticketId) {
        throw new Error("missing ticketId");
      }
      const ticket = await deps.db
        .collection<{ _id: string; subject?: string; body?: string }>("tickets")
        .findOne({ _id: ticketId });
      if (!ticket) {
        throw new Error("ticket not found");
      }
      const { taskId } = await runTriage(ctx, msg, {
        tenantId: msg.tenantId,
        customerId: msg.customerId,
        subject: String(ticket.subject),
        body: String(ticket.body),
        ticketId,
      });
      await deps.redis.xAdd(STREAM_RESOLVE, "*", {
        idempotencyKey: randomUUID(),
        tenantId: msg.tenantId,
        taskId,
        customerId: msg.customerId,
        attempt: "0",
      });
    },
  });

  const resolve = new StreamConsumer({
    redisUrl: deps.redisUrl,
    stream: STREAM_RESOLVE,
    group: "resolve-workers",
    consumerName: deps.consumerName,
    concurrency: 2,
    handler: async (msg) => {
      if (!msg.taskId) {
        throw new Error("missing taskId");
      }
      await runResolver(ctx, msg as TaskMessage);
      await scheduleFollowup(deps.redis, Date.now() + 5_000, {
        idempotencyKey: randomUUID(),
        tenantId: msg.tenantId,
        taskId: msg.taskId,
        customerId: msg.customerId,
        attempt: "0",
      });
    },
  });

  const followup = new StreamConsumer({
    redisUrl: deps.redisUrl,
    stream: STREAM_FOLLOWUP,
    group: "followup-workers",
    consumerName: deps.consumerName,
    concurrency: 2,
    handler: async (msg) => {
      if (!msg.taskId) {
        throw new Error("missing taskId");
      }
      await runFollowup(ctx, msg as HandoffMessage & { taskId: string });
    },
  });

  await Promise.all([triage.connect(), resolve.connect(), followup.connect()]);
  await Promise.all([triage.start(), resolve.start(), followup.start()]);

  return {
    stop: async () => {
      await Promise.all([triage.stop(), resolve.stop(), followup.stop()]);
    },
  };
}

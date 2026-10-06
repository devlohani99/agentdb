import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeFalkor, getTenantGraph } from "./graph.js";
import { MemoryStore } from "./memory-store.js";
import { closeRedis } from "./redis.js";

const falkorUrl = process.env.FALKORDB_URL ?? "redis://127.0.0.1:6380";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const runIntegration = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!runIntegration)("MemoryStore integration", () => {
  const store = new MemoryStore({ falkorUrl, redisUrl });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();

  beforeAll(async () => {
    await store.initTenant(tenantA);
    await store.initTenant(tenantB);
  });

  afterAll(async () => {
    await closeRedis();
    await closeFalkor();
  });

  it("supersedes active facts with same key", async () => {
    const { sessionId } = await store.startSession(tenantA, customerA);
    const { eventId: e1 } = await store.appendEvent(tenantA, sessionId, {
      kind: "note",
      payload: "plan-basic",
    });
    await store.upsertFact(tenantA, customerA, "plan", "basic", 0.9, e1);
    const { eventId: e2 } = await store.appendEvent(tenantA, sessionId, {
      kind: "note",
      payload: "plan-pro",
    });
    await store.upsertFact(tenantA, customerA, "plan", "pro", 0.95, e2);
    const history = await store.getFactHistory(tenantA, customerA, "plan");
    expect(history).toHaveLength(2);
    const active = await store.getActiveFacts(tenantA, customerA);
    expect(active.find((f) => f.key === "plan")?.value).toBe("pro");
    const superseded = history.find((f) => f.status === "superseded");
    expect(superseded?.value).toBe("basic");
  });

  it("orders events on NEXT chain", async () => {
    const { sessionId } = await store.startSession(tenantA, customerA);
    await store.appendEvent(tenantA, sessionId, {
      kind: "a",
      payload: "1",
      ts: 1,
    });
    await store.appendEvent(tenantA, sessionId, {
      kind: "b",
      payload: "2",
      ts: 2,
    });
    await store.appendEvent(tenantA, sessionId, {
      kind: "c",
      payload: "3",
      ts: 3,
    });
    const timeline = await store.getSessionTimeline(tenantA, sessionId);
    expect(timeline.map((e) => e.kind)).toEqual(["a", "b", "c"]);
  });

  it("rejects stale CAS claim", async () => {
    const { sessionId } = await store.startSession(tenantA, customerA);
    const { eventId } = await store.appendEvent(tenantA, sessionId, {
      kind: "ticket",
      payload: "help",
    });
    const { taskId } = await store.createTask(
      tenantA,
      customerA,
      eventId,
      "billing",
    );
    const first = await store.claimTask(tenantA, taskId, "resolver", 0);
    expect(first.ok).toBe(true);
    const stale = await store.claimTask(tenantA, taskId, "resolver", 0);
    expect(stale.ok).toBe(false);
  });

  it("isolates tenants on separate graph handles", async () => {
    const { sessionId: sA } = await store.startSession(tenantA, customerA);
    const { eventId: evA } = await store.appendEvent(tenantA, sA, {
      kind: "secret",
      payload: "tenant-a-only",
    });
    await store.upsertFact(
      tenantA,
      customerA,
      "token",
      "alpha",
      1,
      evA,
    );

    const { sessionId: sB } = await store.startSession(tenantB, customerB);
    const { eventId: evB } = await store.appendEvent(tenantB, sB, {
      kind: "secret",
      payload: "tenant-b-only",
    });
    await store.upsertFact(
      tenantB,
      customerB,
      "token",
      "beta",
      1,
      evB,
    );

    const graphA = await getTenantGraph(tenantA, falkorUrl);
    const leak = await graphA.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_FACT]->(f:Fact)
       RETURN f.value AS value`,
      { params: { customerId: customerB } },
    );
    const values = (leak.data ?? []).filter((v) => v !== null);
    expect(values.length).toBe(0);

    const factsA = await store.getActiveFacts(tenantA, customerB);
    expect(factsA).toHaveLength(0);
  });
});

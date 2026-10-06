import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterAll, describe, expect, it } from "vitest";
import { StreamConsumer } from "./stream-consumer.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const runIntegration = process.env.RUN_INTEGRATION === "1";

describe.skipIf(!runIntegration)("StreamConsumer reclaim", () => {
  const stream = `stream:test:${randomUUID()}`;
  const group = "test-group";
  const workKey = `relay:test:work:${randomUUID()}`;

  afterAll(async () => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.del(stream);
    await redis.del(workKey);
    await redis.quit();
  });

  it("reclaims pending work and applies side effects once", async () => {
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.xGroupCreate(stream, group, "0", { MKSTREAM: true });

    const idempotencyKey = randomUUID();
    await redis.xAdd(stream, "*", {
      idempotencyKey,
      tenantId: "demo",
      customerId: randomUUID(),
      attempt: "0",
    });

    const consumerA = new StreamConsumer({
      redisUrl,
      stream,
      group,
      consumerName: "a",
      concurrency: 1,
      handler: async () => {
        throw new Error("simulated crash before ack");
      },
    });
    await consumerA.connect();
    await consumerA.start();
    await new Promise((r) => setTimeout(r, 3000));
    await consumerA.stop();

    const consumerB = new StreamConsumer({
      redisUrl,
      stream,
      group,
      consumerName: "b",
      concurrency: 1,
      handler: async () => {
        await redis.incr(workKey);
      },
    });
    await consumerB.connect();
    await consumerB.start();
    await new Promise((r) => setTimeout(r, 10_000));
    await consumerB.stop();

    const workCount = await redis.get(workKey);
    await redis.quit();

    expect(workCount).toBe("1");
  }, 25_000);
});

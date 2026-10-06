import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { RedisClientType } from "redis";
import { STREAM_TRIAGE } from "@relay/shared";

export async function relayOutboxOnce(
  db: Db,
  redis: RedisClientType,
): Promise<number> {
  const rows = await db
    .collection("outbox")
    .find({ published: false })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  let count = 0;
  for (const row of rows) {
    const payload = row.payload as {
      ticketId: string;
      tenantId: string;
      customerId: string;
    };
    await redis.xAdd(STREAM_TRIAGE, "*", {
      idempotencyKey: randomUUID(),
      tenantId: payload.tenantId,
      ticketId: payload.ticketId,
      customerId: payload.customerId,
      attempt: "0",
    });
    await db
      .collection("outbox")
      .updateOne({ _id: row._id }, { $set: { published: true } });
    count += 1;
  }
  return count;
}

export function startOutboxRelay(
  db: Db,
  redis: RedisClientType,
  intervalMs = 1000,
): { stop: () => void } {
  let active = true;
  const tick = async () => {
    while (active) {
      try {
        await relayOutboxOnce(db, redis);
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void tick();
  return {
    stop: () => {
      active = false;
    },
  };
}

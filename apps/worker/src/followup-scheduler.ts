import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { FOLLOWUP_DELAY_ZSET, STREAM_FOLLOWUP } from "@relay/shared";

export async function scheduleFollowup(
  redis: RedisClientType,
  runAtMs: number,
  fields: Record<string, string>,
): Promise<void> {
  await redis.zAdd(FOLLOWUP_DELAY_ZSET, {
    score: runAtMs,
    value: JSON.stringify(fields),
  });
}

export function startFollowupScheduler(
  redis: RedisClientType,
  intervalMs = 2000,
): { stop: () => void } {
  let active = true;
  const tick = async () => {
    while (active) {
      try {
        const now = Date.now();
        const due = await redis.zRangeByScore(FOLLOWUP_DELAY_ZSET, 0, now, {
          LIMIT: { offset: 0, count: 20 },
        });
        for (const item of due) {
          const fields = JSON.parse(item) as Record<string, string>;
          await redis.xAdd(STREAM_FOLLOWUP, "*", {
            ...fields,
            idempotencyKey: fields.idempotencyKey ?? randomUUID(),
          });
          await redis.zRem(FOLLOWUP_DELAY_ZSET, item);
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void tick();
  return { stop: () => { active = false; } };
}

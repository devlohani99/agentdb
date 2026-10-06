import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { TASK_LOCK_PREFIX } from "@relay/shared";

let redis: RedisClientType | null = null;

export async function getRedis(url: string): Promise<RedisClientType> {
  if (redis?.isOpen) {
    return redis;
  }
  redis = createClient({ url });
  redis.on("error", () => undefined);
  await redis.connect();
  return redis;
}

export async function withTaskLock(
  redisUrl: string,
  taskId: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = await getRedis(redisUrl);
  const key = `${TASK_LOCK_PREFIX}${taskId}`;
  const token = randomUUID();
  const acquired = await client.set(key, token, { NX: true, PX: ttlMs });
  if (acquired !== "OK") {
    return false;
  }
  try {
    await fn();
    return true;
  } finally {
    const current = await client.get(key);
    if (current === token) {
      await client.del(key);
    }
  }
}

export async function closeRedis(): Promise<void> {
  if (redis?.isOpen) {
    await redis.quit();
  }
  redis = null;
}

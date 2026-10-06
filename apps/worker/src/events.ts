import type { RedisClientType } from "redis";
import { SSE_CHANNEL_PREFIX } from "@relay/shared";

export async function publishProgress(
  redis: RedisClientType,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await redis.publish(
    `${SSE_CHANNEL_PREFIX}${tenantId}`,
    JSON.stringify({ at: Date.now(), ...payload }),
  );
}

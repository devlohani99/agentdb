import type { Response } from "express";
import type { RedisClientType } from "redis";
import { SSE_CHANNEL_PREFIX } from "@relay/shared";

export function openSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

export async function subscribeTenantEvents(
  redis: RedisClientType,
  tenantId: string,
  res: Response,
  signal: AbortSignal,
): Promise<void> {
  const sub = redis.duplicate();
  await sub.connect();
  const channel = `${SSE_CHANNEL_PREFIX}${tenantId}`;
  await sub.subscribe(channel, (message) => {
    res.write(`data: ${message}\n\n`);
  });
  signal.addEventListener("abort", () => {
    void sub.unsubscribe(channel).finally(() => sub.quit());
  });
}

export async function publishTenantEvent(
  redis: RedisClientType,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await redis.publish(
    `${SSE_CHANNEL_PREFIX}${tenantId}`,
    JSON.stringify(payload),
  );
}

import type { RedisClientType } from "redis";
import { MAX_STREAM_PENDING, STREAM_TRIAGE } from "@relay/shared";

type GroupInfo = {
  name?: string;
  pending?: number;
};

export async function streamBackpressure(
  redis: RedisClientType,
): Promise<{ blocked: boolean; pending: number }> {
  let pending = 0;
  try {
    const groups = (await redis.xInfoGroups(STREAM_TRIAGE)) as GroupInfo[];
    for (const group of groups) {
      pending += Number(group.pending ?? 0);
    }
  } catch {
    pending = Number(await redis.xLen(STREAM_TRIAGE));
  }
  return { blocked: pending > MAX_STREAM_PENDING, pending };
}

export const STREAM_TRIAGE = "stream:triage";
export const STREAM_RESOLVE = "stream:resolve";
export const STREAM_FOLLOWUP = "stream:followup";
export const STREAM_DLQ = "stream:dlq";

export const GLOBAL_PLAYBOOKS_GRAPH = "global_playbooks";

export const SSE_CHANNEL_PREFIX = "relay:sse:";

export const IDEMPOTENCY_PREFIX = "relay:idempotency:";
export const TASK_LOCK_PREFIX = "relay:lock:task:";

export const FOLLOWUP_DELAY_ZSET = "relay:followup:schedule";

export const MAX_STREAM_PENDING = 500;
export const RATE_LIMIT_TOKENS = 60;
export const RATE_LIMIT_REFILL_MS = 60_000;

import type { RedisClientType } from "redis";
import { RATE_LIMIT_REFILL_MS, RATE_LIMIT_TOKENS } from "@relay/shared";

const LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local max_tokens = tonumber(ARGV[3])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = max_tokens
  ts = now
end
local delta = math.max(0, now - ts)
local refill_tokens = math.floor(delta / refill * max_tokens)
tokens = math.min(max_tokens, tokens + refill_tokens)
if tokens < 1 then
  redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', key, refill * 2)
  return 0
end
tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, refill * 2)
return 1
`;

export async function consumeRateLimit(
  redis: RedisClientType,
  tenantId: string,
): Promise<boolean> {
  const key = `relay:ratelimit:${tenantId}`;
  const allowed = await redis.eval(LUA, {
    keys: [key],
    arguments: [
      String(Date.now()),
      String(RATE_LIMIT_REFILL_MS),
      String(RATE_LIMIT_TOKENS),
    ],
  });
  return Number(allowed) === 1;
}

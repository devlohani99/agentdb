import { createClient, type RedisClientType } from "redis";
import {
  IDEMPOTENCY_PREFIX,
  STREAM_DLQ,
  parseStreamFields,
  type HandoffMessage,
} from "@relay/shared";

export type StreamHandler = (
  message: HandoffMessage,
  raw: Record<string, string>,
) => Promise<void>;

export type StreamConsumerOptions = {
  redisUrl: string;
  stream: string;
  group: string;
  consumerName: string;
  concurrency: number;
  handler: StreamHandler;
  onError?: (err: unknown, raw: Record<string, string>) => void;
};

function fieldsArrayToRecord(
  entries: string[] | Record<string, string>,
): Record<string, string> {
  if (Array.isArray(entries)) {
    const out: Record<string, string> = {};
    for (let i = 0; i < entries.length; i += 2) {
      const k = entries[i];
      const v = entries[i + 1];
      if (k && v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }
  return entries;
}

export class StreamConsumer {
  private readonly redis: RedisClientType;
  private running = false;
  private inFlight = 0;

  constructor(private readonly opts: StreamConsumerOptions) {
    this.redis = createClient({ url: opts.redisUrl });
  }

  async connect(): Promise<void> {
    this.redis.on("error", () => undefined);
    await this.redis.connect();
    try {
      await this.redis.xGroupCreate(this.opts.stream, this.opts.group, "0", {
        MKSTREAM: true,
      });
    } catch {
      /* group exists */
    }
  }

  async start(): Promise<void> {
    this.running = true;
    void this.autoClaimLoop();
    for (let i = 0; i < this.opts.concurrency; i++) {
      void this.readLoop(i);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }

  private attemptKey(messageId: string): string {
    return `relay:attempt:${this.opts.stream}:${messageId}`;
  }

  private async autoClaimLoop(): Promise<void> {
    while (this.running) {
      try {
        const claimed = await this.redis.xAutoClaim(
          this.opts.stream,
          this.opts.group,
          this.opts.consumerName,
          60_000,
          "0-0",
          { COUNT: 10 },
        );
        const messages = claimed.messages ?? [];
        for (const msg of messages) {
          if (!msg || !msg.message) {
            continue;
          }
          const raw = fieldsArrayToRecord(msg.message);
          await this.processMessage(msg.id, raw);
        }
      } catch {
        /* retry loop */
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  private async readLoop(workerId: number): Promise<void> {
    const consumer = `${this.opts.consumerName}-${workerId}`;
    while (this.running) {
      try {
        const batch = await this.redis.xReadGroup(
          this.opts.group,
          consumer,
          [{ key: this.opts.stream, id: ">" }],
          { COUNT: 1, BLOCK: 5000 },
        );
        if (!batch) {
          continue;
        }
        for (const stream of batch) {
          for (const msg of stream.messages) {
            if (!msg || !msg.message) {
              continue;
            }
            const raw = fieldsArrayToRecord(msg.message);
            await this.processMessage(msg.id, raw);
          }
        }
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  private async processMessage(
    id: string,
    raw: Record<string, string>,
  ): Promise<void> {
    this.inFlight += 1;
    try {
      const parsed = parseStreamFields(raw);
      const idemKey = `${IDEMPOTENCY_PREFIX}${parsed.idempotencyKey}`;
      if (await this.redis.get(idemKey)) {
        await this.redis.xAck(this.opts.stream, this.opts.group, id);
        return;
      }
      try {
        await this.opts.handler(parsed, raw);
        await this.redis.set(idemKey, "1", { EX: 86_400 });
        await this.redis.xAck(this.opts.stream, this.opts.group, id);
        await this.redis.del(this.attemptKey(id));
      } catch (err) {
        this.opts.onError?.(err, raw);
        const attempts = await this.redis.incr(this.attemptKey(id));
        if (attempts >= 5) {
          await this.redis.xAdd(STREAM_DLQ, "*", {
            ...raw,
            error: err instanceof Error ? err.message : "unknown",
          });
          await this.redis.xAck(this.opts.stream, this.opts.group, id);
          await this.redis.del(this.attemptKey(id));
        }
      }
    } finally {
      this.inFlight -= 1;
    }
  }
}

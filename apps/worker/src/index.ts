import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createClient } from "redis";
import { MemoryStore } from "@relay/memory";
import { createLogger, loadEnv } from "@relay/shared";
import { closeMongo, connectMongo } from "./mongo.js";
import { startFollowupScheduler } from "./followup-scheduler.js";
import { startOutboxRelay } from "./outbox-relay.js";
import { startPipeline } from "./pipeline.js";

const env = loadEnv();
const log = createLogger(env);
const consumerName = `worker-${randomUUID().slice(0, 8)}`;

async function main() {
  const db = await connectMongo(env);
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (err) => log.warn({ err }, "redis error"));
  await redis.connect();
  const memory = new MemoryStore({
    falkorUrl: env.FALKORDB_URL,
    redisUrl: env.REDIS_URL,
  });

  const outbox = startOutboxRelay(db, redis);
  const followupScheduler = startFollowupScheduler(redis);
  const pipeline = await startPipeline({
    db,
    redis,
    redisUrl: env.REDIS_URL,
    memory,
    consumerName,
  });

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "worker", consumerName }));
  });
  server.listen(env.PORT, () => {
    log.info({ port: env.PORT, consumerName }, "worker listening");
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker shutting down");
    outbox.stop();
    followupScheduler.stop();
    await pipeline.stop();
    server.close();
    await redis.quit();
    await closeMongo();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});

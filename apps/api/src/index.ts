import { createClient } from "redis";
import { MemoryStore } from "@relay/memory";
import { createLogger, loadEnv } from "@relay/shared";
import { createApp } from "./app.js";
import { closeMongo, connectMongo, ensureDemoTenant, ensureIndexes } from "./mongo.js";

const env = loadEnv();
const log = createLogger(env);

async function main() {
  const db = await connectMongo(env);
  await ensureIndexes(db);
  await ensureDemoTenant(db);
  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (err) => log.warn({ err }, "redis error"));
  await redis.connect();
  const memory = new MemoryStore({
    falkorUrl: env.FALKORDB_URL,
    redisUrl: env.REDIS_URL,
  });
  const app = createApp({ env, log, db, redis, memory });
  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT }, "api listening");
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "api shutting down");
    server.close();
    await redis.quit();
    await closeMongo();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "api failed to start");
  process.exit(1);
});

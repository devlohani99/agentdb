import pino from "pino";
import type { Env } from "./env.js";

export type Logger = pino.Logger;

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">): Logger {
  const isDev = env.NODE_ENV === "development";
  return pino({
    level: env.LOG_LEVEL,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          },
        }
      : {}),
  });
}

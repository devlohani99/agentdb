import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const CORRELATION_HEADER = "x-correlation-id";

export function generateCorrelationId(): string {
  return randomUUID();
}

export function correlationIdFromRequest(req: IncomingMessage): string {
  const raw = req.headers[CORRELATION_HEADER];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw) && raw[0] && raw[0].length > 0) {
    return raw[0];
  }
  return generateCorrelationId();
}

export function withCorrelation<T extends Record<string, unknown>>(
  logFields: T,
  correlationId: string,
): T & { correlationId: string } {
  return { ...logFields, correlationId };
}

import { z } from "zod";

export const tenantIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, "invalid tenant id");

export const createTicketSchema = z.object({
  customerId: z.string().min(1).max(128),
  subject: z.string().min(1).max(512),
  body: z.string().min(1).max(16_384),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const handoffMessageSchema = z.object({
  idempotencyKey: z.string().uuid(),
  tenantId: z.string(),
  taskId: z.string().uuid().optional(),
  ticketId: z.string().uuid().optional(),
  customerId: z.string(),
  correlationId: z.string().optional(),
  attempt: z.coerce.number().int().nonnegative().default(0),
});

export function parseStreamFields(
  fields: Record<string, string>,
): HandoffMessage {
  return handoffMessageSchema.parse(fields);
}

export type HandoffMessage = z.infer<typeof handoffMessageSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  labels: z.array(z.string()),
  properties: z.record(z.unknown()),
});

export const graphEdgeSchema = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  target: z.string(),
  properties: z.record(z.unknown()).optional(),
});

export const graphSnapshotSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

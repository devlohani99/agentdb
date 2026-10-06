import type { MemoryStore } from "@relay/memory";
import type { HandoffMessage } from "@relay/shared";
import { createLlmProvider } from "./llm.js";

export type TicketPayload = {
  tenantId: string;
  customerId: string;
  subject: string;
  body: string;
  ticketId: string;
};

export type AgentContext = {
  store: MemoryStore;
  publish?: (event: Record<string, unknown>) => Promise<void>;
};

async function classifyIssueType(
  subject: string,
  body: string,
): Promise<string> {
  const llm = createLlmProvider();
  const s = await llm.complete([
    {
      role: "user",
      content: `classify: ${subject}\n${body}`,
    },
  ]);
  return s.trim().toLowerCase();
}

export async function runTriage(
  ctx: AgentContext,
  msg: HandoffMessage,
  ticket: TicketPayload,
): Promise<{ taskId: string; issueType: string }> {
  const issueType = await classifyIssueType(ticket.subject, ticket.body);
  const { sessionId } = await ctx.store.startSession(msg.tenantId, msg.customerId);
  const { eventId } = await ctx.store.appendEvent(msg.tenantId, sessionId, {
    kind: "ticket",
    payload: JSON.stringify({
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      body: ticket.body,
    }),
  });
  await ctx.store.upsertFact(
    msg.tenantId,
    msg.customerId,
    "last_issue_type",
    issueType,
    0.85,
    eventId,
  );
  const { taskId } = await ctx.store.createTask(
    msg.tenantId,
    msg.customerId,
    eventId,
    issueType,
  );
  const snapshot = JSON.stringify({ issueType, subject: ticket.subject, eventId });
  const { runId } = await ctx.store.handoffTask(
    msg.tenantId,
    taskId,
    "triage",
    "resolver",
    snapshot,
  );
  await ctx.store.recordAgentRunIO(msg.tenantId, runId, [eventId], [eventId]);
  await ctx.publish?.({
    stage: "triage",
    taskId,
    issueType,
    tenantId: msg.tenantId,
    runId,
    at: Date.now(),
  });
  return { taskId, issueType };
}

export type TaskMessage = HandoffMessage & { taskId: string };

export async function runResolver(
  ctx: AgentContext,
  msg: TaskMessage,
): Promise<{ success: boolean; reply: string }> {
  const claim = await ctx.store.claimTask(msg.tenantId, msg.taskId, "resolver", 0);
  if (!claim.ok) {
    throw new Error("task claim failed");
  }
  const recall = await ctx.store.recall(msg.tenantId, msg.customerId, "issue");
  const playbook = await ctx.store.findBestPlaybook(
    msg.tenantId,
    String(recall.facts.find((f) => f.key === "last_issue_type")?.value ?? "general"),
  );
  let reply: string;
  if (playbook && Number(playbook.successRate ?? 0) > 0.7) {
    reply = `Playbook ${String(playbook.issueType)}: ${String((playbook.steps as string[] | undefined)?.[0] ?? "standard steps")}`;
  } else {
    const llm = createLlmProvider();
    reply = await llm.complete([
      { role: "user", content: `resolve: ${JSON.stringify(recall.events.slice(0, 3))}` },
    ]);
  }
  const issueType = String(
    recall.facts.find((f) => f.key === "last_issue_type")?.value ?? "general",
  );
  await ctx.store.recordOutcome(
    msg.tenantId,
    issueType,
    playbook?.steps ? (playbook.steps as string[]) : ["investigate", "respond"],
    true,
  );
  await ctx.store.completeTask(msg.tenantId, msg.taskId, true, issueType);
  const readIds = recall.nodeIds;
  const { runId } = await ctx.store.handoffTask(
    msg.tenantId,
    msg.taskId,
    "resolver",
    "followup",
    JSON.stringify({ reply }),
  );
  await ctx.store.recordAgentRunIO(msg.tenantId, runId, readIds, []);
  await ctx.publish?.({
    stage: "resolver",
    taskId: msg.taskId,
    reply,
    tenantId: msg.tenantId,
    runId,
    at: Date.now(),
  });
  return { success: true, reply };
}

export async function runFollowup(
  ctx: AgentContext,
  msg: TaskMessage,
): Promise<void> {
  const recall = await ctx.store.recall(msg.tenantId, msg.customerId, "outcome");
  const issueType = String(
    recall.facts.find((f) => f.key === "last_issue_type")?.value ?? "general",
  );
  await ctx.store.recordOutcome(
    msg.tenantId,
    issueType,
    ["confirm_resolution"],
    true,
  );
  await ctx.store.upsertFact(
    msg.tenantId,
    msg.customerId,
    "last_resolved_at",
    String(Date.now()),
    0.8,
    String(recall.events[0]?.id ?? msg.taskId),
  );
  const { runId } = await ctx.store.handoffTask(
    msg.tenantId,
    msg.taskId,
    "followup",
    "done",
    JSON.stringify({ status: "closed" }),
  );
  await ctx.store.recordAgentRunIO(msg.tenantId, runId, recall.nodeIds, []);
  await ctx.publish?.({
    stage: "followup",
    taskId: msg.taskId,
    tenantId: msg.tenantId,
    runId,
    at: Date.now(),
  });
}

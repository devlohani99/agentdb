export type AgentEvent = {
  at: number;
  stage?: string;
  taskId?: string;
  issueType?: string;
  reply?: string;
  runId?: string;
  tenantId?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  runId?: string;
  at: number;
};

export type TaskHop = {
  stage: string;
  at: number;
  taskId: string;
};

export type PlaybookPoint = {
  at: number;
  issueType: string;
  successRate: number;
};

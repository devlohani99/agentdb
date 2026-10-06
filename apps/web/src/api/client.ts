import { API_BASE } from "../config/demo.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(`HTTP ${res.status}`, res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as T;
}

export type GraphSnapshot = {
  nodes: Array<{
    id: string;
    type?: string;
    label?: string;
    properties?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }>;
};

export type ExplainResult = {
  nodes: Array<{ id: string; reason?: string; labels?: string[] }>;
  edges: Array<{ source: string; target: string; type: string }>;
};

export function createTicket(
  apiKey: string,
  body: { customerId: string; subject: string; body: string },
) {
  return request<{ ticketId: string }>("/tickets", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchGraph(
  apiKey: string,
  tenantId: string,
  customerId: string,
) {
  return request<GraphSnapshot>(
    `/tenants/${tenantId}/graph?customerId=${encodeURIComponent(customerId)}`,
    apiKey,
  );
}

export function fetchExplain(apiKey: string, runId: string) {
  return request<ExplainResult>(`/runs/${runId}/explain`, apiKey);
}

export function fetchMetrics() {
  return fetch(`${API_BASE}/metrics`).then((r) => r.text());
}

export function fetchIsolationProbe(
  apiKey: string,
  otherTenantId: string,
  customerId: string,
) {
  return request<GraphSnapshot>(
    `/tenants/${otherTenantId}/graph?customerId=${encodeURIComponent(customerId)}`,
    apiKey,
  );
}

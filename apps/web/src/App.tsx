import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createTicket,
  fetchExplain,
  fetchGraph,
  fetchIsolationProbe,
  type GraphSnapshot,
} from "./api/client.js";
import { ActivityFeed } from "./components/ActivityFeed.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { ForceGraphView } from "./components/ForceGraphView.js";
import { LoadPanel } from "./components/LoadPanel.js";
import { PlaybookPanel } from "./components/PlaybookPanel.js";
import { TaskTimeline } from "./components/TaskTimeline.js";
import { DEMO_TENANTS } from "./config/demo.js";
import { useMetrics } from "./hooks/useMetrics.js";
import { useSse } from "./hooks/useSse.js";
import type {
  AgentEvent,
  ChatMessage,
  PlaybookPoint,
  TaskHop,
} from "./types.js";

export function App() {
  const [tenantIdx, setTenantIdx] = useState(0);
  const [customerIdx, setCustomerIdx] = useState(0);
  const [compareIsolation, setCompareIsolation] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [graphB, setGraphB] = useState<GraphSnapshot | null>(null);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [explainReasons, setExplainReasons] = useState<Map<string, string>>(
    new Map(),
  );
  const [hops, setHops] = useState<TaskHop[]>([]);
  const [playbookPoints, setPlaybookPoints] = useState<PlaybookPoint[]>([]);
  const [isolationResult, setIsolationResult] = useState<string>("");
  const metrics = useMetrics();

  const tenant = DEMO_TENANTS[tenantIdx] ?? DEMO_TENANTS[0]!;
  const customer = tenant.customers[customerIdx] ?? tenant.customers[0]!;
  const otherTenant = DEMO_TENANTS.find((t) => t.id !== tenant.id);

  const refreshGraph = useCallback(async () => {
    try {
      const g = await fetchGraph(tenant.apiKey, tenant.id, customer.id);
      setGraph(g);
      if (compareIsolation && otherTenant) {
        const g2 = await fetchGraph(
          otherTenant.apiKey,
          otherTenant.id,
          otherTenant.customers[0]!.id,
        );
        setGraphB(g2);
      }
    } catch {
      setGraph(null);
    }
  }, [tenant, customer, compareIsolation, otherTenant]);

  useEffect(() => {
    void refreshGraph();
    const id = setInterval(() => void refreshGraph(), 5000);
    return () => clearInterval(id);
  }, [refreshGraph]);

  useSse(tenant.apiKey, (ev) => {
    setEvents((prev) => [...prev.slice(-99), ev]);
    if (ev.stage && ev.taskId) {
      setHops((prev) => [
        ...prev,
        { stage: ev.stage!, at: ev.at, taskId: ev.taskId! },
      ]);
    }
    if (ev.stage === "resolver" && ev.reply) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${ev.at}-agent`,
          role: "agent",
          text: ev.reply!,
          runId: ev.runId,
          at: ev.at,
        },
      ]);
      if (ev.issueType) {
        setPlaybookPoints((prev) => [
          ...prev,
          { at: ev.at, issueType: ev.issueType!, successRate: 0.85 },
        ]);
      }
    }
    void refreshGraph().then(() => {
      setPulseIds((prev) => {
        const next = new Set(prev);
        graph?.nodes.slice(-3).forEach((n) => next.add(n.id));
        return next;
      });
      setTimeout(() => setPulseIds(new Set()), 2500);
    });
  });

  const handleSend = async (text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: "user", text, at: Date.now() },
    ]);
    await createTicket(tenant.apiKey, {
      customerId: customer.id,
      subject: text.slice(0, 80),
      body: text,
    });
    void refreshGraph();
  };

  const handleExplain = async (runId: string) => {
    try {
      const ex = await fetchExplain(tenant.apiKey, runId);
      const ids = new Set(ex.nodes.map((n) => String(n.id)));
      const reasons = new Map(
        ex.nodes.map((n) => [String(n.id), String(n.reason ?? "Used in run")]),
      );
      setHighlightIds(ids);
      setExplainReasons(reasons);
    } catch {
      setHighlightIds(new Set());
      setExplainReasons(new Map());
    }
  };

  const runIsolationTest = async () => {
    if (!otherTenant) return;
    try {
      await fetchIsolationProbe(
        tenant.apiKey,
        otherTenant.id,
        otherTenant.customers[0]!.id,
      );
      setIsolationResult("Unexpected: cross-tenant read succeeded");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setIsolationResult("Blocked — tenant mismatch (403)");
      } else {
        setIsolationResult(`Rejected — ${err instanceof Error ? err.message : "error"}`);
      }
    }
  };

  const tenantOptions = useMemo(() => DEMO_TENANTS, []);

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-900/80">
        <h1 className="text-lg font-semibold tracking-tight mr-4">Relay</h1>
        <label className="text-xs text-slate-400">
          Tenant
          <select
            className="ml-2 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm"
            value={tenantIdx}
            onChange={(e) => {
              setTenantIdx(Number(e.target.value));
              setCustomerIdx(0);
              setMessages([]);
              setEvents([]);
            }}
          >
            {tenantOptions.map((t, i) => (
              <option key={t.id} value={i}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Customer
          <select
            className="ml-2 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm"
            value={customerIdx}
            onChange={(e) => setCustomerIdx(Number(e.target.value))}
          >
            {tenant.customers.map((c, i) => (
              <option key={c.id} value={i}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400 ml-auto">
          <input
            type="checkbox"
            checked={compareIsolation}
            onChange={(e) => setCompareIsolation(e.target.checked)}
          />
          Side-by-side tenants
        </label>
        <button
          type="button"
          className="rounded-md border border-red-500/40 px-3 py-1 text-xs hover:bg-red-950/40"
          onClick={() => void runIsolationTest()}
        >
          Isolation test
        </button>
        {isolationResult && (
          <span className="text-xs text-amber-300">{isolationResult}</span>
        )}
      </header>

      <div className="flex-1 grid grid-cols-12 min-h-0">
        <div className="col-span-3 min-h-0">
          <ChatPanel
            tenantName={tenant.name}
            customerName={customer.name}
            messages={messages}
            onSend={(t) => void handleSend(t)}
            onAgentClick={(id) => void handleExplain(id)}
          />
        </div>

        <div className="col-span-6 p-3 min-h-0 flex flex-col gap-3 overflow-y-auto">
          {compareIsolation && otherTenant ? (
            <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              <ForceGraphView
                data={graph}
                pulseIds={pulseIds}
                highlightIds={highlightIds}
                explainReasons={explainReasons}
                title={tenant.name}
              />
              <ForceGraphView
                data={graphB}
                pulseIds={new Set()}
                highlightIds={new Set()}
                explainReasons={new Map()}
                title={otherTenant.name}
              />
            </div>
          ) : (
            <ForceGraphView
              data={graph}
              pulseIds={pulseIds}
              highlightIds={highlightIds}
              explainReasons={explainReasons}
            />
          )}
          {highlightIds.size > 0 && (
            <p className="text-xs text-pink-300 px-1">
              Highlighting {highlightIds.size} nodes from agent explain(runId)
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <PlaybookPanel points={playbookPoints} />
            <TaskTimeline hops={hops} />
          </div>
          <LoadPanel
            apiKey={tenant.apiKey}
            customerId={customer.id}
            metrics={metrics}
          />
        </div>

        <div className="col-span-3 min-h-0">
          <ActivityFeed
            events={events}
            onSelectRun={(id) => void handleExplain(id)}
          />
        </div>
      </div>
    </div>
  );
}

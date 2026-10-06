import type { AgentEvent } from "../types.js";

type Props = {
  events: AgentEvent[];
  onSelectRun: (runId: string) => void;
};

export function ActivityFeed({ events, onSelectRun }: Props) {
  return (
    <section className="flex flex-col h-full border-l border-slate-800 bg-slate-900/40">
      <header className="px-4 py-3 border-b border-slate-800">
        <h2 className="font-medium text-slate-100">Agent activity</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {events.length === 0 && (
          <p className="text-sm text-slate-500">Waiting for SSE events…</p>
        )}
        {[...events].reverse().map((ev, i) => (
          <button
            key={`${ev.at}-${i}`}
            type="button"
            className="w-full text-left rounded-md border border-slate-800 bg-slate-950/80 p-2 hover:border-pink-500/40"
            onClick={() => ev.runId && onSelectRun(ev.runId)}
          >
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="uppercase">{ev.stage ?? "event"}</span>
              <span>{new Date(ev.at).toLocaleTimeString()}</span>
            </div>
            <p className="text-sm text-slate-200 mt-1 truncate">
              {ev.reply ?? ev.issueType ?? ev.taskId ?? "update"}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

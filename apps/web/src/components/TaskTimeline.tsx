import type { TaskHop } from "../types.js";

type Props = {
  hops: TaskHop[];
};

const STAGES = ["triage", "resolver", "followup"];

export function TaskTimeline({ hops }: Props) {
  const byTask = hops.reduce<Map<string, TaskHop[]>>((acc, hop) => {
    const list = acc.get(hop.taskId) ?? [];
    list.push(hop);
    acc.set(hop.taskId, list);
    return acc;
  }, new Map());

  const latest = [...byTask.entries()].slice(-3);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <h3 className="text-sm font-medium text-slate-200 mb-2">Task handoffs</h3>
      {latest.length === 0 ? (
        <p className="text-xs text-slate-500">No handoffs yet.</p>
      ) : (
        <div className="space-y-3">
          {latest.map(([taskId, taskHops]) => {
            const ordered = STAGES.map((stage) =>
              taskHops.find((h) => h.stage === stage),
            ).filter(Boolean) as TaskHop[];
            return (
              <div key={taskId} className="text-xs">
                <p className="text-slate-500 truncate mb-1">{taskId}</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {ordered.map((hop, idx) => {
                    const prev = ordered[idx - 1];
                    const latency = prev ? hop.at - prev.at : 0;
                    return (
                      <span key={`${hop.stage}-${hop.at}`} className="flex items-center gap-1">
                        {idx > 0 && (
                          <span className="text-slate-600">{latency}ms →</span>
                        )}
                        <span className="rounded bg-slate-800 px-2 py-0.5 capitalize">
                          {hop.stage}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

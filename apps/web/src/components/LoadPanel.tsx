import { useState } from "react";
import { createTicket } from "../api/client.js";
import type { MetricsSnapshot } from "../hooks/useMetrics.js";

type Props = {
  apiKey: string;
  customerId: string;
  metrics: MetricsSnapshot;
};

export function LoadPanel({ apiKey, customerId, metrics }: Props) {
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 space-y-2">
      <h3 className="text-sm font-medium text-slate-200">Simulate load</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-950 p-2">
          <p className="text-slate-500">Throughput</p>
          <p className="text-lg text-emerald-400">{metrics.throughput.toFixed(2)}/s</p>
        </div>
        <div className="rounded bg-slate-950 p-2">
          <p className="text-slate-500">p95 latency</p>
          <p className="text-lg text-amber-400">{metrics.p95Ms.toFixed(0)} ms</p>
        </div>
      </div>
      <button
        type="button"
        disabled={running}
        className="w-full rounded-md bg-emerald-700/80 py-2 text-sm hover:bg-emerald-600 disabled:opacity-50"
        onClick={async () => {
          setRunning(true);
          let count = 0;
          for (let i = 0; i < 10; i++) {
            await createTicket(apiKey, {
              customerId,
              subject: `Load test ${Date.now()}`,
              body: "Automated load simulation ticket",
            });
            count += 1;
            setSent(count);
          }
          setRunning(false);
        }}
      >
        {running ? "Sending…" : `Burst 10 tickets (${sent} sent)`}
      </button>
    </section>
  );
}

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { PlaybookPoint } from "../types.js";

type Props = {
  points: PlaybookPoint[];
};

export function PlaybookPanel({ points }: Props) {
  const data = points.map((p) => ({
    time: new Date(p.at).toLocaleTimeString(),
    rate: Math.round(p.successRate * 100),
    issueType: p.issueType,
  }));

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <h3 className="text-sm font-medium text-slate-200 mb-2">Playbook success rate</h3>
      <div className="h-36">
        {data.length === 0 ? (
          <p className="text-xs text-slate-500">Resolve tickets to populate chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
              />
              <Line type="monotone" dataKey="rate" stroke="#14b8a6" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

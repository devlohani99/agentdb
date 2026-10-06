import { useEffect, useRef, useState } from "react";
import { fetchMetrics } from "../api/client.js";

export type MetricsSnapshot = {
  throughput: number;
  p95Ms: number;
};

function parseHistogram(text: string): { p95Ms: number; count: number } {
  const lines = text.split("\n");
  let count = 0;
  const buckets: Array<{ le: number; count: number }> = [];
  for (const line of lines) {
    if (!line.startsWith("relay_http_request_duration_seconds_bucket")) continue;
    const leMatch = line.match(/le="([^"]+)"/);
    const valMatch = line.match(/\s(\d+(?:\.\d+)?)$/);
    if (!leMatch || !valMatch) continue;
    const le = leMatch[1] === "+Inf" ? Infinity : Number(leMatch[1]);
    buckets.push({ le, count: Number(valMatch[1]) });
  }
  for (const line of lines) {
    if (!line.startsWith("relay_http_request_duration_seconds_count")) continue;
    const valMatch = line.match(/\s(\d+(?:\.\d+)?)$/);
    if (valMatch) count = Number(valMatch[1]);
  }
  if (buckets.length === 0 || count === 0) {
    return { p95Ms: 0, count: 0 };
  }
  buckets.sort((a, b) => a.le - b.le);
  const target = count * 0.95;
  let p95 = buckets[buckets.length - 1]?.le ?? 0;
  for (const b of buckets) {
    if (b.count >= target) {
      p95 = b.le;
      break;
    }
  }
  return { p95Ms: p95 * 1000, count };
}

export function useMetrics(pollMs = 3000): MetricsSnapshot {
  const [snap, setSnap] = useState<MetricsSnapshot>({ throughput: 0, p95Ms: 0 });
  const prev = useRef({ count: 0, at: Date.now() });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const raw = await fetchMetrics();
        if (!alive) return;
        const { p95Ms, count } = parseHistogram(raw);
        const now = Date.now();
        const dt = (now - prev.current.at) / 1000;
        const throughput = dt > 0 ? (count - prev.current.count) / dt : 0;
        prev.current = { count, at: now };
        setSnap({ throughput: Math.max(0, throughput), p95Ms });
      } catch {
        /* optional */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return snap;
}

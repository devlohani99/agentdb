import client from "prom-client";

export const httpDuration = new client.Histogram({
  name: "relay_http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
});

client.collectDefaultMetrics({ prefix: "relay_" });

export { client as promClient };

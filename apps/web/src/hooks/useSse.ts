import { useEffect, useRef } from "react";
import { API_BASE } from "../config/demo.js";
import type { AgentEvent } from "../types.js";

export function useSse(
  apiKey: string,
  onEvent: (event: AgentEvent) => void,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();

    void (async () => {
      const res = await fetch(`${API_BASE}/events`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            handler.current(JSON.parse(line.slice(6)) as AgentEvent);
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => controller.abort();
  }, [apiKey]);
}

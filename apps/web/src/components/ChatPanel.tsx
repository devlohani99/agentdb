import { useState } from "react";
import type { ChatMessage } from "../types.js";

type Props = {
  tenantName: string;
  customerName: string;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onAgentClick: (runId: string) => void;
};

export function ChatPanel({
  tenantName,
  customerName,
  messages,
  onSend,
  onAgentClick,
}: Props) {
  const [draft, setDraft] = useState("");

  return (
    <section className="flex flex-col h-full border-r border-slate-800 bg-slate-900/60">
      <header className="px-4 py-3 border-b border-slate-800">
        <p className="text-xs uppercase tracking-wide text-slate-500">{tenantName}</p>
        <h2 className="font-medium text-slate-100">{customerName}</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">Submit a ticket to start a session.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-blue-600/30 text-blue-100"
                : "bg-slate-800 text-slate-100 cursor-pointer hover:ring-1 hover:ring-pink-500/50"
            }`}
            onClick={() => m.runId && onAgentClick(m.runId)}
          >
            {m.text}
          </div>
        ))}
      </div>
      <form
        className="p-3 border-t border-slate-800 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onSend(text);
          setDraft("");
        }}
      >
        <input
          className="flex-1 rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
          placeholder="Describe your issue…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500"
        >
          Send
        </button>
      </form>
    </section>
  );
}

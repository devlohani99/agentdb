import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { GraphSnapshot } from "../api/client.js";

const NODE_COLORS: Record<string, string> = {
  Customer: "#3b82f6",
  Session: "#a855f7",
  Event: "#22c55e",
  Fact: "#eab308",
  Task: "#f97316",
  Playbook: "#14b8a6",
  AgentRun: "#ec4899",
  Entity: "#64748b",
  Node: "#94a3b8",
};

type GraphNode = NodeObject & {
  id: string;
  type: string;
  pulse?: boolean;
  highlight?: boolean;
};

type GraphLink = LinkObject<GraphNode> & { type?: string };

type Props = {
  data: GraphSnapshot | null;
  pulseIds: Set<string>;
  highlightIds: Set<string>;
  explainReasons: Map<string, string>;
  title?: string;
};

export function ForceGraphView({
  data,
  pulseIds,
  highlightIds,
  explainReasons,
  title,
}: Props) {
  const ref = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined,
  );

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    const nodes: GraphNode[] = data.nodes.map((n) => ({
      id: n.id,
      name: String(n.properties?.key ?? n.properties?.kind ?? n.type ?? n.id),
      type: n.type ?? n.label ?? "Node",
      pulse: pulseIds.has(n.id),
      highlight: highlightIds.has(n.id),
    }));
    const links: GraphLink[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    }));
    return { nodes, links };
  }, [data, pulseIds, highlightIds]);

  useEffect(() => {
    ref.current?.zoomToFit(400, 40);
  }, [graphData.nodes.length]);

  return (
    <div className="relative h-full min-h-[320px] bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
      {title && (
        <div className="absolute top-2 left-2 z-10 text-xs text-slate-400 bg-slate-900/80 px-2 py-1 rounded">
          {title}
        </div>
      )}
      <ForceGraph2D
        ref={ref}
        graphData={graphData}
        nodeLabel={(n) => {
          const node = n as GraphNode;
          const reason = explainReasons.get(node.id);
          return reason ? `${node.name}\n${reason}` : node.name;
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode;
          const label = n.name ?? n.id;
          const fontSize = 12 / globalScale;
          const r = n.highlight ? 8 : 6;
          const base = NODE_COLORS[n.type] ?? NODE_COLORS.Node;
          const pulse = n.pulse ? 1 + 0.25 * Math.sin(Date.now() / 200) : 1;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r * pulse, 0, 2 * Math.PI, false);
          ctx.fillStyle = n.highlight ? "#f472b6" : String(base);
          ctx.fill();
          if (n.highlight) {
            ctx.strokeStyle = "#fdf2f8";
            ctx.lineWidth = 2 / globalScale;
            ctx.stroke();
          }
          ctx.font = `${fontSize}px Sans-Serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + r + fontSize);
        }}
        linkColor={(link) =>
          (link as GraphLink).type === "SUPERSEDES" ? "#ef4444" : "#475569"
        }
        linkLineDash={(link) =>
          (link as GraphLink).type === "SUPERSEDES" ? [4, 4] : null
        }
        linkWidth={(link) =>
          (link as GraphLink).type === "SUPERSEDES" ? 2 : 1
        }
        backgroundColor="#020617"
      />
    </div>
  );
}

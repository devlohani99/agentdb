import { FalkorDB, type Graph } from "falkordb";
import { GLOBAL_PLAYBOOKS_GRAPH, tenantIdSchema } from "@relay/shared";

let falkor: FalkorDB | null = null;

export function resolveTenantGraphName(tenantId: string): string {
  const id = tenantIdSchema.parse(tenantId);
  return `t_${id}`;
}

export async function connectFalkor(url: string): Promise<FalkorDB> {
  if (falkor) {
    return falkor;
  }
  falkor = await FalkorDB.connect({ url });
  return falkor;
}

export async function getTenantGraph(
  tenantId: string,
  falkorUrl: string,
): Promise<Graph> {
  const db = await connectFalkor(falkorUrl);
  return db.selectGraph(resolveTenantGraphName(tenantId));
}

export async function getGlobalPlaybooksGraph(
  falkorUrl: string,
): Promise<Graph> {
  const db = await connectFalkor(falkorUrl);
  return db.selectGraph(GLOBAL_PLAYBOOKS_GRAPH);
}

export async function ensureTenantSchema(
  tenantId: string,
  falkorUrl: string,
): Promise<void> {
  const graph = await getTenantGraph(tenantId, falkorUrl);
  const indexes: Array<() => Promise<unknown>> = [
    () => graph.createNodeRangeIndex("Customer", "id"),
    () => graph.createNodeRangeIndex("Event", "ts"),
    () => graph.createNodeRangeIndex("Fact", "key"),
    () => graph.createNodeRangeIndex("Task", "id"),
    () => graph.createNodeRangeIndex("Playbook", "issueType"),
  ];
  for (const create of indexes) {
    try {
      await create();
    } catch {
      /* idempotent */
    }
  }
}

export async function ensureGlobalPlaybooksSchema(
  falkorUrl: string,
): Promise<void> {
  const graph = await getGlobalPlaybooksGraph(falkorUrl);
  try {
    await graph.createNodeRangeIndex("Playbook", "issueType");
  } catch {
    /* idempotent */
  }
}

export async function closeFalkor(): Promise<void> {
  if (falkor) {
    await falkor.close();
    falkor = null;
  }
}

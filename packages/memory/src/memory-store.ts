import { randomUUID } from "node:crypto";
import type { Graph } from "falkordb";
import {
  getGlobalPlaybooksGraph,
  getTenantGraph,
  ensureGlobalPlaybooksSchema,
  ensureTenantSchema,
} from "./graph.js";
import { firstRow, mapRows } from "./parse.js";
import { getRedis, withTaskLock } from "./redis.js";

export type MemoryStoreConfig = {
  falkorUrl: string;
  redisUrl: string;
};

export type RecallBundle = {
  events: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  playbook: Record<string, unknown> | null;
  nodeIds: string[];
};

export class MemoryStore {
  constructor(private readonly config: MemoryStoreConfig) {}

  async initTenant(tenantId: string): Promise<void> {
    await ensureTenantSchema(tenantId, this.config.falkorUrl);
    await ensureGlobalPlaybooksSchema(this.config.falkorUrl);
  }

  private graph(tenantId: string): Promise<Graph> {
    return getTenantGraph(tenantId, this.config.falkorUrl);
  }

  async startSession(
    tenantId: string,
    customerId: string,
  ): Promise<{ sessionId: string }> {
    await this.initTenant(tenantId);
    const sessionId = randomUUID();
    const graph = await this.graph(tenantId);
    await graph.query(
      `MERGE (c:Customer {id: $customerId})
       CREATE (s:Session {id: $sessionId, startedAt: $now, lastEventId: ''})
       CREATE (c)-[:HAS_SESSION]->(s)`,
      {
        params: {
          customerId,
          sessionId,
          now: Date.now(),
        },
      },
    );
    return { sessionId };
  }

  async appendEvent(
    tenantId: string,
    sessionId: string,
    input: { kind: string; payload: string; ts?: number },
  ): Promise<{ eventId: string }> {
    const eventId = randomUUID();
    const ts = input.ts ?? Date.now();
    const graph = await this.graph(tenantId);
    await graph.query(
      `MATCH (s:Session {id: $sessionId})
       OPTIONAL MATCH (prev:Event {id: s.lastEventId})
       CREATE (e:Event {id: $eventId, ts: $ts, kind: $kind, payload: $payload})
       CREATE (s)-[:CONTAINS]->(e)
       FOREACH (_ IN CASE WHEN prev IS NULL THEN [] ELSE [1] END |
         CREATE (prev)-[:NEXT]->(e)
       )
       SET s.lastEventId = $eventId
       RETURN e.id AS id`,
      {
        params: {
          sessionId,
          eventId,
          ts,
          kind: input.kind,
          payload: input.payload,
        },
      },
    );
    return { eventId };
  }

  async getSessionTimeline(
    tenantId: string,
    sessionId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (s:Session {id: $sessionId})-[:CONTAINS]->(head:Event)
       WHERE NOT (head)<-[:NEXT]-(:Event)
       MATCH path = (head)-[:NEXT*0..]->(e:Event)
       WITH e ORDER BY e.ts ASC
       RETURN e.id AS id, e.ts AS ts, e.kind AS kind, e.payload AS payload`,
      { params: { sessionId } },
    );
    return mapRows(reply);
  }

  async getRecentSessions(
    tenantId: string,
    customerId: string,
    n: number,
  ): Promise<Array<Record<string, unknown>>> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_SESSION]->(s:Session)
       RETURN s.id AS id, s.startedAt AS startedAt
       ORDER BY s.startedAt DESC
       LIMIT $n`,
      { params: { customerId, n } },
    );
    return mapRows(reply);
  }

  async upsertFact(
    tenantId: string,
    customerId: string,
    key: string,
    value: string,
    confidence: number,
    sourceEventId: string,
  ): Promise<{ factId: string }> {
    const factId = randomUUID();
    const now = Date.now();
    const graph = await this.graph(tenantId);
    const reply = await graph.query(
      `MATCH (c:Customer {id: $customerId})
       OPTIONAL MATCH (c)-[:HAS_FACT]->(old:Fact {key: $key, status: 'active'})
       WITH c, old
       WHERE old IS NULL OR old.value <> $value
       CREATE (f:Fact {
         id: $factId, key: $key, value: $value, confidence: $confidence,
         validFrom: $now, status: 'active'
       })
       CREATE (c)-[:HAS_FACT]->(f)
       WITH f, old
       FOREACH (_ IN CASE WHEN old IS NULL THEN [] ELSE [1] END |
         CREATE (f)-[:SUPERSEDES]->(old)
         SET old.status = 'superseded', old.validTo = $now
       )
       WITH f
       MATCH (ev:Event {id: $sourceEventId})
       CREATE (f)-[:DERIVED_FROM]->(ev)
       RETURN f.id AS id`,
      {
        params: {
          customerId,
          key,
          value,
          confidence,
          factId,
          now,
          sourceEventId,
        },
      },
    );
    const row = firstRow<{ id: string }>(reply);
    if (row?.id) {
      return { factId: row.id };
    }
    const existing = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_FACT]->(f:Fact {key: $key, status: 'active'})
       RETURN f.id AS id LIMIT 1`,
      { params: { customerId, key } },
    );
    const ex = firstRow<{ id: string }>(existing);
    return { factId: ex?.id ?? factId };
  }

  async getActiveFacts(
    tenantId: string,
    customerId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_FACT]->(f:Fact {status: 'active'})
       RETURN f.id AS id, f.key AS key, f.value AS value, f.confidence AS confidence`,
      { params: { customerId } },
    );
    return mapRows(reply);
  }

  async getFactHistory(
    tenantId: string,
    customerId: string,
    key: string,
  ): Promise<Array<Record<string, unknown>>> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_FACT]->(f:Fact {key: $key})
       RETURN f.id AS id, f.value AS value, f.status AS status, f.validFrom AS validFrom, f.validTo AS validTo
       ORDER BY f.validFrom ASC`,
      { params: { customerId, key } },
    );
    return mapRows(reply);
  }

  async recordOutcome(
    tenantId: string,
    issueType: string,
    steps: string[],
    success: boolean,
  ): Promise<void> {
    const graph = await this.graph(tenantId);
    await graph.query(
      `MERGE (p:Playbook {issueType: $issueType})
       ON CREATE SET p.steps = $steps, p.uses = 0, p.successes = 0, p.successRate = 0.0
       SET p.uses = p.uses + 1,
           p.successes = p.successes + $successInc,
           p.successRate = toFloat(p.successes) / toFloat(p.uses),
           p.steps = $steps`,
      {
        params: {
          issueType,
          steps,
          successInc: success ? 1 : 0,
        },
      },
    );
  }

  async findBestPlaybook(
    tenantId: string,
    issueType: string,
  ): Promise<Record<string, unknown> | null> {
    const graph = await this.graph(tenantId);
    const local = await graph.roQuery(
      `MATCH (p:Playbook {issueType: $issueType})
       RETURN p.issueType AS issueType, p.steps AS steps, p.successRate AS successRate, p.uses AS uses
       ORDER BY p.successRate DESC, p.uses DESC
       LIMIT 1`,
      { params: { issueType } },
    );
    const hit = firstRow(local);
    if (hit) {
      return hit;
    }
    const globalGraph = await getGlobalPlaybooksGraph(this.config.falkorUrl);
    const global = await globalGraph.roQuery(
      `MATCH (p:Playbook {issueType: $issueType})
       RETURN p.issueType AS issueType, p.steps AS steps, p.successRate AS successRate, p.uses AS uses
       ORDER BY p.successRate DESC
       LIMIT 1`,
      { params: { issueType } },
    );
    return firstRow(global) ?? null;
  }

  async createTask(
    tenantId: string,
    customerId: string,
    eventId: string,
    issueType: string,
  ): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    const graph = await this.graph(tenantId);
    await graph.query(
      `MATCH (c:Customer {id: $customerId}), (e:Event {id: $eventId})
       CREATE (t:Task {
         id: $taskId, issueType: $issueType, status: 'open', version: 0, createdAt: $now
       })
       CREATE (t)-[:ABOUT]->(c)
       CREATE (t)-[:ORIGINATED_IN]->(e)`,
      {
        params: { customerId, eventId, taskId, issueType, now: Date.now() },
      },
    );
    return { taskId };
  }

  async claimTask(
    tenantId: string,
    taskId: string,
    agent: string,
    expectedVersion: number,
  ): Promise<{ ok: true; version: number } | { ok: false }> {
    let claimed = false;
    let newVersion = expectedVersion;
    const locked = await withTaskLock(
      this.config.redisUrl,
      taskId,
      15_000,
      async () => {
        const graph = await this.graph(tenantId);
        const reply = await graph.query(
          `MATCH (t:Task {id: $taskId, version: $expectedVersion})
           SET t.version = t.version + 1,
               t.status = 'claimed',
               t.claimedBy = $agent
           RETURN t.version AS version`,
          { params: { taskId, expectedVersion, agent } },
        );
        const row = firstRow<{ version: number }>(reply);
        if (row?.version !== undefined) {
          claimed = true;
          newVersion = Number(row.version);
        }
      },
    );
    if (!locked || !claimed) {
      return { ok: false };
    }
    return { ok: true, version: newVersion };
  }

  async handoffTask(
    tenantId: string,
    taskId: string,
    fromAgent: string,
    toAgent: string,
    snapshot: string,
  ): Promise<{ runId: string }> {
    const runId = randomUUID();
    const graph = await this.graph(tenantId);
    await graph.query(
      `MATCH (t:Task {id: $taskId})
       CREATE (r:AgentRun {id: $runId, agent: $toAgent, at: $now})
       CREATE (t)-[:HANDED_OFF_TO {snapshot: $snapshot, at: $now, from: $fromAgent, to: $toAgent}]->(r)
       SET t.status = 'handed_off'`,
      {
        params: {
          taskId,
          runId,
          toAgent,
          fromAgent,
          snapshot,
          now: Date.now(),
        },
      },
    );
    return { runId };
  }

  async completeTask(
    tenantId: string,
    taskId: string,
    success: boolean,
    playbookIssueType?: string,
  ): Promise<void> {
    const graph = await this.graph(tenantId);
    if (playbookIssueType) {
      await graph.query(
        `MATCH (t:Task {id: $taskId}), (p:Playbook {issueType: $issueType})
         SET t.status = $status
         CREATE (t)-[:RESOLVED_WITH {success: $success}]->(p)`,
        {
          params: {
            taskId,
            issueType: playbookIssueType,
            status: success ? "resolved" : "failed",
            success,
          },
        },
      );
      return;
    }
    await graph.query(
      `MATCH (t:Task {id: $taskId}) SET t.status = $status`,
      {
        params: {
          taskId,
          status: success ? "resolved" : "failed",
        },
      },
    );
  }

  async recordAgentRunIO(
    tenantId: string,
    runId: string,
    readIds: string[],
    writeIds: string[],
  ): Promise<void> {
    const graph = await this.graph(tenantId);
    for (const nodeId of readIds) {
      await graph.query(
        `MATCH (r:AgentRun {id: $runId}), (n {id: $nodeId})
         CREATE (r)-[:READ]->(n)`,
        { params: { runId, nodeId } },
      );
    }
    for (const nodeId of writeIds) {
      await graph.query(
        `MATCH (r:AgentRun {id: $runId}), (n {id: $nodeId})
         CREATE (r)-[:WROTE]->(n)`,
        { params: { runId, nodeId } },
      );
    }
  }

  async recall(
    tenantId: string,
    customerId: string,
    query: string,
  ): Promise<RecallBundle> {
    const graph = await this.graph(tenantId);
    const q = query.toLowerCase();
    const eventsReply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_SESSION]->(:Session)-[:CONTAINS]->(e:Event)
       WHERE toLower(e.payload) CONTAINS $q OR toLower(e.kind) CONTAINS $q
       RETURN e.id AS id, e.ts AS ts, e.kind AS kind, e.payload AS payload
       ORDER BY e.ts DESC
       LIMIT 10`,
      { params: { customerId, q } },
    );
    const events = mapRows(eventsReply);
    const factsReply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})-[:HAS_FACT]->(f:Fact {status: 'active'})
       WHERE toLower(f.key) CONTAINS $q OR toLower(f.value) CONTAINS $q
       RETURN f.id AS id, f.key AS key, f.value AS value, f.confidence AS confidence`,
      { params: { customerId, q } },
    );
    const facts = mapRows(factsReply);
    let playbook: Record<string, unknown> | null = null;
    const pb = await graph.roQuery(
      `MATCH (p:Playbook)
       WHERE toLower(p.issueType) CONTAINS $q
       RETURN p.issueType AS issueType, p.steps AS steps, p.successRate AS successRate
       ORDER BY p.successRate DESC
       LIMIT 1`,
      { params: { q } },
    );
    playbook = firstRow(pb) ?? null;
    const nodeIds = [
      ...events.map((e) => String(e.id)),
      ...facts.map((f) => String(f.id)),
    ];
    if (playbook?.issueType) {
      nodeIds.push(String(playbook.issueType));
    }
    return { events, facts, playbook, nodeIds };
  }

  async consolidate(tenantId: string, decayDays = 30): Promise<void> {
    const graph = await this.graph(tenantId);
    const cutoff = Date.now() - decayDays * 86_400_000;
    await graph.query(
      `MATCH (f:Fact {status: 'active'})
       WHERE f.validFrom < $cutoff
       SET f.confidence = f.confidence * 0.5,
           f.status = CASE WHEN f.confidence * 0.5 < 0.2 THEN 'decayed' ELSE f.status END`,
      { params: { cutoff } },
    );
    await graph.query(
      `MATCH (e1:Entity), (e2:Entity)
       WHERE id(e1) < id(e2) AND e1.name = e2.name
       MERGE (e1)-[:SAME_AS]->(e2)`,
      { params: {} },
    );
    const promote = await graph.roQuery(
      `MATCH (t:Task)-[r:RESOLVED_WITH {success: true}]->(p:Playbook)
       WITH p.issueType AS issueType, p.steps AS steps, count(r) AS wins
       WHERE wins >= 3
       RETURN issueType, steps, wins`,
      { params: {} },
    );
    for (const row of mapRows<{ issueType: string; steps: string[] }>(
      promote,
    )) {
      await graph.query(
        `MERGE (p:Playbook {issueType: $issueType})
         SET p.steps = $steps, p.uses = coalesce(p.uses, 0), p.successes = coalesce(p.successes, 0)`,
        { params: { issueType: row.issueType, steps: row.steps } },
      );
      const globalGraph = await getGlobalPlaybooksGraph(this.config.falkorUrl);
      await globalGraph.query(
        `MERGE (p:Playbook {issueType: $issueType})
         SET p.steps = $steps, p.uses = coalesce(p.uses, 0), p.successes = coalesce(p.successes, 0),
             p.successRate = coalesce(p.successRate, 0.0)`,
        { params: { issueType: row.issueType, steps: row.steps } },
      );
    }
  }

  async explain(
    tenantId: string,
    runId: string,
  ): Promise<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (r:AgentRun {id: $runId})
       OPTIONAL MATCH (r)-[rel:READ|WROTE]->(n)
       RETURN r.id AS runId, type(rel) AS relType, labels(n) AS labels, n AS node`,
      { params: { runId } },
    );
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    for (const row of mapRows<{
      runId: string;
      relType: string;
      labels: string[];
      node: { id: string; properties: Record<string, unknown> };
    }>(reply)) {
      if (row.node) {
        nodes.push({
          id: row.node.id ?? row.node,
          labels: row.labels,
          reason: `${row.relType} during agent run`,
        });
        edges.push({
          source: row.runId,
          target: String(row.node.id ?? row.node),
          type: row.relType,
        });
      }
    }
    return { nodes, edges };
  }

  async getCustomerGraph(
    tenantId: string,
    customerId: string,
  ): Promise<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    const graph = await this.graph(tenantId);
    const reply = await graph.roQuery(
      `MATCH (c:Customer {id: $customerId})
       OPTIONAL MATCH p=(c)-[*1..3]-()
       WITH collect(DISTINCT c) + [n IN nodes(p) | n] AS rawNodes
       UNWIND rawNodes AS n
       WITH collect(DISTINCT n) AS ns
       UNWIND ns AS a
       UNWIND ns AS b
       OPTIONAL MATCH (a)-[r]->(b)
       RETURN a.id AS srcId, labels(a) AS srcLabels, properties(a) AS srcProps,
              type(r) AS relType, b.id AS dstId, labels(b) AS dstLabels, properties(b) AS dstProps`,
      { params: { customerId } },
    );
    const nodes = new Map<string, Record<string, unknown>>();
    const edges: Array<Record<string, unknown>> = [];
    const edgeKeys = new Set<string>();

    const addNode = (
      id: unknown,
      labels: unknown,
      props: unknown,
    ): string | null => {
      if (typeof id !== "string" || id.length === 0) return null;
      if (!nodes.has(id)) {
        const labelList = Array.isArray(labels)
          ? labels.filter((l): l is string => typeof l === "string")
          : [];
        nodes.set(id, {
          id,
          label: labelList[0] ?? "Node",
          type: labelList[0] ?? "Node",
          properties:
            props && typeof props === "object"
              ? (props as Record<string, unknown>)
              : {},
        });
      }
      return id;
    };

    for (const row of mapRows<{
      srcId: string;
      srcLabels: string[];
      srcProps: Record<string, unknown>;
      relType: string | null;
      dstId: string | null;
      dstLabels: string[] | null;
      dstProps: Record<string, unknown> | null;
    }>(reply)) {
      const srcId = addNode(row.srcId, row.srcLabels, row.srcProps);
      if (row.dstId) {
        addNode(row.dstId, row.dstLabels, row.dstProps);
      }
      if (srcId && row.dstId && row.relType) {
        const key = `${srcId}|${row.relType}|${row.dstId}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({
            id: key,
            source: srcId,
            target: row.dstId,
            type: row.relType,
          });
        }
      }
    }

    return { nodes: [...nodes.values()], edges };
  }
}

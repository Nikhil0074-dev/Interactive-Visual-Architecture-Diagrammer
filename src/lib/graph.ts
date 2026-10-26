import type { ArchEdge, ArchNode, Graph, Operation } from './schema';

export interface ValidationResult { errors: string[]; warnings: string[] }

export function nextId(g: Pick<Graph, 'nodes' | 'edges'>, prefix: string): string {
  const used = new Set([...g.nodes.map((n) => n.id), ...g.edges.map((e) => e.id)]);
  let i = 1;
  while (used.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

export function hasCycle(g: Graph): boolean {
  const adj = new Map<string, string[]>();
  g.edges.forEach((e) => adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const nx of adj.get(id) ?? []) if (visit(nx)) return true;
    state.set(id, 2);
    return false;
  };
  return g.nodes.some((n) => visit(n.id));
}

export function validateGraph(g: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
    if (!n.data.label?.trim()) errors.push(`Node "${n.id}" has no label`);
  }
  for (const e of g.edges) {
    if (ids.has(e.id)) errors.push(`Duplicate edge id "${e.id}"`);
    ids.add(e.id);
    if (!g.nodes.some((n) => n.id === e.source)) errors.push(`Edge "${e.id}" references missing source "${e.source}"`);
    if (!g.nodes.some((n) => n.id === e.target)) errors.push(`Edge "${e.id}" references missing target "${e.target}"`);
    if (e.source === e.target) warnings.push(`Edge "${e.id}" connects a node to itself`);
  }
  if (errors.length === 0) {
    const label = (id: string) => g.nodes.find((n) => n.id === id)!.data.label;
    for (const n of g.nodes) {
      const inc = g.edges.filter((e) => e.target === n.id).length;
      const out = g.edges.filter((e) => e.source === n.id).length;
      if (g.nodes.length > 1 && inc + out === 0) warnings.push(`"${n.data.label}" is disconnected`);
      if (n.type === 'database' && inc === 0 && out === 0) continue;
      if (n.type === 'database' && inc === 0) warnings.push(`Database "${label(n.id)}" has no incoming connection`);
      if (n.type === 'frontend' && inc > 0) warnings.push(`Frontend "${label(n.id)}" has incoming connections`);
    }
    if (hasCycle(g)) warnings.push('The graph contains a cycle (may be intentional)');
  }
  return { errors, warnings };
}

export function applyOps(graph: Graph, ops: Operation[]): Graph {
  const g: Graph = structuredClone(graph);
  for (const op of ops) {
    switch (op.op) {
      case 'addNode':
        if (g.nodes.some((n) => n.id === op.node.id)) throw new Error(`Node "${op.node.id}" already exists`);
        g.nodes.push(op.node);
        break;
      case 'removeNode':
        if (!g.nodes.some((n) => n.id === op.id)) throw new Error(`Node "${op.id}" not found`);
        g.nodes = g.nodes.filter((n) => n.id !== op.id);
        g.edges = g.edges.filter((e) => e.source !== op.id && e.target !== op.id);
        break;
      case 'updateNode': {
        const n = g.nodes.find((x) => x.id === op.id);
        if (!n) throw new Error(`Node "${op.id}" not found`);
        if (op.type) n.type = op.type;
        n.data = { ...n.data, ...Object.fromEntries(Object.entries(op.data).filter(([, v]) => v !== undefined)) } as ArchNode['data'];
        break;
      }
      case 'addEdge':
        if (g.edges.some((e) => e.id === op.edge.id)) throw new Error(`Edge "${op.edge.id}" already exists`);
        if (g.edges.some((e) => e.source === op.edge.source && e.target === op.edge.target)) break;
        g.edges.push(op.edge);
        break;
      case 'removeEdge':
        if (!g.edges.some((e) => e.id === op.id)) throw new Error(`Edge "${op.id}" not found`);
        g.edges = g.edges.filter((e) => e.id !== op.id);
        break;
    }
  }
  const { errors } = validateGraph(g);
  if (errors.length) throw new Error(`Invalid result: ${errors.join('; ')}`);
  return g;
}

export interface GraphDiff { addedNodes: string[]; removedNodes: string[]; changedNodes: string[]; addedEdges: string[]; removedEdges: string[] }
export function diffGraphs(a: Graph, b: Graph): GraphDiff {
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  const ae = new Set(a.edges.map((e) => e.id));
  const be = new Set(b.edges.map((e) => e.id));
  return {
    addedNodes: [...bn.keys()].filter((k) => !an.has(k)),
    removedNodes: [...an.keys()].filter((k) => !bn.has(k)),
    changedNodes: [...bn.keys()].filter((k) => an.has(k) && JSON.stringify([an.get(k)!.type, an.get(k)!.data]) !== JSON.stringify([bn.get(k)!.type, bn.get(k)!.data])),
    addedEdges: [...be].filter((k) => !ae.has(k)),
    removedEdges: [...ae].filter((k) => !be.has(k)),
  };
}

export function layoutGraph(g: Graph, xGap = 300, yGap = 130): Graph {
  const layer = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < g.nodes.length; i++) {
    let changed = false;
    for (const e of g.edges) {
      if (e.source === e.target || !layer.has(e.source) || !layer.has(e.target)) continue;
      const want = layer.get(e.source)! + 1;
      if (want > layer.get(e.target)! && want < g.nodes.length) { layer.set(e.target, want); changed = true; }
    }
    if (!changed) break;
  }
  const cols = new Map<number, ArchNode[]>();
  g.nodes.forEach((n) => cols.set(layer.get(n.id)!, [...(cols.get(layer.get(n.id)!) ?? []), n]));
  const tallest = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const out = structuredClone(g);
  for (const [l, col] of cols) {
    col.forEach((n, i) => {
      const t = out.nodes.find((x) => x.id === n.id)!;
      t.position = { x: l * xGap, y: ((tallest - col.length) * yGap) / 2 + i * yGap };
    });
  }
  return out;
}

/** Keep the positions of existing nodes; take layout positions only for new ones. */
export function mergePositions(old: Graph, next: Graph): Graph {
  const laid = layoutGraph(next);
  const prev = new Map(old.nodes.map((n) => [n.id, n.position]));
  return { ...laid, nodes: laid.nodes.map((n) => ({ ...n, position: prev.get(n.id) ?? n.position })) };
}

const esc = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/[<>()[\]{}|;]/g, (c) => c === ';' ? ';' : `#${c.charCodeAt(0).toString(16)};`)
  .replace(/"/g, '#quot;')
  .replace(/[\r\n]+/g, ' ');
export function toMermaid(g: Graph, dir: 'LR' | 'TD' = 'LR'): string {
  const ids = new Map(g.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const lines = [`flowchart ${dir}`];
  for (const n of g.nodes) {
    const l = esc(n.data.technology && n.data.technology !== n.data.label ? `${n.data.label}<br/>(${n.data.technology})` : n.data.label);
    const id = ids.get(n.id)!;
    lines.push(
      n.type === 'database' ? `    ${id}[("${l}")]`
      : n.type === 'external' ? `    ${id}{{"${l}"}}`
      : n.type === 'queue' ? `    ${id}[["${l}"]]`
      : `    ${id}["${l}"]`,
    );
  }
  for (const e of g.edges) {
    const s = ids.get(e.source), t = ids.get(e.target);
    if (!s || !t) throw new Error(`Edge "${e.id}" references a missing node`);
    lines.push(e.label ? `    ${s} -->|"${esc(e.label)}"| ${t}` : `    ${s} --> ${t}`);
  }
  return lines.join('\n');
}

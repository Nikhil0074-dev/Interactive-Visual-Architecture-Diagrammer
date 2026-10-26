import { describe, expect, it } from 'vitest';
import { applyOps, diffGraphs, hasCycle, layoutGraph, mergePositions, nextId, toMermaid, validateGraph } from '@/lib/graph';
import { graphSchema, opSchema, type Graph } from '@/lib/schema';

const node = (id: string, type: any = 'service', label = id) => ({ id, type, position: { x: 0, y: 0 }, data: { label } });
const base = (): Graph => graphSchema.parse({
  nodes: [node('f', 'frontend', 'Web'), node('a', 'service', 'API'), node('d', 'database', 'PG')],
  edges: [{ id: 'e1', source: 'f', target: 'a', label: 'HTTPS' }, { id: 'e2', source: 'a', target: 'd' }],
});

describe('validateGraph', () => {
  it('accepts a valid graph', () => expect(validateGraph(base()).errors).toEqual([]));
  it('detects duplicate ids and dangling edges', () => {
    const g = base(); g.nodes.push(node('a')); g.edges.push({ id: 'e1', source: 'zz', target: 'a' });
    const r = validateGraph(g);
    expect(r.errors.join()).toMatch(/Duplicate node id "a"/);
    expect(r.errors.join()).toMatch(/Duplicate edge id "e1"/);
    expect(r.errors.join()).toMatch(/missing source "zz"/);
  });
  it('warns about disconnected nodes and cycles but does not error', () => {
    const g = base(); g.nodes.push(node('x'));
    expect(validateGraph(g).warnings.join()).toMatch(/"x" is disconnected/);
    g.edges.push({ id: 'e3', source: 'd', target: 'a' });
    expect(hasCycle(g)).toBe(true);
    expect(validateGraph(g).errors).toEqual([]);
  });
});

describe('applyOps', () => {
  it('adds, updates, removes without mutating the input', () => {
    const g = base();
    const out = applyOps(g, [
      { op: 'addNode', node: node('c', 'cache', 'Redis') },
      { op: 'addEdge', edge: { id: 'e3', source: 'a', target: 'c' } },
      { op: 'updateNode', id: 'd', data: { label: 'MySQL' } },
      { op: 'removeEdge', id: 'e1' },
    ]);
    expect(out.nodes).toHaveLength(4);
    expect(out.edges.map((e) => e.id)).toEqual(['e2', 'e3']);
    expect(out.nodes.find((n) => n.id === 'd')!.data.label).toBe('MySQL');
    expect(g.nodes).toHaveLength(3);
  });
  it('removeNode also removes its edges', () => {
    expect(applyOps(base(), [{ op: 'removeNode', id: 'a' }]).edges).toEqual([]);
  });
  it('rejects invalid operations', () => {
    expect(() => applyOps(base(), [{ op: 'removeNode', id: 'nope' }])).toThrow(/not found/);
    expect(() => applyOps(base(), [{ op: 'addEdge', edge: { id: 'q', source: 'a', target: 'ghost' } }])).toThrow(/Invalid result/);
    expect(() => applyOps(base(), [{ op: 'addNode', node: node('a') }])).toThrow(/already exists/);
  });
  it('op schema rejects unknown ops and node types', () => {
    expect(opSchema.safeParse({ op: 'explode' }).success).toBe(false);
    expect(opSchema.safeParse({ op: 'addNode', node: { id: 'x', type: 'banana', data: { label: 'x' } } }).success).toBe(false);
  });
});

describe('layout, diff, ids', () => {
  it('lays out left-to-right in layers without overlaps', () => {
    const g = layoutGraph(base());
    const xs = g.nodes.map((n) => n.position.x);
    expect(xs).toEqual([0, 300, 600]);
    const pts = new Set(g.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(pts.size).toBe(3);
  });
  it('terminates on cyclic graphs', () => {
    const g = base(); g.edges.push({ id: 'e3', source: 'd', target: 'f' });
    expect(() => layoutGraph(g)).not.toThrow();
  });
  it('mergePositions keeps old positions', () => {
    const g = base(); g.nodes[0].position = { x: 5, y: 7 };
    const next = applyOps(g, [{ op: 'addNode', node: node('c', 'cache') }]);
    const m = mergePositions(g, next);
    expect(m.nodes[0].position).toEqual({ x: 5, y: 7 });
  });
  it('diffGraphs reports changes', () => {
    const a = base();
    const b = applyOps(a, [{ op: 'addNode', node: node('c', 'cache') }, { op: 'updateNode', id: 'a', data: { label: 'GW' } }, { op: 'removeEdge', id: 'e1' }]);
    expect(diffGraphs(a, b)).toEqual({ addedNodes: ['c'], removedNodes: [], changedNodes: ['a'], addedEdges: [], removedEdges: ['e1'] });
  });
  it('nextId avoids collisions', () => expect(nextId({ nodes: [node('cache_1')], edges: [] }, 'cache')).toBe('cache_2'));
});

describe('toMermaid', () => {
  it('generates flowchart syntax with shapes and labels', () => {
    const m = toMermaid(base());
    expect(m.startsWith('flowchart LR')).toBe(true);
    expect(m).toContain('n3[("PG")]');
    expect(m).toContain('n1 -->|"HTTPS"| n2');
    expect(m).toContain('n2 --> n3');
  });
  it('escapes quotes and newlines in labels', () => {
    const g = base(); g.nodes[0].data.label = 'Say "hi"\nthere';
    expect(toMermaid(g)).toContain('Say #quot;hi#quot; there');
  });
  it('throws on dangling edges', () => {
    const g = base(); g.edges.push({ id: 'bad', source: 'a', target: 'zz' });
    expect(() => toMermaid(g)).toThrow(/missing node/);
  });
});

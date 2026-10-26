'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, applyEdgeChanges, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { diffGraphs, layoutGraph, nextId, toMermaid, validateGraph, type GraphDiff } from '@/lib/graph';
import { NODE_TYPES, type Graph, type NodeType } from '@/lib/schema';

type Data = { label: string; technology?: string; description?: string; kind: NodeType };
type RFNode = Node<Data, 'arch'>;

const COLORS: Record<NodeType, string> = {
  frontend: '#4cc9f0', gateway: '#b388ff', service: '#ffb703', auth: '#ff8fab', database: '#5bd6a0',
  cache: '#ff6b6b', queue: '#f4a261', external: '#a8dadc', storage: '#90be6d',
};
const EXAMPLES = [
  'Create an e-commerce application with a React frontend, a Python FastAPI backend, PostgreSQL for user data, Redis for caching, and Stripe for payments.',
  'Create a food delivery platform with a React frontend, FastAPI backend, authentication service, restaurant service, order service, PostgreSQL database, Redis cache, and RabbitMQ for asynchronous order processing.',
];

function ArchNode({ data, selected }: NodeProps<RFNode>) {
  return (
    <div className={`rf-node${selected ? ' sel' : ''}`} style={{ ['--c' as string]: COLORS[data.kind] }} data-testid="arch-node">
      <Handle type="target" position={Position.Left} />
      <small>{data.kind}</small>
      <strong>{data.label}</strong>
      {data.technology && <em>{data.technology}</em>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { arch: ArchNode };

const toRF = (g: Graph): { nodes: RFNode[]; edges: Edge[] } => ({
  nodes: g.nodes.map((n) => ({ id: n.id, type: 'arch', position: n.position, data: { ...n.data, kind: n.type } })),
  edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
});
const fromRF = (name: string, nodes: RFNode[], edges: Edge[]): Graph => ({
  id: 'project', name, version: 1,
  nodes: nodes.map((n) => ({ id: n.id, type: n.data.kind, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: { label: n.data.label, technology: n.data.technology || undefined, description: n.data.description || undefined } })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : undefined })),
});

function download(name: string, text: string, mime: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

function Inner() {
  const [name, setName] = useState('Untitled Architecture');
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [instruction, setInstruction] = useState('Add Redis between the API and the database');
  const [busy, setBusy] = useState<'gen' | 'mod' | null>(null);
  const [status, setStatus] = useState<{ kind: 'err' | 'ok' | 'warn'; text: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ graph: Graph; diff: GraphDiff } | null>(null);
  const [addType, setAddType] = useState<NodeType>('service');
  const { fitView } = useReactFlow();
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const [, bump] = useState(0);

  const graph = useMemo(() => fromRF(name, nodes, edges), [name, nodes, edges]);
  const validation = useMemo(() => validateGraph(graph), [graph]);
  const mermaid = useMemo(() => (validation.errors.length ? '' : toMermaid(graph)), [graph, validation]);
  const selected = nodes.find((n) => n.selected);

  const load = useCallback((g: Graph) => { const r = toRF(g); setNodes(r.nodes); setEdges(r.edges); setName(g.name); setTimeout(() => fitView({ padding: 0.2, duration: 150 }), 60); }, [fitView]);
  const snapshot = useCallback(() => { past.current.push(graph); future.current = []; bump((x) => x + 1); }, [graph]);
  const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push(graph); load(p); bump((x) => x + 1); };
  const redo = () => { const f = future.current.pop(); if (!f) return; past.current.push(graph); load(f); bump((x) => x + 1); };

  async function api<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok || !j.success) throw new Error(j.error ?? `Request failed (${res.status})`);
    return j as T;
  }

  async function generate() {
    setBusy('gen'); setStatus(null); setPreview(null);
    try {
      const j = await api<{ architecture: Graph; assumptions: string[]; warnings: string[]; source: string }>('/api/generate', { prompt });
      snapshot(); load(j.architecture);
      setNotes([...j.assumptions.map((a) => `Assumption: ${a}`), ...j.warnings]);
      setStatus({ kind: 'ok', text: `Generated ${j.architecture.nodes.length} components (${j.source}).` });
    } catch (e) { setStatus({ kind: 'err', text: (e as Error).message }); } finally { setBusy(null); }
  }
  async function modify() {
    setBusy('mod'); setStatus(null);
    try {
      const j = await api<{ architecture: Graph; diff: GraphDiff }>('/api/modify', { graph, instruction });
      setPreview({ graph: j.architecture, diff: j.diff });
    } catch (e) { setPreview(null); setStatus({ kind: 'err', text: (e as Error).message }); } finally { setBusy(null); }
  }
  const applyPreview = () => { if (!preview) return; snapshot(); load({ ...preview.graph, name }); setPreview(null); setStatus({ kind: 'ok', text: 'Changes applied.' }); };

  const onNodesChange = useCallback((c: NodeChange<RFNode>[]) => setNodes((n) => applyNodeChanges(c, n)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((e) => applyEdgeChanges(c, e)), []);
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || edges.some((e) => e.source === c.source && e.target === c.target)) return;
    snapshot(); setEdges((e) => [...e, { id: nextId({ nodes: graph.nodes, edges: graph.edges }, 'edge'), source: c.source!, target: c.target!, label: 'HTTP' }]);
  };
  const addNode = () => {
    snapshot();
    const id = nextId(graph, addType);
    const label = `New ${addType[0].toUpperCase()}${addType.slice(1)}`;
    setNodes((n) => [...n.map((x) => ({ ...x, selected: false })), { id, type: 'arch', position: { x: 60 + n.length * 20, y: 40 + n.length * 20 }, selected: true, data: { label, kind: addType } }]);
  };
  const patch = (p: Partial<Data>) => selected && setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...p } } : n)));
  const autoLayout = () => { snapshot(); load(layoutGraph(graph)); };

  const save = () => {
    try {
      const raw = localStorage.getItem('arch-projects');
      const parsed = raw ? JSON.parse(raw) : {};
      const all: Record<string, Graph> = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const key = name.trim() || 'Untitled Architecture';
      all[key] = graph;
      localStorage.setItem('arch-projects', JSON.stringify(all));
      setStatus({ kind: 'ok', text: `Saved "${key}" to this browser.` });
    } catch { setStatus({ kind: 'err', text: 'Browser storage is unavailable.' }); }
  };
  const exportAs = (f: 'json' | 'mermaid' | 'markdown') => {
    if (validation.errors.length) return setStatus({ kind: 'err', text: 'Fix validation errors before exporting.' });
    const safeName = name.trim().replace(/\W+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'architecture';
    api<{ content: string }>('/api/export', { graph, format: f }).then((j) => download(`${safeName}.${f === 'json' ? 'json' : f === 'mermaid' ? 'mmd' : 'md'}`, j.content, f === 'json' ? 'application/json' : 'text/plain'))
      .catch((e) => setStatus({ kind: 'err', text: e.message }));
  };

  return (
    <div className="app">
      <header>
        <h1>Arch<b>/</b>Diagrammer</h1>
        <input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="sp" />
        <button onClick={undo} disabled={!past.current.length}>Undo</button>
        <button onClick={redo} disabled={!future.current.length}>Redo</button>
        <button onClick={autoLayout} disabled={!nodes.length}>Auto-layout</button>
        <button onClick={save} disabled={!nodes.length}>Save</button>
        <button onClick={() => exportAs('json')} disabled={!nodes.length}>JSON</button>
        <button onClick={() => exportAs('mermaid')} disabled={!nodes.length}>Mermaid</button>
        <button onClick={() => exportAs('markdown')} disabled={!nodes.length}>Report</button>
      </header>
      <div className="main">
        <aside className="l">
          <section>
            <h2>1 · Describe</h2>
            <textarea aria-label="Architecture description" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} />
            <div className="row">{EXAMPLES.map((x, i) => <button key={i} className="chip" onClick={() => setPrompt(x)}>Example {i + 1}</button>)}</div>
            <div className="row"><button className="primary" onClick={generate} disabled={busy !== null || prompt.trim().length < 3}>{busy === 'gen' ? 'Generating…' : 'Generate diagram'}</button></div>
          </section>
          <section>
            <h2>2 · Refine with AI</h2>
            <input aria-label="Modification instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="row"><button onClick={modify} disabled={busy !== null || !nodes.length || instruction.trim().length < 3}>{busy === 'mod' ? 'Thinking…' : 'Preview change'}</button></div>
            {preview && (
              <div className="msg diff" style={{ marginTop: 8 }} data-testid="preview">
                {preview.diff.addedNodes.map((id) => <div key={id} className="a">+ node {id}</div>)}
                {preview.diff.removedNodes.map((id) => <div key={id} className="d">− node {id}</div>)}
                {preview.diff.changedNodes.map((id) => <div key={id} className="c">~ node {id}</div>)}
                {preview.diff.addedEdges.map((id) => <div key={id} className="a">+ edge {id}</div>)}
                {preview.diff.removedEdges.map((id) => <div key={id} className="d">− edge {id}</div>)}
                <div className="row"><button className="primary" onClick={applyPreview}>Apply</button><button onClick={() => setPreview(null)}>Discard</button></div>
              </div>
            )}
          </section>
          {status && <div className={`msg ${status.kind}`} role="status">{status.text}</div>}
          {notes.map((n, i) => <div key={i} className="msg warn">{n}</div>)}
          <section>
            <h2>Validation</h2>
            {validation.errors.length === 0 && validation.warnings.length === 0 && <div className="msg ok">No issues found.</div>}
            <ul className="v">
              {validation.errors.map((e, i) => <li key={'e' + i} style={{ color: 'var(--bad)' }}>{e}</li>)}
              {validation.warnings.map((w, i) => <li key={'w' + i}>{w}</li>)}
            </ul>
          </section>
        </aside>
        <div className="canvas">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeDragStart={snapshot} onBeforeDelete={async () => { snapshot(); return true; }}
            fitView fitViewOptions={{ padding: 0.2 }} colorMode="dark" proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#1d4565" />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n) => COLORS[(n.data as Data).kind]} maskColor="rgba(11,31,51,.7)" bgColor="#0f2a44" style={{ border: "1px solid #27506f" }} />
          </ReactFlow>
          {!nodes.length && <div className="empty"><div><h2>Empty canvas</h2>Describe a system on the left and press “Generate diagram”.</div></div>}
        </div>
        <aside className="r">
          <section>
            <h2>Add component</h2>
            <select aria-label="Component type" value={addType} onChange={(e) => setAddType(e.target.value as NodeType)}>{NODE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <div className="row"><button onClick={addNode}>Add node</button></div>
          </section>
          <section>
            <h2>Properties</h2>
            {selected ? (
              <div onFocusCapture={() => undefined}>
                <label>Name</label><input aria-label="Node name" value={selected.data.label} onFocus={snapshot} onChange={(e) => patch({ label: e.target.value })} />
                <label>Type</label>
                <select aria-label="Node type" value={selected.data.kind} onChange={(e) => { snapshot(); patch({ kind: e.target.value as NodeType }); }}>{NODE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                <label>Technology</label><input aria-label="Technology" value={selected.data.technology ?? ''} onFocus={snapshot} onChange={(e) => patch({ technology: e.target.value })} />
                <label>Description</label><textarea aria-label="Description" style={{ minHeight: 60 }} value={selected.data.description ?? ''} onFocus={snapshot} onChange={(e) => patch({ description: e.target.value })} />
                <div className="row"><button onClick={() => { snapshot(); setNodes((ns) => ns.filter((n) => n.id !== selected.id)); setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id)); }}>Delete node</button></div>
              </div>
            ) : <div className="msg" style={{ color: 'var(--mute)' }}>Select a node to edit it. Drag from a node’s right handle to another node to connect them.</div>}
          </section>
          <section>
            <h2>Mermaid</h2>
            <pre aria-label="Mermaid source">{mermaid || '— fix validation errors —'}</pre>
          </section>
        </aside>
      </div>
    </div>
  );
}
export default function Editor() { return <ReactFlowProvider><Inner /></ReactFlowProvider>; }

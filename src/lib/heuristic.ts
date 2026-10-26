import { applyOps, layoutGraph, nextId } from './graph';
import type { ArchEdge, ArchNode, Graph, NodeType, Operation } from './schema';

interface Entry { re: RegExp; type: NodeType; label: string; tech?: string; desc: string }
export const CATALOG: Entry[] = [
  { re: /\breact\b|\bnext\.?js\b|\bvue\b|\bangular\b|\bsvelte\b/i, type: 'frontend', label: 'Web Frontend', desc: 'User-facing interface' },
  { re: /api[ -]gateway|\bgateway\b/i, type: 'gateway', label: 'API Gateway', desc: 'Routes incoming requests' },
  { re: /fastapi|express|django|flask|spring|nest\.?js|node\.?js|laravel|rails/i, type: 'service', label: 'API Service', desc: 'Core application logic' },
  { re: /postgres(?:ql)?/i, type: 'database', label: 'PostgreSQL', tech: 'PostgreSQL', desc: 'Relational storage' },
  { re: /mysql|mariadb/i, type: 'database', label: 'MySQL', tech: 'MySQL', desc: 'Relational storage' },
  { re: /mongo(?:db)?/i, type: 'database', label: 'MongoDB', tech: 'MongoDB', desc: 'Document storage' },
  { re: /redis/i, type: 'cache', label: 'Redis', tech: 'Redis', desc: 'In-memory cache' },
  { re: /memcached/i, type: 'cache', label: 'Memcached', tech: 'Memcached', desc: 'In-memory cache' },
  { re: /rabbitmq/i, type: 'queue', label: 'RabbitMQ', tech: 'RabbitMQ', desc: 'Message broker' },
  { re: /kafka/i, type: 'queue', label: 'Kafka', tech: 'Kafka', desc: 'Event streaming' },
  { re: /\bsqs\b/i, type: 'queue', label: 'Amazon SQS', tech: 'SQS', desc: 'Managed message queue' },
  { re: /stripe/i, type: 'external', label: 'Stripe', tech: 'Stripe', desc: 'Payment provider' },
  { re: /paypal/i, type: 'external', label: 'PayPal', tech: 'PayPal', desc: 'Payment provider' },
  { re: /twilio/i, type: 'external', label: 'Twilio', tech: 'Twilio', desc: 'SMS provider' },
  { re: /sendgrid/i, type: 'external', label: 'SendGrid', tech: 'SendGrid', desc: 'Email provider' },
  { re: /\bs3\b|object storage|blob storage/i, type: 'storage', label: 'Object Storage', tech: 'S3', desc: 'File and media storage' },
];
const TECH = /fastapi|express|django|flask|spring|nest\.?js|node\.?js|laravel|rails|react|next\.?js|vue|angular|svelte/i;
const nice = (s: string) => (/[A-Z]/.test(s.slice(1)) ? s : title(s));
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function generateHeuristic(prompt: string): { graph: Graph; assumptions: string[]; warnings: string[] } {
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];
  const add = (type: NodeType, label: string, technology?: string, description?: string) => {
    const existing = nodes.find((n) => n.data.label.toLowerCase() === label.toLowerCase());
    if (existing) return existing;
    const n: ArchNode = { id: nextId({ nodes, edges }, type), type, position: { x: 0, y: 0 }, data: { label, technology, description } };
    nodes.push(n);
    return n;
  };
  const link = (a?: ArchNode, b?: ArchNode, label?: string) => {
    if (!a || !b || a.id === b.id || edges.some((e) => e.source === a.id && e.target === b.id)) return;
    edges.push({ id: `edge_${edges.length + 1}`, source: a.id, target: b.id, label });
  };

  for (const c of CATALOG) {
    const m = prompt.match(c.re);
    if (!m) continue;
    const tech = c.tech ?? (TECH.test(m[0]) ? nice(m[0]) : undefined);
    const label = c.type === 'frontend' ? `${nice(m[0])} Frontend` : c.type === 'service' ? `${nice(m[0])} Service` : c.label;
    add(c.type, label, tech, c.desc);
  }
  const named = [...prompt.matchAll(/\b([a-z]+(?: [a-z]+)?) service\b/gi)];
  for (const m of named) {
    const words = m[1].toLowerCase().split(' ').filter((w) => !['a', 'an', 'the', 'and', 'with', 'three', 'two', 'backend', 'of', 'for'].includes(w));
    if (!words.length) continue;
    const name = title(words.slice(-1)[0] === 'api' ? words.join(' ') : words.join(' ')) + ' Service';
    const isAuth = /auth|login|identity/.test(name.toLowerCase());
    add(isAuth ? 'auth' : 'service', name, undefined, isAuth ? 'Identity and access management' : `${name.replace(' Service', '')} business logic`);
  }
  if (/worker|background job/i.test(prompt)) add('service', 'Background Worker', undefined, 'Processes asynchronous jobs');

  if (nodes.length === 0) {
    warnings.push('No known components were recognised; a generic starter architecture was created.');
    add('frontend', 'Web Frontend', undefined, 'User-facing interface');
    add('service', 'API Service', undefined, 'Core application logic');
    add('database', 'Database', undefined, 'Persistent storage');
  }
  const of = (t: NodeType) => nodes.filter((n) => n.type === t);
  if (of('service').length + of('auth').length === 0 && of('frontend').length) {
    add('service', 'API Service', undefined, 'Core application logic');
    assumptions.push('Added an "API Service" because a frontend was described without a backend.');
  }
  const gateway = of('gateway')[0];
  const services = nodes.filter((n) => n.type === 'service' || n.type === 'auth');
  const core = services.find((n) => n.data.technology) ?? services.find((n) => n.type === 'service') ?? services[0];
  const entry = gateway ?? core;
  of('frontend').forEach((f) => link(f, entry, 'HTTPS'));
  if (gateway) services.forEach((s) => link(gateway, s, 'HTTP'));
  else services.forEach((s) => s !== core && link(core, s, 'HTTP'));
  const dbs = of('database');
  dbs.forEach((d) => (dbs.length === 1 ? services : [core]).forEach((s) => link(s, d, 'SQL/Query')));
  of('cache').forEach((c) => link(core, c, 'cache'));
  of('storage').forEach((s) => link(core, s, 'files'));
  const worker = nodes.find((n) => n.data.label === 'Background Worker') ?? services.find((s) => /notif|worker/i.test(s.data.label));
  const producers = services.filter((s) => /order|payment|billing/i.test(s.data.label));
  of('queue').forEach((q) => {
    (producers.length ? producers : [core]).forEach((p) => link(p, q, 'publish'));
    if (worker) link(q, worker, 'consume');
    else if (!producers.length) assumptions.push('No consumer was named for the queue.');
  });
  const pay = services.find((s) => /payment|billing|order/i.test(s.data.label)) ?? core;
  of('external').forEach((x) => link(/stripe|paypal/i.test(x.data.label) ? pay : core, x, 'API'));

  const name = title(prompt.trim().split(/[.\n]/)[0].replace(/^(create|build|design|make)\s+(an?\s+)?/i, '').split(/\bwith\b|\busing\b/i)[0].trim().slice(0, 50)) || 'Architecture';
  const graph = layoutGraph({ id: 'project', name, version: 1, nodes, edges });
  return { graph, assumptions, warnings };
}

// ---------- natural-language modification (offline fallback) ----------
const ALIAS: Record<string, NodeType> = { database: 'database', db: 'database', cache: 'cache', queue: 'queue', frontend: 'frontend', gateway: 'gateway' };
export function findNode(g: Graph, text: string): ArchNode | undefined {
  const t = text.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  if (!t) return undefined;
  let best: { n: ArchNode; s: number } | undefined;
  let tied = false;
  for (const n of g.nodes) {
    const l = n.data.label.toLowerCase(), tech = (n.data.technology ?? '').toLowerCase();
    const s = l === t ? 4 : tech === t ? 3 : ALIAS[t] === n.type ? 2 : l.includes(t) ? 1 : tech.includes(t) ? 1 : 0;
    if (s > (best?.s ?? 0)) { best = s ? { n, s } : undefined; tied = false; }
    else if (s > 0 && s === best?.s) tied = true;
  }
  return best && !tied ? best.n : undefined;
}
function describe(text: string): { type: NodeType; label: string; tech?: string; desc: string } {
  const c = CATALOG.find((e) => e.re.test(text) && e.type !== 'frontend' && e.type !== 'service');
  if (c) return { type: c.type, label: c.label, tech: c.tech, desc: c.desc };
  const name = title(text.replace(/\b(a|an|the|service)\b/gi, '').trim()) || 'Component';
  return { type: /auth/i.test(name) ? 'auth' : 'service', label: `${name} Service`, desc: `${name} logic` };
}

export function modifyHeuristic(g: Graph, instruction: string): { operations: Operation[]; graph: Graph } {
  const s = instruction.trim().replace(/[.!]+$/, '');
  const ops: Operation[] = [];
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^replace\s+(.+?)\s+with\s+(.+)$/i))) {
    const target = findNode(g, m[1]);
    if (!target) throw new Error(`Could not find "${m[1]}" in the diagram`);
    const d = describe(m[2]);
    ops.push({ op: 'updateNode', id: target.id, type: d.type, data: { label: d.label, technology: d.tech, description: d.desc } });
  } else if ((m = s.match(/^(?:remove|delete)\s+(.+)$/i))) {
    const target = findNode(g, m[1]);
    if (!target) throw new Error(`Could not find "${m[1]}" in the diagram`);
    ops.push({ op: 'removeNode', id: target.id });
  } else if ((m = s.match(/^add\s+(.+?)(?:\s+between\s+(.+?)\s+and\s+(.+))?$/i))) {
    if (m[2] && m[3]) {
      const a = findNode(g, m[2]), b = findNode(g, m[3]);
      if (!a || !b) throw new Error('Could not resolve both components for "between"');
      const d = describe(m[1]);
      const id = nextId(g, d.type);
      ops.push({ op: 'addNode', node: { id, type: d.type, position: { x: 0, y: 0 }, data: { label: d.label, technology: d.tech, description: d.desc } } });
      const used = new Set<string>([id]);
      const eid = () => { let i = g.edges.length + used.size; while (g.edges.some((e) => e.id === `edge_${i}`) || used.has(`edge_${i}`)) i++; used.add(`edge_${i}`); return `edge_${i}`; };
      const old = g.edges.find((e) => e.source === a.id && e.target === b.id);
      if (old) ops.push({ op: 'removeEdge', id: old.id });
      ops.push({ op: 'addEdge', edge: { id: eid(), source: a.id, target: id } }, { op: 'addEdge', edge: { id: eid(), source: id, target: b.id } });
    } else {
      const d = describe(m[1]);
      const id = nextId(g, d.type);
      ops.push({ op: 'addNode', node: { id, type: d.type, position: { x: 0, y: 0 }, data: { label: d.label, technology: d.tech, description: d.desc } } });
      const used = new Set<string>([id]);
      const eid = () => { let i = g.edges.length + used.size; while (g.edges.some((e) => e.id === `edge_${i}`) || used.has(`edge_${i}`)) i++; used.add(`edge_${i}`); return `edge_${i}`; };
      const core = g.nodes.find((n) => n.type === 'service') ?? g.nodes.find((n) => n.type !== 'frontend');
      if (core) ops.push({ op: 'addEdge', edge: { id: eid(), source: core.id, target: id } });
    }
  } else {
    throw new Error('Could not interpret the instruction. Try "add Redis", "replace MongoDB with PostgreSQL" or "remove the cache".');
  }
  return { operations: ops, graph: applyOps(g, ops) };
}

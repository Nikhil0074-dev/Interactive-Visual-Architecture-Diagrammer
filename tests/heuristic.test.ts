import { describe, expect, it } from 'vitest';
import { generateHeuristic, modifyHeuristic } from '@/lib/heuristic';
import { validateGraph } from '@/lib/graph';
import { graphSchema } from '@/lib/schema';

const label = (g: any, id: string) => g.nodes.find((n: any) => n.id === id).data.label;
const has = (g: any, a: string, b: string) => g.edges.some((e: any) => label(g, e.source) === a && label(g, e.target) === b);

describe('generateHeuristic', () => {
  const p = 'Build an e-commerce application with a React frontend, a Python FastAPI backend, PostgreSQL for user data, Redis for caching, and Stripe for payments.';
  const { graph } = generateHeuristic(p);
  it('produces a schema-valid, error-free graph', () => {
    expect(graphSchema.safeParse(graph).success).toBe(true);
    expect(validateGraph(graph).errors).toEqual([]);
  });
  it('finds each described component exactly once', () => {
    const types = graph.nodes.map((n) => n.type).sort();
    expect(types).toEqual(['cache', 'database', 'external', 'frontend', 'service']);
  });
  it('wires only the described relationships', () => {
    expect(has(graph, 'React Frontend', 'FastAPI Service')).toBe(true);
    expect(has(graph, 'FastAPI Service', 'PostgreSQL')).toBe(true);
    expect(has(graph, 'FastAPI Service', 'Redis')).toBe(true);
    expect(has(graph, 'FastAPI Service', 'Stripe')).toBe(true);
    expect(graph.edges).toHaveLength(4);
  });
  it('handles the food-delivery example with queue and services', () => {
    const r = generateHeuristic('Create a food delivery platform with a React frontend, FastAPI backend, authentication service, restaurant service, order service, PostgreSQL database, Redis cache, and RabbitMQ for asynchronous order processing.');
    const g = r.graph;
    expect(validateGraph(g).errors).toEqual([]);
    expect(g.nodes.map((n) => n.data.label)).toEqual(expect.arrayContaining(['Authentication Service', 'Restaurant Service', 'Order Service', 'RabbitMQ', 'Redis', 'PostgreSQL']));
    expect(has(g, 'Order Service', 'RabbitMQ')).toBe(true);
    expect(g.nodes.find((n) => n.data.label === 'Authentication Service')!.type).toBe('auth');
  });
  it('adds an API service (and says so) when only a frontend is given', () => {
    const r = generateHeuristic('A Vue app and MongoDB');
    expect(r.assumptions.join()).toMatch(/API Service/);
    expect(validateGraph(r.graph).errors).toEqual([]);
  });
  it('falls back to a starter architecture for unrecognised text', () => {
    const r = generateHeuristic('something vague');
    expect(r.warnings.length).toBe(1);
    expect(r.graph.nodes.length).toBe(3);
  });
});

describe('modifyHeuristic', () => {
  const g = generateHeuristic('React frontend, FastAPI backend, PostgreSQL').graph;
  it('adds Redis connected to the core service', () => {
    const r = modifyHeuristic(g, 'Add Redis caching');
    expect(r.graph.nodes.some((n) => n.data.label === 'Redis' && n.type === 'cache')).toBe(true);
    expect(r.graph.edges.length).toBe(g.edges.length + 1);
  });
  it('inserts a node between two components', () => {
    const r = modifyHeuristic(g, 'Add Redis between the API and the database');
    expect(r.graph.edges.some((e) => label(r.graph, e.source) === 'FastAPI Service' && label(r.graph, e.target) === 'PostgreSQL')).toBe(false);
    expect(validateGraph(r.graph).errors).toEqual([]);
    expect(r.operations.map((o) => o.op)).toEqual(['addNode', 'removeEdge', 'addEdge', 'addEdge']);
  });
  it('replaces and removes', () => {
    expect(modifyHeuristic(g, 'Replace PostgreSQL with MongoDB').graph.nodes.some((n) => n.data.label === 'MongoDB')).toBe(true);
    expect(modifyHeuristic(g, 'remove the database').graph.nodes.some((n) => n.type === 'database')).toBe(false);
  });
  it('reports unintelligible or unresolvable instructions', () => {
    expect(() => modifyHeuristic(g, 'make it faster')).toThrow(/Could not interpret/);
    expect(() => modifyHeuristic(g, 'remove the kraken')).toThrow(/Could not find/);
  });
});

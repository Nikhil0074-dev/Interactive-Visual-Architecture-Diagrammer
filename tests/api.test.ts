import { beforeEach, describe, expect, it } from 'vitest';
import { POST as generate } from '@/app/api/generate/route';
import { POST as modify } from '@/app/api/modify/route';
import { POST as validate } from '@/app/api/validate/route';
import { POST as exportRoute } from '@/app/api/export/route';

const call = (h: (r: Request) => Promise<Response>, body: unknown, raw?: string) =>
  h(new Request('http://t/api', { method: 'POST', body: raw ?? JSON.stringify(body) }));

beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });

describe('API routes (offline mode)', () => {
  it('/generate returns a graph', async () => {
    const res = await call(generate, { prompt: 'React frontend, FastAPI backend and PostgreSQL' });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.success).toBe(true);
    expect(j.source).toBe('offline');
    expect(j.architecture.nodes.length).toBe(3);
  });
  it('/generate rejects bad input', async () => {
    expect((await call(generate, { prompt: 'x' })).status).toBe(400);
    expect((await call(generate, null, 'not json')).status).toBe(400);
  });
  it('/modify returns a diff, and 422 for uninterpretable instructions', async () => {
    const g = (await (await call(generate, { prompt: 'React, FastAPI, PostgreSQL' })).json()).architecture;
    const ok = await (await call(modify, { graph: g, instruction: 'Add Redis' })).json();
    expect(ok.diff.addedNodes.length).toBe(1);
    expect((await call(modify, { graph: g, instruction: 'do a barrel roll' })).status).toBe(422);
  });
  it('/validate flags invalid graphs', async () => {
    const bad = { nodes: [{ id: 'a', type: 'service', data: { label: 'A' } }], edges: [{ id: 'e', source: 'a', target: 'b' }] };
    const j = await (await call(validate, { graph: bad })).json();
    expect(j.valid).toBe(false);
    expect(j.errors[0]).toMatch(/missing target/);
  });
  it('/export produces json, mermaid and markdown; refuses invalid graphs', async () => {
    const g = (await (await call(generate, { prompt: 'React, FastAPI, Redis' })).json()).architecture;
    expect(JSON.parse((await (await call(exportRoute, { graph: g, format: 'json' })).json()).content).nodes.length).toBe(3);
    expect((await (await call(exportRoute, { graph: g, format: 'mermaid' })).json()).content).toMatch(/^flowchart/);
    expect((await (await call(exportRoute, { graph: g, format: 'markdown' })).json()).content).toMatch(/## Connections/);
    const bad = { nodes: [], edges: [{ id: 'e', source: 'a', target: 'b' }] };
    expect((await call(exportRoute, { graph: bad, format: 'json' })).status).toBe(422);
  });
});

import { NextResponse } from 'next/server';
import { modifyArchitecture } from '@/lib/ai';
import { fail, parseBody } from '@/lib/http';
import { modifyRequestSchema } from '@/lib/schema';
import { diffGraphs } from '@/lib/graph';

export async function POST(req: Request) {
  const p = await parseBody(req, modifyRequestSchema);
  if ('error' in p) return p.error;
  try {
    const r = await modifyArchitecture(p.data.graph, p.data.instruction);
    return NextResponse.json({ success: true, operations: r.operations, architecture: r.graph, diff: diffGraphs(p.data.graph, r.graph), source: r.source });
  } catch (e) { return fail(e); }
}

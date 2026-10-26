import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/http';
import { graphSchema } from '@/lib/schema';
import { validateGraph } from '@/lib/graph';

export async function POST(req: Request) {
  const p = await parseBody(req, z.object({ graph: graphSchema }));
  if ('error' in p) return p.error;
  const r = validateGraph(p.data.graph);
  return NextResponse.json({ success: true, valid: r.errors.length === 0, ...r });
}

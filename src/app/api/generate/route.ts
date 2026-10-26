import { NextResponse } from 'next/server';
import { generateArchitecture } from '@/lib/ai';
import { fail, parseBody } from '@/lib/http';
import { generateRequestSchema } from '@/lib/schema';
import { validateGraph } from '@/lib/graph';

export async function POST(req: Request) {
  const p = await parseBody(req, generateRequestSchema);
  if ('error' in p) return p.error;
  try {
    const r = await generateArchitecture(p.data.prompt);
    return NextResponse.json({ success: true, architecture: r.graph, assumptions: r.assumptions, warnings: [...r.warnings, ...validateGraph(r.graph).warnings], source: r.source });
  } catch (e) { return fail(e, 502); }
}

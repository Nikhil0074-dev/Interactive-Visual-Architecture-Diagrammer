import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: NextResponse }> {
  let json: unknown;
  try { json = await req.json(); } catch { return { error: NextResponse.json({ success: false, error: 'Body must be valid JSON' }, { status: 400 }) }; }
  const r = schema.safeParse(json);
  if (!r.success) return { error: NextResponse.json({ success: false, error: r.error.issues[0]?.path.join('.') + ': ' + r.error.issues[0]?.message }, { status: 400 }) };
  return { data: r.data };
}
export const fail = (e: unknown, status = 422) => NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status });

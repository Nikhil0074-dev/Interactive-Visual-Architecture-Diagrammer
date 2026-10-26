import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fail, parseBody } from '@/lib/http';
import { graphSchema } from '@/lib/schema';
import { toMermaid, validateGraph } from '@/lib/graph';

export async function POST(req: Request) {
  const p = await parseBody(req, z.object({ graph: graphSchema, format: z.enum(['json', 'mermaid', 'markdown']) }));
  if ('error' in p) return p.error;
  const { graph, format } = p.data;
  const v = validateGraph(graph);
  if (v.errors.length) return fail(new Error(v.errors.join('; ')));
  const mermaid = toMermaid(graph);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)!.data.label;
  const content = format === 'json' ? JSON.stringify(graph, null, 2) : format === 'mermaid' ? mermaid
    : `# ${graph.name}\n\n## Components\n${graph.nodes.map((n) => `- **${n.data.label}** (${n.type}${n.data.technology ? `, ${n.data.technology}` : ''})${n.data.description ? ` - ${n.data.description}` : ''}`).join('\n')}\n\n## Connections\n${graph.edges.map((e) => `- ${name(e.source)} -> ${name(e.target)}${e.label ? ` (${e.label})` : ''}`).join('\n')}\n\n## Diagram\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
  return NextResponse.json({ success: true, format, content });
}

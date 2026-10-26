import { z } from 'zod';

export const NODE_TYPES = ['frontend', 'gateway', 'service', 'auth', 'database', 'cache', 'queue', 'external', 'storage'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  data: z.object({
    label: z.string().trim().min(1).max(80),
    technology: z.string().max(80).optional(),
    description: z.string().max(300).optional(),
  }),
});
export const edgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().max(60).optional(),
});
export const graphSchema = z.object({
  id: z.string().default('project'),
  name: z.string().min(1).max(100).default('Untitled Architecture'),
  version: z.number().int().default(1),
  nodes: z.array(nodeSchema).max(100),
  edges: z.array(edgeSchema).max(300),
});

export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNode'), node: nodeSchema }),
  z.object({ op: z.literal('removeNode'), id: z.string() }),
  z.object({
    op: z.literal('updateNode'), id: z.string(), type: z.enum(NODE_TYPES).optional(),
    data: nodeSchema.shape.data.partial(),
  }),
  z.object({ op: z.literal('addEdge'), edge: edgeSchema }),
  z.object({ op: z.literal('removeEdge'), id: z.string() }),
]);
export const opsResponseSchema = z.object({ operations: z.array(opSchema).max(50) });

export const generateRequestSchema = z.object({ prompt: z.string().trim().min(3).max(2000) });
export const modifyRequestSchema = z.object({ graph: graphSchema, instruction: z.string().trim().min(3).max(500) });

export type ArchNode = z.infer<typeof nodeSchema>;
export type ArchEdge = z.infer<typeof edgeSchema>;
export type Graph = z.infer<typeof graphSchema>;
export type Operation = z.infer<typeof opSchema>;

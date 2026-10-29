import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const pipelineUpdate = z.object({
  name: text(80).min(1),
  description: text(300).nullable().optional(),
  stages: z.array(z.object({
    // No id = new stage; it needs the system status it belongs under.
    id: z.string().min(1).optional(),
    system_status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared', 'closed']).optional(),
    name: text(60).min(1),
    description: text(300).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color hexadecimal como #2563eb'),
  }).strict()).min(1, 'El pipeline necesita al menos una etapa'),
}).strict();

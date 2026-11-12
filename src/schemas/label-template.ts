import { z } from 'zod';

export const labelVariableKey = z.enum([
  'farmacia_nombre', 'farmacia_telefono', 'farmacia_direccion',
  'paciente_nombre', 'paciente_documento', 'paciente_edad', 'paciente_telefono',
  'tratamiento_nombre', 'medicamento_nombre', 'medicamento_presentacion',
  'dosis', 'programacion_dosis', 'dosis_cantidad', 'dosis_unidad', 'via_administracion', 'frecuencia', 'horario', 'duracion', 'cantidad', 'instrucciones',
  'fecha_inicio', 'fecha_fin', 'prescriptor', 'codigo_tratamiento',
]);
export type LabelVariableKey = z.infer<typeof labelVariableKey>;

const elementBase = {
  id: z.number().int().min(1),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(4).max(400),
  fontSize: z.number().min(6).max(72).default(12),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color hex como #243247').default('#243247'),
  rotation: z.number().min(-180).max(180).default(0),
};

export const labelElement = z.discriminatedUnion('type', [
  z.object({ type: z.literal('variable'), key: labelVariableKey, showLabel: z.boolean().default(true), ...elementBase }).strict(),
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(200), ...elementBase }).strict(),
  z.object({ type: z.literal('line'), orientation: z.enum(['horizontal', 'vertical']).default('horizontal'), ...elementBase }).strict(),
]);

const labelTemplateFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).nullable().optional(),
  branch_id: z.string().min(1).nullable().optional(),
  width_in: z.number().min(1).max(12),
  height_in: z.number().min(1).max(12),
  orientation: z.enum(['landscape', 'portrait']),
  elements: z.array(labelElement).max(100),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
};

export const labelTemplateCreate = z.object(labelTemplateFields).strict();
export const labelTemplatePatch = z.object({
  ...labelTemplateFields,
  name: labelTemplateFields.name.optional(),
  width_in: labelTemplateFields.width_in.optional(),
  height_in: labelTemplateFields.height_in.optional(),
  orientation: labelTemplateFields.orientation.optional(),
  elements: labelTemplateFields.elements.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const labelTemplateParams = z.object({ id: z.string().min(1) });
export const labelTemplateListQuery = z.object({
  branch_id: z.string().optional(),
  active: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
});
export const labelTemplatePreviewQuery = z.object({ treatment_id: z.string().min(1) });
export const labelTemplateResolveQuery = z.object({
  patient_id: z.string().min(1),
  treatment_id: z.string().min(1).optional(),
});

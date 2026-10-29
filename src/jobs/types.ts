/** Queue names. The Spanish names match the product vocabulary used in the specification. */
export const JOBS = {
  planNotices: 'planificar-avisos',
  sendNotice: 'enviar-aviso',
  processNoResponse: 'procesar-sin-respuesta',
  reviewPrescriptions: 'revisar-recetas',
  recalcStates: 'recalcular-estados',
  cleanOutbox: 'limpieza-outbox',
  scheduledRules: 'reglas-programadas',
  processInbound: 'procesar-entrantes',
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * What the jobs need from the queue. pg-boss implements it in the worker;
 * tests pass a recording fake, so job logic never depends on pg-boss itself.
 */
export type JobQueue = {
  enqueue(name: JobName, data: object, options?: { singletonKey?: string; startAfter?: Date }): Promise<void>;
};

export type SendNoticeData = { organizationId: string; outboxId: string };

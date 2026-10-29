/**
 * Catalog of no-code automation rules. Each one can be switched on or off
 * independently; the organization-wide switch (Setting.automationEnabled)
 * must also be on for any of them to run.
 *
 * No rule here sends anything to a patient. They create internal work
 * (tasks, incidents, history). Where the work is a patient reminder, a patient
 * without current reminder consent only ever gets a *call* task.
 */
export const automationRuleKeys = ['cycle_delivered', 'treatment_created', 'cycle_due_soon', 'cycle_no_response'] as const;
export type AutomationRuleKey = (typeof automationRuleKeys)[number];

export const automationRuleCatalog: Record<AutomationRuleKey, { label: string; description: string; defaults: Record<string, number> }> = {
  cycle_delivered: {
    label: 'Ciclo entregado',
    description: 'Avisa al equipo con una tarea y asegura que exista el siguiente ciclo con su fecha prevista.',
    defaults: {},
  },
  treatment_created: {
    label: 'Tratamiento nuevo',
    description: 'Crea una tarea de seguimiento cuando se registra un tratamiento nuevo.',
    defaults: { followUpDays: 7 },
  },
  cycle_due_soon: {
    label: 'Ciclo en «Vence pronto»',
    description: 'Crea un recordatorio cuando un ciclo abierto entra en el umbral de «Vence pronto».',
    defaults: {},
  },
  cycle_no_response: {
    label: 'Sin respuesta',
    description: 'Crea una incidencia «Sin respuesta» cuando un ciclo avisado lleva X días sin respuesta.',
    defaults: { days: 3 },
  },
};

export const isAutomationRuleKey = (value: string): value is AutomationRuleKey =>
  (automationRuleKeys as readonly string[]).includes(value);

/** Safety rule: no current reminder consent means the only allowed output is a call task. */
export function reminderTaskFor(consent: boolean, patientName: string, subject: string) {
  return consent
    ? { type: 'other' as const, title: `Avisar a ${patientName}: ${subject}`, withoutConsent: false }
    : { type: 'call' as const, title: `Llamar a ${patientName}: ${subject} (sin consentimiento de recordatorios)`, withoutConsent: true };
}

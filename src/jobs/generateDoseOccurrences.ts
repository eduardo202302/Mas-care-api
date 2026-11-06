import { materializeOccurrences, type DoseScheduleVersion } from '../domain/doseSchedule.js';
import { localDateString } from '../domain/localDate.js';
import { logger } from '../infra/logger.js';
import { prisma, withTenant } from '../infra/prisma.js';
import { effectiveSettings } from './shared.js';

export type GenerateDoseOccurrencesSummary = { created: number; treatmentsScanned: number };

const LOOKAHEAD_HOURS = 48;

/**
 * Materializes DoseLog rows ~48h ahead for every active treatment that has
 * an active DoseSchedule (effectiveTo null). Never computed on the fly:
 * each occurrence needs its own row with its own lifecycle a person can act
 * on, the same reasoning RefillCycle is a real row rather than a derived
 * date. Idempotent via the (organizationId, doseScheduleId, scheduledFor)
 * unique constraint, so running this twice in the same window is harmless.
 */
export async function generateDoseOccurrences(options: { now?: Date; organizationId?: string } = {}): Promise<GenerateDoseOccurrencesSummary> {
  const now = options.now ?? new Date();
  const total: GenerateDoseOccurrencesSummary = { created: 0, treatmentsScanned: 0 };
  const organizations = await prisma.organization.findMany({
    where: { status: 'active', ...(options.organizationId ? { id: options.organizationId } : {}) },
    select: { id: true },
  });
  for (const { id: organizationId } of organizations) {
    try {
      const created = await withTenant(organizationId, async (tx) => {
        const treatments = await tx.treatment.findMany({
          where: { status: 'active', doseSchedules: { some: { effectiveTo: null } } },
          select: { id: true, branchId: true, doseSchedules: { orderBy: { effectiveFrom: 'asc' } } },
          take: 2000,
        });
        total.treatmentsScanned += treatments.length;
        let createdHere = 0;
        for (const treatment of treatments) {
          const settings = await effectiveSettings(tx, treatment.branchId);
          const timezone = settings?.timezone ?? 'America/Santo_Domingo';
          const fromLocal = new Date(`${localDateString(now, timezone)}T00:00:00.000Z`);
          const toLocal = new Date(`${localDateString(new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000), timezone)}T00:00:00.000Z`);
          const versions: DoseScheduleVersion[] = treatment.doseSchedules.map((version) => ({
            id: version.id,
            dosePerIntake: version.dosePerIntake.toString(),
            times: version.times,
            frequencyType: version.frequencyType,
            intervalHours: version.intervalHours,
            anchorAt: version.anchorAt,
            weekdays: version.weekdays,
            monthdays: version.monthdays,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo,
          }));
          const occurrences = materializeOccurrences(versions, fromLocal, toLocal, timezone);
          if (!occurrences.length) continue;
          const result = await tx.doseLog.createMany({
            data: occurrences.map((occurrence) => ({
              organizationId,
              treatmentId: treatment.id,
              doseScheduleId: occurrence.doseScheduleId,
              scheduledFor: occurrence.scheduledFor,
              status: 'scheduled',
              nominalQuantity: occurrence.nominalQuantity,
            })),
            skipDuplicates: true,
          });
          createdHere += result.count;
        }
        return createdHere;
      });
      total.created += created;
    } catch (error) {
      logger.error({ err: error, organizationId }, 'generating dose occurrences failed');
    }
  }
  return total;
}

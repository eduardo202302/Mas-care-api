import { PrismaClient } from '@prisma/client';

const directUrl = process.env.DIRECT_URL;
if (!directUrl) throw new Error('DIRECT_URL is required');
const prisma = new PrismaClient({ datasourceUrl: directUrl });

const tables = [
  'branches', 'settings', 'audit_log', 'patients', 'patient_caregivers',
  'patient_consents', 'medications', 'treatments', 'refill_cycles', 'outbox_messages',
  'notices', 'incidents', 'deliveries', 'patient_transfers', 'patient_transfer_treatments',
  'activities', 'saved_views', 'tasks', 'message_templates', 'import_jobs',
  '"user"', 'password_reset_pin', 'session', 'account', 'verification',
  'organization', 'member', 'invitation', 'menu_items', 'roles',
  'automation_rules', 'automation_runs', 'pipelines', 'pipeline_stages', 'custom_properties',
  'whatsapp_inbound', 'whatsapp_accounts', 'telegram_accounts', 'telegram_links', 'telegram_link_tokens',
];

async function main() {
  const unionSql = tables.map((t) => `SELECT numeric_id, '${t.replace(/"/g, '')}' AS source_table FROM ${t}`).join('\n  UNION ALL\n  ');

  const perTableCounts = await Promise.all(
    tables.map(async (t) => {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM ${t}`);
      const [row] = rows;
      if (!row) throw new Error(`No count row for ${t}`);
      return { table: t.replace(/"/g, ''), count: Number(row.count) };
    }),
  );
  const totalRows = perTableCounts.reduce((sum, r) => sum + r.count, 0);

  const distinctCountRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(DISTINCT numeric_id)::bigint AS count FROM (\n  ${unionSql}\n) t`,
  );
  const [distinctCountRow] = distinctCountRows;
  if (!distinctCountRow) throw new Error('No distinct-count row');
  const distinctCount = Number(distinctCountRow.count);

  const duplicates = await prisma.$queryRawUnsafe<{ numeric_id: bigint; source_table: string; occurrences: bigint }[]>(
    `SELECT numeric_id, source_table, count(*)::bigint AS occurrences FROM (\n  ${unionSql}\n) t GROUP BY numeric_id, source_table HAVING count(*) > 1`,
  );

  const crossTableDuplicates = await prisma.$queryRawUnsafe<{ numeric_id: bigint; tables: string[] }[]>(
    `SELECT numeric_id, array_agg(DISTINCT source_table) AS tables FROM (\n  ${unionSql}\n) t GROUP BY numeric_id HAVING count(DISTINCT source_table) > 1`,
  );

  const seqRows = await prisma.$queryRawUnsafe<{ last_value: bigint; is_called: boolean }[]>(
    `SELECT last_value, is_called FROM global_numeric_id_seq`,
  );
  const [seqRow] = seqRows;
  if (!seqRow) throw new Error('No sequence row');

  console.log('Per-table row counts:');
  for (const r of perTableCounts) console.log(`  ${r.table}: ${r.count}`);
  console.log(`\nTotal rows across all 40 tables: ${totalRows}`);
  console.log(`Distinct numeric_id values across all 40 tables: ${distinctCount}`);
  console.log(`Match (total === distinct): ${totalRows === distinctCount}`);
  console.log(`Within-table duplicate numeric_id groups: ${duplicates.length}`);
  console.log(`Cross-table duplicate numeric_id groups: ${crossTableDuplicates.length}`);
  if (duplicates.length) console.log(JSON.stringify(duplicates, null, 2));
  if (crossTableDuplicates.length) console.log(JSON.stringify(crossTableDuplicates, null, 2));
  console.log(`\nSequence global_numeric_id_seq: last_value=${seqRow.last_value}, is_called=${seqRow.is_called}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

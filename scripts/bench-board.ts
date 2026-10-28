import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma, withTenant } from '../src/infra/prisma.js';

const RUNS = Number(process.env.PERF_RUNS ?? 30);
const password = 'MaxCareDev-2026!';

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function measure(path: string, runs: number): Promise<number[]> {
  const timings: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await agent.get(path).expect(200);
    timings.push(performance.now() - started);
  }
  return timings;
}

const agent = request.agent(app);
await agent.post('/api/auth/sign-in/email').send({ email: 'owner.a@maxcare.test', password }).expect(200);
const me = (await agent.get('/api/v1/me').expect(200)).body as { organization: { id: string }; branches: Array<{ id: string; name: string }> };
const branches = me.branches.filter((branch) => branch.name.startsWith('Perf Sucursal'));
if (branches.length === 0) throw new Error('Run scripts/seed-perf.ts first.');
const scoped = branches[0]!;

const globalRuns = await measure('/api/v1/board', RUNS);
const branchRuns = await measure(`/api/v1/board?branch_id=${scoped.id}`, RUNS);
const lastBody = (await agent.get('/api/v1/board').expect(200)).body as {
  columns?: Record<string, { count: number }>;
};
const total = Object.values(lastBody.columns ?? {}).reduce((sum, column) => sum + column.count, 0);

async function explain(sql: string, ...params: unknown[]) {
  const rows = await withTenant(me.organization.id, (tx) =>
    tx.$queryRawUnsafe<Array<Record<string, string>>>(sql, ...params),
  );
  return rows.map((row) => Object.values(row)[0]).join('\n');
}

const branchPlan = await explain(
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
   SELECT rc.id
   FROM refill_cycles rc
   JOIN treatments t ON t.organization_id = rc.organization_id AND t.id = rc.treatment_id
   WHERE rc.organization_id = $1 AND rc.branch_id = $2 AND rc.status = 'to_notify' AND rc.closed_at IS NULL
   ORDER BY rc.status, rc.board_position NULLS LAST, rc.expected_on, rc.id
   LIMIT 30`,
  me.organization.id,
  scoped.id,
);
const globalPlan = await explain(
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
   SELECT rc.id
   FROM refill_cycles rc
   WHERE rc.organization_id = $1 AND rc.status = 'to_notify' AND rc.closed_at IS NULL
   ORDER BY rc.status, rc.board_position NULLS LAST, rc.expected_on, rc.id
   LIMIT 30`,
  me.organization.id,
);

const metrics = (values: number[]) => ({
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: Math.max(...values),
});
const globalMetrics = metrics(globalRuns);
const branchMetrics = metrics(branchRuns);
const pass = globalMetrics.p95 < 300 && branchMetrics.p95 < 300;

const report = [
  '# Phase 2 board performance',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `- Environment: ${process.env.DATABASE_URL?.includes('neon.tech') ? 'remote Neon Postgres' : 'local PostgreSQL'}`,
  `- Seed: ${total} open cycles across ${branches.length} performance branches (see \`scripts/seed-perf.ts\`)`,
  `- Endpoint: \`GET /api/v1/board\` (5 columns + counts + 30 cards each)`,
  `- Runs per scenario: ${RUNS}`,
  '',
  '| scenario | p50 (ms) | p95 (ms) | max (ms) |',
  '| --- | ---: | ---: | ---: |',
  `| branch filter (\`branch_id=${scoped.id}\`) | ${branchMetrics.p50.toFixed(0)} | ${branchMetrics.p95.toFixed(0)} | ${branchMetrics.max.toFixed(0)} |`,
  `| no filters (whole organization) | ${globalMetrics.p50.toFixed(0)} | ${globalMetrics.p95.toFixed(0)} | ${globalMetrics.max.toFixed(0)} |`,
  '',
  `Target: p95 < 300 ms with and without filters. Result: **${pass ? 'PASS' : 'FAIL'}**.`,
  '',
  '## EXPLAIN (ANALYZE, BUFFERS): branch filter',
  '',
  '```text',
  branchPlan,
  '```',
  '',
  '## EXPLAIN (ANALYZE, BUFFERS): no filters',
  '',
  '```text',
  globalPlan,
  '```',
  '',
].join('\n');

writeFileSync('docs/phase2-performance.md', report, 'utf8');
console.info(report);
await prisma.$disconnect();

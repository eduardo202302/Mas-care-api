import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pipelineUpdate } from '../src/schemas/pipeline.js';
import { noticeScenario } from './helpers/notice-scenario.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

async function login(role: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.a@maxcare.test`, password }).expect(200);
  return agent;
}

describe('pipeline schema', () => {
  const stage = { id: 's1', name: 'Una', color: '#112233' };
  it('requires at least one stage and a valid colour', () => {
    expect(pipelineUpdate.safeParse({ name: 'P', stages: [] }).success).toBe(false);
    expect(pipelineUpdate.safeParse({ name: 'P', stages: [{ ...stage, color: 'red' }] }).success).toBe(false);
    expect(pipelineUpdate.safeParse({ name: 'P', stages: [stage] }).success).toBe(true);
  });
});

describe.skipIf(!enabled)('pipeline editor', () => {
  it('renames and reorders stages, and refuses a bad list', async () => {
    const agent = await login('owner');
    const current = (await agent.get('/api/v1/pipelines/refill-cycles').expect(200)).body as {
      name: string; stages: { id: string; name: string; color: string; system_status: string }[];
    };
    expect(current.stages).toHaveLength(5);
    const original = current.stages.map((s) => ({ id: s.id, name: s.name, color: s.color }));
    try {
    const reversed = [...current.stages].reverse().map((s) => ({ id: s.id, name: s.name, color: s.color }));
    reversed[0] = { ...reversed[0]!, name: 'Cerrados' };

    const updated = (await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: reversed }).expect(200)).body as typeof current;
    expect(updated.stages[0]).toMatchObject({ name: 'Cerrados', system_status: 'closed' });

    // Dropping the only stage of a column, an unknown id, or a new stage without its column are all refused.
    await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: reversed.slice(1) }).expect(409);
    await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: [reversed[0], { ...reversed[0]! , id: 'x' }, ...reversed.slice(1)] }).expect(400);
    await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: [...reversed, { name: 'Sin columna', color: '#112233' }] }).expect(400);
    await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: reversed.map((s) => ({ ...s, name: 'Igual' })) }).expect(400);

    } finally {
      // Always put the original names back so reruns start from the same state.
      await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: original });
    }
  });

  it('adds a sub-stage, files a cycle in it, and refuses to delete it while it holds cycles', async () => {
    const s = await noticeScenario({ consent: false });
    const agent = s.agent;
    const get = async () => (await agent.get('/api/v1/pipelines/refill-cycles').expect(200)).body as {
      name: string; stages: { id: string; name: string; color: string; system_status: string; cycle_count: number }[];
    };
    const keep = (stages: Awaited<ReturnType<typeof get>>['stages']) => stages.map((x) => ({ id: x.id, name: x.name, color: x.color }));
    const before = await get();
    const put = (stages: object[]) => agent.put('/api/v1/pipelines/refill-cycles').send({ name: before.name, stages });
    const column = s.cycle.status as string;
    const main = before.stages.find((x) => x.system_status === column)!;
    try {
      const created = (await put([...keep(before.stages), { name: 'Sub-etapa prueba', color: '#334455', system_status: column }]).expect(200)).body as Awaited<ReturnType<typeof get>>;
      const sub = created.stages.find((x) => x.name === 'Sub-etapa prueba')!;
      expect(sub.system_status).toBe(column);
      const mainCount = created.stages.find((x) => x.id === main.id)!.cycle_count;
      expect(mainCount).toBeGreaterThan(0);

      const other = before.stages.find((x) => x.system_status !== column)!;
      await agent.patch(`/api/v1/cycles/${s.cycle.id}/stage`).send({ stage_id: other.id }).expect(400);
      await agent.patch(`/api/v1/cycles/${s.cycle.id}/stage`).send({ stage_id: sub.id }).expect(200);
      const filed = await get();
      expect(filed.stages.find((x) => x.id === sub.id)!.cycle_count).toBe(1);
      expect(filed.stages.find((x) => x.id === main.id)!.cycle_count).toBe(mainCount - 1);
      await put(keep(created.stages).filter((x) => x.id !== sub.id)).expect(409);

      await agent.patch(`/api/v1/cycles/${s.cycle.id}/stage`).send({ stage_id: null }).expect(200);
      await put(keep(created.stages).filter((x) => x.id !== sub.id)).expect(200);
      expect((await get()).stages).toHaveLength(before.stages.length);
    } finally {
      await agent.patch(`/api/v1/cycles/${s.cycle.id}/stage`).send({ stage_id: null });
      await put(keep(before.stages));
      await s.cleanup();
    }
  });

  it('is read-only for roles without settings:write', async () => {
    const agent = await login('operator');
    const current = (await agent.get('/api/v1/pipelines/refill-cycles').expect(200)).body as { name: string; stages: { id: string; name: string; color: string }[] };
    await agent.put('/api/v1/pipelines/refill-cycles').send({ name: current.name, stages: current.stages.map((s) => ({ id: s.id, name: s.name, color: s.color })) }).expect(403);
  });
});

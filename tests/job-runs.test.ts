import './db-guard.js';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/infra/prisma.js';
import { trackRun } from '../src/jobs/runLog.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const job = `test-job-${Date.now()}`;

describe.skipIf(!enabled)('worker job runs', () => {
  afterAll(async () => { await prisma.jobRun.deleteMany({ where: { jobName: job } }); });

  it('counts runs and failures, keeping only the error class', async () => {
    await trackRun(job, async () => 'ok');
    await expect(trackRun(job, async () => { throw new RangeError('+18095550000 said hi'); })).rejects.toThrow(RangeError);
    await trackRun(job, async () => 'ok');
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { jobName: job } });
    expect(row).toMatchObject({ runs: 3, failures: 1, lastStatus: 'ok', lastError: 'RangeError' });
    expect(row.lastError).not.toContain('8095550000');
    expect(row.lastFailureAt).not.toBeNull();
  });

  it('rejects anonymous callers and organization staff who are not the platform owner', async () => {
    await request(app).get('/api/v1/jobs').expect(401);
    const agent = request.agent(app);
    await agent.post('/api/auth/sign-in/email').send({ email: 'owner.b@maxcare.test', password: 'MaxCareDev-2026!' }).expect(200);
    await agent.get('/api/v1/jobs').expect(403);
  });
});

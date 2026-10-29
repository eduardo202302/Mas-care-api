import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

async function login(role: string, organization = 'a') {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.${organization}@maxcare.test`, password }).expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as { organization: { id: string } };
  return { agent, context };
}

describe.skipIf(!enabled)('exports', () => {
  it('exports patients as CSV, neutralises formulas and audits without row data', async () => {
    const { agent, context } = await login('owner');
    const branch = (await agent.post('/api/v1/branches').send({ name: `Export branch ${Date.now()}` }).expect(201)).body as { id: string };
    await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: '=Fictional Export Patient' }).expect(201);

    const res = await agent.post('/api/v1/exports/patients').send({ format: 'csv', columns: ['fullName', 'primaryBranchId', 'primaryBranchName'], branchId: branch.id }).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain("'=Fictional Export Patient");
    expect(res.text).toContain(branch.id);

    const audit = await withTenant(context.organization.id, (tx) => tx.auditLog.findFirst({ where: { action: 'export.create' }, orderBy: { createdAt: 'desc' } }));
    const metadata = audit?.metadata as { rows: number };
    expect(metadata.rows).toBe(1);
    expect(JSON.stringify(audit?.metadata)).not.toContain('Fictional');
  });

  it('exports medications as XLSX and rejects unknown columns', async () => {
    const { agent } = await login('owner');
    await agent.post('/api/v1/medications').send({ genericName: 'Fictional export med', presentation: '10 mg' }).expect(201);
    const res = await agent.post('/api/v1/exports/medications').send({ format: 'xlsx', columns: ['id', 'presentation'] }).buffer().parse((r, cb) => {
      const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await agent.post('/api/v1/exports/medications').send({ format: 'csv', columns: ['nope'] }).expect(400);
  });

  it('denies export to roles without export:csv', async () => {
    const { agent } = await login('operator');
    await agent.post('/api/v1/exports/patients').send({ format: 'csv', columns: ['id'] }).expect(403);
  });
});

describe.skipIf(!enabled)('medication import', () => {
  it('validates in preview without writing, then imports skipping duplicates', async () => {
    const { agent } = await login('owner');
    const suffix = Date.now();
    const csv = [
      'nombre,presentacion,unidades',
      `Fictional imp ${suffix},10 mg,30`,
      `Fictional imp ${suffix},10 mg,30`,
      `,20 mg,10`,
    ].join('\n');
    const mapping = JSON.stringify({ genericName: 'nombre', presentation: 'presentacion', unitsPerPackage: 'unidades' });

    const preview = await agent.post('/api/v1/imports/medications/preview').field('column_mapping', mapping).attach('file', Buffer.from(csv), 'm.csv').expect(200);
    expect(preview.body).toMatchObject({ total_rows: 3, valid_rows: 1, error_rows: 2 });
    const before = await agent.get(`/api/v1/medications?q=${encodeURIComponent(`Fictional imp ${suffix}`)}`).expect(200);
    expect(before.body.data).toHaveLength(0);

    const done = await agent.post('/api/v1/imports/medications').field('column_mapping', mapping).attach('file', Buffer.from(csv), 'm.csv').expect(201);
    expect(done.body.summary).toEqual({ total_rows: 3, imported_rows: 1, error_rows: 2 });
    expect(done.body.errors.map((e: { code: string }) => e.code)).toEqual(expect.arrayContaining(['DUPLICATE_MEDICATION', 'INVALID_ROW']));
  });
});

describe.skipIf(!enabled)('custom properties in export and import', () => {
  it('exports property columns, and imports a CSV column into a property (org B, cleaned up)', async () => {
    const { agent } = await login('owner', 'b');
    const key = `cpx_${Date.now().toString(36)}`;
    const prop = (await agent.post('/api/v1/custom-properties').send({ entity: 'patient', key, label: 'Seguro CPX', type: 'select', options: ['Público', 'Privado'] }).expect(201)).body as { id: string };
    try {
      const columns = (await agent.get('/api/v1/exports/patients/columns').expect(200)).body.columns as { key: string; header: string }[];
      expect(columns).toContainEqual({ key: `custom:${key}`, header: 'Seguro CPX' });
      await agent.post('/api/v1/exports/medications').send({ format: 'csv', columns: [`custom:${key}`] }).expect(400);

      const suffix = Date.now();
      const csv = ['nombre,seguro', `Fictional cpx a ${suffix},privado`, `Fictional cpx b ${suffix},Otro`].join('\n');
      const mapping = JSON.stringify({ fullName: 'nombre', [`custom:${key}`]: 'seguro' });
      const preview = await agent.post('/api/v1/imports/patients/preview').field('column_mapping', mapping).attach('file', Buffer.from(csv), 'p.csv').expect(200);
      expect(preview.body.valid_rows).toBe(1);
      expect(preview.body.errors[0].fields[key]).toBeTruthy();
      await agent.post('/api/v1/imports/patients').field('column_mapping', JSON.stringify({ fullName: 'nombre', 'custom:nope': 'seguro' })).attach('file', Buffer.from(csv), 'p.csv').expect(400);
      await agent.post('/api/v1/imports/patients').field('column_mapping', mapping).attach('file', Buffer.from(csv), 'p.csv').expect(201);

      const out = await agent.post('/api/v1/exports/patients').send({ format: 'csv', columns: ['fullName', `custom:${key}`], q: `Fictional cpx a ${suffix}` }).expect(200);
      expect(out.text).toContain(`Fictional cpx a ${suffix},Privado`);
    } finally {
      await agent.delete(`/api/v1/custom-properties/${prop.id}`);
    }
  });
});

describe.skipIf(!enabled)('treatment import', () => {
  it('creates treatments with their first cycle, rejects bad rows and repeats (org B)', async () => {
    const { agent } = await login('owner', 'b');
    const suffix = Date.now();
    const phone = `809${String(suffix).slice(-7)}`;
    const branch = (await agent.post('/api/v1/branches').send({ name: `TI branch ${suffix}` }).expect(201)).body as { id: string };
    await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: `Fictional ti ${suffix}`, phone }).expect(201);
    await agent.post('/api/v1/medications').send({ genericName: `Fictional ti med ${suffix}`, presentation: '5 mg' }).expect(201);
    const csv = [
      'tel,med,dosis,tomas,cant,inicio',
      `${phone},Fictional ti med ${suffix},1,2,60,2026-10-01`,
      `${phone},Fictional ti med ${suffix},1,2,60,2026-10-01`,
      `8090000000,Fictional ti med ${suffix},1,2,60,2026-10-01`,
      `${phone},No existe ${suffix},1,2,60,2026-10-01`,
    ].join('\n');
    const mapping = JSON.stringify({ patientPhone: 'tel', medication: 'med', dosePerIntake: 'dosis', intakesPerDay: 'tomas', quantityPerCycle: 'cant', startDate: 'inicio' });
    const send = (url: string) => agent.post(url).field('column_mapping', mapping).attach('file', Buffer.from(csv), 't.csv');

    const preview = await send('/api/v1/imports/treatments/preview').expect(200);
    expect(preview.body.valid_rows).toBe(1);
    expect(preview.body.errors.map((e: { code: string }) => e.code).sort()).toEqual(['DUPLICATE_TREATMENT', 'MEDICATION_NOT_FOUND', 'PATIENT_NOT_FOUND']);

    const done = await send('/api/v1/imports/treatments').expect(201);
    expect(done.body.summary).toMatchObject({ imported_rows: 1, error_rows: 3 });
    const cycles = await agent.get(`/api/v1/cycles?q=Fictional ti ${suffix}`).expect(200);
    expect(cycles.body.data).toHaveLength(1);
    // The same file again finds the treatment already there.
    expect((await send('/api/v1/imports/treatments').expect(201)).body.summary.imported_rows).toBe(0);
    await agent.post('/api/v1/imports/treatments').field('column_mapping', JSON.stringify({ medication: 'med' })).attach('file', Buffer.from(csv), 't.csv').expect(400);
  });

  it('is refused to roles without treatments:write', async () => {
    const { agent } = await login('read_only');
    await agent.post('/api/v1/imports/treatments/preview').field('column_mapping', '{}').attach('file', Buffer.from('a\n1'), 't.csv').expect(403);
  });
});

import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { validateCustomValues, type PropertyDef } from '../src/domain/customProperties.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

const defs: PropertyDef[] = [
  { key: 'seguro', label: 'Seguro', type: 'select', required: true, options: ['A', 'B'] },
  { key: 'peso', label: 'Peso', type: 'number', required: false, options: [] },
  { key: 'alergias', label: 'Alergias', type: 'multiselect', required: false, options: ['x', 'y'] },
  { key: 'visita', label: 'Visita', type: 'date', required: false, options: [] },
  { key: 'activo', label: 'Activo', type: 'checkbox', required: false, options: [] },
  { key: 'nota', label: 'Nota', type: 'short_text', required: false, options: [] },
  { key: 'cita', label: 'Cita', type: 'datetime', required: false, options: [] },
  { key: 'detalle', label: 'Detalle', type: 'long_text', required: false, options: [] },
];

describe('validateCustomValues', () => {
  it('accepts valid values of every type', () => {
    const result = validateCustomValues(defs, {
      seguro: 'A', peso: 70.5, alergias: ['x'], visita: '2026-10-01', activo: true, nota: 'ok', cita: '2026-10-01T10:00:00Z', detalle: 'largo',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects wrong types, unknown options and unknown keys', () => {
    const result = validateCustomValues(defs, { seguro: 'Z', peso: '70', alergias: ['q'], visita: '01/10/2026', activo: 'si', fantasma: 1 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['activo', 'alergias', 'fantasma', 'peso', 'seguro', 'visita']);
  });

  it('requires required properties on create but only touched ones on patch', () => {
    expect(validateCustomValues(defs, {})).toMatchObject({ ok: false });
    expect(validateCustomValues(defs, { peso: 60 }, {}, 'patch')).toMatchObject({ ok: true });
    expect(validateCustomValues(defs, { seguro: null }, { seguro: 'A' }, 'patch')).toMatchObject({ ok: false });
  });

  it('merges on patch and clears with null', () => {
    const result = validateCustomValues(defs, { peso: null, nota: 'nuevo' }, { seguro: 'A', peso: 70 }, 'patch');
    expect(result).toEqual({ ok: true, values: { seguro: 'A', nota: 'nuevo' } });
  });
});

async function login(role: string, org = 'a') {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.${org}@maxcare.test`, password }).expect(200);
  return agent;
}

describe.skipIf(!enabled)('custom properties API', () => {
  it('manages definitions and enforces them on patients, with filtering and delete cleanup', async () => {
    // Org B: a required property in org A would break patient creation in tests running in parallel.
    const agent = await login('owner', 'b');
    const key = `seguro_${Date.now().toString(36)}`;
    let propId = ''
    try {
    const prop = (await agent.post('/api/v1/custom-properties').send({ entity: 'patient', key, label: 'Seguro', type: 'select', required: true, options: ['Público', 'Privado'] }).expect(201)).body as { id: string };
    propId = prop.id;
    await agent.post('/api/v1/custom-properties').send({ entity: 'patient', key, label: 'Otra', type: 'short_text' }).expect(409);
    await agent.post('/api/v1/custom-properties').send({ entity: 'patient', key: 'x1', label: 'Sin opciones', type: 'select' }).expect(400);

    const branch = (await agent.post('/api/v1/branches').send({ name: `CP branch ${Date.now()}` }).expect(201)).body as { id: string };
    await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional cp missing' }).expect(400);
    await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional cp bad', customValues: { [key]: 'Otro' } }).expect(400);
    const ok = (await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional cp ok', customValues: { [key]: 'Privado' } }).expect(201)).body.patient as { id: string; customValues: Record<string, unknown> };
    expect(ok.customValues[key]).toBe('Privado');

    const filtered = await agent.get(`/api/v1/patients?cp_key=${key}&cp_value=Privado`).expect(200);
    expect(filtered.body.data.map((p: { id: string }) => p.id)).toContain(ok.id);
    await agent.get('/api/v1/patients?cp_key=nope&cp_value=1').expect(400);

    await agent.post(`/api/v1/custom-properties/${prop.id}/archive`).expect(200);
    await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional cp after archive' }).expect(201);
    await agent.delete(`/api/v1/custom-properties/${prop.id}`).expect(204);
    propId = '';
    const after = (await agent.get(`/api/v1/patients/${ok.id}`).expect(200)).body as { customValues: Record<string, unknown> };
    expect(after.customValues[key]).toBeUndefined();
    } finally {
      // A required property left behind would make every later patient create fail.
      if (propId) await agent.delete(`/api/v1/custom-properties/${propId}`);
    }
  });

  it('only lets settings managers change definitions', async () => {
    const agent = await login('operator');
    await agent.get('/api/v1/custom-properties').expect(200);
    await agent.post('/api/v1/custom-properties').send({ entity: 'patient', key: 'zz', label: 'Z', type: 'short_text' }).expect(403);
  });
});

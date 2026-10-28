import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { PrismaClient } from '@prisma/client';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';
type Role = 'owner' | 'admin' | 'pharmacist' | 'operator' | 'read_only';
type Context = { user: { id: string }; organization: { id: string }; branches: { id: string; name: string }[] };

const today = new Date();
const todayOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (days: number) => new Date(todayOnly.getTime() + days * 24 * 60 * 60 * 1000);

async function login(role: Role, organization = 'a'): Promise<{ agent: Agent; context: Context }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email')
    .send({ email: `${role}.${organization}@maxcare.test`, password })
    .expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as Context;
  return { agent, context };
}

async function createBranch(agent: Agent, name: string) {
  return (await agent.post('/api/v1/branches').send({ name }).expect(201)).body as { id: string; name: string };
}

async function createTreatment(
  agent: Agent,
  context: Context,
  suffix: string,
  overrides: { branchId?: string; quantity?: number; startDate?: string } = {},
) {
  const branchId = overrides.branchId ?? context.branches[0]!.id;
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Phase 2 patient ${suffix}`,
    documentId: `P2-${suffix}`,
    phone: `740${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Phase 2 medication ${suffix}`,
    presentation: '10 mg tablets',
    unitsPerPackage: 30,
  }).expect(201);
  const treatment = await agent.post('/api/v1/treatments').send({
    patient_id: patient.body.patient.id as string,
    medication_id: medication.body.id as string,
    branch_id: branchId,
    responsible_user_id: context.user.id,
    dose_per_intake: 1,
    intakes_per_day: 1,
    quantity_per_cycle: overrides.quantity ?? 30,
    start_date: overrides.startDate ?? iso(todayOnly),
    prescriber_name: 'Dr. Phase 2',
    prescription_expires_on: iso(addDays(30)),
    notes: 'Fictional treatment data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    branchId,
    treatment: treatment.body as { id: string; version: number; coverageEndOn: string; derived_status: string },
  };
}

async function openCycle(organizationId: string, treatmentId: string) {
  return withTenant(organizationId, (tx) => tx.refillCycle.findFirstOrThrow({
    where: { treatmentId, closedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }));
}

function boardCards(board: { columns: Record<string, { cards: Array<{ cycle_id: string; status: string; board_position: number | null }> }> }, column: string) {
  return board.columns[column]!.cards;
}

describe.skipIf(!enabled)('phase 2 board, stock and incidents', () => {
  it('moves a cycle and writes one activity visible in both patient and treatment history', async () => {
    const { agent: owner, context } = await login('owner');
    const { treatment, patientId } = await createTreatment(owner, context, crypto.randomUUID());
    const cycle = await openCycle(context.organization.id, treatment.id);

    const moved = await owner.post(`/api/v1/cycles/${cycle.id}/move`)
      .send({ to_status: 'confirmed', expected_version: cycle.version })
      .expect(200);
    expect(moved.body).toMatchObject({ cycle_id: cycle.id, status: 'confirmed', version: cycle.version + 1 });
    expect(moved.body.card).toMatchObject({ cycle_id: cycle.id, status: 'confirmed' });

    const activities = await withTenant(context.organization.id, (tx) => tx.activity.findMany({
      where: { cycleId: cycle.id, type: 'cycle_moved' },
    }));
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ patientId, treatmentId: treatment.id, metadata: { from: 'to_notify', to: 'confirmed' } });
    const patientHistory = await owner.get(`/api/v1/patients/${patientId}/activities`).expect(200);
    expect(patientHistory.body.data.some((row: { id: string }) => row.id === activities[0]!.id)).toBe(true);
  });

  it.skipIf(!process.env.DIRECT_URL)('rolls back status, position and activity when a move step fails', async () => {
    const { agent: owner, context } = await login('owner');
    const { treatment } = await createTreatment(owner, context, crypto.randomUUID());
    const cycle = await openCycle(context.organization.id, treatment.id);
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL! } } });
    const token = cycle.id.replace(/\W/g, '');
    const functionName = `fail_move_${token}`;
    const triggerName = `fail_move_${token}`;
    try {
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${functionName}() RETURNS trigger AS $$ BEGIN IF NEW.cycle_id = '${cycle.id}' AND NEW.type = 'cycle_moved' THEN RAISE EXCEPTION 'forced move failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON "activities" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      await owner.post(`/api/v1/cycles/${cycle.id}/move`)
        .send({ to_status: 'confirmed', expected_version: cycle.version })
        .expect(500);
      const state = await withTenant(context.organization.id, (tx) => tx.refillCycle.findFirstOrThrow({ where: { id: cycle.id } }));
      expect(state.status).toBe('to_notify');
      expect(state.version).toBe(cycle.version);
      expect(await withTenant(context.organization.id, (tx) => tx.activity.count({ where: { cycleId: cycle.id, type: 'cycle_moved' } }))).toBe(0);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "activities"`).catch(() => undefined);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined);
      await admin.$disconnect();
    }
  });

  it('rejects a stale expected_version with 409 and the current card', async () => {
    const { agent: owner, context } = await login('owner');
    const { treatment } = await createTreatment(owner, context, crypto.randomUUID());
    const cycle = await openCycle(context.organization.id, treatment.id);

    await owner.post(`/api/v1/cycles/${cycle.id}/move`)
      .send({ to_status: 'notified', expected_version: cycle.version })
      .expect(200);
    const conflict = await owner.post(`/api/v1/cycles/${cycle.id}/move`)
      .send({ to_status: 'confirmed', expected_version: cycle.version })
      .expect(409);
    expect(conflict.body.error.code).toBe('STALE_VERSION');
    expect(conflict.body.error.details.card).toMatchObject({ cycle_id: cycle.id, status: 'notified', version: cycle.version + 1 });
  });

  it('inserts between cards, rebalances the column and preserves the visible order', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Order ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const first = await createTreatment(owner, context, `${suffix}-1`, { branchId: branch.id });
    const second = await createTreatment(owner, context, `${suffix}-2`, { branchId: branch.id });
    const third = await createTreatment(owner, context, `${suffix}-3`, { branchId: branch.id });
    const cycles = await withTenant(context.organization.id, (tx) => tx.refillCycle.findMany({
      where: { treatmentId: { in: [first.treatment.id, second.treatment.id, third.treatment.id] }, closedAt: null },
      orderBy: { id: 'asc' },
    }));
    const byTreatment = new Map(cycles.map((cycle) => [cycle.treatmentId, cycle]));
    const c1 = byTreatment.get(first.treatment.id)!;
    const c2 = byTreatment.get(second.treatment.id)!;
    const c3 = byTreatment.get(third.treatment.id)!;

    const move = (id: string, body: Record<string, unknown>) => owner.post(`/api/v1/cycles/${id}/move`).send(body).expect(200);
    await move(c1.id, { to_status: 'confirmed', expected_version: c1.version });
    await move(c2.id, { to_status: 'confirmed', after_id: c1.id, expected_version: c2.version });
    await move(c3.id, { to_status: 'confirmed', after_id: c2.id, expected_version: c3.version });

    let board = (await owner.get(`/api/v1/board?branch_id=${branch.id}`).expect(200)).body;
    expect(boardCards(board, 'confirmed').map((card) => card.cycle_id)).toEqual([c1.id, c2.id, c3.id]);

    // Collapse the gap between the neighbours so the next midpoint forces a rebalance.
    await withTenant(context.organization.id, async (tx) => {
      await tx.refillCycle.update({ where: { id: c1.id }, data: { boardPosition: 1 } });
      await tx.refillCycle.update({ where: { id: c3.id }, data: { boardPosition: 1 + 1e-7 } });
      await tx.refillCycle.update({ where: { id: c2.id }, data: { boardPosition: 3 } });
    });
    await owner.post(`/api/v1/cycles/${c2.id}/move`).send({
      to_status: 'confirmed', after_id: c1.id, before_id: c3.id, expected_version: c2.version + 1,
    }).expect(200);

    board = (await owner.get(`/api/v1/board?branch_id=${branch.id}`).expect(200)).body;
    const cards = boardCards(board, 'confirmed');
    expect(cards.map((card) => card.cycle_id)).toEqual([c1.id, c2.id, c3.id]);
    expect(cards.every((card) => typeof card.board_position === 'number')).toBe(true);
  }, 120_000);

  it('blocks prepared with out_of_stock, allows it with confirmation and warns on low stock', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const blocked = await createTreatment(owner, context, `${suffix}-blocked`);
    await owner.put(`/api/v1/branches/${blocked.branchId}/stock-marks/${blocked.medicationId}`)
      .send({ level: 'out_of_stock' }).expect(200);
    const blockedCycle = await openCycle(context.organization.id, blocked.treatment.id);
    await owner.post(`/api/v1/cycles/${blockedCycle.id}/move`)
      .send({ to_status: 'prepared', expected_version: blockedCycle.version })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('STOCK_OUT_OF_STOCK'));

    const confirmed = await owner.post(`/api/v1/cycles/${blockedCycle.id}/move`)
      .send({ to_status: 'prepared', expected_version: blockedCycle.version, confirm_out_of_stock: true })
      .expect(200);
    expect(confirmed.body).toMatchObject({ status: 'prepared' });
    const incidents = await owner.get(`/api/v1/incidents?branch_id=${blocked.branchId}&type=out_of_stock`).expect(200);
    expect(incidents.body.data.some((incident: { cycleId: string }) => incident.cycleId === blockedCycle.id)).toBe(true);

    const low = await createTreatment(owner, context, `${suffix}-low`);
    await owner.put(`/api/v1/branches/${low.branchId}/stock-marks/${low.medicationId}`)
      .send({ level: 'low' }).expect(200);
    // Age the mark so the move must also surface STOCK_STALE.
    await withTenant(context.organization.id, (tx) => tx.medicationStockMark.update({
      where: {
        organizationId_branchId_medicationId: {
          organizationId: context.organization.id,
          branchId: low.branchId,
          medicationId: low.medicationId,
        },
      },
      data: { reviewedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    }));
    const lowCycle = await openCycle(context.organization.id, low.treatment.id);
    const warned = await owner.post(`/api/v1/cycles/${lowCycle.id}/move`)
      .send({ to_status: 'prepared', expected_version: lowCycle.version })
      .expect(200);
    const warningCodes = warned.body.warnings.map((warning: { code: string }) => warning.code);
    expect(warningCodes).toContain('STOCK_LOW');
    expect(warningCodes).toContain('STOCK_STALE');
  });

  it('changes expected_on without touching coverage_end_on or the derived status', async () => {
    const { agent: owner, context } = await login('owner');
    const { treatment } = await createTreatment(owner, context, crypto.randomUUID());
    const cycle = await openCycle(context.organization.id, treatment.id);
    const before = await owner.get(`/api/v1/treatments/${treatment.id}`).expect(200);

    const moved = await owner.patch(`/api/v1/cycles/${cycle.id}/expected-on`)
      .send({ expected_on: iso(addDays(12)), reason: 'Paciente pidio otra fecha', expected_version: cycle.version })
      .expect(200);
    expect(moved.body.expected_on).toBe(iso(addDays(12)));

    const after = await owner.get(`/api/v1/treatments/${treatment.id}`).expect(200);
    expect(after.body.coverageEndOn).toBe(before.body.coverageEndOn);
    expect(after.body.derived_status).toBe(before.body.derived_status);
    expect(after.body.days_remaining).toBe(before.body.days_remaining);
  });

  it('requires a resolution and only resolves through /resolve', async () => {
    const { agent: owner, context } = await login('owner');
    const { treatment, patientId, branchId } = await createTreatment(owner, context, crypto.randomUUID());
    const incident = await owner.post('/api/v1/incidents').send({
      branch_id: branchId,
      type: 'patient_reported',
      patient_id: patientId,
      treatment_id: treatment.id,
      description: 'El paciente reportó un problema',
    }).expect(201);

    await owner.post(`/api/v1/incidents/${incident.body.id}/resolve`).send({}).expect(400);
    await owner.post(`/api/v1/incidents/${incident.body.id}/move`).send({ to_status: 'resolved' }).expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('RESOLVE_ENDPOINT_REQUIRED'));
    const resolved = await owner.post(`/api/v1/incidents/${incident.body.id}/resolve`)
      .send({ resolution: 'Se contactó al paciente y se resolvió' }).expect(200);
    expect(resolved.body).toMatchObject({ status: 'resolved', resolution: 'Se contactó al paciente y se resolvió' });
    expect(resolved.body.resolvedAt).not.toBeNull();
  });

  it('keeps board and table aligned for the same filters', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Compare ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const first = await createTreatment(owner, context, `${suffix}-a`, { branchId: branch.id });
    await createTreatment(owner, context, `${suffix}-b`, { branchId: branch.id });
    // Close one cycle so the comparison also covers the closed column.
    await owner.post(`/api/v1/treatments/${first.treatment.id}/deliver`).send({
      quantity: 30,
      delivered_on: iso(todayOnly),
      picked_up_by: 'patient',
    }).expect(201);

    const board = (await owner.get(`/api/v1/board?branch_id=${branch.id}`).expect(200)).body;
    expect(board.columns.closed.count).toBe(1);
    const boardIds = ['to_notify', 'notified', 'confirmed', 'prepared', 'closed']
      .flatMap((column) => boardCards(board, column).map((card) => card.cycle_id));
    const table = (await owner.get(`/api/v1/cycles?branch_id=${branch.id}`).expect(200)).body;
    // Same cycles in the same visible order, not just the same set.
    expect(table.data.map((row: { cycle_id: string }) => row.cycle_id)).toEqual(boardIds);
  });

  it('paginates a column with a cursor and reports due-today counts', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Cursor ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    await createTreatment(owner, context, `${suffix}-1`, { branchId: branch.id });
    await createTreatment(owner, context, `${suffix}-2`, { branchId: branch.id });
    await createTreatment(owner, context, `${suffix}-3`, { branchId: branch.id });

    const board = (await owner.get(`/api/v1/board?branch_id=${branch.id}`).expect(200)).body;
    expect(board.columns.to_notify.count).toBe(3);
    // New treatments start with a cycle expected after their 30-day coverage.
    expect(board.columns.to_notify.due_today_count).toBe(0);

    const firstPage = await owner.get(`/api/v1/board/columns/to_notify?branch_id=${branch.id}&limit=2`).expect(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.next_cursor).toBeTruthy();
    const secondPage = await owner.get(
      `/api/v1/board/columns/to_notify?branch_id=${branch.id}&limit=2&cursor=${firstPage.body.next_cursor}`,
    ).expect(200);
    expect(secondPage.body.data).toHaveLength(1);
    const ids = [...firstPage.body.data, ...secondPage.body.data].map((card: { cycle_id: string }) => card.cycle_id);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps organizations and branches isolated for board, stock marks and incidents', async () => {
    const { agent: ownerA, context: contextA } = await login('owner', 'a');
    const { agent: ownerB, context: contextB } = await login('owner', 'b');
    const b = await createTreatment(ownerB, contextB, crypto.randomUUID());
    const bCycle = await openCycle(contextB.organization.id, b.treatment.id);
    const bIncident = await ownerB.post('/api/v1/incidents').send({
      branch_id: b.branchId, type: 'patient_no_response', patient_id: b.patientId, description: 'B private incident',
    }).expect(201);
    await ownerB.put(`/api/v1/branches/${b.branchId}/stock-marks/${b.medicationId}`)
      .send({ level: 'low' }).expect(200);

    await ownerA.get(`/api/v1/incidents/${bIncident.body.id}`).expect(404);
    await ownerA.post(`/api/v1/incidents/${bIncident.body.id}/resolve`).send({ resolution: 'x' }).expect(404);
    await ownerA.post(`/api/v1/cycles/${bCycle.id}/move`).send({ to_status: 'confirmed', expected_version: bCycle.version }).expect(404);
    const stockA = await ownerA.get(`/api/v1/stock-marks?branch_id=${b.branchId}`).expect(200);
    expect(stockA.body.data).toHaveLength(0);
    await ownerA.put(`/api/v1/branches/${b.branchId}/stock-marks/${b.medicationId}`)
      .send({ level: 'in_stock' }).expect(404);
    const boardA = (await ownerA.get(`/api/v1/board?branch_id=${b.branchId}`).expect(200)).body;
    expect(Object.values(boardA.columns).flatMap((column) => (column as { cards: Array<{ cycle_id: string }> }).cards.map((card) => card.cycle_id))).not.toContain(bCycle.id);

    const limited = await login('operator', 'a');
    const branchY = await createBranch(ownerA, `Other branch ${crypto.randomUUID()}`);
    const y = await createTreatment(ownerA, contextA, crypto.randomUUID(), { branchId: branchY.id });
    const yCycle = await openCycle(contextA.organization.id, y.treatment.id);
    const limitedBoard = (await limited.agent.get(`/api/v1/board?branch_id=${branchY.id}`).expect(200)).body;
    expect(Object.values(limitedBoard.columns).flatMap((column) => (column as { cards: Array<{ cycle_id: string }> }).cards.map((card) => card.cycle_id))).not.toContain(yCycle.id);
    await limited.agent.post(`/api/v1/cycles/${yCycle.id}/move`).send({ to_status: 'confirmed', expected_version: yCycle.version }).expect(404);
    const limitedStock = await limited.agent.get(`/api/v1/stock-marks?branch_id=${branchY.id}`).expect(200);
    expect(limitedStock.body.data).toHaveLength(0);
    await limited.agent.put(`/api/v1/branches/${branchY.id}/stock-marks/${y.medicationId}`)
      .send({ level: 'low' }).expect(404);
  }, 180_000);

  it('enforces the role matrix for board, stock and incidents', async () => {
    const owner = await login('owner');
    const { treatment, branchId } = await createTreatment(owner.agent, owner.context, crypto.randomUUID());
    const cycle = await openCycle(owner.context.organization.id, treatment.id);

    const readOnly = await login('read_only');
    await readOnly.agent.get('/api/v1/board').expect(200);
    await readOnly.agent.post(`/api/v1/cycles/${cycle.id}/move`).send({ to_status: 'confirmed', expected_version: cycle.version }).expect(403);
    await readOnly.agent.put(`/api/v1/branches/${branchId}/stock-marks/${treatment.id}`).send({ level: 'low' }).expect(403);
    await readOnly.agent.post('/api/v1/incidents').send({ branch_id: branchId, type: 'patient_reported', description: 'x' }).expect(403);

    const operator = await login('operator');
    const operatorBranch = operator.context.branches.find((branch) => branch.name === 'Sucursal 2')!;
    const opTreatment = await createTreatment(owner.agent, owner.context, crypto.randomUUID(), { branchId: operatorBranch.id });
    const opCycle = await openCycle(operator.context.organization.id, opTreatment.treatment.id);
    await operator.agent.post(`/api/v1/cycles/${opCycle.id}/move`).send({ to_status: 'notified', expected_version: opCycle.version }).expect(200);
    await operator.agent.put(`/api/v1/branches/${opTreatment.branchId}/stock-marks/${opTreatment.medicationId}`).send({ level: 'in_stock' }).expect(200);
    const opIncident = await operator.agent.post('/api/v1/incidents').send({
      branch_id: opTreatment.branchId, type: 'patient_reported', patient_id: opTreatment.patientId, description: 'Operator incident',
    }).expect(201);
    await operator.agent.post(`/api/v1/incidents/${opIncident.body.id}/move`).send({ to_status: 'in_progress' }).expect(200);
    await operator.agent.post(`/api/v1/incidents/${opIncident.body.id}/resolve`).send({ resolution: 'x' }).expect(403);
    await operator.agent.patch(`/api/v1/cycles/${opCycle.id}/expected-on`).send({ expected_on: iso(addDays(5)), expected_version: opCycle.version + 1 }).expect(403);

    const pharmacist = await login('pharmacist');
    const pharmacistBranch = pharmacist.context.branches.find((branch) => branch.name === 'Sucursal 1')!;
    const phTreatment = await createTreatment(owner.agent, owner.context, crypto.randomUUID(), { branchId: pharmacistBranch.id });
    const phIncident = await pharmacist.agent.post('/api/v1/incidents').send({
      branch_id: phTreatment.branchId, type: 'patient_reported', patient_id: phTreatment.patientId, description: 'Pharmacist incident',
    }).expect(201);
    await pharmacist.agent.post(`/api/v1/incidents/${phIncident.body.id}/resolve`).send({ resolution: 'Resuelta por farmaceutico' }).expect(200);
    const phCycle = await openCycle(pharmacist.context.organization.id, phTreatment.treatment.id);
    await pharmacist.agent.patch(`/api/v1/cycles/${phCycle.id}/expected-on`).send({ expected_on: iso(addDays(6)), expected_version: phCycle.version }).expect(200);

    const permissions = (await owner.agent.get('/api/v1/me').expect(200)).body.permissions as string[];
    expect(permissions).toEqual(expect.arrayContaining([
      'cycle:move', 'cycle:edit-date', 'stock:mark', 'incident:create', 'incident:move', 'incident:resolve',
    ]));
  }, 180_000);
});

import 'dotenv/config';
import { auth } from '../src/infra/auth.js';
import { env } from '../src/config/env.js';
import { prisma, withTenant } from '../src/infra/prisma.js';
import { findOrCreateSetting } from '../src/infra/settings.js';

if (process.env.NODE_ENV !== 'development') throw new Error('Refusing to seed outside development');
const password = 'MaxCareDev-2026!';
const roles = ['owner', 'admin', 'pharmacist', 'operator', 'read_only'] as const;

async function seedOrganization(code: 'a' | 'b', pin: string) {
  const ownerEmail = `owner.${code}@maxcare.test`;
  const owner = await getOrCreateUser(`Owner ${code.toUpperCase()}`, ownerEmail);
  const ownerHeaders = owner.headers;
  const existing = await prisma.organization.findUnique({ where: { slug: `max-care-${code}` } });
  const organizationId = existing?.id ?? (await auth.api.createOrganization({
    body: { name: `Max Care ${code.toUpperCase()}`, slug: `max-care-${code}`, userId: owner.user.id },
    headers: ownerHeaders,
  })).id;
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      email: ownerEmail,
      pin,
      domain: env.WEB_ORIGIN.split(',')[0]?.trim() || env.BETTER_AUTH_URL,
    },
  });
  const userIds = [owner.user.id];
  await withTenant(organizationId, async (tx) => {
    await findOrCreateSetting(tx, organizationId);
  });
  for (const role of roles.slice(1)) {
    const email = `${role}.${code}@maxcare.test`;
    const user = await prisma.user.findUnique({ where: { email } }) ?? (await auth.api.signUpEmail({
      body: { name: `${role} ${code.toUpperCase()}`, email, password },
    })).user;
    const member = await prisma.member.findFirst({ where: { organizationId, userId: user.id } });
    if (!member) await auth.api.addMember({ body: { userId: user.id, organizationId, role }, headers: ownerHeaders });
    userIds.push(user.id);
  }
  await withTenant(organizationId, async (tx) => {
    for (let index = 1; index <= 2; index += 1) {
      const branchName = `Sucursal ${index}`;
      const branch = await tx.branch.findFirst({ where: { organizationId, name: branchName } }) ?? await tx.branch.create({
        data: { organizationId, name: branchName },
      });
      for (const [userIndex, userId] of userIds.entries()) {
        if (userIndex % 2 !== index - 1) continue;
        await tx.branchMember.upsert({
          where: { organizationId_branchId_userId: { organizationId, branchId: branch.id, userId } },
          create: { organizationId, branchId: branch.id, userId },
          update: {},
        });
      }
      const documentId = `DEV-${code.toUpperCase()}-${index}`;
      const patient = await tx.patient.findFirst({ where: { documentId } });
      const patientData = {
        primaryBranchId: branch.id,
        fullName: `Paciente de ejemplo ${index}`,
        documentId,
        birthDate: new Date(`199${index}-01-0${index}T00:00:00.000Z`),
        phone: `7000000${index}`,
        phoneHasWhatsapp: true,
        email: `paciente.${index}.${code}@maxcare.test`,
        address: `Calle de ejemplo ${index}`,
        zone: `Zona ${index}`,
        preferredChannel: index === 1 ? 'whatsapp' as const : 'call' as const,
        careNotes: 'Dato ficticio para pruebas de desarrollo.',
        responsibleUserId: owner.user.id,
      };
      const seededPatient = patient
        ? await tx.patient.update({ where: { organizationId_id: { organizationId, id: patient.id } }, data: patientData })
        : await tx.patient.create({ data: { ...patientData, organizationId, createdBy: owner.user.id } });
      if (!await tx.patientCaregiver.findFirst({ where: { patientId: seededPatient.id } })) {
        await tx.patientCaregiver.create({
          data: { organizationId, patientId: seededPatient.id, fullName: `Contacto de ejemplo ${index}`, phone: `7100000${index}`, relationship: 'Familiar', isPrimary: true },
        });
      }
      if (!await tx.activity.findFirst({ where: { patientId: seededPatient.id } })) {
        await tx.activity.create({
          data: { organizationId, patientId: seededPatient.id, authorId: owner.user.id, type: 'note', body: 'Registro ficticio de ejemplo para desarrollo.' },
        });
      }
    }
    const examples = [
      { genericName: 'Paracetamol', activeIngredient: 'Paracetamol', presentation: '500 mg tabletas', unitsPerPackage: 20 },
      { genericName: 'Ibuprofeno', activeIngredient: 'Ibuprofeno', presentation: '400 mg comprimidos', unitsPerPackage: 20 },
      { genericName: 'Amoxicilina', activeIngredient: 'Amoxicilina', presentation: '500 mg cápsulas', unitsPerPackage: 21 },
      { genericName: 'Loratadina', activeIngredient: 'Loratadina', presentation: '10 mg tabletas', unitsPerPackage: 10 },
    ];
    for (const example of examples) {
      const medication = await tx.medication.findFirst({ where: { genericName: example.genericName, presentation: example.presentation } });
      if (medication) await tx.medication.update({
        where: { organizationId_id: { organizationId, id: medication.id } },
        data: { ...example, doseUnit: 'tablet' },
      });
      else await tx.medication.create({ data: { organizationId, brandName: null, ...example, doseUnit: 'tablet' } });
    }
    const templates = [
      {
        channel: 'whatsapp' as const,
        name: 'Recordatorio de reposición (WhatsApp)',
        body: 'Hola {{paciente}}, tu medicamento {{medicamento}} está listo para reposición el {{fecha}} en {{farmacia}}.',
      },
      {
        channel: 'call' as const,
        name: 'Guion de llamada de reposición',
        body: 'Llamar a {{paciente}} para coordinar la reposición de {{medicamento}} el {{fecha}} en {{farmacia}}.',
      },
    ];
    for (const template of templates) {
      const existingTemplate = await tx.messageTemplate.findFirst({
        where: { channel: template.channel, kind: 'refill_notice', name: template.name, branchId: null },
      });
      if (existingTemplate) await tx.messageTemplate.update({
        where: { organizationId_id: { organizationId, id: existingTemplate.id } },
        data: { body: template.body, isActive: true },
      });
      else await tx.messageTemplate.create({
        data: { organizationId, branchId: null, channel: template.channel, kind: 'refill_notice', name: template.name, body: template.body },
      });
    }
  });
  console.info(`Seeded Max Care ${code.toUpperCase()}`);
}

async function getOrCreateUser(name: string, email: string) {
  try {
    const signup = await auth.api.signUpEmail({ body: { name, email, password }, returnHeaders: true });
    return { user: signup.response.user, headers: new Headers({ cookie: cookieHeader(signup.headers) }) };
  } catch {
    const signin = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    return { user: signin.response.user, headers: new Headers({ cookie: cookieHeader(signin.headers) }) };
  }
}

function cookieHeader(headers: Headers): string {
  const cookie = headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  if (!cookie) throw new Error('Better Auth did not return a session cookie');
  return cookie;
}

try {
  await seedOrganization('a', '475804');
  await seedOrganization('b', '475805');
} finally {
  await prisma.$disconnect();
}

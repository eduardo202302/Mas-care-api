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
    const specialties = [
      'Medicina General', 'Cardiología', 'Pediatría', 'Ginecología y Obstetricia', 'Dermatología',
      'Neurología', 'Endocrinología', 'Gastroenterología', 'Nefrología', 'Neumología',
    ];
    for (const name of specialties) {
      const specialty = await tx.medicalSpecialty.findFirst({ where: { organizationId, name } });
      if (!specialty) await tx.medicalSpecialty.create({ data: { organizationId, name } });
    }
    const healthConditions = [
      'Hipertensión arterial', 'Insuficiencia cardíaca', 'Arritmia cardíaca', 'Cardiopatía isquémica', 'Hipercolesterolemia',
      'Diabetes mellitus tipo 1', 'Diabetes mellitus tipo 2', 'Hipotiroidismo', 'Hipertiroidismo', 'Obesidad',
      'Asma', 'Enfermedad pulmonar obstructiva crónica (EPOC)', 'Rinitis alérgica', 'Bronquitis crónica', 'Apnea del sueño',
    ];
    for (const name of healthConditions) {
      const condition = await tx.healthCondition.findFirst({ where: { organizationId, name } });
      if (!condition) await tx.healthCondition.create({ data: { organizationId, name } });
    }
    const examples = [
      // Medicina General
      { genericName: 'Paracetamol', activeIngredient: 'Paracetamol', presentation: '500 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 20 },
      { genericName: 'Ibuprofeno', activeIngredient: 'Ibuprofeno', presentation: '400 mg comprimidos', doseUnit: 'tablet', unitsPerPackage: 20 },
      { genericName: 'Amoxicilina', activeIngredient: 'Amoxicilina', presentation: '500 mg cápsulas', doseUnit: 'tablet', unitsPerPackage: 21 },
      { genericName: 'Loratadina', activeIngredient: 'Loratadina', presentation: '10 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 10 },
      { genericName: 'Omeprazol', activeIngredient: 'Omeprazol', presentation: '20 mg cápsulas', doseUnit: 'tablet', unitsPerPackage: 14 },
      // Cardiología
      { genericName: 'Losartán', activeIngredient: 'Losartán potásico', presentation: '50 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Enalapril', activeIngredient: 'Enalapril', presentation: '10 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Amlodipino', activeIngredient: 'Amlodipino', presentation: '5 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Atorvastatina', activeIngredient: 'Atorvastatina', presentation: '20 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Bisoprolol', activeIngredient: 'Bisoprolol', presentation: '5 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      // Pediatría
      { genericName: 'Paracetamol pediátrico', activeIngredient: 'Paracetamol', presentation: '160 mg/5 mL jarabe', doseUnit: 'ml', unitsPerPackage: 90 },
      { genericName: 'Ibuprofeno pediátrico', activeIngredient: 'Ibuprofeno', presentation: '100 mg/5 mL suspensión', doseUnit: 'ml', unitsPerPackage: 90 },
      { genericName: 'Amoxicilina suspensión', activeIngredient: 'Amoxicilina', presentation: '250 mg/5 mL suspensión', doseUnit: 'ml', unitsPerPackage: 100 },
      { genericName: 'Loratadina jarabe', activeIngredient: 'Loratadina', presentation: '5 mg/5 mL jarabe', doseUnit: 'ml', unitsPerPackage: 60 },
      { genericName: 'Sales de rehidratación oral', activeIngredient: 'Sales de rehidratación oral', presentation: 'sobres 20.5 g', doseUnit: 'sobre', unitsPerPackage: 10 },
      // Ginecología y Obstetricia
      { genericName: 'Ácido fólico', activeIngredient: 'Ácido fólico', presentation: '5 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Sulfato ferroso', activeIngredient: 'Sulfato ferroso', presentation: '300 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Progesterona', activeIngredient: 'Progesterona micronizada', presentation: '200 mg cápsulas', doseUnit: 'tablet', unitsPerPackage: 14 },
      { genericName: 'Clotrimazol', activeIngredient: 'Clotrimazol', presentation: '500 mg óvulos vaginales', doseUnit: 'ovulo', unitsPerPackage: 1 },
      { genericName: 'Metronidazol', activeIngredient: 'Metronidazol', presentation: '500 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 20 },
      // Dermatología
      { genericName: 'Hidrocortisona tópica', activeIngredient: 'Hidrocortisona', presentation: '1% crema', doseUnit: 'aplicacion', unitsPerPackage: 1 },
      { genericName: 'Clotrimazol crema', activeIngredient: 'Clotrimazol', presentation: '1% crema', doseUnit: 'aplicacion', unitsPerPackage: 1 },
      { genericName: 'Mupirocina', activeIngredient: 'Mupirocina', presentation: '2% pomada', doseUnit: 'aplicacion', unitsPerPackage: 1 },
      { genericName: 'Terbinafina', activeIngredient: 'Terbinafina', presentation: '1% crema', doseUnit: 'aplicacion', unitsPerPackage: 1 },
      { genericName: 'Adapaleno', activeIngredient: 'Adapaleno', presentation: '0.1% gel', doseUnit: 'aplicacion', unitsPerPackage: 1 },
      // Neurología
      { genericName: 'Pregabalina', activeIngredient: 'Pregabalina', presentation: '75 mg cápsulas', doseUnit: 'tablet', unitsPerPackage: 28 },
      { genericName: 'Levetiracetam', activeIngredient: 'Levetiracetam', presentation: '500 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Carbamazepina', activeIngredient: 'Carbamazepina', presentation: '200 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Sumatriptán', activeIngredient: 'Sumatriptán', presentation: '50 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 4 },
      { genericName: 'Topiramato', activeIngredient: 'Topiramato', presentation: '25 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      // Endocrinología
      { genericName: 'Metformina', activeIngredient: 'Metformina', presentation: '850 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Levotiroxina', activeIngredient: 'Levotiroxina', presentation: '100 mcg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Insulina glargina', activeIngredient: 'Insulina glargina', presentation: '100 UI/mL solución inyectable', doseUnit: 'ml', unitsPerPackage: 3 },
      { genericName: 'Sitagliptina', activeIngredient: 'Sitagliptina', presentation: '100 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 28 },
      { genericName: 'Empagliflozina', activeIngredient: 'Empagliflozina', presentation: '10 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      // Gastroenterología
      { genericName: 'Omeprazol', activeIngredient: 'Omeprazol', presentation: '40 mg cápsulas', doseUnit: 'tablet', unitsPerPackage: 14 },
      { genericName: 'Pantoprazol', activeIngredient: 'Pantoprazol', presentation: '40 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 14 },
      { genericName: 'Lactulosa', activeIngredient: 'Lactulosa', presentation: '10 g/15 mL solución oral', doseUnit: 'ml', unitsPerPackage: 200 },
      { genericName: 'Mesalazina', activeIngredient: 'Mesalazina', presentation: '500 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 60 },
      { genericName: 'Domperidona', activeIngredient: 'Domperidona', presentation: '10 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      // Nefrología
      { genericName: 'Furosemida', activeIngredient: 'Furosemida', presentation: '40 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Eritropoyetina', activeIngredient: 'Epoetina alfa', presentation: '4000 UI solución inyectable', doseUnit: 'ampolla', unitsPerPackage: 1 },
      { genericName: 'Sevelámero', activeIngredient: 'Sevelámero', presentation: '800 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 90 },
      { genericName: 'Carbonato de calcio', activeIngredient: 'Carbonato de calcio', presentation: '600 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Bicarbonato de sodio', activeIngredient: 'Bicarbonato de sodio', presentation: '650 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      // Neumología
      { genericName: 'Salbutamol', activeIngredient: 'Salbutamol', presentation: '100 mcg inhalador', doseUnit: 'puff', unitsPerPackage: 200 },
      { genericName: 'Budesonida', activeIngredient: 'Budesonida', presentation: '200 mcg inhalador', doseUnit: 'puff', unitsPerPackage: 200 },
      { genericName: 'Montelukast', activeIngredient: 'Montelukast', presentation: '10 mg tabletas', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Tiotropio', activeIngredient: 'Tiotropio', presentation: '18 mcg cápsulas inhalación', doseUnit: 'tablet', unitsPerPackage: 30 },
      { genericName: 'Formoterol', activeIngredient: 'Formoterol', presentation: '12 mcg inhalador', doseUnit: 'puff', unitsPerPackage: 120 },
    ];
    for (const example of examples) {
      const medication = await tx.medication.findFirst({ where: { organizationId, genericName: example.genericName, presentation: example.presentation } });
      if (medication) await tx.medication.update({
        where: { organizationId_id: { organizationId, id: medication.id } },
        data: { ...example },
      });
      else await tx.medication.create({ data: { organizationId, brandName: null, ...example } });
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

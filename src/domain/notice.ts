export type NoticeVariables = {
  patient: string;
  medication: string;
  date: string;
  pharmacy: string;
};

/**
 * Local numbers for countries this app has customers in today. `callingCode`
 * is the E.164 prefix (no leading `+`); `localLength` is the subscriber
 * number length used to tell an already-complete number from a local one.
 */
const countryDialingPlans: Record<string, { callingCode: string; localLength: number }> = {
  DO: { callingCode: '1', localLength: 10 }, // Dominican Republic (NANP: 809/829/849 + 7 digits)
  CO: { callingCode: '57', localLength: 10 },
};

/**
 * Normalizes a phone number to E.164 digits (no `+`) for wa.me links and the
 * WhatsApp Cloud API, which both require it. `defaultCountryCode` is the
 * organization's configured country (`settings.default_country_code`) used
 * when the number has no country code of its own.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = 'DO'): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const plan = countryDialingPlans[defaultCountryCode.toUpperCase()] ?? countryDialingPlans.DO!;
  if (digits.length === plan.localLength && !digits.startsWith(plan.callingCode)) {
    digits = `${plan.callingCode}${digits}`;
  }
  return digits.length >= 7 ? digits : null;
}

export function waMeUrl(phone: string | null, body: string): string | null {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

export function renderNoticeTemplate(body: string, variables: NoticeVariables): string {
  const replacements: Record<string, string> = {
    paciente: variables.patient,
    medicamento: variables.medication,
    fecha: variables.date,
    farmacia: variables.pharmacy,
  };
  return body.replace(/\{\{\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)\s*\}\}/g, (match, key: string) => {
    const value = replacements[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export function defaultNoticeBody(channel: 'whatsapp' | 'call'): string {
  return channel === 'whatsapp'
    ? 'Hola {{paciente}}, tu medicamento {{medicamento}} está listo para reposición el {{fecha}} en {{farmacia}}.'
    : 'Llamar a {{paciente}} para coordinar la reposición de {{medicamento}} el {{fecha}} en {{farmacia}}.';
}

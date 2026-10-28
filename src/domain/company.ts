export function normalizeDomain(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!url.hostname) throw new Error('INVALID_DOMAIN');
  return url.origin;
}

export function companyLinks(domain: string, token: string) {
  const base = normalizeDomain(domain);
  const company = encodeURIComponent(token);
  return {
    registrationLink: `${base}/registro?empresa=${company}`,
    loginLink: `${base}/acceso?empresa=${company}`,
  };
}

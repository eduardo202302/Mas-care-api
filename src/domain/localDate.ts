/** Calendar date (YYYY-MM-DD) of an instant in an IANA time zone, e.g. the organization's. */
export function localDateString(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

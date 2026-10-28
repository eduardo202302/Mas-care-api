export type CsvTable = {
  columns: string[];
  rows: string[][];
  delimiter: ',' | ';';
};

/** Minimal RFC-4180-ish parser: quoted fields, escaped quotes, CRLF and BOM. */
export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter: ',' | ';' = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((value) => value.some((cell) => cell.trim() !== ''));
  if (!nonEmpty.length) return { columns: [], rows: [], delimiter };
  const columns = nonEmpty[0]!.map((value) => value.trim());
  const dataRows = nonEmpty.slice(1).map((value) => {
    const cells = value.map((cell) => cell.trim());
    return columns.map((_, index) => cells[index] ?? '');
  });
  return { columns, rows: dataRows, delimiter };
}

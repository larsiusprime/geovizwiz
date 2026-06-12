/**
 * Shared CSV / Excel export helpers.
 *
 * Callers supply their own dataframe shaping (rows / array-of-arrays);
 * this module owns the mechanics: blob download, CSV stringify, zip
 * packaging, and multi-sheet .xlsx workbook construction.
 */
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download a string as a text file (defaults to CSV mime type). */
export function downloadText(content: string, filename: string, mime = 'text/csv'): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

/**
 * Convert plain object rows to a CSV string. Headers are taken from the
 * first row's keys; values are JSON-escaped (quotes/commas safe).
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
  ].join('\n');
}

/** Package multiple named text files into a .zip and download it. */
export async function downloadCsvZip(
  zipFilename: string,
  files: { name: string; content: string }[],
): Promise<void> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.content);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipFilename);
}

/** A worksheet spec: either array-of-arrays (aoa) or array-of-objects (json). */
export type SheetSpec =
  | { name: string; aoa: unknown[][] }
  | { name: string; json: Record<string, unknown>[] };

/** Build a multi-sheet .xlsx workbook and trigger its download. */
export function downloadXlsx(filename: string, sheets: SheetSpec[]): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = 'aoa' in sheet
      ? XLSX.utils.aoa_to_sheet(sheet.aoa)
      : XLSX.utils.json_to_sheet(sheet.json);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  XLSX.writeFile(wb, filename);
}

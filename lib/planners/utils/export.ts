import { gunzipBytes, gzipBytes } from './gzip';

/**
 * Utility to trigger a file download in the browser. `filename` is the file as it reads once
 * unpacked: `plan.json` arrives gzipped as `plan.json.gz`.
 */
export async function downloadGzipped(filename: string, content: string) {
  const gzipped = await gzipBytes(new TextEncoder().encode(content));
  const blob = new Blob([gzipped], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.gz`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** The JSON text of an imported file: a `.json.gz` export, or a plain `.json` from before they were gzipped. */
export async function readImportedJson(bytes: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(await gunzipBytes(bytes));
}

/** An imported file's name without its `.json.gz` or `.json`, to name a plan after. */
export function importedPlanName(fileName: string): string {
  return fileName.replace(/(\.json)?(\.gz)?$/i, '');
}

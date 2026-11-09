/**
 * Test-only: the maxed table the instant-search specs pin their answers to. It is a frozen copy kept
 * in the table store under its own name, because the store's maxed.bin.gz changes with every rebuild.
 * Downloaded once into node_modules/.cache and checked against its hash on every load.
 *
 * Built at 31b596bb, with the video doubler off. Nothing in the app loads this file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readTable, type Table } from './table';
import { TABLE_STORE } from './tableCatalog';

const NAME = 'table-test-fixture-31b596bb-te120-489.bin.gz';
const SHA256 = 'f65d29db49152de83d9f9b8d34a4c945a50a02f4880ce77fd320dae9cafd46ed';
const CACHE = fileURLToPath(new URL(`../../../node_modules/.cache/ascension-planner/${NAME}`, import.meta.url));

const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function readCached(): Buffer | null {
  try {
    const gz = readFileSync(CACHE);
    return hashOf(gz) === SHA256 ? gz : null;
  } catch {
    return null;
  }
}

async function download(): Promise<Buffer> {
  const url = `${TABLE_STORE}/tables/${NAME}`;
  let gz: Buffer;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    gz = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new Error(`Could not download the specs' table from ${url}: ${(err as Error).message}`);
  }
  if (hashOf(gz) !== SHA256) throw new Error(`The specs' table at ${url} is not the expected file (hash mismatch)`);
  // Spec files run in parallel: a rename means none of them can read a half-written file.
  mkdirSync(dirname(CACHE), { recursive: true });
  const partial = `${CACHE}.${randomUUID()}.tmp`;
  writeFileSync(partial, gz);
  renameSync(partial, CACHE);
  return gz;
}

export async function loadSpecTable(): Promise<Table> {
  const bytes = gunzipSync(readCached() ?? (await download()));
  return readTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

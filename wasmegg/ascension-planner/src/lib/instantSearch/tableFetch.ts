/**
 * Fetching a table file, ported from AutoAutoAP (their src/search/tableFetch.ts): gzipped when the
 * server has the copy. The table store serves the gzip as `application/octet-stream` (no
 * `Content-Encoding`), so DecompressionStream unpacks it here; anything wrong with the .gz (missing,
 * a web page in its place, cut short, nothing to unpack it with) falls back to the plain file.
 * readTable checks either is complete.
 */
import { readTable, type Table, type TableHeader } from './table';

export interface FetchDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Absent in older browsers (Safari before 16.4). */
  DecompressionStream?: typeof DecompressionStream;
}

const defaults = (): FetchDeps => ({
  fetch: (url, init) => fetch(url, init),
  DecompressionStream: typeof DecompressionStream === 'undefined' ? undefined : DecompressionStream,
});

/** How long a download may go without a byte arriving before it is given up: a file is 2-3 MB, so a
 *  slow phone still sees bytes every few seconds; no limit on the whole download, which a slow line
 *  may need. */
export const TABLE_STALL_MS = 30_000;
/** The stall's message: it crosses from the worker as text, and `tableLoadFailed` reads it. */
export const TABLE_STALLED = 'the table download stalled (timeout)';

class Stalled extends Error {}

/** The error (here, or as text from a worker) is the stall. */
export function isTableStall(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).includes(TABLE_STALLED);
}

/**
 * An optional file's table: null when there is none, so the caller falls back to the maxed one. A
 *  stall is not "none": it is the connection, and waiting another 30 s on the next file only
 *  doubled the wait before the error card. So it is thrown on.
 */
export async function probeTable(load: () => Promise<Table>): Promise<Table | null> {
  try {
    return await load();
  } catch (e) {
    if (isTableStall(e)) throw e;
    return null;
  }
}

/** One file's bytes, or an error when the server has none (the preview server answers a missing file
 *  with the app's own page, status 200), or when no byte arrives for `stallMs`. Revalidated, not taken
 *  from cache: a table can be replaced while the site is up. */
async function fetchBytes(url: string, deps: FetchDeps, stallMs: number): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (e: Error) => void = () => {};
  // Rejects at the stall whether or not the fetch notices the abort.
  const stalled = new Promise<never>((_, reject) => (fail = reject));
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ctrl.abort();
      fail(new Stalled(TABLE_STALLED));
    }, stallMs);
  };
  progress();
  try {
    return await Promise.race([
      (async () => {
        const res = await deps.fetch(url, { cache: 'no-cache', signal: ctrl.signal });
        progress();
        if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? '')) {
          throw new Error(`the table could not be loaded (${res.ok ? 404 : res.status})`);
        }
        if (!res.body) return res.arrayBuffer();
        // Read by chunks, each one putting the stall off again.
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          progress();
          parts.push(value);
          size += value.byteLength;
        }
        const out = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
          out.set(p, at);
          at += p.byteLength;
        }
        return out.buffer;
      })(),
      stalled,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the table line says when its file could not be loaded: a missing file used to read like a TE
 *  the table doesn't cover. */
export const TABLE_LOAD_FAILED = 'The table couldn’t be loaded.';

/** An error message that means the file itself could not be had: missing, a web page in its place,
 *  cut short, from another version, stalled, or no connection. Not a TE outside the file. */
export function tableLoadFailed(message: string): boolean {
  return /404|not a precomputed table|incomplete|precomputed table version|table could not be loaded|download stalled|failed to fetch|networkerror|load failed/i.test(
    message
  );
}

const isGzip = (b: ArrayBuffer) => b.byteLength > 2 && new Uint8Array(b)[0] === 0x1f && new Uint8Array(b)[1] === 0x8b;

/** A table file's bytes, unpacked: the `.gz` first (a quarter of the size), gunzipped here when the
 *  server sends it as plain bytes (the store does: no `Content-Encoding`), the plain file when
 *  anything is wrong with the .gz. */
export async function fetchTableBytes(
  url: string,
  deps: FetchDeps = defaults(),
  stallMs = TABLE_STALL_MS
): Promise<ArrayBuffer> {
  try {
    let bytes = await fetchBytes(url + '.gz', deps, stallMs);
    if (isGzip(bytes)) {
      const DS = deps.DecompressionStream;
      if (!DS) throw new Error('no DecompressionStream');
      bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DS('gzip'))).arrayBuffer();
    }
    return bytes;
  } catch (e) {
    // A stall is the connection, not the .gz: the plain file (four times the size) would only stall too.
    if (e instanceof Stalled) throw e;
    return fetchBytes(url, deps, stallMs);
  }
}

export async function fetchTable(url: string, deps: FetchDeps = defaults(), stallMs = TABLE_STALL_MS): Promise<Table> {
  return readTable(await fetchTableBytes(url, deps, stallMs));
}

/** Reads a stream until `want(bytes so far)` says it has enough, then stops the download. */
async function readUntil(
  stream: ReadableStream<Uint8Array>,
  want: (bytes: Uint8Array) => boolean
): Promise<Uint8Array> {
  const reader = stream.getReader();
  let bytes: Uint8Array = new Uint8Array(0);
  try {
    for (;;) {
      if (want(bytes)) return bytes;
      const { done, value } = await reader.read();
      if (done) return bytes;
      bytes = concat(bytes, value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}

const TICK = Symbol('tick');
const tick = () => new Promise<typeof TICK>(resolve => setTimeout(() => resolve(TICK), 0));

/**
 * Unpacks a gzip stream until `want` has enough. Fed one compressed chunk at a time, not piped: a
 * pipe may read the whole download ahead of what is unpacked (Node's does), and only the front of
 * the file is wanted.
 */
async function gunzipUntil(
  source: ReadableStreamDefaultReader<Uint8Array>,
  first: Uint8Array,
  DS: typeof DecompressionStream,
  want: (bytes: Uint8Array) => boolean
): Promise<Uint8Array> {
  const ds = new DS('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  let out: Uint8Array = new Uint8Array(0);
  let pending = reader.read();
  let chunk: Uint8Array | undefined = first;
  try {
    while (chunk) {
      await writer.write(chunk as Uint8Array<ArrayBuffer>);
      // Take what this chunk unpacked to, without waiting on output it may not make.
      for (;;) {
        const r = await Promise.race([pending, tick()]);
        if (r === TICK) break;
        if (r.done) return out;
        out = concat(out, r.value);
        if (want(out)) return out;
        pending = reader.read();
      }
      const next = await source.read();
      chunk = next.done ? undefined : next.value;
    }
    await writer.close();
    for (;;) {
      const r = await pending;
      if (r.done || want((out = concat(out, r.value)))) return out;
      pending = reader.read();
    }
  } finally {
    writer.abort().catch(() => {});
    reader.cancel().catch(() => {});
  }
}

/** A table's header has arrived: its length and the JSON it counts. */
const headerComplete = (b: Uint8Array) =>
  b.byteLength >= 4 && b.byteLength >= 4 + new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);

/**
 * Only a table file's header: what it was built with, without the megabytes of cells. The header is
 * at the front of the file, so the `.gz` is unpacked as it streams in and the download stopped once
 * the header is whole (a few KB in). The plain file when the .gz can't be had.
 */
export async function fetchTableHeader(url: string, deps: FetchDeps = defaults()): Promise<TableHeader> {
  const ctrl = new AbortController();
  const open = async (u: string) => {
    const res = await deps.fetch(u, { cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok || !res.body || /text\/html/.test(res.headers.get('content-type') ?? ''))
      throw new Error(`the table could not be loaded (${res.ok ? 404 : res.status})`);
    return res.body;
  };
  let bytes: Uint8Array;
  try {
    const source = (await open(url + '.gz')).getReader();
    try {
      let first: Uint8Array = new Uint8Array(0);
      while (first.byteLength < 2) {
        const { done, value } = await source.read();
        if (done) break;
        first = concat(first, value);
      }
      if (first[0] === 0x1f && first[1] === 0x8b) {
        const DS = deps.DecompressionStream;
        if (!DS) throw new Error('no DecompressionStream');
        bytes = await gunzipUntil(source, first, DS, headerComplete);
      } else {
        bytes = first;
        while (!headerComplete(bytes)) {
          const { done, value } = await source.read();
          if (done) break;
          bytes = concat(bytes, value);
        }
      }
    } finally {
      source.cancel().catch(() => {});
    }
    if (!headerComplete(bytes)) throw new Error('cut short');
  } catch {
    bytes = await readUntil(await open(url), headerComplete);
  } finally {
    ctrl.abort();
  }
  if (!headerComplete(bytes)) throw new Error('that file is not a precomputed table');
  const len = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as TableHeader;
  } catch {
    throw new Error('that file is not a precomputed table');
  }
}

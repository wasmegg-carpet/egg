import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fetchTableHeader } from './tableFetch';

/** A table file: the header and 64 KB of cells after it. */
function tableFile(header: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = Math.ceil((4 + json.length) / 8) * 8;
  const out = new Uint8Array(start + 65536);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  return out;
}

/** Serves bytes in 1 KB chunks, counting how many were read. */
function serve(files: Record<string, Uint8Array>) {
  const sent = { chunks: 0 };
  const fetch = (url: string) => {
    const bytes = files[url];
    if (!bytes) return Promise.resolve(new Response('missing', { status: 404 }));
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (at >= bytes.length) return c.close();
        sent.chunks++;
        c.enqueue(bytes.slice(at, (at += 1024)));
      },
    });
    return Promise.resolve(new Response(body));
  };
  return { sent, deps: { fetch, DecompressionStream } };
}

describe('fetchTableHeader', () => {
  const header = { version: 1, builtAt: '2026-11-09T00:00:00Z', simChange: 'abc', pad: 'x'.repeat(3000) };

  it('reads the header from the .gz without downloading the cells', async () => {
    const { sent, deps } = serve({ 'u.gz': gzipSync(tableFile(header), { level: 0 }) });
    expect(await fetchTableHeader('u', deps)).toEqual(header);
    expect(sent.chunks).toBeLessThan(20);
  });

  it('falls back to the plain file', async () => {
    const { sent, deps } = serve({ u: tableFile(header) });
    expect(await fetchTableHeader('u', deps)).toEqual(header);
    expect(sent.chunks).toBeLessThan(10);
  });

  it('rejects a file that is not a table', async () => {
    const { deps } = serve({ u: new Uint8Array([0xff, 0xff, 0xff, 0x7f, 1, 2]) });
    await expect(fetchTableHeader('u', deps)).rejects.toThrow('not a precomputed table');
  });
});

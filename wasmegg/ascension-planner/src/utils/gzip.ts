/**
 * Gzip with the browser's CompressionStream. It has no level option, so the output isn't byte-for-byte
 * the CLI's `gzipSync(level 9)`, but it decompresses to the same bytes.
 */
export async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The bytes of a file, gzipped or not (gzip's magic number decides), as an ArrayBuffer. */
export async function gunzipBytes(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

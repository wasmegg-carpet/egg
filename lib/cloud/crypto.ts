/**
 * Cloud library crypto, all in the browser with Web Crypto. The worker never sees a PIN or a key.
 *
 *   marker id  M   = hex(PBKDF2-SHA256(EID, "wasmegg-cloud:marker:v1", 10,000 iterations, 128 bits))
 *   PIN key        = PBKDF2-SHA256(PIN, salt ‖ EID, settings.kdf.iterations, 256 bits)
 *   main id    P   = hex(HKDF-SHA256(PIN key, info "wasmegg-cloud:main-id:v1", 128 bits))
 *   KEK            = HKDF-SHA256(PIN key, info "wasmegg-cloud:kek:v1"), an AES-GCM-256 key
 *   master key     = random AES-GCM-256; encrypts the library's plans and main-file body; stored wrapped by the KEK
 *   envelope       = version byte (1) | 12-byte IV | AES-GCM(gzip(plaintext))
 *
 * The marker id must match the worker's (joo-cloudflare src/eid.ts); both pin the same test vector. Changing any
 * constant here makes existing libraries unreachable. Don't; add a new version instead.
 */

export const MARKER_SALT = 'wasmegg-cloud:marker:v1';
export const MARKER_ITERATIONS = 10_000;
const INFO_MAIN_ID = 'wasmegg-cloud:main-id:v1';
const INFO_KEK = 'wasmegg-cloud:kek:v1';
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;

/** Default PIN-key iterations for new libraries (stored per library, so it can change later). */
export const DEFAULT_PIN_ITERATIONS = 600_000;

export const PIN_TYPES = ['pin6', 'pin4', 'password', 'none'] as const;
export type PinType = (typeof PIN_TYPES)[number];

/** A library's public settings, as the worker stores them in the marker. */
export interface LibrarySettings {
  v: 1;
  pinType: PinType;
  /** Base64, 16 bytes. */
  salt: string;
  kdf: { alg: 'PBKDF2-SHA256'; iterations: number };
}

/** A PIN that doesn't fit the library's PIN type (checked before any slow hashing or network call). */
export class PinFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinFormatError';
  }
}

/** What unlocking with a PIN yields: where the main file is, and the key that opens its master key. */
export interface PinKeys {
  mainId: string;
  kek: CryptoKey;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- EIDs and marker ids ------------------------------------------------------------------------------

/** An EID as `EI` + 16 digits, uppercase, or null if it isn't one. */
export function normalizeEid(raw: string): string | null {
  const eid = raw.trim().toUpperCase();
  return /^EI\d{16}$/.test(eid) ? eid : null;
}

export async function markerId(eid: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(eid), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(MARKER_SALT), iterations: MARKER_ITERATIONS },
    key,
    128
  );
  return toHex(new Uint8Array(bits));
}

// ---- PINs ---------------------------------------------------------------------------------------------

/** Why a PIN isn't acceptable for its type, or null when it is. */
export function pinProblem(pinType: PinType, pin: string): string | null {
  switch (pinType) {
    case 'pin6':
      return /^\d{6}$/.test(pin) ? null : 'Enter 6 digits.';
    case 'pin4':
      return /^\d{4}$/.test(pin) ? null : 'Enter 4 digits.';
    case 'password':
      return pin.length >= 8 ? null : 'Use at least 8 characters.';
    case 'none':
      return null;
  }
}

/** The PIN as it goes into the KDF: passwords in Unicode NFC (so every device types the same bytes). */
function pinBytes(pinType: PinType, pin: string): Uint8Array<ArrayBuffer> {
  if (pinType === 'none') return new Uint8Array();
  return enc.encode(pinType === 'password' ? pin.normalize('NFC') : pin.trim());
}

/** Settings for a new library: a fresh salt, the default iterations. */
export function newSettings(pinType: PinType, iterations = DEFAULT_PIN_ITERATIONS): LibrarySettings {
  return { v: 1, pinType, salt: toBase64(randomBytes(16)), kdf: { alg: 'PBKDF2-SHA256', iterations } };
}

/** Derive the main id and KEK from a PIN. This is the slow step (settings.kdf.iterations of PBKDF2). */
export async function derivePinKeys(eid: string, pin: string, settings: LibrarySettings): Promise<PinKeys> {
  const problem = pinProblem(settings.pinType, pin);
  if (problem) throw new PinFormatError(problem);
  const password = await crypto.subtle.importKey('raw', pinBytes(settings.pinType, pin), 'PBKDF2', false, ['deriveBits']);
  const salt = concat(fromBase64(settings.salt), enc.encode(eid));
  const pinKey = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: settings.kdf.iterations },
    password,
    256
  );
  const hkdf = await crypto.subtle.importKey('raw', pinKey, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdfParams = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: enc.encode(info) });
  const mainId = toHex(new Uint8Array(await crypto.subtle.deriveBits(hkdfParams(INFO_MAIN_ID), hkdf, 128)));
  const kek = await crypto.subtle.deriveKey(hkdfParams(INFO_KEK), hkdf, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
  return { mainId, kek };
}

// ---- Master key ---------------------------------------------------------------------------------------

/**
 * A new master key. Extractable, because a PIN change re-wraps it under the new KEK (wrapKey needs that);
 * it only ever leaves Web Crypto wrapped.
 */
export function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** The master key wrapped by the KEK: base64(IV ‖ AES-GCM(raw key)). */
export async function wrapMasterKey(master: CryptoKey, kek: CryptoKey): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey('raw', master, kek, { name: 'AES-GCM', iv });
  return toBase64(concat(iv, new Uint8Array(wrapped)));
}

/** Throws (a DOMException) when the KEK is wrong. */
export async function unwrapMasterKey(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  const bytes = fromBase64(wrapped);
  return crypto.subtle.unwrapKey(
    'raw',
    bytes.slice(IV_BYTES),
    kek,
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// ---- Envelopes ----------------------------------------------------------------------------------------

/** Gzip, then encrypt with `key`: version | IV | ciphertext. */
export async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await gzip(plaintext));
  return concat(Uint8Array.of(ENVELOPE_VERSION), iv, new Uint8Array(ciphertext));
}

/** Decrypt and gunzip an envelope. Throws on a wrong key, tampering, or an unknown version. */
export async function open(key: CryptoKey, envelope: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (envelope[0] !== ENVELOPE_VERSION) throw new Error(`unknown envelope version ${envelope[0]}`);
  const iv = envelope.slice(1, 1 + IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, envelope.slice(1 + IV_BYTES));
  return gunzip(new Uint8Array(plaintext));
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  return seal(key, enc.encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, envelope: Uint8Array): Promise<T> {
  return JSON.parse(dec.decode(await open(key, envelope))) as T;
}

// ---- The main file ------------------------------------------------------------------------------------

/** On the wire: JSON `{v, wrappedKey, body}`, body = base64 envelope of the index under the master key. */
interface MainFileWire {
  v: 1;
  wrappedKey: string;
  body: string;
}

export async function encodeMainFile(index: unknown, master: CryptoKey, kek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const wire: MainFileWire = { v: 1, wrappedKey: await wrapMasterKey(master, kek), body: toBase64(await sealJson(master, index)) };
  return enc.encode(JSON.stringify(wire));
}

/** The master key and decrypted index from a main file. Throws if the KEK doesn't open it. */
export async function decodeMainFile<T>(bytes: Uint8Array, kek: CryptoKey): Promise<{ master: CryptoKey; index: T }> {
  const wire = JSON.parse(dec.decode(bytes)) as MainFileWire;
  if (wire.v !== 1) throw new Error(`unknown main file version ${wire.v}`);
  const master = await unwrapMasterKey(wire.wrappedKey, kek);
  return { master, index: await openJson<T>(master, fromBase64(wire.body)) };
}

/** The index from a main file, with a master key already unwrapped (a remembered device). Throws if it doesn't open. */
export async function openMainFile<T>(bytes: Uint8Array, master: CryptoKey): Promise<{ index: T; wrappedKey: string }> {
  const wire = JSON.parse(dec.decode(bytes)) as MainFileWire;
  if (wire.v !== 1) throw new Error(`unknown main file version ${wire.v}`);
  return { index: await openJson<T>(master, fromBase64(wire.body)), wrappedKey: wire.wrappedKey };
}

/** Re-encode a main file's index under a master key already unwrapped (an ordinary save). */
export async function reencodeMainFile(index: unknown, master: CryptoKey, wrappedKey: string): Promise<Uint8Array<ArrayBuffer>> {
  const wire: MainFileWire = { v: 1, wrappedKey, body: toBase64(await sealJson(master, index)) };
  return enc.encode(JSON.stringify(wire));
}

/** The wrapped key a main file carries (kept so ordinary saves don't need the KEK). */
export function mainFileWrappedKey(bytes: Uint8Array): string {
  return (JSON.parse(dec.decode(bytes)) as MainFileWire).wrappedKey;
}

// ---- Bytes --------------------------------------------------------------------------------------------

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const gzip = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('gzip'));
const gunzip = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('gzip'));

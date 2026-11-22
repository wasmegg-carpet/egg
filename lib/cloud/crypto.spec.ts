import { describe, expect, it } from 'vitest';
import {
  decodeMainFile,
  derivePinKeys,
  encodeMainFile,
  fromBase64,
  generateMasterKey,
  markerId,
  newSettings,
  normalizeEid,
  open,
  openJson,
  pinProblem,
  reencodeMainFile,
  mainFileWrappedKey,
  seal,
  sealJson,
  toBase64,
  unwrapMasterKey,
  wrapMasterKey,
  type LibrarySettings,
} from './crypto';

const EID = 'EI0000000000000000';
/** Few iterations, so the suite stays fast; the real default is measured separately below. */
const fast = (pinType: LibrarySettings['pinType']): LibrarySettings => ({ ...newSettings(pinType), kdf: { alg: 'PBKDF2-SHA256', iterations: 1000 } });

describe('marker id', () => {
  // The worker (joo-cloudflare test/eid.spec.ts) pins the same vector: the two must agree.
  it('matches the worker’s test vector', async () => {
    expect(await markerId(EID)).toBe('1ca62b75ebb07f985eaf1289c4664bcf');
  });

  it('normalizes EIDs', () => {
    expect(normalizeEid(' ei1234567890123456 ')).toBe('EI1234567890123456');
    expect(normalizeEid('EI123')).toBeNull();
  });
});

describe('PINs', () => {
  it.each([
    ['pin6', '123456', null],
    ['pin6', '12345', 'Enter 6 digits.'],
    ['pin6', '12345a', 'Enter 6 digits.'],
    ['pin4', '1234', null],
    ['pin4', '123456', 'Enter 4 digits.'],
    ['password', 'correct horse', null],
    ['password', 'short', 'Use at least 8 characters.'],
    ['none', '', null],
  ] as const)('%s %j → %s', (type, pin, problem) => {
    expect(pinProblem(type, pin)).toBe(problem);
  });

  it('derives the same main id for the same EID, PIN and settings, and different ones otherwise', async () => {
    const settings = fast('pin6');
    const a = await derivePinKeys(EID, '123456', settings);
    const b = await derivePinKeys(EID, '123456', settings);
    expect(a.mainId).toMatch(/^[0-9a-f]{32}$/);
    expect(b.mainId).toBe(a.mainId);
    expect((await derivePinKeys(EID, '123457', settings)).mainId).not.toBe(a.mainId);
    expect((await derivePinKeys('EI0000000000000001', '123456', settings)).mainId).not.toBe(a.mainId);
    expect((await derivePinKeys(EID, '123456', fast('pin6'))).mainId).not.toBe(a.mainId); // new salt
  });

  // Computed independently (plain Node Web Crypto, same recipe). A change here strands every library.
  it('is stable across releases (fixed vector)', async () => {
    const settings: LibrarySettings = { v: 1, pinType: 'pin6', salt: toBase64(new Uint8Array(16)), kdf: { alg: 'PBKDF2-SHA256', iterations: 1000 } };
    expect((await derivePinKeys(EID, '123456', settings)).mainId).toBe('0ef4d57c23f3e4f95992fab8cd69402f');
  });

  it('refuses a PIN that does not fit the type', async () => {
    await expect(derivePinKeys(EID, '12', fast('pin4'))).rejects.toThrow('Enter 4 digits.');
  });

  it('treats a password the same however its accents were typed (NFC)', async () => {
    const settings = fast('password');
    const composed = await derivePinKeys(EID, 'café au lait', settings);
    const decomposed = await derivePinKeys(EID, 'café au lait', settings);
    expect(decomposed.mainId).toBe(composed.mainId);
  });
});

describe('master key and envelopes', () => {
  it('wraps the master key so only the right KEK unwraps it', async () => {
    const settings = fast('pin6');
    const right = await derivePinKeys(EID, '111111', settings);
    const wrong = await derivePinKeys(EID, '222222', settings);
    const master = await generateMasterKey();
    const wrapped = await wrapMasterKey(master, right.kek);
    const back = await unwrapMasterKey(wrapped, right.kek);
    const sealed = await seal(master, new TextEncoder().encode('hi'));
    expect(new TextDecoder().decode(await open(back, sealed))).toBe('hi');
    await expect(unwrapMasterKey(wrapped, wrong.kek)).rejects.toThrow();
  });

  it('seals and opens JSON, compressing it, and refuses tampering and wrong keys', async () => {
    const key = await generateMasterKey();
    const value = { plan: 'x'.repeat(10_000), n: 1 };
    const sealed = await sealJson(key, value);
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBeLessThan(500); // gzipped
    expect(await openJson(key, sealed)).toEqual(value);

    const tampered = sealed.slice();
    tampered[tampered.length - 1]! ^= 1;
    await expect(open(key, tampered)).rejects.toThrow();
    await expect(open(await generateMasterKey(), sealed)).rejects.toThrow();
    const wrongVersion = sealed.slice();
    wrongVersion[0] = 9;
    await expect(open(key, wrongVersion)).rejects.toThrow('unknown envelope version 9');
  });

  it('uses a fresh IV every time', async () => {
    const key = await generateMasterKey();
    const a = await seal(key, new Uint8Array([1]));
    const b = await seal(key, new Uint8Array([1]));
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});

describe('main file', () => {
  it('round-trips the index and master key, and re-encodes without the KEK', async () => {
    const settings = fast('pin6');
    const { kek } = await derivePinKeys(EID, '123456', settings);
    const master = await generateMasterKey();
    const bytes = await encodeMainFile({ v: 1, plans: [{ id: 'a' }] }, master, kek);
    const decoded = await decodeMainFile<{ plans: { id: string }[] }>(bytes, kek);
    expect(decoded.index.plans[0]!.id).toBe('a');

    const again = await reencodeMainFile({ v: 1, plans: [] }, decoded.master, mainFileWrappedKey(bytes));
    expect((await decodeMainFile<{ plans: unknown[] }>(again, kek)).index.plans).toEqual([]);

    const other = await derivePinKeys(EID, '654321', settings);
    await expect(decodeMainFile(bytes, other.kek)).rejects.toThrow();
  });
});

describe('base64', () => {
  it('round-trips large buffers', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('KDF timing', () => {
  it('the default PIN key takes well under a second here (target ~0.5 s on a phone)', async () => {
    const started = performance.now();
    await derivePinKeys(EID, '123456', newSettings('pin6'));
    const ms = performance.now() - started;
    console.log(`PIN key at the default iterations: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

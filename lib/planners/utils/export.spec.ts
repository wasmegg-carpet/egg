import { describe, expect, it } from 'vitest';
import { importedPlanName, readImportedJson } from './export';
import { gzipBytes } from './gzip';

const JSON_TEXT = '{"version":1,"name":"Plän ✓"}';
const plain = () => new TextEncoder().encode(JSON_TEXT);

describe('readImportedJson', () => {
  it('reads back a gzipped export', async () => {
    expect(await readImportedJson((await gzipBytes(plain())).buffer)).toBe(JSON_TEXT);
  });

  it('still reads a plain .json export', async () => {
    expect(await readImportedJson(plain().buffer)).toBe(JSON_TEXT);
  });

  it('rejects a file cut short', async () => {
    const gzipped = await gzipBytes(plain());
    await expect(readImportedJson(gzipped.slice(0, gzipped.length - 10).buffer)).rejects.toThrow();
  });
});

describe('importedPlanName', () => {
  it('drops the extensions of either kind', () => {
    expect(importedPlanName('My_Plan.json.gz')).toBe('My_Plan');
    expect(importedPlanName('My_Plan.json')).toBe('My_Plan');
    expect(importedPlanName('My_Plan.gz')).toBe('My_Plan');
    expect(importedPlanName('v1.2.JSON.GZ')).toBe('v1.2');
    expect(importedPlanName('v1.2')).toBe('v1.2');
  });
});

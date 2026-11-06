/**
 * The gear and modes a table's cells were simulated with, written into its header so a file says
 * what it assumes, and the check the Chain Finder runs on a loaded table's header. Shared by
 * scripts/buildTable.ts `--pack` and the Table Builder; Node-free.
 */
import { stoneId, STONE_FAMILIES, STONE_TIERS } from '@/auto/loadout';
import type { SimulationContext } from '@/auto/types';
import { getArtifact } from '@/lib/artifacts/data';
import { REFERENCE_WEEK } from './cell';
import { maxedContext } from './maxedAccount';

export interface TableGear {
  /** The earnings set's artifact ids, as built. */
  earnings: string[];
  /** The fixed delivery structure's artifact ids, as built. */
  delivery: string[];
  /** `deliveryKey(delivery)`: names the delivery set in file names and upload paths. */
  deliveryKey: string;
  /** Stones in the pool by stone id, e.g. `quantum-stone-4: 12`; families and tiers with none left out. */
  stones: Record<string, number>;
  /** Only written when the table was built in silo mode (the auto-planner's defer for earnings). */
  deferForEarnings?: true;
}

/** The header fields a table gets from the context its cells were simulated with. */
export function tableGear(context: SimulationContext): TableGear {
  const inputs = context.loadoutInputs;
  if (!inputs || inputs.delivery.mode !== 'fixed') throw new Error('a table needs a fixed delivery structure');
  const delivery = inputs.delivery.artifactIds.map(id => id ?? '');
  const stones: Record<string, number> = {};
  for (const family of STONE_FAMILIES)
    for (const tier of STONE_TIERS) if (inputs.stones[family][tier]) stones[stoneId(family, tier)] = inputs.stones[family][tier];
  return {
    earnings: inputs.earnings.map(slot => slot.artifactId ?? ''),
    delivery,
    deliveryKey: deliveryKey(delivery),
    stones,
    ...(context.deferForEarningsMode ? { deferForEarnings: true as const } : {}),
  };
}

/**
 * 8 hex digits (FNV-1a) of the artifact ids sorted, so the same four artifacts in any order get
 * the same key.
 */
export function deliveryKey(ids: string[]): string {
  const text = [...ids].sort().join(',');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Every key a header written by `--pack` or the Table Builder may have. */
const KNOWN_KEYS = new Set([
  'version',
  'referenceWeek',
  'cteBonus',
  'doubleEarnings',
  'earnings',
  'delivery',
  'deliveryKey',
  'stones',
  'deferForEarnings',
  'deliveryScore',
  'from',
  'to',
  'slots',
  'builtAt',
  'simVersion',
  'k3',
]);

/** Keys a header from before them lacks: without them a file can't say what it was built with. */
const REQUIRED_KEYS = ['builtAt', 'simVersion', 'doubleEarnings', 'earnings', 'delivery', 'deliveryKey', 'stones'];

/**
 * What's missing or unexpected in a loaded table's header, one sentence each; empty when it's as
 * the Table Builder writes it today. A delivery set other than the maxed one isn't flagged: that's
 * what the Table Builder is for.
 */
export function tableHeaderWarnings(header: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const missing = REQUIRED_KEYS.filter(k => header[k] === undefined);
  if (missing.length)
    warnings.push(`The header has no ${missing.join(', ')}: it was packed before these were recorded.`);
  const unknown = Object.keys(header).filter(k => !KNOWN_KEYS.has(k));
  if (unknown.length) warnings.push(`The header has keys this page doesn't know: ${unknown.join(', ')}.`);

  if (header.doubleEarnings === false) warnings.push('Built with 2x earnings (the video doubler) off.');
  if (header.deferForEarnings === false)
    warnings.push('The header says deferForEarnings: false. Only silo-mode tables should have that key (silo mode was off).');
  if (header.referenceWeek !== undefined && header.referenceWeek !== REFERENCE_WEEK)
    warnings.push(`Simulated from reference week ${header.referenceWeek}, not ${REFERENCE_WEEK}.`);
  if (typeof header.simVersion === 'string' && header.simVersion.endsWith('-dirty'))
    warnings.push(`Built from uncommitted simulator code (${header.simVersion}).`);

  const expected = tableGear(maxedContext());
  if (Array.isArray(header.earnings) && !sameIds(header.earnings, expected.earnings))
    warnings.push(`Earnings set is ${labels(header.earnings)}, not the maxed ${labels(expected.earnings)}.`);
  if (header.stones !== undefined && !sameStones(header.stones, expected.stones))
    warnings.push(`Stones are ${stonesText(header.stones)}, not ${stonesText(expected.stones)}.`);
  if (Array.isArray(header.delivery)) {
    const unknownIds = header.delivery.filter(id => !getArtifact(String(id)));
    if (unknownIds.length) warnings.push(`Unknown delivery artifact ids: ${unknownIds.join(', ')}.`);
    if (header.deliveryKey !== undefined && header.deliveryKey !== deliveryKey(header.delivery.map(String)))
      warnings.push(`deliveryKey ${header.deliveryKey} doesn't match the delivery set (${deliveryKey(header.delivery.map(String))}).`);
  }
  return warnings;
}

/** e.g. `metronome T4E, compass T4L, gusset T4L, totem T4L`, for a header's artifact ids. */
export function labels(ids: unknown[]): string {
  return ids
    .map(id => {
      const a = getArtifact(String(id));
      return a ? `${a.familyName} T${a.tier}${a.rarityCode}` : String(id);
    })
    .join(', ');
}

function sameIds(a: unknown[], b: string[]): boolean {
  return JSON.stringify(a.map(String).sort()) === JSON.stringify([...b].sort());
}

function sameStones(a: unknown, b: Record<string, number>): boolean {
  if (!a || typeof a !== 'object') return false;
  const entries = (s: object) => JSON.stringify(Object.entries(s).sort(([x], [y]) => x.localeCompare(y)));
  return entries(a) === entries(b);
}

function stonesText(stones: unknown): string {
  if (!stones || typeof stones !== 'object') return String(stones);
  const entries = Object.entries(stones);
  return entries.length ? entries.map(([id, n]) => `${n} ${id}`).join(', ') : 'none';
}

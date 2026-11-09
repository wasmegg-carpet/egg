/**
 * Per-account precomputed tables, ported from AutoAutoAP (their src/search/tableGear.ts): tables
 * built on real gear, not only on the maxed reference account. Two things the table store's catalog
 * and this page must agree on exactly, so they live here once:
 *
 * THE FILE'S NAME. A table is served at a public URL, and nothing derived from the player id may be
 * guessable from it. The name is PBKDF2-SHA256 of the id with a fixed salt and 200,000 iterations: a
 * tenth of a second in the browser, once, and far beyond searching all 10^16 ids. The id itself never
 * leaves the page.
 *
 * THE GEAR STAMP. What a table's builds depend on besides the start: the sets the simulator's
 * optimizer picks from the inventory (earnings, and delivery at no research and at the research a
 * build waits with), epic research and colleggtibles. Stamped into the table when it is made; the page
 * works the same stamp out from the loaded save and uses the table only when they match. The sets, not
 * the raw inventory: a new artifact that changes no choice leaves the table exact, and the save's
 * current research (which moves mid-ascension) is not part of it.
 */
import { getArtifact, getStone, getOptimalELRSet, sanitizeLongs } from '@/lib/artifacts';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import { getColleggtibleTiers, modifiersFromColleggtibleTiers, type Modifiers } from 'lib/collegtibles';
import type { ei } from 'lib';

const SALT = 'egg-precompute-table-v1';
const ITERATIONS = 200_000;

/** The table file's name for a player id: `acct-` and 24 hex digits. */
export async function tableName(playerId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(playerId), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    96
  );
  return 'acct-' + [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('') + '.bin';
}

/** One artifact slot as a gear stamp reads it: the artifact's label and its stones' labels. */
export interface LoadoutSlot {
  artifact: string;
  stones: string[];
}

/** A loadout as labels (search/csv.ts `describeLoadoutSlots` in AutoAutoAP): unknown ids are skipped. */
export function describeLoadoutSlots(loadout: EquippedArtifact[] | null | undefined): LoadoutSlot[] {
  if (!loadout?.length) return [];
  const slots: LoadoutSlot[] = [];
  for (const slot of loadout) {
    const a = getArtifact(slot.artifactId);
    if (!a) continue;
    const stones: string[] = [];
    for (const id of slot.stones) {
      if (!id) continue;
      const st = getStone(id);
      if (st) stones.push(st.label);
    }
    slots.push({ artifact: a.label, stones });
  }
  return slots;
}

/** What a gear stamp is computed from: the save and the context the simulator reads it in. */
export interface GearContext {
  rawBackup?: ei.IBackup | null;
  epicResearchLevels: Record<string, number>;
  colleggtibleModifiers: Modifiers;
}

/** The context a gear stamp is computed in: the backup itself, with the epic research and the
 *  colleggtibles the simulator reads parsed from it. Null with no backup. */
export function backupGearContext(backup: ei.IBackup | null | undefined): GearContext | null {
  if (!backup) return null;
  const epicResearchLevels: Record<string, number> = {};
  for (const research of backup.game?.epicResearch ?? []) {
    if (research.id && research.level !== null && research.level !== undefined) {
      epicResearchLevels[research.id] = research.level;
    }
  }
  return {
    rawBackup: backup,
    epicResearchLevels,
    colleggtibleModifiers: modifiersFromColleggtibleTiers(getColleggtibleTiers(backup)),
  };
}

export interface TableGear {
  earnings: LoadoutSlot[];
  /** The delivery set the optimizer picks with no common research, and with `research`. */
  deliveryBare: LoadoutSlot[];
  deliveryFull: LoadoutSlot[];
  /** The research `deliveryFull` is picked at (the table's k3 research). */
  research: Record<string, number>;
  epicResearch: Record<string, number>;
  colleggtibles: Record<string, number>;
}

/** The gear stamp of the account `context` was collected from. `earnings`: its earnings set as the
 *  optimizer picks it (`getOptimalEarningsSet(rawBackup)`); `research`: the table's waiting research
 *  (its header's `k3.research`, or the maxed table's). Null without a save. */
export function gearStamp(
  context: GearContext,
  earnings: EquippedArtifact[] | null | undefined,
  research: Record<string, number>
): TableGear | null {
  const raw = context.rawBackup;
  if (!raw) return null;
  // Each on a fresh copy of the save: getOptimalELRSet caches the first set structure it finds per
  // backup OBJECT (lib/artifacts/virtue.ts), so on the page's own save the answer would depend on
  // whatever ran first, and a stamp computed first would leave its structure in that cache for the
  // page's own searches. A copy is a cache miss, a full search, and leaves the page's cache alone.
  const delivery = (commonResearch: Record<string, number>) =>
    describeLoadoutSlots(
      getOptimalELRSet(sanitizeLongs(raw) as typeof raw, {
        commonResearch,
        epicResearchLevels: context.epicResearchLevels,
        colleggtibleModifiers: context.colleggtibleModifiers,
        assumeMaxHabsVehicles: true,
      }) as EquippedArtifact[] | null
    );
  const sorted = (r: Record<string, number> | undefined) =>
    Object.fromEntries(Object.entries(r ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return {
    earnings: describeLoadoutSlots(earnings),
    deliveryBare: delivery({}),
    deliveryFull: delivery(research),
    research: sorted(research),
    epicResearch: sorted(context.epicResearchLevels as Record<string, number>),
    colleggtibles: sorted(getColleggtibleTiers(raw)),
  };
}

/** The 24 hex digits of SHA-256 of `text`, as a gear table's file name. */
async function gearFile(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return (
    'gear-' +
    [...new Uint8Array(bytes)]
      .slice(0, 12)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('') +
    '.bin'
  );
}

/**
 * A gear table's file name (tables built on a board account's gear, not an account): SHA-256 of the
 * stamp, worked out at the maxed table's own waiting research so the page can work it out before it
 * loads anything else. Gear is not private (the board shows it), so a plain hash will do.
 *
 * The canonical name: the stamp with every set as `asWorn` has it (artifacts sorted, stones pooled and
 * sorted, the same rule `gearChanges` compares by) and the research maps with their keys in code-point
 * order, under `v: 2` so it can never equal a legacy name. The same gear gives the same name however
 * the slots and stones are arranged.
 */
export async function gearTableName(stamp: TableGear): Promise<string> {
  return gearFile(JSON.stringify(canonicalGear(stamp)));
}

/** The stamp as the canonical name hashes it (`gearTableName`). */
export function canonicalGear(stamp: TableGear): object {
  const keys = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    v: 2,
    earnings: asWorn(stamp.earnings),
    deliveryBare: asWorn(stamp.deliveryBare),
    deliveryFull: asWorn(stamp.deliveryFull),
    epicResearch: keys(stamp.epicResearch),
    colleggtibles: keys(stamp.colleggtibles),
  };
}

/** The name gear tables were deployed under before 11 Oct 2026: the stamp hashed as worn, so the same
 *  gear in another slot order or stone split gave another name. Kept to find those tables until each
 *  has its canonical alias. */
export async function legacyGearTableName(stamp: TableGear): Promise<string> {
  const { research: _research, ...gear } = stamp;
  void _research;
  return gearFile(JSON.stringify(gear));
}

/**
 * The epic research the planner models (lib/epicResearch.ts epicResearchDefs), each at the save's
 * level or 0, keys sorted. Saves also carry research the planner never reads (silo quality, warp
 * shift), which changes no build but split every v2 name: a board gear table built on such a save
 * could never match a real owner.
 */
export function simEpicResearch(levels: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    epicResearchDefs
      .map(d => d.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(id => [id, levels?.[id] ?? 0])
  );
}

/** What the colleggtibles do (lib/collegtibles.ts modifiersFromColleggtibleTiers: the multipliers
 *  the simulator reads), not which eggs at which tier: a new egg with no effect, or the same effect
 *  from other eggs, is the same farm. Rounded to 12 significant digits so float order can't split. */
export function colleggtibleEffects(tiers: Record<string, number> | undefined): Record<string, number> {
  const mods = modifiersFromColleggtibleTiers(tiers ?? {}) as unknown as Record<string, number>;
  return Object.fromEntries(
    Object.keys(mods)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(k => [k, Number(mods[k].toPrecision(12))])
  );
}

/** The stamp as the v3 name hashes it: v2's sets, but only the epic research and colleggtible effects
 *  the simulator reads (`simEpicResearch`, `colleggtibleEffects`). */
export function canonicalGearV3(stamp: TableGear): object {
  return {
    v: 3,
    earnings: asWorn(stamp.earnings),
    deliveryBare: asWorn(stamp.deliveryBare),
    deliveryFull: asWorn(stamp.deliveryFull),
    epicResearch: simEpicResearch(stamp.epicResearch),
    colleggtibles: colleggtibleEffects(stamp.colleggtibles),
  };
}

/** The v3 gear table name (11 Oct 2026): what the page looks up first. */
export async function gearTableNameV3(stamp: TableGear): Promise<string> {
  return gearFile(JSON.stringify(canonicalGearV3(stamp)));
}

/** The names to look a player's gear table up under, in order: v3, v2 canonical, then legacy. */
export async function gearTableNames(stamp: TableGear): Promise<string[]> {
  const names = [await gearTableNameV3(stamp), await gearTableName(stamp), await legacyGearTableName(stamp)];
  return [...new Set(names)];
}

/**
 * A set as what it does: its artifacts and its stones, each as a sorted list. An artifact's effect and
 * a stone's effect are each a factor of their own, whichever artifact the stone sits in
 * (lib/artifacts/calculator.ts multiplies every effect in), so the same artifacts with the same
 * stones are the same set however they are worn.
 */
function asWorn(slots: LoadoutSlot[]): { artifacts: string[]; stones: string[] } {
  return {
    artifacts: slots.map(s => s.artifact).sort(),
    stones: slots.flatMap(s => s.stones).sort(),
  };
}

/**
 * Which rule `gearChanges` compares by. 1: slots exactly; 2 (0ec1fe28): slot order ignored;
 * 3: which artifact a stone is in ignored too; 4: only the epic research and colleggtible effects
 * the simulator reads. Raise it whenever `gearChanges` changes.
 */
export const GEAR_RULE = 4;

/** What differs between a table's stamp and the player's, in words; empty when they match. Which
 *  slot an artifact is in and which artifact a stone is in are ignored here only (`asWorn`): the
 *  stamp itself (and so every gear-<sha> name) is unchanged. */
export function gearChanges(table: TableGear, mine: TableGear): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const sameSet = (a: LoadoutSlot[], b: LoadoutSlot[]) => same(asWorn(a), asWorn(b));
  const out: string[] = [];
  if (!sameSet(table.earnings, mine.earnings)) out.push('earnings set');
  if (!sameSet(table.deliveryBare, mine.deliveryBare) || !sameSet(table.deliveryFull, mine.deliveryFull))
    out.push('delivery set');
  // Only what the simulator reads (rule 4): research it never models and colleggtibles with the
  // same effects no longer count as a change.
  if (!same(simEpicResearch(table.epicResearch), simEpicResearch(mine.epicResearch))) out.push('epic research');
  if (!same(colleggtibleEffects(table.colleggtibles), colleggtibleEffects(mine.colleggtibles)))
    out.push('colleggtibles');
  return out;
}

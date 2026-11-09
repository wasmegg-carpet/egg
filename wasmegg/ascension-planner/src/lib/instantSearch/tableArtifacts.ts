/**
 * What a table was built with, in words: the earnings set and the delivery set its cells were
 * simulated with, and the stone counts it assumed. Read from the header alone, so it works for a
 * downloaded table as well as a file the player loaded (components/instantSearch/InstantSearch.vue
 * shows it under the table's name).
 *
 * Three shapes carry the sets, newest first:
 *   `earnings` / `delivery` ids        the Table Builder's tables (and the store's release tables)
 *   `gear.earnings` / `gear.deliveryFull`  an account's or gear table's stamp, as labels
 *   `k3.delivery`                      the maxed table's waiting set, as records
 * A table packed without any of them (an older build) reports nothing rather than guessing.
 */
import { getArtifact, getStone } from '@/lib/artifacts';
import type { TableHeader } from './table';

export interface TableArtifactSets {
  /** The earnings set, by label. */
  earnings: string[];
  /** The delivery set the cells' peak rate is reached with, by label. */
  delivery: string[];
  /** Stones the build assumes, by label and count. */
  stones: { label: string; count: number }[];
}

const artifactLabel = (id: string): string => getArtifact(id)?.label ?? id;
const stoneLabel = (id: string): string => getStone(id)?.label ?? id;

/** The artifact sets a table's header records (empty lists when it records none). */
export function tableArtifacts(header: TableHeader): TableArtifactSets {
  const earnings = header.earnings?.length
    ? header.earnings.map(artifactLabel)
    : (header.gear?.earnings?.map(slot => slot.artifact) ?? []);

  const delivery = header.delivery?.length
    ? header.delivery.map(artifactLabel)
    : (header.gear?.deliveryFull?.map(slot => slot.artifact) ??
      (header.k3?.delivery as { artifactId?: string | null }[] | undefined)
        ?.map(slot => (slot.artifactId ? artifactLabel(slot.artifactId) : ''))
        .filter(Boolean) ??
      []);

  const stones = Object.entries(header.stones ?? {}).map(([id, count]) => ({ label: stoneLabel(id), count }));

  return { earnings, delivery, stones };
}

/**
 * One line for the sets: `earnings T4L Demeters necklace, … · delivery T4L Quantum metronome, … ·
 * 12× T4 Tachyon stone, …`. Empty when the header records none of it.
 */
export function describeTableArtifacts(header: TableHeader): string {
  const { earnings, delivery, stones } = tableArtifacts(header);
  const parts: string[] = [];
  if (earnings.length) parts.push(`earnings ${earnings.join(', ')}`);
  if (delivery.length) parts.push(`delivery ${delivery.join(', ')}`);
  if (stones.length) parts.push(stones.map(s => `${s.count}× ${s.label}`).join(', '));
  return parts.join(' · ');
}

import { iconURL } from '../utils';

const now = Date.now();

export class Tool {
  id: string;
  url: string;
  title: string;
  iconUrl = '';
  description?: string;
  displayIconOnly = false;
  iconCssClasses = '';
  newUntil = 0;
  majorUpdateUntil = 0;
  updateUntil = 0;
  whatsNew?: string;

  constructor({
    id,
    url,
    title,
    iconUrl,
    description,
    displayIconOnly,
    iconCssClasses,
    newUntil,
    majorUpdateUntil,
    updateUntil,
    whatsNew,
  }: {
    id: string;
    url?: string;
    title: string;
    iconUrl?: string;
    description?: string;
    displayIconOnly?: boolean;
    iconCssClasses?: string;
    newUntil?: number;
    majorUpdateUntil?: number;
    updateUntil?: number;
    whatsNew?: string;
  }) {
    this.id = id;
    this.url = url || `https://wasmegg-carpet.netlify.app/${this.id}/`;
    this.title = title;
    this.iconUrl = iconUrl || '';
    this.description = description;
    this.displayIconOnly = displayIconOnly || false;
    this.iconCssClasses = iconCssClasses || '';
    this.newUntil = newUntil || 0;
    this.majorUpdateUntil = majorUpdateUntil || 0;
    this.updateUntil = updateUntil || 0;
    this.whatsNew = whatsNew;
  }

  get isNew(): boolean {
    return now < this.newUntil;
  }

  get isMajorUpdate(): boolean {
    return now < this.majorUpdateUntil;
  }

  get isUpdate(): boolean {
    return now < this.updateUntil;
  }

  get isHighlight(): boolean {
    return this.isNew || this.isMajorUpdate || this.isUpdate;
  }
}

export const tools = [
  new Tool({
    id: 'eicoop',
    url: 'https://eicoop-carpet.netlify.app/',
    title: 'CoopTracker',
    iconUrl: iconURL('wasmegg/eicoop.svg'),
    description: 'Coop tracker and contract master list',
    displayIconOnly: true,
    iconCssClasses: 'h-6 -ml-0.5 -mr-1 -top-0.5',
    majorUpdateUntil: 1624607856000,
    updateUntil: 1638811910000,
    whatsNew: 'Grade detection works again',
  }),

  new Tool({
    id: 'artifact-explorer',
    title: 'Artifact explorer',
    url: '/artifact-explorer/',
    iconUrl: iconURL('wasmegg/artifact-explorer.svg'),
    description: 'Explorer for everything artifacts',
    // forever
    updateUntil: 1638811910000,
    whatsNew: 'Updated for new levels of FTL Epic Research.',
  }),
  new Tool({
    id: 'artifact-sandbox',
    title: 'Artifact sandbox',
    url: '/artifact-sandbox/',
    iconUrl: iconURL('wasmegg/artifact-sandbox.svg'),
    description: 'Sandbox for experimenting, optimizing, and sharing artifact builds',
    // forever
    updateUntil: 1638811910000,
    whatsNew: 'Added Max Base RCB field.',
  }),
  new Tool({
    id: 'virtue-companion',
    title: 'Virtue Companion',
    url: '/virtue-companion/',
    iconUrl: iconURL('egginc/egg_truth.png', 64),
    description: 'Companion for tracking virtue progress',
    iconCssClasses: 'h-5 w-5',
    majorUpdateUntil: 1764547200,
    updateUntil: 1638811910000,
    whatsNew: 'New Tool: Virtue Companion!',
  }),
  new Tool({
    id: 'ascension-planner',
    title: 'Ascension Planner',
    url: '/ascension-planner/',
    iconUrl: iconURL('egginc/egg_truth.png', 64),
    description: 'Planner for ascension progress',
    iconCssClasses: 'h-5 w-5',
  }),
  new Tool({
    id: 'enl-planner',
    title: 'Enlightenment Planner',
    url: '/enl-planner/',
    iconUrl: iconURL('egginc/egg_enlightenment.png', 64),
    description: 'Planner for the fastest route to Enlightenment trophies',
    iconCssClasses: 'h-5 w-5',
  }),
  new Tool({
    id: 'rockets-tracker',
    title: 'Rockets tracker',
    url: '/rockets-tracker/',
    iconUrl: iconURL('wasmegg/rockets-tracker.svg'),
    description:
      'Tracker for active rocket missions, historical mission statistics, progress on artifact collection, etc.',
    // forever
    updateUntil: 1637780082000,
    whatsNew: 'Fixed crafting expense and crafting count.',
  }),
  new Tool({
    id: 'eggs-laid',
    title: 'Eggs laid',
    url: '/eggs-laid/',
    description: 'Lists total eggs laid for all eggs',
    // forever
  }),
  new Tool({
    id: 'past-contracts',
    title: 'Past contracts viewer',
    url: '/past-contracts/',
    iconUrl: iconURL('wasmegg/past-contracts.svg'),
    description: 'Past contracts and prophecy egg completion tracker',
    // Tue Jun  8 12:33:17 UTC 2021
    updateUntil: 1623155597000,
    whatsNew: 'Displays Contract Score',
  }),
  new Tool({
    id: 'inventory-visualizer',
    title: 'Inventory visualizer',
    url: '/inventory-visualizer/',
    iconUrl: iconURL('wasmegg/inventory-visualizer.svg'),
    description: 'The easiest way to share your entire Egg, Inc. artifact inventory',
    // Thu Dec  9 17:50:20 UTC 2021
    newUntil: 1639072220000,
  }),
  new Tool({
    id: 'enlightenment',
    url: '/enlightenment/',
    title: 'Enlightenment companion',
    iconUrl: iconURL('wasmegg/enlightenment.svg'),
    description: 'Informational companion on your journey to the Enlightenment Diamond Trophy',
  }),
  new Tool({
    id: 'smart-assistant',
    url: '/smart-assistant/',
    title: 'Smart assistant',
    iconUrl: iconURL('wasmegg/smart-assistant.svg'),
    description:
      'Smart, personalized artifact loadout generator \u2014 effortlessly optimize your prestige loadout; full-fledged earning bonus planner',
    // Tue Aug 10 16:38:57 UTC 2021
    newUntil: 1628613537000,
    // Mon Aug  2 13:52:46 UTC 2021
    updateUntil: 1627912366000,
    whatsNew: 'Added earning bonus planner.',
  }),
  new Tool({
    id: 'shell-company',
    url: '/shell-company/',
    title: 'Shell company',
    iconUrl: iconURL('wasmegg/shell-company.png'),
    description:
      'Personal and always-up-to-date catalog of all cosmetic items (shell sets, shells, chickens and hats) with ownership and pricing info',
    // Sun Aug 14 02:14:16 UTC 2022
    newUntil: 1660443245000,
  }),

  new Tool({
    id: 'mission-list',
    url: '/mission-list/',
    title: 'Mission list',
    // forever
    updateUntil: 1624548902000,
    description: 'Spaceship & mission parameters list',
    whatsNew: 'Updated for new levels of FTL Epic Research.',
  }),
  new Tool({
    id: 'mission-planner',
    url: '/mission-planner/',
    title: 'Mission planner',
    // Wed Apr 10 08:43:22 UTC 2024
    updateUntil: 1712738602000,
    description: 'Spaceship & mission parameters list',
    whatsNew: 'Added fuel tanks >100T and Henliner',
  }),
  new Tool({
    id: 'consumption-sheet',
    url: '/consumption-sheet/',
    title: 'Consumption sheet',
    description: 'Artifact consumption outcomes',
    // Fri Jul 30 12:32:29 UTC 2021
    updateUntil: 1627648349000,
    whatsNew: 'Added expected gold yield of fully consuming artifacts, and gold yield of demoting uncommon artifacts.',
  }),
  new Tool({
    id: 'events',
    url: '/events/',
    title: 'Events calendar',
    description: 'Filterable calendar of (not so) special events',
    updateUntil: 1638811910000,
    whatsNew: 'It works again.',
  }),
  new Tool({
    id: 'legendary-study',
    url: '/legendary-study/',
    title: 'Legendary study report',
    description: 'See how you fare against other Egg, Inc. players in the legendary artifact department',
    updateUntil: 1638811910000,
    whatsNew: 'It works again.',
  }),

  new Tool({
    id: 'researches',
    url: '/researches/',
    title: 'Researches',
    description: 'Structured data of common and epic researches, customizable by SQL',
  }),

  new Tool({
    id: 'EggLedger',
    url: 'https://github.com/DavidArthurCole/EggLedger#readme',
    title: 'EggLedger',
    iconUrl: iconURL('wasmegg/EggLedger.png'),
    description:
      'Spaceship mission data exporter, supplementing rockets tracker - forked and fixed by @davidarthurcole',
    // Sat Jun 17 16:21 UTC 2023
    newUntil: 1686975703,
    whatsNew: 'Fixed issue with Chrome',
  }),

  new Tool({
    id: 'ebeb',
    url: 'https://ebeb.netlify.app/',
    title: 'Earning Bonus Enhancing Bootcamp',
    iconUrl: iconURL('wasmegg/ebeb.svg'),
    description: 'The shortest path to fame and fortune (terms and conditions may apply)',
    // Tue Jul 20 14:57:17 UTC 2021
    newUntil: 1626793037000,
  }),
  new Tool({
    id: 'fuckify',
    url: 'https://fuckify.vercel.app/',
    title: 'Fuckify Your Screenshot',
    iconUrl: iconURL('wasmegg/fuckify.svg'),
    description: 'Most stylish watermarking tool ever was or ever will be',
  }),
];

export const idToTool = new Map<string, Tool>(tools.map(t => [t.id, t]));

export const newTools = tools.filter(tool => tool.isNew);
export const majorUpdateTools = tools.filter(tool => !tool.isNew && tool.isMajorUpdate);
export const updateTools = tools.filter(tool => !tool.isNew && !tool.isMajorUpdate && tool.isUpdate);

// This is the signature of the what's new section of a particular build. We
// generate a signature so that a user can hide what's new and won't be bothered
// until something changes.
export const updateSignature = generateUpdateSignature();

function generateUpdateSignature(): string {
  let s = '';
  for (const tool of tools) {
    if (tool.newUntil || tool.majorUpdateUntil || tool.updateUntil) {
      s += `${tool}:${tool.newUntil}:${tool.majorUpdateUntil}:${tool.updateUntil}`;
    }
  }
  return hashFNV1a32bit(s).toString(16);
}

// https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function#FNV-1a_hash
// https://datatracker.ietf.org/doc/html/draft-eastlake-fnv-17
function hashFNV1a32bit(s: string): number {
  const prime = 0x01000193;
  const offsetBasis = 0x811c9dc5;
  const uint32max = 0x100000000;
  let hash = offsetBasis;
  const len = s.length;
  for (let i = 0; i < len; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, prime);
  }
  return (hash + uint32max) % uint32max;
}

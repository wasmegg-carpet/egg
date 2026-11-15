// What the type checker sees in place of the loot dataset, by way of the `#loot-dataset` entry in lib's
// package.json. The dataset is 84MB of JSON: imported by path, the checker parses all of it to infer a type
// that `loot-json.ts` then casts away, which is slow in the artifact explorer and runs the ascension
// planner's larger program out of memory. Bundlers take the entry's `default` and load the JSON itself.
declare const data: unknown;
export default data;

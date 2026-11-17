// battle/battle_data_release.dat, loaded once and shared: the Classes & items
// mode edits its tables, and Battles mode changes a stage's unit counts when
// characters are added to or taken out of a battle. Whoever saves writes the
// whole file, so both kinds of change go out together.
//
// Stage table (entry 17, 230-byte rows): +0x11 = how many allied units the
// battle loads, +0x12 = how many others. A unit added to a battle file only
// appears if its side's count is raised too (Deneb cameo v5-v7). The ally count
// equals the allies on the field in the stock battles; the other count also
// covers reinforcements, so counts are changed by the difference, not recounted.

import { encodeDat, loadDat } from './datfile.js';
import { buildPakd, isXlce, parsePakd, parseXlce } from '../lib/pakd.js';

export const BATTLE_DATA = 'battle/battle_data_release.dat';
const STAGES = 17, STAGE_ROW = 230, ALLIES = 0x11, OTHERS = 0x12;
export const ALLY_TEAM = 1;

let shared = null;
let countsTouched = false; // a stage count changed since the last save (cheap check for the Save button)

/** { dat, original }: the file as loaded and its bytes then (or at the last save). */
export function battleData() {
  shared ??= loadDat(BATTLE_DATA).then((dat) => ({ dat, original: dat.pack.slice() }));
  return shared;
}

/** True when the shared file differs from what is on disk. */
export async function battleDataChanged() {
  const { dat, original } = await battleData();
  if (dat.pack.length !== original.length) return true;
  for (let i = 0; i < original.length; i++) if (dat.pack[i] !== original[i]) return true;
  return false;
}

/** The file to write ({ path, bytes, originalSize }), or null if unchanged. */
export async function battleDataFile() {
  if (!(await battleDataChanged())) { countsTouched = false; return null; }
  const { dat } = await battleData();
  return { path: BATTLE_DATA, bytes: await encodeDat(dat.pack, dat.entryName), originalSize: dat.originalSize, dat };
}

/** After the file was written. */
export async function battleDataSaved(bytes, size = bytes.length) {
  const bd = await battleData();
  bd.dat.originalSize = size;
  bd.original = bd.dat.pack.slice();
  countsTouched = false;
}

/** True when a stage count was changed since the last save (it may have been changed back). */
export function countsChanged() { return countsTouched; }

function stageRow(dat, stage) {
  const e = dat.pakd.entries[STAGES];
  if (!e || !isXlce(e.data)) throw new Error('stage table not found');
  const t = parseXlce(e.data);
  if (t.rowSize !== STAGE_ROW || stage < 1 || stage >= t.count) throw new Error(`no stage ${stage}`);
  return t.row(stage);
}

/** A stage's unit counts: { allies, others }. */
export async function stageCounts(stage) {
  const row = stageRow((await battleData()).dat, stage);
  return { allies: row[ALLIES], others: row[OTHERS] };
}

/** Add `delta` to a stage's count for `team`'s side (clamped to 0-255). */
export async function changeStageCount(stage, team, delta) {
  const row = stageRow((await battleData()).dat, stage);
  const at = team === ALLY_TEAM ? ALLIES : OTHERS;
  row[at] = Math.max(0, Math.min(255, row[at] + delta));
  countsTouched = true;
  return row[at];
}

/** Rebuild only replaced tables; other live edits travel with the shared pack. */
export async function replaceBattleTables(replacements) {
  const {dat}=await battleData();
  dat.pack=buildPakd(dat.pakd.entries.map((e,i)=>replacements.get(i)??e.data));
  dat.pakd=parsePakd(dat.pack);countsTouched=true;
}
export function touchBattleData(){countsTouched=true;}

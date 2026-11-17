// AI behaviours: battle data entry 27, 113 rows of 98 bytes (49 signed 16-bit
// weights), one per AI number (a unit's +0x94). Found in the exe (1.0.2.0):
// the think setup (0x2f3510) reads the unit's AI number (unit +0x1D8, getter
// 0x33d6c0; 0 = player-controlled and Charmed units use row 7), copies the row's
// first 88 bytes into the AI workspace, and the outcome scorer (0x3c33e0) weighs
// every simulated result of an action with them:
//   +0x02 damage dealt (x min(damage, HP))       +0x0A damage to its own side (negative)
//   +0x06 % of the target's HP the damage takes
//   +0x12 a status put on its own side (buffs)   +0x14 a status put on an enemy (ailments)
//   +0x1A HP healed                              +0x2A/+0x30/+0x3C/+0x40/+0x4C positioning
// A status is scored as target max HP x the status's AI value (status table,
// entry 26, +0x70) / 100 x the weight x the hit chance; harmful statuses
// (+0x0B = 1) are never put on the AI's own side, and a status the target
// already has scores nothing. Shipped values make damage win about 2:1 over
// Sleep or Poison, which is why enemy casters rarely use their status spells.
//
// The "Status-focused AI behaviours" integrated mod adds two rows after the
// game's own, so no existing AI number changes.

export const AI_ENTRY = 27;
export const AI_ROW = 98;
export const STOCK_AI_ROWS = 113;
export const W = { friendlyDamage: 0x0A, damage: 0x02, damagePercent: 0x06, buffAllies: 0x12, ailmentsEnemies: 0x14, heal: 0x1A };

export const BEHAVIOURS = [
  {
    key: 'support',
    name: 'Support: buffs its own side',
    base: 53, // the common cleric AI: heals, keeps back from melee
    set: { [W.buffAllies]: 300, [W.friendlyDamage]: -2000 }, // 85 in the cleric AI
    about: 'Puts beneficial statuses (Quicken, Strengthen, elemental attunements...) on its allies before anything else, still heals the hurt, and attacks only when there is nothing to buff.',
  },
  {
    key: 'ailments',
    name: 'Ailments: statuses on enemies',
    base: 63, // the common wizard AI: casts from range
    // wizard AI: 125, 125, 100. Damage also scores the % of HP it takes (+0x06), so with
    // 600/60 a fireball still beat a 35%-chance Sleep (first in-game test, Almorica)
    set: { [W.ailmentsEnemies]: 1500, [W.damage]: 30, [W.damagePercent]: 30, [W.friendlyDamage]: -2000 },
    about: 'Casts harmful statuses (Sleep, Poison, Slow, Stun, Petrify...) on enemies who don\'t already have them, and falls back to damage when none is worth it.',
  },
];

/** The row a behaviour adds, built from its base row in `table` (parseXlce of entry 27). */
export function behaviourRow(table, b) {
  const row = table.row(b.base).slice();
  const v = new DataView(row.buffer, row.byteOffset, row.byteLength);
  for (const [offset, value] of Object.entries(b.set)) v.setInt16(Number(offset), value, true);
  return row;
}

/** AI number -> behaviour for the rows the mod added (they match what it writes). */
export function addedBehaviours(table) {
  const out = new Map();
  BEHAVIOURS.forEach((b, k) => {
    const id = STOCK_AI_ROWS + k;
    if (id >= table.count) return;
    const want = behaviourRow(table, b), have = table.row(id);
    const previous=want.slice();new DataView(previous.buffer).setInt16(W.friendlyDamage,new DataView(table.row(b.base).buffer,table.row(b.base).byteOffset).getInt16(W.friendlyDamage,true),true);
    if (want.every((x, i) => x === have[i])||previous.every((x,i)=>x===have[i])) out.set(id, b);
  });
  return out;
}

// What the game's own AI numbers are used for (most common classes in the stock battles)
const FAMILIES = [
  [[11, 15], 'Melee'], [[18, 20], 'Beasts, dragons'], [[21, 29], 'Archers'], [[31, 35], 'Rune fencers, terror knights'],
  [[37, 40], 'Beast tamers'], [[41, 50], 'Knights'], [[51, 59], 'Clerics'], [[61, 70], 'Wizards, warlocks'],
];

/** Labels for the AI field: the stock families, the added behaviours, and plain numbers otherwise. */
export function aiLabels(table, trapProfile=0) {
  const added = table ? addedBehaviours(table) : new Map();
  const count = table?.count ?? STOCK_AI_ROWS;
  const out = [];
  for (let id = 0; id < count; id++) {
    let name;
    if (id === 0) name = 'Player-controlled';
    else if (id === 7) name = 'Default (also used while Charmed)';
    else if (id === 74) name = 'AI guest (warrior)';
    else if (id === 75) name = 'AI guest (priest)';
    else if (id === trapProfile) name = 'Trap AI';
    else if (added.has(id)) name = `${added.get(id).name} (added)`;
    else {
      const f = FAMILIES.find(([[a, z]]) => id >= a && id <= z);
      name = f ? `${f[1]} ${id - f[0][0] + 1}` : `AI ${id}`;
    }
    out.push({ id, name });
  }
  return out;
}

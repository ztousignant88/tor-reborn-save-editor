// Layout of the decoded main save block (tag 0x10000001), as worked out for
// this game build (payload version 0x81000102, 383,896 bytes). Offsets are
// documented in save-editor/README.md together with how each was confirmed.

export const LAYOUT_SIZE = 383896;

export const HEADER = {
  goth: 0x50,          // u32, Goth (30,000 at the start of a new game)
  armyName: 0x54,      // army/clan name, text
  armyNameSize: 33,    // 32 bytes + NUL (0x85 onward holds other data)
};

export const UNIT = {
  start: 0xC6, size: 0x7B5, slots: 105,
  usable: 100,         // slots 100-104 hold game-reserved data; never fill them
  present: 0x00,       // 1 = slot in use
  name: 0x01, nameSize: 37,
  template: 0x3F,      // u16 unit template: race and look (Hawkman 1, Lamia 4, a story character...)
  portrait: 0x43,      // u16 portrait id
  index: 0x41,         // u16 = slot number
  index2: 0x90,        // u8 = slot number
  finishers: 0x73,     // 8 x u16
  luck: 0x83, loyalty: 0x84,
  cls: 0x88, level: 0x89, element: 0x8C,
  clan: 0x8D,          // bits 0-2 clan, bits 3-4 alignment (1 Lawful, 2 Neutral, 3 Chaotic)
  equipment: 0x93,     // 7 x u16 item ids
  skills: 0xF0, skillCount: 4, skillStride: 6, // u16 id, u8 rank, (pad), u16 xp; the game shows 4 slots
  ranks: 0x251, rankCount: 100, rankStride: 8,  // per skill id: u8 rank, 3 pad, u32 xp (weapon skills 1-21)
  learned: 0x1D1,      // 800-bit set: skills unlocked by level, across all classes
  kept: 0x675,         // 800-bit set: current class's skill list (the skill screen); entries not
                       // in 'learned' persist across class change (Bodysnatch)
  setLevels: 0x575, setCount: 64, // u8 level kept per class skill set (class +0x53); the unit keeps
                       // that set's skills up to this level in any class (Bodysnatch units: 50s)
  spells: 0x12C,       // 4 x u16 item ids (spellbooks, 1000 + commodity)
  items: 0x134,        // 4 x u16 item ids (consumables)
  levelCopy: 0x156,    // u16, mirrors level
};

export const STATS = ['HP', 'MP', 'STR', 'VIT', 'DEX', 'AGI', 'AVD', 'INT', 'MND', 'RES'];
const statOffsets = (hp, mp, first) => [hp, mp, ...Array.from({ length: 8 }, (_, k) => first + 2 * k)];
// Each part is stored x10; total = (base + growth + random + extra) / 10, plus
// equipment for HP/MP. "total" is what the game shows and is kept in step.
export const STAT_PARTS = {
  total: statOffsets(0x158, 0x15A, 0x15C),
  base: statOffsets(0x1BC, 0x16E, 0x170),
  growth: statOffsets(0x1C0, 0x182, 0x184),
  random: statOffsets(0x1C4, 0x196, 0x198),
  extra: statOffsets(0x1C8, 0x1AA, 0x1AC),
};
export const EDITABLE_PARTS = ['base', 'growth', 'random', 'extra'];

export const SLOT_NAMES = ['Right hand', 'Left hand', 'Head', 'Body', 'Arms', 'Feet', 'Accessory'];
// armament item_type (+0x02) allowed in each slot
const WEAPON_TYPES = new Set([1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21]);
export const SLOT_TYPES = [
  (t) => WEAPON_TYPES.has(t),
  (t) => WEAPON_TYPES.has(t) || t === 22,
  (t) => t === 23, (t) => t === 24, (t) => t === 25, (t) => t === 27, (t) => t === 29,
];

// Inventory (known layout only)
export const INVENTORY = {
  arms: 0x32C83, armsCount: 761,         // u16 stock per equipment id
  items: 0x33275, itemsCount: 1000,      // u16 stock per item id - 1000
  customOwned: 0x33A45,                  // 1000-bit set: relic copy owned (equipped or not)
  namedOwned: 0x33AC2,                   // 85-bit set: named weapon owned
  named: 0x33ACD, namedStride: 0x51, namedCount: 85, // +1: name text
  // Relic copies (equipment id 3000+n). +0: u16 base relic id; then u16 stat
  // bonuses the game adds onto the base item's stats (rolled per drop, raised
  // by upgrading; 0-15 seen). Relics never use the plain stock counts.
  custom: 0x35712, customStride: 94, customCount: 1000,
  relicBonusFirst: 2, relicBonusEnd: 0x32,  // the bonus words every relic record fills
};
export const NAMED_BASE = 2000, CUSTOM_BASE = 3000;

// Story progress values (known layout only). Found by comparing new-game,
// early and late saves: Union Level 5 early (matches guides for the Almorica
// battle) and 50 late (the max); Chariot rewind limit 10 early, 50 late.
export const PROGRESS = {
  unionLevel: 0x4DB2D,   // u8: units can't level past this
  chariotTurns: 0x4DB2E, // u8: how many turns the Chariot Tarot can rewind
};

/**
 * Snapshot (cursed) weapon record, 0x51 bytes at INVENTORY.named + 0x51*n,
 * equipment id 2000+n. The weapon type is fixed by the slot: n/5 picks one of
 * 17 "Cursed Weapon" base items (0x262+n/5), so each type has 5 slots.
 * The game copies the stat bytes straight onto the base item (exe 0x43E8C0;
 * HP..RES are capped at 127 there). +0x3A..+0x3C are not read by that code.
 */
export const SNAPSHOT = {
  present: 0x00, name: 0x01, nameSize: 0x39, nameMax: 16, extra: 0x3A,
  stats: [ // [key, offset, label, max]
    ['rt', 0x3D, 'RT', 255], ['atk', 0x3E, 'ATK', 255], ['def', 0x3F, 'DEF', 255],
    ['hp', 0x40, 'HP', 127], ['mp', 0x41, 'MP', 127], ['str', 0x42, 'STR', 127], ['vit', 0x43, 'VIT', 127],
    ['dex', 0x44, 'DEX', 127], ['agi', 0x45, 'AGI', 127], ['avd', 0x46, 'AVD', 127], ['int', 0x47, 'INT', 127],
    ['mnd', 0x48, 'MND', 127], ['res', 0x49, 'RES', 127],
    ['damageType', 0x4A, 'Damage type', 255], ['damageBonus', 0x4B, 'Damage type bonus %', 255],
    ['obstacle', 0x4C, 'Damage to obstacles', 255],
    ['race', 0x4D, 'Race', 255], ['raceBonus', 0x4E, 'Race bonus %', 255],
    ['element', 0x4F, 'Element', 255], ['elementBonus', 0x50, 'Element bonus %', 255],
  ],
  perType: 5, types: 17, baseItem: 0x262,
};
/** Warren Report army statistics, stored as u32 values in the mapped save layout. */
export const WARREN = {
  fields: [ // [key, offset, label]
    ['battles', 0x5AE9A, 'Battles'], ['victories', 0x5AE9E, 'Victories'],
    ['alliesDown', 0x5AEA6, 'Allies Incapacitated'], ['alliesSlain', 0x5AEAA, 'Allies Slain'],
    ['campaignDays', 0x5AED2, 'Campaign days'], ['chariotUses', 0x5AFFA, 'Chariot Tarot uses'],
    ['fundsIn', 0x5AED6, 'War Funds Collected'], ['fundsOut', 0x5AEDA, 'War Funds Spent'],
  ],
  enemiesTotal: 0x5AEAE,
  // enemies slain by faction; the save keeps Unknown first
  enemies: [['Walister', 0x5AEB6], ['Galgastan', 0x5AEBA], ['Bakram', 0x5AEBE], ['Xenobia', 0x5AEC2],
    ['Lodis', 0x5AEC6], ['Bolmocca', 0x5AECA], ['Balboede', 0x5AECE], ['Unknown', 0x5AEB2]],
  playFrames: 0x4DCB3, // u32 play time in 1/60 s (unaligned)
};
/** Chaos Frame entries store faction reputation from 0 to 100, in screen order.
 * The older copy at 0x4DB26..0x4DB2C is preserved. */
export const CHAOS_FRAME = [['Walister', 0x5D985], ['Galgastan', 0x5D986], ['Bakram', 0x5D987], ['Xenobia', 0x5D988],
  ['Lodis', 0x5D989], ['Bolmocca', 0x5D98A], ['Balboede', 0x5D98B]];
export const MAX_STOCK = 999; // the user's endgame saves hold up to 999

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

export class SaveData {
  constructor(bytes) {
    this.bytes = new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.knownLayout = this.bytes.length === LAYOUT_SIZE;
  }
  u8(o) { return this.bytes[o]; }
  u16(o) { return this.view.getUint16(o, true); }
  u32(o) { return this.view.getUint32(o, true); }
  setU8(o, v) { this.bytes[o] = v; }
  setU16(o, v) { this.view.setUint16(o, v, true); }
  setU32(o, v) { this.view.setUint32(o, v >>> 0, true); }
  text(o, size) {
    const raw = this.bytes.subarray(o, o + size);
    const end = raw.indexOf(0);
    return dec.decode(raw.subarray(0, end < 0 ? size : end));
  }
  setText(o, size, value) {
    const b = fitText(value, size - 1);
    this.bytes.fill(0, o, o + size);
    this.bytes.set(b, o);
  }

  get version() { return [...this.bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  get goth() { return this.u32(HEADER.goth); }
  set goth(v) { this.setU32(HEADER.goth, Math.max(0, Math.min(99999999, v | 0))); }
  get armyName() { return this.text(HEADER.armyName, HEADER.armyNameSize); }
  set armyName(v) { this.setText(HEADER.armyName, HEADER.armyNameSize, v); }
  // ---- progress (known layout only) ----
  get unionLevel() { return this.knownLayout ? this.u8(PROGRESS.unionLevel) : 0; }
  set unionLevel(v) { if (this.knownLayout) this.setU8(PROGRESS.unionLevel, Math.max(1, Math.min(50, v | 0))); }
  get chariotTurns() { return this.knownLayout ? this.u8(PROGRESS.chariotTurns) : 0; }
  set chariotTurns(v) { if (this.knownLayout) this.setU8(PROGRESS.chariotTurns, Math.max(1, Math.min(50, v | 0))); }

  // ---- Warren Report and Chaos Frame (known layout only) ----
  warren(key) { const f = WARREN.fields.find((x) => x[0] === key); return this.u32(f[1]); }
  setWarren(key, v) { const f = WARREN.fields.find((x) => x[0] === key); this.setU32(f[1], Math.max(0, Math.min(0xFFFFFFFF, Math.floor(v) || 0))); }
  enemiesSlain(offset) { return this.u32(offset); }
  /** Set one faction's kills; the total is kept equal to the sum, as the game keeps it. */
  setEnemiesSlain(offset, v) {
    this.setU32(offset, Math.max(0, Math.min(99999999, Math.floor(v) || 0)));
    this.setU32(WARREN.enemiesTotal, WARREN.enemies.reduce((t, [, o]) => t + this.u32(o), 0));
  }
  get enemiesTotal() { return this.u32(WARREN.enemiesTotal); }
  get playFrames() { return this.u32(WARREN.playFrames); }
  set playFrames(v) { this.setU32(WARREN.playFrames, Math.max(0, Math.min(0xFFFFFFFF, Math.floor(v) || 0))); }
  chaos(offset) { return this.u8(offset); }
  setChaos(offset, v) { this.setU8(offset, Math.max(0, Math.min(100, Math.floor(v) || 0))); }

  unitOffset(slot) { return UNIT.start + slot * UNIT.size; }
  unit(slot) { return new Unit(this, slot); }
  units() {
    const out = [];
    for (let s = 0; s < UNIT.slots; s++) if (this.u8(this.unitOffset(s) + UNIT.present)) out.push(this.unit(s));
    return out;
  }
  unitCount() { return this.units().filter((u) => u.slot < UNIT.usable).length; }

  // ---- inventory ----
  /**
   * Equipment stock is the total owned, worn pieces included (in the user's
   * saves every worn piece's stock is >= the number of units wearing it).
   * Spare = stock - worn.
   */
  armsStock(id) { return this.u16(INVENTORY.arms + 2 * id); }
  wornCount(id) {
    let n = 0;
    for (const u of this.units()) for (const e of u.equipment) if (e === id) n++;
    return n;
  }
  /** Make sure stock covers every worn piece (a piece put on a unit counts as owned). */
  coverWorn(id) {
    if (!this.knownLayout || !(id > 0 && id < 1000)) return;
    const worn = this.wornCount(id);
    if (this.armsStock(id) < worn) this.setArmsStock(id, worn);
  }
  setArmsStock(id, n) { this.setU16(INVENTORY.arms + 2 * id, clampStock(n)); }
  itemStock(id) { return this.u16(INVENTORY.items + 2 * (id - 1000)); }
  setItemStock(id, n) { this.setU16(INVENTORY.items + 2 * (id - 1000), clampStock(n)); }
  bit(base, i) { return (this.bytes[base + (i >> 3)] >> (i & 7)) & 1; }
  customOwned(i) { return this.bit(INVENTORY.customOwned, i); }
  namedOwned(i) { return this.bit(INVENTORY.namedOwned, i); }
  customBase(i) { return this.u16(INVENTORY.custom + INVENTORY.customStride * i); }
  namedName(i) { return this.text(INVENTORY.named + INVENTORY.namedStride * i + 1, INVENTORY.namedStride - 1); }
  /** Base equipment id a slot value stands for (for its type and name). */
  baseOf(id) {
    if (!id || id === 0xFFFF) return 0;
    if (id < 1000) return id;
    if (id >= NAMED_BASE && id < NAMED_BASE + INVENTORY.namedCount) return 0x262 + Math.floor((id - NAMED_BASE) / 5);
    if (id >= CUSTOM_BASE && id < CUSTOM_BASE + INVENTORY.customCount && this.knownLayout) return this.customBase(id - CUSTOM_BASE);
    return 0;
  }
  setBit(base, i, on) { const at = base + (i >> 3), b = 1 << (i & 7); this.bytes[at] = on ? this.bytes[at] | b : this.bytes[at] & ~b; }
  /** Bonus words of relic copy i. */
  relicBonuses(i) {
    const o = INVENTORY.custom + INVENTORY.customStride * i, out = [];
    for (let k = INVENTORY.relicBonusFirst; k < INVENTORY.relicBonusEnd; k += 2) out.push(this.u16(o + k));
    return out;
  }
  setRelicBonuses(i, value) {
    const o = INVENTORY.custom + INVENTORY.customStride * i, v = Math.max(0, Math.min(15, value | 0));
    for (let k = INVENTORY.relicBonusFirst; k < INVENTORY.relicBonusEnd; k += 2) this.setU16(o + k, v);
  }
  /**
   * Add one relic copy of `base`. It copies an owned copy of the same relic
   * when there is one (like a duplicate drop), otherwise it writes a clean
   * record with every bonus set to `bonus`. Returns the new equipment id.
   */
  addRelic(base, bonus = 0) {
    const used = this.equippedSpecial();
    let free = -1, donor = -1;
    for (let i = 0; i < INVENTORY.customCount; i++) {
      const owned = this.customOwned(i);
      if (!owned && free < 0 && !used.has(CUSTOM_BASE + i)) free = i;
      if (owned && donor < 0 && this.customBase(i) === base) donor = i;
    }
    if (free < 0) throw new Error('All 1000 relic slots are in use.');
    const stride = INVENTORY.customStride, to = INVENTORY.custom + stride * free;
    if (donor >= 0) this.bytes.copyWithin(to, INVENTORY.custom + stride * donor, INVENTORY.custom + stride * (donor + 1));
    else { this.bytes.fill(0, to, to + stride); this.setU16(to, base); this.setRelicBonuses(free, bonus); }
    this.setBit(INVENTORY.customOwned, free, true);
    return CUSTOM_BASE + free;
  }
  /** First relic slot that is not owned and not equipped, or -1. */
  freeRelicSlot() {
    const used = this.equippedSpecial();
    for (let i = 0; i < INVENTORY.customCount; i++) if (!this.customOwned(i) && !used.has(CUSTOM_BASE + i)) return i;
    return -1;
  }

  // ---- character export / import ----
  /**
   * A unit packed for another save: its whole record, plus copies of the
   * relic and snapshot weapon records it has equipped (their equipment ids
   * only mean something inside this save).
   */
  exportUnit(slot) {
    const u = this.unit(slot), o = this.unitOffset(slot);
    const pack = { record: this.bytes.slice(o, o + UNIT.size), relics: [], snapshots: [] };
    if (!this.knownLayout) return pack;
    u.equipment.forEach((id, k) => {
      if (id >= CUSTOM_BASE && id < CUSTOM_BASE + INVENTORY.customCount) {
        const ro = INVENTORY.custom + INVENTORY.customStride * (id - CUSTOM_BASE);
        pack.relics.push({ slot: k, record: this.bytes.slice(ro, ro + INVENTORY.customStride) });
      } else if (id >= NAMED_BASE && id < NAMED_BASE + INVENTORY.namedCount) {
        const n = id - NAMED_BASE, so = this.snapshotOffset(n);
        pack.snapshots.push({ slot: k, type: Math.floor(n / SNAPSHOT.perType), record: this.bytes.slice(so, so + INVENTORY.namedStride) });
      }
    });
    return pack;
  }
  /**
   * Put a packed unit into this save: a new slot (replaceSlot null) or over
   * an existing unit. Its relics and snapshot weapons are re-created in free
   * slots here; any that don't fit are unequipped. Returns {unit, notes}.
   */
  importUnit(pack, replaceSlot = null) {
    if (!(pack.record instanceof Uint8Array) || pack.record.length !== UNIT.size || !pack.record[UNIT.present]) throw new Error('That file does not hold a unit.');
    const count = this.unitCount();
    let slot;
    if (replaceSlot === null) {
      if (count >= UNIT.usable) throw new Error(`The roster is full (${UNIT.usable} units).`);
      slot = count;
    } else {
      if (replaceSlot < 0 || replaceSlot >= count) throw new Error('No unit in that slot.');
      slot = replaceSlot;
      // the replaced unit's plain gear simply becomes spare: stock already counts it
    }
    const o = this.unitOffset(slot);
    this.bytes.set(pack.record, o);
    const u = this.unit(slot);
    u.setIndex(slot);
    const notes = [];
    // drop every special id first: they point into the other save's tables
    u.equipment.forEach((id, k) => { if (id >= NAMED_BASE && id !== 0xFFFF) u.setEquipment(k, 0); });
    // the plain gear the unit brings becomes owned here
    for (const id of u.equipment) this.coverWorn(id);
    const specials = (pack.relics?.length ?? 0) + (pack.snapshots?.length ?? 0);
    if (!this.knownLayout) {
      if (specials) notes.push('This save has a different layout, so relics and snapshot weapons were left off.');
      return { unit: u, notes };
    }
    for (const r of pack.relics ?? []) {
      const n = this.freeRelicSlot();
      if (n < 0) { notes.push('No free relic slot: a relic was left off.'); continue; }
      this.bytes.set(r.record.subarray(0, INVENTORY.customStride), INVENTORY.custom + INVENTORY.customStride * n);
      this.setBit(INVENTORY.customOwned, n, true);
      u.setEquipment(r.slot, CUSTOM_BASE + n);
    }
    for (const s of pack.snapshots ?? []) {
      const n = this.freeSnapshotSlot(s.type);
      if (n < 0) { notes.push(`No free snapshot slot for that weapon type: "${dec.decode(s.record.subarray(1, SNAPSHOT.nameSize)).split('\0')[0]}" was left off.`); continue; }
      this.bytes.set(s.record.subarray(0, INVENTORY.namedStride), this.snapshotOffset(n));
      this.setBit(INVENTORY.namedOwned, n, true);
      u.setEquipment(s.slot, NAMED_BASE + n);
    }
    return { unit: u, notes };
  }

  /** Drop relic copy i (it must not be equipped). */
  removeRelic(i) {
    if (this.equippedSpecial().has(CUSTOM_BASE + i)) throw new Error('That relic is equipped. Unequip it first.');
    this.setBit(INVENTORY.customOwned, i, false);
  }
  // ---- snapshot (cursed) weapons ----
  snapshotOffset(n) { return INVENTORY.named + INVENTORY.namedStride * n; }
  /** Snapshot weapon n as {name, type (0-16), rt, atk, ...}. */
  snapshot(n) {
    const o = this.snapshotOffset(n);
    const s = { n, name: this.text(o + SNAPSHOT.name, SNAPSHOT.nameSize), type: Math.floor(n / SNAPSHOT.perType) };
    for (const [key, off] of SNAPSHOT.stats) s[key] = this.u8(o + off);
    return s;
  }
  /** Write name and stats of snapshot weapon n (it stays in its slot, so its type can't change). */
  setSnapshot(n, s) {
    const o = this.snapshotOffset(n);
    this.setText(o + SNAPSHOT.name, SNAPSHOT.nameSize, String(s.name ?? '').slice(0, SNAPSHOT.nameMax));
    // byte range only: values the game itself stored above the 127 cap stay as they are unless edited
    for (const [key, off] of SNAPSHOT.stats) if (s[key] !== undefined) this.setU8(o + off, Math.max(0, Math.min(255, s[key] | 0)));
  }
  /** Free slot of a weapon type (0-16), or -1 when its 5 slots are full. */
  freeSnapshotSlot(type) {
    const used = this.equippedSpecial();
    for (let n = type * SNAPSHOT.perType; n < (type + 1) * SNAPSHOT.perType; n++) {
      if (!this.namedOwned(n) && !used.has(NAMED_BASE + n) && !this.u8(this.snapshotOffset(n))) return n;
    }
    return -1;
  }
  /** Make a new snapshot weapon of a type. Returns its slot n. */
  createSnapshot(type, s) {
    const n = this.freeSnapshotSlot(type);
    if (n < 0) throw new Error('All 5 snapshot slots for this weapon type are in use. Delete one first.');
    const o = this.snapshotOffset(n);
    // the three bytes the stat code skips: copy them from a weapon the game made, if any
    let donor = -1;
    for (let k = 0; k < INVENTORY.namedCount && donor < 0; k++) if (this.namedOwned(k)) donor = k;
    const extra = donor >= 0 ? this.bytes.slice(this.snapshotOffset(donor) + SNAPSHOT.extra, this.snapshotOffset(donor) + SNAPSHOT.extra + 3) : new Uint8Array([2, 0, 1]);
    this.bytes.fill(0, o, o + INVENTORY.namedStride);
    this.setU8(o + SNAPSHOT.present, 1);
    this.bytes.set(extra, o + SNAPSHOT.extra);
    this.setSnapshot(n, s);
    this.setBit(INVENTORY.namedOwned, n, true);
    return n;
  }
  /** Remove snapshot weapon n (it must not be equipped). */
  deleteSnapshot(n) {
    if (this.equippedSpecial().has(NAMED_BASE + n)) throw new Error('That weapon is equipped. Unequip it first.');
    const o = this.snapshotOffset(n);
    this.bytes.fill(0, o, o + INVENTORY.namedStride);
    this.setBit(INVENTORY.namedOwned, n, false);
  }
  /** Ids of named/custom pieces any unit has equipped. */
  equippedSpecial() {
    const used = new Set();
    for (const u of this.units()) for (const id of u.equipment) if (id >= NAMED_BASE) used.add(id);
    return used;
  }

  // ---- roster changes ----
  /** Copy a unit into the next free slot. Returns the new Unit. */
  duplicateUnit(slot, name) {
    const count = this.unitCount();
    if (count >= UNIT.usable) throw new Error(`The roster is full (${UNIT.usable} units).`);
    const from = this.unitOffset(slot), to = this.unitOffset(count);
    this.bytes.copyWithin(to, from, from + UNIT.size);
    const copy = this.unit(count);
    copy.setIndex(count);
    // named and custom pieces exist once; the copy starts without them
    const eq = copy.equipment;
    eq.forEach((id, k) => { if (id >= 1000 && id !== 0xFFFF) copy.setEquipment(k, 0); });
    if (name) copy.name = name;
    return copy;
  }
  /** Remove a unit and close the gap, like the game's own packed roster. */
  removeUnit(slot) {
    const count = this.unitCount();
    if (slot <= 0 || slot >= count) throw new Error('That unit cannot be removed.');
    // the unit's plain gear stays owned: stock already counts worn pieces
    for (let s = slot; s < count - 1; s++) {
      this.bytes.copyWithin(this.unitOffset(s), this.unitOffset(s + 1), this.unitOffset(s + 1) + UNIT.size);
      this.unit(s).setIndex(s);
    }
    this.bytes.fill(0, this.unitOffset(count - 1), this.unitOffset(count - 1) + UNIT.size);
  }
}

export class Unit {
  constructor(save, slot) { this.save = save; this.slot = slot; this.o = save.unitOffset(slot); }
  get name() { return this.save.text(this.o + UNIT.name, UNIT.nameSize); }
  set name(v) { this.save.setText(this.o + UNIT.name, UNIT.nameSize, v); }
  get portrait() { return this.save.u16(this.o + UNIT.portrait); }
  set portrait(v) { this.save.setU16(this.o + UNIT.portrait, v); }
  get clan() { return this.save.u8(this.o + UNIT.clan) & 7; }
  set clan(v) { const b = this.save.u8(this.o + UNIT.clan); this.save.setU8(this.o + UNIT.clan, (b & ~7) | (v & 7)); }
  get alignment() { return (this.save.u8(this.o + UNIT.clan) >> 3) & 3; }
  set alignment(v) { const b = this.save.u8(this.o + UNIT.clan); this.save.setU8(this.o + UNIT.clan, (b & ~0x18) | ((v & 3) << 3)); }
  setFinisher(k, id) { this.save.setU16(this.o + UNIT.finishers + 2 * k, id); }

  /** Skill ids in one of the two learned-skill bit sets ('learned' or 'kept'). */
  skillSet(which) {
    const base = this.o + UNIT[which], out = [];
    for (let i = 0; i < 800; i++) if ((this.save.bytes[base + (i >> 3)] >> (i & 7)) & 1) out.push(i);
    return out;
  }
  setSkillBit(which, id, on) {
    const at = this.o + UNIT[which] + (id >> 3), bit = 1 << (id & 7);
    this.save.bytes[at] = on ? this.save.bytes[at] | bit : this.save.bytes[at] & ~bit;
  }
  /** Level kept for a class skill set (0 = none). */
  setLevel(set) { return this.save.u8(this.o + UNIT.setLevels + set); }
  setSetLevel(set, v) { this.save.setU8(this.o + UNIT.setLevels + set, Math.max(0, Math.min(99, v | 0))); }
  /** Rank table entry (weapon skills use their weapon type as id). */
  rank(id) {
    const at = this.o + UNIT.ranks + UNIT.rankStride * id;
    return { rank: this.save.u8(at), xp: this.save.u32(at + 4) };
  }
  setRank(id, rank) {
    if (!isWeaponSkill(id)) return;
    rank = Math.max(0, Math.min(255, rank | 0));
    this.save.setU8(this.o + UNIT.ranks + UNIT.rankStride * id, rank);
    for (let k = 0; k < UNIT.skillCount; k++) if (this.skill(k).id === id) this.save.setU8(this.o + UNIT.skills + UNIT.skillStride * k + 2, rank);
  }
  get template() { return this.save.u16(this.o + UNIT.template); }
  get cls() { return this.save.u8(this.o + UNIT.cls); }
  set cls(v) { this.save.setU8(this.o + UNIT.cls, v); }
  get level() { return this.save.u8(this.o + UNIT.level); }
  set level(v) { v = Math.max(1, Math.min(99, v | 0)); this.save.setU8(this.o + UNIT.level, v); this.save.setU16(this.o + UNIT.levelCopy, v); }
  get loyalty() { return this.save.u8(this.o + UNIT.loyalty); }
  set loyalty(v) { this.save.setU8(this.o + UNIT.loyalty, Math.max(0, Math.min(100, v | 0))); }
  get luck() { return this.save.u8(this.o + UNIT.luck); }
  set luck(v) { this.save.setU8(this.o + UNIT.luck, Math.max(0, Math.min(255, v | 0))); }
  get element() { return this.save.u8(this.o + UNIT.element); }
  set element(v) { this.save.setU8(this.o + UNIT.element, v); }
  setIndex(slot) { this.save.setU16(this.o + UNIT.index, slot); this.save.setU8(this.o + UNIT.index2, slot); }

  get equipment() { return Array.from({ length: 7 }, (_, k) => this.save.u16(this.o + UNIT.equipment + 2 * k)); }
  setEquipment(k, id) { this.save.setU16(this.o + UNIT.equipment + 2 * k, id); }
  get spells() { return Array.from({ length: 4 }, (_, k) => this.save.u16(this.o + UNIT.spells + 2 * k)); }
  setSpell(k, id) { this.save.setU16(this.o + UNIT.spells + 2 * k, id); }
  get items() { return Array.from({ length: 4 }, (_, k) => this.save.u16(this.o + UNIT.items + 2 * k)); }
  setItem(k, id) { this.save.setU16(this.o + UNIT.items + 2 * k, id); }
  get finishers() { return Array.from({ length: 8 }, (_, k) => this.save.u16(this.o + UNIT.finishers + 2 * k)); }

  skill(k) {
    const at = this.o + UNIT.skills + UNIT.skillStride * k;
    return { id: this.save.u16(at), rank: this.save.u8(at + 2), xp: this.save.u16(at + 4) };
  }
  /** Equip a skill in slot k. Rank and XP come from the unit's rank table, like the game's cache. */
  setSkill(k, { id, rank }) {
    const at = this.o + UNIT.skills + UNIT.skillStride * k;
    if (id !== undefined) {
      this.save.setU16(at, id);
      const r = isWeaponSkill(id) ? this.rank(id) : { rank: id ? 1 : 0, xp: 0 };
      this.save.setU8(at + 2, id ? Math.max(1, r.rank) : 0);
      this.save.setU16(at + 4, id ? Math.min(0xFFFF, r.xp) : 0);
    }
    if (rank !== undefined) {
      const sid = this.save.u16(at);
      this.save.setU8(at + 2, Math.max(0, Math.min(255, rank | 0)));
      if (isWeaponSkill(sid)) this.save.setU8(this.o + UNIT.ranks + UNIT.rankStride * sid, Math.max(0, Math.min(255, rank | 0)));
    }
  }

  stat(part, s) { return this.save.u16(this.o + STAT_PARTS[part][s]); }
  /** Set one stored part (x10 units) and move the shown total by the same amount. */
  setStat(part, s, value) {
    value = Math.max(0, Math.min(65535, Math.round(value)));
    const before = this.stat(part, s);
    this.save.setU16(this.o + STAT_PARTS[part][s], value);
    const sum = (u) => EDITABLE_PARTS.reduce((t, p) => t + u.stat(p, s), 0);
    const total = this.stat('total', s);
    const delta = Math.trunc(sum(this) / 10) - Math.trunc((sum(this) - value + before) / 10);
    this.save.setU16(this.o + STAT_PARTS.total[s], Math.max(1, Math.min(65535, total + delta)));
  }
}

/** Weapon skills (ids 1-21 = weapon types) keep their rank in the unit's rank table. */
export const isWeaponSkill = (id) => id >= 1 && id <= 21;

function clampStock(n) { return Math.max(0, Math.min(MAX_STOCK, n | 0)); }

/** UTF-8 bytes of value, cut at a character boundary to fit max bytes. */
export function fitText(value, max) {
  let b = enc.encode(value ?? '');
  while (b.length > max) { value = value.slice(0, -1); b = enc.encode(value); }
  return b;
}

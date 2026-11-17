// TO:R Save Editor page. Game names come from the TO:R Editor's table loader
// (served read-only from /js); the save itself is decoded by the local server.

import { GameTables, ELEMENTS, CLANS, ALIGNMENTS, previewPalette } from '/js/game/tables.js';
import { characterPortrait } from '/js/game/customcharacters.js';
import { readFileRegistry } from '/js/lib/filetable.js';
import { loadTexts } from '/js/game/texts.js';
import { loadActorFrame } from '/js/game/unitsprites.js';
import { itemArt, abilityArt } from '/js/ui/iconart.js';
import { rgbaCanvas, textureCanvas } from '/js/ui/texcanvas.js';
import { loadIconArchive } from '/js/game/icons.js';
import {
  SaveData, UNIT, STATS, EDITABLE_PARTS, SLOT_NAMES, SLOT_TYPES, INVENTORY,
  NAMED_BASE, CUSTOM_BASE, MAX_STOCK, SNAPSHOT,
} from './saveformat.js';

const API = { 'X-TOR-Editor': '1' };
const $ = (id) => document.getElementById(id);

const state = {
  tables: null, armsType: [], saves: [], gameRunning: false,
  name: null, sha: null, original: null, data: null, slot: 0, dirty: false,
  syncStock: true, invFilter: '', invOwnedOnly: true, tab: 'units',
  relics: new Set(), relicBonus: 0, // relic equipment ids; bonus for a brand-new relic copy
};

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'tip' || k === 'title') { if (v) tips.set(el, v); continue; } // hover text: see tooltips below
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fmt = (n) => Number(n).toLocaleString('en-US');

// ---------------------------------------------------------------- tooltips
/**
 * Hover text. An element's tip is a string, a {title, text, lines} object, or a
 * function returning either (worked out only when shown). Labels, table
 * headings and card titles without a tip of their own get FIELD_HELP by text.
 */
const tips = new WeakMap();
const tipBox = document.createElement('div');
tipBox.className = 'tip';
tipBox.setAttribute('role', 'tooltip');
tipBox.hidden = true;
let tipTarget = null, tipTimer = 0, mouse = { x: 0, y: 0 };
function tipOf(el) {
  if (tips.has(el)) return tips.get(el);
  if (/^(LABEL|TH|H3)$/.test(el.tagName)) return fieldHelp(el);
  return null;
}
function tipTargetFrom(node) {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (el.nodeType === 1 && tipOf(el)) return el;
  }
  return null;
}
function hideTip() { clearTimeout(tipTimer); tipBox.hidden = true; tipTarget = null; }
function placeTip() {
  const pad = 8, w = tipBox.offsetWidth, ht = tipBox.offsetHeight;
  let x = mouse.x + 16, y = mouse.y + 20;
  if (x + w > window.innerWidth - pad) x = Math.max(pad, mouse.x - w - 12);
  if (y + ht > window.innerHeight - pad) y = Math.max(pad, mouse.y - ht - 12);
  tipBox.style.left = `${x}px`;
  tipBox.style.top = `${y}px`;
}
function showTip(el) {
  let t = tipOf(el);
  if (typeof t === 'function') { try { t = t(); } catch (e) { console.warn('tip:', e); t = null; } }
  if (typeof t === 'string') t = { text: t };
  if (!t || !(t.title || t.text || t.lines?.length)) return;
  tipBox.replaceChildren(
    t.title ? h('b', {}, t.title) : '',
    t.text ? h('div', {}, t.text) : '',
    ...(t.lines ?? []).filter(Boolean).map((line) => h('div', { class: 'tip-line' }, line)));
  // a modal dialog sits in the top layer, so the box has to be inside it to show
  (el.closest('dialog[open]') ?? document.body).append(tipBox);
  tipBox.hidden = false;
  placeTip();
}
document.addEventListener('mouseover', (e) => {
  const el = tipTargetFrom(e.target);
  if (el === tipTarget) return;
  hideTip();
  if (!el) return;
  tipTarget = el;
  tipTimer = setTimeout(() => { if (tipTarget === el && el.isConnected) showTip(el); }, 300);
});
document.addEventListener('mousemove', (e) => { mouse = { x: e.clientX, y: e.clientY }; if (!tipBox.hidden) placeTip(); });
for (const ev of ['mousedown', 'keydown', 'wheel']) document.addEventListener(ev, hideTip, true);

const STAT_HELP = {
  HP: 'Hit points. The unit is knocked out at 0.',
  MP: 'Magic points, spent on spells and some skills.',
  STR: 'Strength: physical attack power, mainly with melee weapons.',
  VIT: 'Vitality: physical defence.',
  DEX: 'Dexterity: accuracy, and damage with bows and other precise weapons.',
  AGI: 'Agility: accuracy and evasion.',
  AVD: 'Avoidance: the chance to dodge physical attacks.',
  INT: 'Intelligence: power of offensive magic.',
  MND: 'Mind: magic accuracy and healing power.',
  RES: 'Resistance: defence against magic.',
};
const FIELD_HELP = {
  // unit card
  Name: 'The unit’s name, up to 36 characters. The leader’s name also shows in the load menu.',
  Class: 'The unit’s current class. Hover a class in the list for the game’s description. “Other classes” are ones this character can’t normally change into.',
  Level: 'Unit level. Changing it does not re-roll stats. The game won’t level units past the Union Level.',
  Element: 'The unit’s element. Spells of the unit’s own element work better for it.',
  Clan: 'The clan shown on the status screen (Walister, Galgastani, Bakram...). The story changes it for some characters.',
  Alignment: 'Lawful, Neutral or Chaotic. Some classes need a particular alignment, and story choices move units’ loyalty depending on it.',
  Loyalty: 'Hidden loyalty, 0–100. Very unhappy units can leave the army.',
  Luck: 'Hidden luck stat, 0–255. It nudges critical hits and other chances.',
  Portrait: 'The face shown on the status screen. Story characters have their own.',
  // equipment and carried things
  'Right hand': 'Main weapon.', 'Left hand': 'Shield or a second weapon.', Head: 'Helmet, hat or hood.', Body: 'Body armour or robes.',
  Arms: 'Gloves or gauntlets.', Feet: 'Boots or shoes.', Accessory: 'Rings, earrings, amulets and the like.',
  'Equipped skill': 'The unit’s skill slots. Any skill can go here, even one its class doesn’t learn: the game loads it anyway.',
  Rank: 'The skill’s rank counter as stored in the save.',
  // stats card
  Base: 'Starting value from the unit’s race and template.',
  'Class growth': 'Gained from level-ups, by class.',
  'Level-up bonus': 'The random part of level-up gains.',
  'Stat items': 'Permanent boosts from stat-increase items.',
  Shown: 'What the game shows: the four parts added up.',
  // army
  Goth: 'Money, up to 99,999,999.',
  'Army name': 'The army’s name.',
  'Union Level': 'Units can’t level past this. The story raises it; the game maximum is 50.',
  'Chariot rewind turns': 'How many turns the Chariot Tarot can rewind (10 early in the game, 50 late).',
};
const SNAP_HELP = {
  Name: 'Shown as the weapon’s name, up to 16 characters.',
  'Weapon type': 'Which kind of Cursed Weapon this is. Each type has 5 slots.',
  'Copy stats': 'Start from the numbers of a snapshot weapon you already have.',
  RT: 'Recovery time the weapon adds: lower acts sooner.',
  ATK: 'Attack power.', DEF: 'Defence.',
  'Damage to obstacles': 'Damage dealt to walls, crates and other obstacles.',
  'Damage type': 'Crushing, slashing or piercing. Targets resist each type differently.',
  'Damage type bonus %': 'Extra damage percentage from the damage type.',
  Element: 'Element of the weapon’s attacks.',
  'Element bonus %': 'Extra damage percentage from the element.',
  Race: 'A race the weapon is especially good against.',
  'Race bonus %': 'Extra damage percentage against that race.',
};
const HEADING_HELP = [
  [/^Finishing moves/, 'The finishing moves (special attacks) set on this unit.'],
  [/^Weapon ranks/, 'Proficiency kept per weapon type. Higher ranks hit harder and more often.'],
  [/^Kept class levels/, 'Bodysnatch-style permanent skills: for each class listed, the unit keeps that class’s skills up to the level shown, in any class.'],
  [/^Skill list/, 'The skills the game lists for this unit right now. View only: it is rebuilt when the game loads.'],
  [/^Unlocked by level/, 'Every skill this unit has unlocked by level, in any class. View only.'],
  [/^Snapshot weapons/, 'Cursed weapons made by sacrificing a unit; each keeps a snapshot of that unit’s stats. Click one to edit it.'],
  [/^Relics/, 'Rare equipment kept as single copies with their own bonuses. Two copies of a relic combine into a stronger one in game.'],
  [/^Equipment stock/, 'How many of each piece the army owns, worn pieces included.'],
  [/^Item stock/, 'How many of each consumable and spellbook the army owns.'],
];
function fieldHelp(el) {
  const text = el.textContent.trim();
  if (!text) return null;
  if (el.closest('dialog.snapshot-dialog')) return SNAP_HELP[text] ?? (STAT_HELP[text] ? `${STAT_HELP[text]} Added to the wielder.` : null);
  if (FIELD_HELP[text]) return FIELD_HELP[text];
  if (STAT_HELP[text]) return STAT_HELP[text];
  if (/^Item \d+$/.test(text)) return 'A consumable the unit carries into battle.';
  if (/^Spell \d+$/.test(text)) return 'A spell the unit has set. Spells come from spellbooks.';
  if (el.tagName === 'H3') return HEADING_HELP.find(([re]) => re.test(text))?.[1] ?? null;
  if (el.tagName === 'TH') return FIELD_HELP[text] ?? null;
  return null;
}

function status(text, error = false) { const s = $('status'); s.textContent = text; s.className = error ? 'err' : ''; }
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...API, ...(options.headers ?? {}) } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res;
}
/**
 * Label for a value a list doesn't offer. Ids past the end of this game's
 * tables come from saves made with a modded copy (ChatGPT's mod installs add
 * items and skills that this install's Data folder doesn't have).
 */
function missingLabel(kind, id) {
  const t = T().tables;
  if (kind === 'skill') return T().skillName(id) || (id >= t.skill.count ? `Skill ${id} (modded game only)` : `Skill ${id}`);
  if (kind === 'item') {
    if (id >= 1000 && id < 2000) return T().commodityName(id - 1000) || (id - 1000 >= t.commodity.count ? `Item ${id} (modded game only)` : `Item ${id}`);
    return T().armsName(id) || `Equipment ${id}`;
  }
  if (kind === 'effect') return T().effectName(id) || `Effect ${id}`;
  if (kind === 'class') return className(id);
  return `#${id}`;
}
function select(options, value, onchange, attrs = {}, kind = '') {
  const el = h('select', { ...attrs, onchange: (e) => onchange(Number(e.target.value)) });
  let found = false;
  for (const o of options) {
    if (o.group) {
      let g = el.querySelector(`optgroup[label="${CSS.escape(o.group)}"]`);
      if (!g) { g = h('optgroup', { label: o.group }); el.append(g); }
      g.append(h('option', { value: o.id }, o.name));
    } else el.append(h('option', { value: o.id }, o.name));
    if (o.id === value) found = true;
  }
  if (!found) el.prepend(h('option', { value }, missingLabel(kind, value)));
  el.value = String(value);
  return el;
}
/**
 * A dropdown whose entries show icons (a native <select> can't). The button
 * shows the current entry; clicking opens a searchable list. `iconFor(id)`
 * returns a promise of a canvas. Arrow keys, Enter and Escape work in the list.
 */
let openPicker = null;
function closePicker() { openPicker?.remove(); openPicker = null; }
document.addEventListener('mousedown', (e) => { if (openPicker && !openPicker.contains(e.target) && !e.target.closest?.('.picker')) closePicker(); });
window.addEventListener('resize', closePicker);
function iconSelect(options, value, onchange, iconFor, kind = '') {
  const current = options.find((o) => o.id === value);
  const label = current ? current.name : missingLabel(kind, value);
  const btn = h('button', { type: 'button', class: 'picker', tip: () => tipFor(kind, value) ?? (label.length > 28 ? label : null) },
    value ? art(() => iconFor(value)) : h('span', { class: 'art' }),
    h('span', { class: 'picker-label' }, label), h('span', { class: 'picker-caret' }, '▾'));
  btn.addEventListener('click', () => {
    if (openPicker?.owner === btn) { closePicker(); return; }
    closePicker();
    const list = h('div', { class: 'picker-list' });
    const search = h('input', { type: 'search', placeholder: 'Type to filter…' });
    const pop = h('div', { class: 'picker-pop' }, search, list);
    pop.owner = btn;
    let rows = [], active = -1;
    const choose = (id) => { closePicker(); if (id !== value) onchange(id); btn.focus(); };
    const setActive = (i) => {
      rows[active]?.classList.remove('active');
      active = Math.max(0, Math.min(rows.length - 1, i));
      rows[active]?.classList.add('active');
      rows[active]?.scrollIntoView({ block: 'nearest' });
    };
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const parts = [];
      let group = null;
      rows = [];
      for (const o of options) {
        if (q && !o.name.toLowerCase().includes(q)) continue;
        if (o.group && o.group !== group) { group = o.group; parts.push(h('div', { class: 'picker-group' }, group)); }
        const row = h('div', { class: o.id === value ? 'picker-row sel' : 'picker-row', onclick: () => choose(o.id), tip: o.id > 0 ? () => tipFor(kind, o.id) : null },
          o.id > 0 ? art(() => iconFor(o.id), 'art small') : h('span', { class: 'art small' }), h('span', {}, o.name));
        rows.push(row);
        parts.push(row);
      }
      list.replaceChildren(...(parts.length ? parts : [h('div', { class: 'picker-group' }, 'Nothing matches.')]));
      active = -1;
      const sel = rows.findIndex((r) => r.classList.contains('sel'));
      if (!q && sel >= 0) setActive(sel); else if (rows.length) setActive(0);
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); rows[active]?.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePicker(); btn.focus(); }
    });
    (btn.closest('dialog[open]') ?? document.body).append(pop); // inside a modal, or it sits behind it
    openPicker = pop;
    // place under the button, or above it when there is no room below
    const r = btn.getBoundingClientRect(), width = Math.max(r.width, 300);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.min(r.left, window.innerWidth - width - 8)}px`;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const room = below >= 260 || below >= above ? below : above;
    list.style.maxHeight = `${Math.max(140, Math.min(360, room - 44))}px`;
    if (room === below) pop.style.top = `${r.bottom + 2}px`; else pop.style.bottom = `${window.innerHeight - r.top + 2}px`;
    draw();
    search.focus();
  });
  return btn;
}
/** An icon (from a promise of a canvas) in front of a control. */
function withIcon(promise, control) {
  const icon = h('span', { class: 'art' });
  promise.then((c) => { if (c) icon.replaceChildren(c); }).catch(() => {});
  return h('span', { class: 'with-icon' }, icon, control);
}
function numberInput(value, onchange, attrs = {}) {
  return h('input', { type: 'number', value, ...attrs, onchange: (e) => onchange(Number(e.target.value)) });
}
function markDirty() {
  state.dirty = true;
  $('dirty').hidden = false;
  for (const id of ['revert', 'save', 'save-copy']) $(id).disabled = false;
}
function clearDirty() {
  state.dirty = false;
  $('dirty').hidden = true;
  $('revert').disabled = true;
  $('save').disabled = true;
  $('save-copy').disabled = !state.data;
  $('import-unit').disabled = !state.data;
}

// ---------------------------------------------------------------- art
// A placeholder span that fills in when its picture is ready. Pictures load
// only once the span scrolls into view, so long lists stay quick.
const artQueue = new WeakMap();
const artObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    artObserver.unobserve(e.target);
    const load = artQueue.get(e.target);
    artQueue.delete(e.target);
    load?.().then((c) => { if (c) { c.removeAttribute?.('title'); e.target.replaceChildren(c); } }).catch(() => {});
  }
}, { rootMargin: '200px' });
function art(load, cls = 'art') {
  const span = h('span', { class: cls });
  artQueue.set(span, load);
  artObserver.observe(span);
  return span;
}
const iconCache = new Map();
/** Canvas of an item's icon (equipment below 1000, items 1000+); fresh copy each call. */
function itemIconFor(id) {
  if (!id || id === 0xFFFF) return Promise.resolve(null);
  const base = id >= 2000 ? state.data?.baseOf(id) : id; // named and custom pieces show their base item
  if (!base) return Promise.resolve(null);
  const key = `i${base}`;
  if (!iconCache.has(key)) {
    const rec = T().itemRecord(base);
    iconCache.set(key, rec ? itemArt(rec.kind, rec.row, 'en-us', 0.5) : Promise.resolve(null));
  }
  return iconCache.get(key).then(cloneCanvas);
}
/**
 * Spellbooks (item type 34) show their spell's own icon, as the game's spell
 * menus do; the book row's u16 +4 is the spell's effect id. Others fall back
 * to the item icon.
 */
function spellIconFor(id) {
  if (id > 1000 && id < 2000) {
    const t = T().tables.commodity, i = id - 1000;
    if (i < t.count) {
      const row = t.row(i);
      const effect = row[2] === 34 ? row[4] | (row[5] << 8) : 0;
      if (effect) return effectIconFor(effect);
    }
  }
  return itemIconFor(id);
}
function effectIconFor(id) {
  if (!id) return Promise.resolve(null);
  const key = `e${id}`;
  if (!iconCache.has(key)) iconCache.set(key, abilityArt('effect', id, T(), 'en-us', 0.5));
  return iconCache.get(key).then(cloneCanvas);
}
function skillIconFor(id) {
  if (!id) return Promise.resolve(null);
  const key = `s${id}`;
  if (!iconCache.has(key)) iconCache.set(key, abilityArt('skill', id, T(), 'en-us', 0.5));
  return iconCache.get(key).then(cloneCanvas);
}
/**
 * Class list icons, the TO:R Editor's way: each class's own representative
 * sprite (tables.classLook) for the unit's gender, not the unit redrawn.
 */
function classIconFor(u) {
  const t = T().tables.unitTemplate;
  const female = u.template < t.count && t.row(u.template)[3] === 1;
  return (cls) => {
    let look = null;
    try { look = T().classLook(cls, female); } catch { look = null; }
    if (!look?.actor) return Promise.resolve(null);
    const key = `${look.actor}:${look.palette ?? 0}`;
    if (!spriteCache.has(key)) spriteCache.set(key, loadActorFrame(look.actor, previewPalette(look.palette ?? 0) ?? undefined).catch(() => null));
    return spriteCache.get(key).then((f) => (f?.rgba ? croppedSprite(f, 0.5) : null));
  };
}
/** Class options for a unit, as the TO:R Editor lists them: gendered names, grouped by what the character can normally change into. */
function classOptions(u) {
  let opts;
  try { opts = T().classOptionsFor(u.template, u.cls); } catch { opts = null; }
  if (!opts) return state.lists.classes;
  return opts.filter((o) => o.id).map((o) => ({ ...o, name: /^unknown$/i.test(o.name) || !o.name ? className(o.id) : o.name }));
}
/** Element icons from the game's org_icon sheet (element 1-8 = Air ... Dark). */
let orgIcons = null;
function orgIcon(kind, index) {
  orgIcons ??= loadIconArchive('org_icon', 'en-us').catch(() => new Map());
  return orgIcons.then((m) => { const t = m.get(`org_icon00_${kind}_${String(index).padStart(4, '0')}_00`); return t ? textureCanvas(t, 0.5) : null; });
}
const elementIconFor = (e) => (e >= 1 && e <= 8 ? orgIcon('element', e - 1) : Promise.resolve(null));
/** Damage type 1-3 (Crushing, Slashing, Piercing) and race 1-9 (Human ... Golem), same sheet. */
const damageTypeIconFor = (t) => (t >= 1 && t <= 3 ? orgIcon('attack_type', t - 1) : Promise.resolve(null));
const raceIconFor = (r) => (r >= 1 && r <= 9 ? orgIcon('race', r - 1) : Promise.resolve(null));
/** A small copy of a portrait for lists. */
function portraitThumb(id) {
  return portraitArt(id).then((c) => {
    if (!c) return null;
    const t = document.createElement('canvas');
    t.width = t.height = 64;
    t.getContext('2d').drawImage(c, 0, 0, 64, 64);
    return t;
  });
}
function cloneCanvas(c) {
  if (!c) return null;
  const copy = document.createElement('canvas');
  copy.width = c.width; copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  return copy;
}
/**
 * Sprites of the non-human races (Hawkman, Lizardman, Lamia, Orc, Skeleton,
 * Ghost, Faerie, Gremlin, Pumpkinhead...): the actors of the generic race
 * templates ("Hawkman 1"...), whose race set (+0x38) is 2-13.
 */
let raceActors = null;
function raceActorSet() {
  if (raceActors) return raceActors;
  const t = T().tables.unitTemplate;
  raceActors = new Set();
  for (let id = 1; id < t.count; id++) {
    const r = t.row(id), actor = r[0x3A] | (r[0x3B] << 8);
    if (actor && r[0x38] >= 2 && r[0x38] <= 13) raceActors.add(actor);
  }
  return raceActors;
}
/**
 * Sprites of the generic classes and monster classes (class skill set +0x53
 * below 44). Story characters' own classes (Lord, Princess, Ranger...) use
 * sets 44-63 or 0.
 */
let genericActors = null;
const isGenericClass = (cls) => { const set = T().tables.class.row(cls)[0x53]; return set > 0 && set < 44; };
function genericActorSet() {
  if (genericActors) return genericActors;
  genericActors = new Set();
  const c = T().tables.class;
  for (let id = 1; id < c.count; id++) {
    if (!isGenericClass(id)) continue;
    for (const female of [false, true]) { const a = T().classSprite(id, female); if (a > 0) genericActors.add(a); }
  }
  return genericActors;
}
/**
 * Sprite and palette a save unit is drawn with. The unit's template (+0x3F)
 * gives gender and race:
 * - a non-human race keeps its race sprite in any class (Hawkman Ninja);
 * - a story character with a sprite of their own keeps it in generic classes
 *   (Denam or Vyce as a Warrior), but their unique class has its own sprite
 *   (Denam as Lord = DenimLord);
 * - everyone else uses the class sprite, or the template's when the class has none.
 */
function unitLook(u) {
  const tables = T().tables;
  const tplRow = u.template < tables.unitTemplate.count ? tables.unitTemplate.row(u.template) : null;
  const female = tplRow ? tplRow[3] === 1 : false;
  const tplActor = tplRow ? tplRow[0x3A] | (tplRow[0x3B] << 8) : 0;
  const tplPal = tplRow && tplRow[0x3D] !== 255 ? tplRow[0x3D] : 0;
  if (tplActor && raceActorSet().has(tplActor)) return { actor: tplActor, palette: tplPal };
  const classActor = T().classSprite(u.cls, female) || T().classSprite(u.cls, !female);
  const ownSprite = tplActor > 0 && !genericActorSet().has(tplActor);
  const clsKnown = u.cls < tables.class.count;
  const actor = ownSprite && clsKnown && isGenericClass(u.cls) ? tplActor : classActor > 0 ? classActor : tplActor;
  const clsRow = u.cls < tables.class.count ? tables.class.row(u.cls) : null;
  const palette = tplPal || (clsRow && clsRow[0x94] !== 255 ? clsRow[0x94] : 0);
  return { actor, palette };
}
const spriteCache = new Map();
function unitSprite(u, scale) {
  const { actor, palette } = unitLook(u);
  if (!actor) return Promise.resolve(null);
  const key = `${actor}:${palette}`;
  if (!spriteCache.has(key)) spriteCache.set(key, loadActorFrame(actor, previewPalette(palette) ?? undefined).catch(() => null));
  return spriteCache.get(key).then((f) => (f?.rgba ? croppedSprite(f, scale) : null));
}
/** The frame cut to its visible pixels, drawn at scale. */
function croppedSprite(f, scale) {
  let x0 = f.width, y0 = f.height, x1 = -1, y1 = -1;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    if (f.rgba[(y * f.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, hgt = y1 - y0 + 1;
  const src = rgbaCanvas(f.width, f.height, f.rgba, 1);
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(src, x0, y0, w, hgt, 0, 0, w, hgt);
  c.style.width = `${Math.round(w * scale)}px`;
  c.style.height = `${Math.round(hgt * scale)}px`;
  return c;
}

// ---------------------------------------------------------------- names
const T = () => state.tables;
function itemLabel(id) {
  const d = state.data;
  if (!id || id === 0xFFFF) return '— empty —';
  if (id < 1000) return T().armsName(id) || `Equipment ${id}`;
  if (id < 2000) return T().commodityName(id - 1000) || `Item ${id}`;
  if (id >= NAMED_BASE && id < NAMED_BASE + INVENTORY.namedCount) {
    const named = d.knownLayout ? d.namedName(id - NAMED_BASE) : '';
    return `★ ${named || 'Snapshot weapon'} (snapshot #${id - NAMED_BASE})`;
  }
  if (id >= CUSTOM_BASE && id < CUSTOM_BASE + INVENTORY.customCount) {
    const base = d.baseOf(id);
    return `◆ ${base ? T().armsName(base) : 'Relic'} (relic #${id - CUSTOM_BASE})`;
  }
  return `#${id}`;
}
// The game's own text for classes 174 and 175 is literally "Unknown"; keep the
// id visible so those units can be told apart.
function className(id) {
  const name = T().className(id);
  if (!name) return `Class ${id}`;
  return /^unknown$/i.test(name) ? `Class ${id} (game text: "Unknown")` : name;
}

// ---------------------------------------------------------------- descriptions
// The game's own help text. Each table row holds the id of its description:
// skill u16 +0x5C, effect +0x16, class +0xB4, armament +0x62; consumables use
// their own index. (Checked: every named row of each table has text.)
const pad = (n, w = 3) => String(n).padStart(w, '0');
const rowU16 = (row, o) => row[o] | (row[o + 1] << 8);
const s8 = (b) => (b << 24) >> 24;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
function rowHelp(table, id, off, key, w = 3) {
  const t = T().tables[table];
  return id > 0 && id < t.count ? T().text(key(pad(rowU16(t.row(id), off), w))) : '';
}
const moddedOnly = 'This id only exists in a modded copy of the game, so there is no description.';
function skillTip(id) {
  if (!id) return null;
  if (id >= T().tables.skill.count) return { title: missingLabel('skill', id), text: moddedOnly };
  return { title: T().skillName(id) || `Skill ${id}`, text: rowHelp('skill', id, 0x5C, (n) => `SKILLTEXT_LC_SKILL_${n}_HELP`) };
}
function effectTip(id) {
  if (!id) return null;
  return { title: T().effectName(id) || `Effect ${id}`, text: rowHelp('effect', id, 0x16, (n) => `EFFECTTEXT_LC_EFFECT_${n}_HELP`) };
}
function classTip(id) {
  if (!id) return null;
  if (id >= T().tables.class.count) return { title: className(id), text: moddedOnly };
  return { title: className(id), text: rowHelp('class', id, 0xB4, (n) => `CLASS_TEXT_DATA_CLASS${n}_HELP`, 4) };
}
/** Affinity line: "Slashing +10% · Fire +5% · vs Beast +15%". */
function affinityLine(damageType, damageBonus, element, elementBonus, race, raceBonus) {
  const parts = [];
  if (damageType) parts.push(`${enumName('damageType', damageType)}${damageBonus ? ` +${damageBonus}%` : ''}`);
  if (element) parts.push(`${enumName('element', element)}${elementBonus ? ` +${elementBonus}%` : ''}`);
  if (race) parts.push(`vs ${enumName('race', race)}${raceBonus ? ` +${raceBonus}%` : ''}`);
  return parts.join(' · ');
}
const STAT_KEYS = ['HP', 'MP', 'STR', 'VIT', 'DEX', 'AGI', 'AVD', 'INT', 'MND', 'RES'];
/** Equipment: the game's description, its type and its numbers. */
function armsTip(id) {
  const t = T().tables.armament;
  if (id >= t.count) return { title: missingLabel('item', id), text: moddedOnly };
  const r = t.row(id), type = r[2];
  const typeName = state.enums?.itemType?.find((o) => o.id === type)?.name ?? '';
  const head = [typeName, r[13] ? 'Two-handed' : '', isRelic(id) ? 'Relic' : ''].filter(Boolean).join(' · ');
  const nums = [];
  if (r[25]) nums.push(`ATK ${r[25]}`);
  if (r[26]) nums.push(`DEF ${r[26]}`);
  if (r[24] && type <= 21) nums.push(`RT ${r[24]}`);
  STAT_KEYS.forEach((k, i) => { const v = s8(r[27 + i]); if (v) nums.push(`${k} ${signed(v)}`); });
  if (s8(r[37])) nums.push(`LUK ${signed(s8(r[37]))}`);
  if (s8(r[38])) nums.push(`Weight ${s8(r[38])}`);
  return {
    title: T().armsName(id) || `Equipment ${id}`,
    text: rowHelp('armament', id, 0x62, (n) => `ARMSTEXT_LC_ARMS_${n}_HELP`),
    lines: [head, nums.join(' · '), affinityLine(r[39], r[40], r[57], r[58], r[46], r[47])],
  };
}
function snapshotTip(n) {
  const d = state.data, s = d.snapshot(n), who = wearerOf(NAMED_BASE + n);
  if (!d.u8(d.snapshotOffset(n))) return { title: `Cursed Weapon (${weaponTypeName(s.type)})`, text: 'A Cursed Weapon that has not been made into a snapshot weapon yet.' };
  const nums = [`ATK ${s.atk}`, `DEF ${s.def}`, `RT ${s.rt}`];
  // the game caps HP to RES at 127 when it applies them
  for (const [key, , label] of SNAPSHOT.stats.slice(3, 13)) if (s[key]) nums.push(`${label} +${Math.min(127, s[key])}${s[key] > 127 ? ` (${s[key]} stored)` : ''}`);
  return {
    title: s.name || '(no name)',
    text: `Snapshot weapon: a ${weaponTypeName(s.type)} Cursed Weapon that keeps the stats of the unit sacrificed into it.`,
    lines: [nums.join(' · '), affinityLine(s.damageType, s.damageBonus, s.element, s.elementBonus, s.race, s.raceBonus), who ? `Equipped by ${who}` : 'In stock'],
  };
}
function relicTip(n) {
  const d = state.data, id = CUSTOM_BASE + n, base = d.baseOf(id);
  const tip = base ? armsTip(base) : { title: 'Relic' };
  const b = d.relicBonuses(n), who = wearerOf(id);
  return { ...tip, lines: [...(tip.lines ?? []), `Relic copy #${n} · bonuses total ${b.reduce((x, y) => x + y, 0)} (highest ${Math.max(...b)})`, who ? `Equipped by ${who}` : 'In stock'] };
}
/** Any item id: equipment, consumable or spellbook, snapshot weapon or relic copy. */
function itemTip(id) {
  if (!id || id === 0xFFFF) return null;
  if (id < 1000) return armsTip(id);
  if (id < 2000) {
    const i = id - 1000, t = T().tables.commodity;
    if (i >= t.count) return { title: missingLabel('item', id), text: moddedOnly };
    const row = t.row(i), spell = row[2] === 34 ? rowU16(row, 4) : 0;
    const text = T().text(`COMMODITYTEXT_LC_COMMODITY_${pad(i)}_HELP`) || (spell ? effectTip(spell)?.text : '');
    return { title: T().commodityName(i) || `Item ${id}`, text };
  }
  if (!state.data?.knownLayout) return { title: itemLabel(id) };
  if (id >= NAMED_BASE && id < NAMED_BASE + INVENTORY.namedCount) return snapshotTip(id - NAMED_BASE);
  if (id >= CUSTOM_BASE && id < CUSTOM_BASE + INVENTORY.customCount) return relicTip(id - CUSTOM_BASE);
  return null;
}
/** A class skill set kept at a level: which skills that gives. */
function setTip(set, level, cls = 0) {
  if (set <= 0) return null;
  const t = T().tables, names = [];
  for (let id = 22; id < t.skill.count; id++) {
    const at = t.skill.row(id)[0x10 + set];
    if (at !== 255 && at <= level) { const n = T().skillName(id); if (n) names.push(n); }
  }
  const owner = cls || setClass(set);
  return {
    title: setLabel(set),
    text: `Kept at level ${level}, the unit has these ${names.length} skills in any class:`,
    lines: [(names.length > 24 ? `${names.slice(0, 24).join(', ')} … +${names.length - 24} more` : names.join(', ')) || 'none', owner ? classTip(owner)?.text : ''],
  };
}
/** Tip for an entry of an icon list, by the list's kind. */
function tipFor(kind, id) {
  switch (kind) {
    case 'skill': return skillTip(id);
    case 'item': return itemTip(id);
    case 'effect': return effectTip(id);
    case 'class': return classTip(id);
    case 'set': return id > 0 ? setTip(id, 50) : null;
    default: return null;
  }
}

function commodityList(test) {
  const t = T().tables.commodity;
  const out = [];
  for (let i = 1; i < t.count; i++) {
    const row = t.row(i);
    if (!test(row[2])) continue;
    const name = T().commodityName(i);
    if (name) out.push({ id: 1000 + i, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Relic equipment ids. The game keeps relics only as numbered copies (3000+n),
 * never as stock counts. The list comes from the TO:R Editor's armament schema
 * (community Nightmare modules), which tags each relic "(relic)".
 */
const isRelic = (id) => !!state.relics?.has(id);
async function loadRelicIds() {
  try {
    const schema = await (await fetch('/data/schemas/armament.json')).json();
    const fields = schema.groups.flatMap((g) => g.fields);
    // labels for the snapshot builder: damage type, race, element
    const opts = (key) => (fields.find((f) => f.key === key)?.options ?? []).map(([id, name]) => ({ id, name }));
    state.enums = { damageType: opts('physical_affinity'), race: opts('tribe_affinity'), element: opts('element_affinity'),
      itemType: opts('item_type').filter((o) => !/not used/.test(o.name)) };
    const field = fields.find((f) => f.options?.some((o) => /\(relic\)/.test(o[1])));
    return new Set(field.options.filter((o) => o[0] < 1000 && /\(relic\)/.test(o[1])).map((o) => o[0]));
  } catch (e) {
    console.warn('relic list:', e);
    return new Set();
  }
}

// ---------------------------------------------------------------- loading
async function boot() {
  try {
    status('Reading game names…');
    const info = await (await api('/api/info')).json();
    $('folder').textContent = `Saves: ${info.savesRoot}`;
    const texts = await loadTexts('en-us');
    state.tables = await GameTables.load(texts, info);
    state.relics = await loadRelicIds();
    const arms = state.tables.tables.armament;
    state.armsType = Array.from({ length: arms.count }, (_, i) => arms.row(i)[2]);
    state.lists = {
      classes: state.tables.lists.class.filter((o) => o.id).map((o) => ({ id: o.id, name: className(o.id) })),
      spells: [{ id: 0, name: '— empty —' }, ...commodityList((t) => t === 34)],
      items: [{ id: 0, name: '— empty —' }, ...commodityList((t) => t === 32)],
      skills: state.tables.lists.skill.map((o) => ({ id: o.id, name: o.id ? o.name : '— empty —' })),
      finishers: state.tables.lists.finisher.map((o) => ({ id: o.id, name: o.id ? o.name : '— empty —' })),
    };
    // portraits are FileTable directory 30 (object/<name>NN.dat); the save stores the id
    const table = await (await api('/api/file?path=FileTable.bin')).arrayBuffer();
    const portraits = readFileRegistry(new Uint8Array(table)).filter((e) => e.directory === 30);
    state.portraitFiles = new Map(portraits.map((e) => [e.id, e.path]));
    state.lists.portraits = [{ id: 0, name: '— none —' }, ...portraits.sort((x, y) => x.id - y.id)
      .map((e) => ({ id: e.id, name: `${e.id} · ${e.path.split('/').pop().replace(/\.dat$/i, '')}` }))];
    await loadSaveList();
  } catch (e) {
    console.error(e);
    status(`Could not start: ${e.message}`, true);
  }
}

async function loadSaveList(keep = state.name) {
  const list = await (await api('/api/saves')).json();
  state.saves = list.saves;
  state.gameRunning = list.gameRunning;
  $('folder').textContent = `Saves: ${list.folder}`;
  const sel = $('save-select');
  sel.replaceChildren(h('option', { value: '' }, '— choose a save —'),
    ...list.saves.map((s) => h('option', { value: s.name, disabled: !s.ok },
      s.ok
        ? `${s.slot === 0 ? 'Autosave' : `Slot ${s.slot}`} · ${s.leader} · ${s.units} units · ${fmt(s.goth)} Goth · ${s.modified.replace('T', ' ')}`
        : `${s.name} · cannot read: ${s.error}`)));
  sel.disabled = false;
  sel.value = keep && list.saves.some((s) => s.name === keep) ? keep : '';
  status(state.gameRunning
    ? 'The game is running. You can look around, but close it before saving.'
    : `${list.saves.length} save files found.`, state.gameRunning);
}

async function openSave(name) {
  if (!name) return;
  if (state.dirty && !confirm('Discard the unsaved changes to the open save?')) {
    $('save-select').value = state.name ?? '';
    return;
  }
  status(`Opening ${name}…`);
  const res = await api(`/api/save?name=${encodeURIComponent(name)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  state.name = name;
  state.sha = res.headers.get('X-Save-Sha256');
  state.original = bytes.slice();
  state.data = new SaveData(bytes);
  state.slot = 0;
  clearDirty();
  render();
  const d = state.data;
  status(d.knownLayout
    ? `Opened ${name}: ${d.unitCount()} units, ${fmt(d.goth)} Goth.`
    : `Opened ${name}. This save uses a layout this editor hasn't mapped yet (${fmt(d.bytes.length)} bytes); unit edits work, but inventory editing is turned off.`,
    !d.knownLayout);
}

// ---------------------------------------------------------------- rendering
function render() {
  renderRoster();
  renderUnit();
  if (state.tab === 'inventory') renderInventory();
  if (state.tab === 'backups') renderBackups();
}

function renderRoster() {
  const d = state.data;
  const list = $('roster');
  if (!d) { list.replaceChildren(); return; }
  const units = d.units().filter((u) => u.slot < UNIT.usable);
  $('roster-count').textContent = `${units.length} of ${UNIT.usable} units`;
  list.replaceChildren(...units.map((u) => h('li', {
    class: u.slot === state.slot ? 'sel' : '',
    onclick: () => { state.slot = u.slot; renderRoster(); renderUnit(); },
  }, h('span', { class: 'num' }, u.slot + 1), art(() => unitSprite(u, 0.5), 'sprite'),
    h('span', { class: 'who' }, h('span', {}, u.name || '(no name)'), h('span', { class: 'cls' }, className(u.cls))),
    h('span', { class: 'lvl' }, `Lv ${u.level}`))));
}

function renderUnit() {
  const panel = $('unit');
  const d = state.data;
  if (!d) { panel.replaceChildren(h('p', { class: 'muted pad' }, 'Open a save to see its units.')); return; }
  const u = d.unit(state.slot);
  const changed = (fn) => (v) => { fn(v); markDirty(); renderRoster(); };
  const title = h('h2', {}, u.name || '(no name)');
  const head = h('div', { class: 'unit-head' },
    art(() => unitSprite(u, 1), 'sprite big'),
    h('div', {}, title, h('div', { class: 'muted' }, `Lv ${u.level} · ${className(u.cls)} · slot ${u.slot + 1}`)),
    h('div', { class: 'spacer' }),
    h('button', { onclick: exportUnit, title: 'Save this character to a file you can import into any save' }, 'Export'),
    h('button', { onclick: duplicateUnit, title: 'Copy this unit into a new roster slot' }, 'Duplicate'),
    h('button', { class: 'danger', onclick: removeUnit, disabled: u.slot === 0, title: u.slot === 0 ? 'The leader cannot be removed' : 'Remove this unit from the roster' }, 'Remove'));

  const portraitBox = art(() => portraitArt(u.portrait), 'portrait');
  const basics = h('div', { class: 'card unit-card' }, h('h3', {}, 'Unit'),
    h('div', { class: 'unit-grid' },
      h('div', { class: 'grid2' },
        h('label', {}, 'Name'), h('input', { type: 'text', value: u.name, maxLength: 36,
          onchange: (e) => { u.name = e.target.value; markDirty(); renderRoster(); title.textContent = u.name; } }),
        h('label', {}, 'Class'), iconSelect(classOptions(u), u.cls, changed((v) => { u.cls = v; renderUnit(); }), classIconFor(u), 'class'),
        h('label', {}, 'Level'), numberInput(u.level, changed((v) => { u.level = v; })),
        h('label', {}, 'Element'), iconSelect(ELEMENTS.slice(0, 9).map((name, id) => ({ id, name })), u.element, changed((v) => { u.element = v; renderUnit(); }), elementIconFor),
        h('label', {}, 'Clan'), select(CLANS.map((name, id) => ({ id, name: id === 0 ? 'None' : name })), u.clan, changed((v) => { u.clan = v; })),
        h('label', {}, 'Alignment'), select(ALIGNMENTS.map((name, id) => ({ id, name })), u.alignment, changed((v) => { u.alignment = v; })),
        h('label', {}, 'Loyalty'), numberInput(u.loyalty, changed((v) => { u.loyalty = v; }), { min: 0, max: 100 }),
        h('label', {}, 'Luck'), numberInput(u.luck, changed((v) => { u.luck = v; }), { min: 0, max: 255 }),
        h('label', {}, 'Portrait'), iconSelect(state.lists.portraits, u.portrait, (v) => { u.portrait = v; markDirty(); renderUnit(); }, portraitThumb)),
      portraitBox),
    h('p', { class: 'note' }, 'Move, jump, RT and the attack/defence numbers on the game’s sheet are worked out from class and gear, so they are not stored. ',
      'Changing the level does not re-roll stats.'));

  panel.replaceChildren(head, h('div', { class: 'cards' },
    basics, equipmentCard(u), carriedCard(u), skillsCard(u), statsCard(u), ranksCard(u), keptSetsCard(u),
    learnedCard(u, 'kept'), learnedCard(u, 'learned')));
}

const portraitCache = new Map();
function portraitArt(id) {
  const entry = state.portraitFiles?.get(id);
  if (!entry) return Promise.resolve(null);
  if (!portraitCache.has(id)) portraitCache.set(id, characterPortrait(entry).catch(() => null));
  return portraitCache.get(id).then((p) => (p ? rgbaCanvas(p.width, p.height, p.rgba, 0.4) : null));
}

function equipmentOptions(u, k, current) {
  const d = state.data;
  const fits = (base) => base > 0 && SLOT_TYPES[k](state.armsType[base] ?? -1);
  const opts = [{ id: 0, name: '— empty —' }];
  if (current) opts.push({ id: current, name: itemLabel(current) + ' (equipped)' });
  if (d.knownLayout) {
    const taken = d.equippedSpecial();
    const special = [];
    for (let i = 0; i < INVENTORY.namedCount; i++) {
      const id = NAMED_BASE + i;
      if (id !== current && d.namedOwned(i) && !taken.has(id) && fits(d.baseOf(id))) special.push({ id, name: itemLabel(id), group: 'Snapshot weapons and relics in stock' });
    }
    for (let i = 0; i < INVENTORY.customCount; i++) {
      const id = CUSTOM_BASE + i;
      if (id !== current && d.customOwned(i) && !taken.has(id) && fits(d.baseOf(id))) special.push({ id, name: itemLabel(id), group: 'Snapshot weapons and relics in stock' });
    }
    opts.push(...special.sort((a, b) => a.name.localeCompare(b.name)));
  }
  // stock counts worn pieces too, so the spare count is stock minus what units wear
  const worn = new Map();
  for (const w of d.units()) for (const e of w.equipment) if (e > 0 && e < 1000) worn.set(e, (worn.get(e) ?? 0) + 1);
  const plain = [];
  for (let id = 1; id < state.armsType.length; id++) {
    if (id === current || !fits(id) || isRelic(id)) continue; // relics are only equipped as their own copies
    const name = T().armsName(id);
    if (!name) continue;
    // every piece is offered; ones with a spare come first
    const spare = d.knownLayout ? Math.max(0, d.armsStock(id) - (worn.get(id) ?? 0)) : 0;
    plain.push({ id, name: spare ? `${name} (${spare} spare)` : name, group: !d.knownLayout ? 'All equipment' : spare ? 'Spare in inventory' : 'None spare (adds one)' });
  }
  plain.sort((a, b) => (a.group === b.group ? 0 : a.group === 'Spare in inventory' ? -1 : 1) || a.name.localeCompare(b.name));
  return [...opts, ...plain];
}

function setEquipment(u, k, id) {
  const d = state.data;
  const old = u.equipment[k];
  if (old === id) return;
  u.setEquipment(k, id);
  // Stock is the total owned, worn pieces included. The removed piece just
  // becomes spare; the new one uses a spare, or counts as one more owned when
  // there is none (so taking it off in game leaves it in the inventory).
  if (state.syncStock && d.knownLayout) d.coverWorn(id);
  markDirty();
  renderUnit();
}

function equipmentCard(u) {
  const d = state.data;
  const eq = u.equipment;
  const rows = SLOT_NAMES.map((slot, k) => [h('label', {}, slot),
    iconSelect(equipmentOptions(u, k, eq[k]), eq[k], (v) => setEquipment(u, k, v), itemIconFor, 'item')]);
  return h('div', { class: 'card' }, h('h3', {}, 'Equipment'),
    h('div', { class: 'grid2' }, rows.flat()),
    d.knownLayout ? h('label', { class: 'note', style: 'display:flex;gap:6px;align-items:center' },
      h('input', { type: 'checkbox', checked: state.syncStock, onchange: (e) => { state.syncStock = e.target.checked; renderUnit(); } }),
      'Keep the inventory in step (the game’s stock counts worn pieces too): a piece with no spare is added as one more owned, so it stays in the inventory when taken off in game') : null,
    h('p', { class: 'note' }, 'The game does not check class or two-hand rules when loading; pick gear the class can use. ',
      '★ snapshot weapons and ◆ relics exist once each.'));
}

function carriedCard(u) {
  const spells = u.spells, items = u.items;
  return h('div', { class: 'card' }, h('h3', {}, 'Items and spells'),
    h('div', { class: 'grid2' },
      ...items.flatMap((id, k) => [h('label', {}, `Item ${k + 1}`), iconSelect(state.lists.items, id, (v) => { u.setItem(k, v); markDirty(); renderUnit(); }, itemIconFor, 'item')]),
      ...spells.flatMap((id, k) => [h('label', {}, `Spell ${k + 1}`), iconSelect(state.lists.spells, id, (v) => { u.setSpell(k, v); markDirty(); renderUnit(); }, spellIconFor, 'item')])));
}

// Any skill can be equipped: the user's own unedited saves already hold
// equipped skills that are unlearned or outside the class's list, and they load.
// The list groups the current class's skills first, then the rest unlocked by level.
function skillsCard(u) {
  const current = new Set(u.skillSet('kept'));
  const unlocked = new Set(u.skillSet('learned'));
  const options = [{ id: 0, name: '— empty —' },
    ...state.lists.skills.filter((o) => o.id && current.has(o.id)).map((o) => ({ ...o, group: 'Current class skills' })),
    ...state.lists.skills.filter((o) => o.id && !current.has(o.id) && unlocked.has(o.id)).map((o) => ({ ...o, group: 'Unlocked by level (other classes)' })),
    ...state.lists.skills.filter((o) => o.id && !current.has(o.id) && !unlocked.has(o.id)).map((o) => ({ ...o, group: 'Other skills' }))];
  const rows = [];
  for (let k = 0; k < UNIT.skillCount; k++) {
    const sk = u.skill(k);
    rows.push(h('tr', {},
      h('td', {}, iconSelect(options, sk.id, (v) => { u.setSkill(k, { id: v }); markDirty(); renderUnit(); }, skillIconFor, 'skill')),
      h('td', { class: 'num' }, sk.id ? numberInput(sk.rank, (v) => { u.setSkill(k, { rank: v }); markDirty(); renderUnit(); }, { min: 0, max: 255 }) : '')));
  }
  const fin = u.finishers;
  const finRows = fin.map((id, k) => h('tr', {},
    h('td', { colSpan: 2 }, iconSelect(state.lists.finishers, id, (v) => { u.setFinisher(k, v); markDirty(); renderUnit(); }, effectIconFor, 'effect'))));
  return h('div', { class: 'card' }, h('h3', {}, 'Skills'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Equipped skill'), h('th', { class: 'num' }, 'Rank'))), h('tbody', {}, rows)),
    h('h3', { style: 'margin-top:14px' }, 'Finishing moves'),
    h('table', {}, h('tbody', {}, finRows)));
}

function statsCard(u) {
  const labels = { base: 'Base', growth: 'Class growth', random: 'Level-up bonus', extra: 'Stat items' };
  const body = STATS.map((stat, s) => h('tr', {},
    h('td', { tip: STAT_HELP[stat] }, stat),
    ...EDITABLE_PARTS.map((p) => h('td', { class: 'num' }, h('input', {
      type: 'number', step: '0.1', min: 0, value: (u.stat(p, s) / 10).toFixed(1),
      onchange: (e) => { u.setStat(p, s, Number(e.target.value) * 10); markDirty(); renderUnit(); },
    }))),
    h('td', { class: 'total' }, u.stat('total', s))));
  return h('div', { class: 'card stats' }, h('h3', {}, 'Stats'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), ...EDITABLE_PARTS.map((p) => h('th', { class: 'num' }, labels[p])), h('th', { class: 'num' }, 'Shown'))),
      h('tbody', {}, body)),
    h('p', { class: 'note' }, 'The game adds the four parts to get each stat (HP and MP also get equipment bonuses). ',
      '"Stat items" is the unit’s own counter of permanent boosts from stat-increase items.'));
}

function ranksCard(u) {
  const rows = [];
  for (let id = 1; id <= 21; id++) {
    const name = T().skillName(id);
    if (!name) continue;
    const r = u.rank(id);
    rows.push(h('tr', { tip: () => skillTip(id) }, h('td', { class: 'icon' }, art(() => skillIconFor(id))), h('td', {}, name),
      h('td', { class: 'num' }, numberInput(r.rank, (v) => { u.setRank(id, v); markDirty(); renderUnit(); }, { min: 0, max: 255 }))));
  }
  return h('div', { class: 'card' }, h('h3', {}, 'Weapon ranks'),
    h('div', { class: 'list short' }, h('table', {}, h('tbody', {}, rows))),
    h('p', { class: 'note' }, 'Kept per weapon type, whatever skills are equipped. An equipped weapon skill shows the same rank.'));
}

/** Does the class learn this skill? Skill row +0x10 + (class +0x53) is its learn level; 255 = never. */
function classLearns(cls, id) {
  const t = T().tables;
  if (cls >= t.class.count || id <= 0 || id >= t.skill.count) return false;
  const set = t.class.row(cls)[0x53];
  return set >= 0x40 || t.skill.row(id)[0x10 + set] !== 255;
}
/** A readable name for a class skill set: the first named class that uses it. */
function setLabel(set) {
  if (set === 0) return 'Set 0 (shared by unique classes)';
  const c = T().tables.class;
  for (let id = 1; id < c.count; id++) if (c.row(id)[0x53] === set && T().className(id)) return `${className(id)} skills`;
  return `Set ${set}`;
}
/** The first named class using a skill set (for its icon), or 0. */
function setClass(set) {
  const c = T().tables.class;
  for (let id = 1; id < c.count; id++) if (c.row(id)[0x53] === set && T().className(id)) return id;
  return 0;
}
const setIconFor = (u) => (set) => { const cls = setClass(set); return cls ? classIconFor(u)(cls) : Promise.resolve(null); };
/**
 * Skills a unit keeps from its kept class levels (+0x575 + set): every skill
 * the set learns at or below that level. (Base confirmed in game: a level
 * written at +0x57A gave Rune Fencer, set 5, skills.)
 */
function keptSkills(u) {
  const t = T().tables, out = new Set();
  for (let s = 1; s < UNIT.setCount; s++) {
    const lvl = u.setLevel(s);
    if (!lvl) continue;
    for (let id = 22; id < t.skill.count; id++) { const at = t.skill.row(id)[0x10 + s]; if (at !== 255 && at <= lvl) out.add(id); }
  }
  return out;
}
function keptSetsCard(u) {
  const rows = [];
  for (let s = 1; s < UNIT.setCount; s++) {
    const lvl = u.setLevel(s);
    if (!lvl) continue;
    rows.push(h('tr', { tip: () => setTip(s, u.setLevel(s)) }, h('td', { class: 'icon' }, art(() => setIconFor(u)(s))), h('td', {}, setLabel(s)),
      h('td', { class: 'num' }, numberInput(lvl, (v) => { u.setSetLevel(s, v); markDirty(); renderUnit(); }, { min: 0, max: 99 })),
      h('td', {}, h('button', { title: 'Remove', onclick: () => { u.setSetLevel(s, 0); markDirty(); renderUnit(); } }, '×'))));
  }
  const options = [{ id: -1, name: '+ Keep another class’s skills…' }];
  for (let s = 1; s < UNIT.setCount; s++) if (!u.setLevel(s)) { const name = setLabel(s); if (!/^Set /.test(name)) options.push({ id: s, name }); }
  const add = iconSelect(options, -1, (v) => { if (v > 0) { u.setSetLevel(v, 50); markDirty(); renderUnit(); } }, setIconFor(u), 'set');
  return h('div', { class: 'card' }, h('h3', {}, 'Kept class levels (permanent skills)'),
    rows.length ? h('table', {}, h('tbody', {}, rows)) : h('p', { class: 'muted' }, 'None.'),
    h('div', { style: 'margin-top:8px' }, add),
    h('p', { class: 'note' }, 'A level kept per class skill set (+0x575). The unit keeps that class’s skills up to this level whatever its class, and they persist through class changes (tested in game 2026-11-16).'));
}
/**
 * The two skill bit sets: 'kept' (+0x675) and 'learned' (+0x1D1). Neither
 * changed when Jack changed class (saves 17 and 18).
 */
function learnedCard(u, which) {
  const ids = u.skillSet(which);
  const isClass = which === 'kept';
  const fromSets = keptSkills(u);
  // permanent: unlocked by a kept class level although the current class never learns it
  const isPerm = (id) => isClass && fromSets.has(id) && !classLearns(u.cls, id);
  const permanent = ids.filter(isPerm);
  const title = isClass ? 'Skill list (+0x675)' : 'Unlocked by level (all classes)';
  const note = isClass
    ? '★ = comes from a kept class level (see that card) and the current class doesn’t learn it. To give a unit skills, use Kept class levels.'
    : 'Every skill this unit has unlocked by level, in any class.';
  const chip = (id) => {
    const perm = isPerm(id);
    const tip = () => { const t = skillTip(id) ?? {}; return { ...t, lines: [perm ? '★ Permanent: kept through class changes (from a kept class level)' : ''] }; };
    return h('span', { class: perm ? 'chip perm' : 'chip', tip },
      art(() => skillIconFor(id), 'art small'),
      perm ? `★ ${missingLabel('skill', id)}` : missingLabel('skill', id));
  };
  const ordered = isClass ? [...permanent, ...ids.filter((id) => !isPerm(id))] : ids;
  // View only: these lists show what the game worked out (adding had no effect in game). Use Kept class levels.
  return h('div', { class: 'card wide' },
    h('h3', {}, `${title} (${ids.length}${isClass ? `, ${permanent.length} permanent` : ''})`),
    h('div', { class: 'chips' }, ordered.length ? ordered.map(chip) : h('span', { class: 'muted' }, 'None.')),
    h('p', { class: 'note' }, note));
}

// ---------------------------------------------------------------- roster changes
function duplicateUnit() {
  const d = state.data;
  const u = d.unit(state.slot);
  if (!confirm(`Copy ${u.name} into a new slot?\n\nThe copy keeps stats, class, skills and plain equipment `
    + `(★ snapshot weapons and ◆ relics stay with the original). Copying a story character can confuse story events; `
    + `copies of generic units are the safest.`)) return;
  try {
    const copy = d.duplicateUnit(state.slot, `${u.name}`.slice(0, 33) + ' II');
    // the copy wears its own pieces: they count as owned (stock includes worn gear)
    if (d.knownLayout) for (const id of copy.equipment) d.coverWorn(id);
    state.slot = copy.slot;
    markDirty();
    render();
    status(`Added ${copy.name} in slot ${copy.slot + 1}.`);
  } catch (e) { status(e.message, true); }
}

function removeUnit() {
  const d = state.data;
  const u = d.unit(state.slot);
  if (!confirm(`Remove ${u.name} from the roster?\n\nTheir plain equipment stays in the inventory; snapshot weapons and relics become free to equip. Later units move up one slot.`)) return;
  try {
    d.removeUnit(state.slot);
    state.slot = Math.max(0, state.slot - 1);
    markDirty();
    render();
    status(`Removed ${u.name}.`);
  } catch (e) { status(e.message, true); }
}

// ---------------------------------------------------------------- character export / import
const UNIT_FILE = 'tor-save-editor-unit';
function fromBase64(text) {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/** Download the selected unit as a .torunit.json file. */
function exportUnit() {
  const d = state.data, u = d.unit(state.slot);
  const pack = d.exportUnit(state.slot);
  const file = {
    format: UNIT_FILE, version: 1, exported: new Date().toISOString(), saveVersion: d.version,
    name: u.name, class: className(u.cls), level: u.level,
    record: toBase64(pack.record),
    relics: pack.relics.map((r) => ({ slot: r.slot, name: T().armsName(r.record[0] | (r.record[1] << 8)), record: toBase64(r.record) })),
    snapshots: pack.snapshots.map((s) => ({ slot: s.slot, type: s.type, record: toBase64(s.record) })),
  };
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(u.name || 'unit').replace(/[^\w .'-]+/g, '_')}.torunit.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  status(`Exported ${u.name}${pack.relics.length || pack.snapshots.length ? ` with ${pack.relics.length} relic(s) and ${pack.snapshots.length} snapshot weapon(s)` : ''}.`);
}
/** Read an exported unit file and ask where to put it. */
async function importUnitFile(fileObj) {
  const d = state.data;
  let file, pack;
  try {
    file = JSON.parse(await fileObj.text());
    if (file.format !== UNIT_FILE) throw new Error('This is not a unit exported by the TO:R Save Editor.');
    pack = {
      record: fromBase64(file.record),
      relics: (file.relics ?? []).map((r) => ({ slot: r.slot, record: fromBase64(r.record) })),
      snapshots: (file.snapshots ?? []).map((s) => ({ slot: s.slot, type: s.type, record: fromBase64(s.record) })),
    };
    if (pack.record.length !== UNIT.size) throw new Error('The unit in this file has the wrong size.');
  } catch (e) { status(`Could not read ${fileObj.name}: ${e.message}`, true); return; }
  const cur = d.unit(state.slot);
  const extras = [pack.relics.length && `${pack.relics.length} relic${pack.relics.length > 1 ? 's' : ''}`, pack.snapshots.length && `${pack.snapshots.length} snapshot weapon${pack.snapshots.length > 1 ? 's' : ''}`].filter(Boolean);
  const dlg = h('dialog');
  const close = () => { dlg.close(); dlg.remove(); };
  const go = (replace) => {
    if (replace !== null && replace === 0 && !confirm(`Replace your leader ${cur.name}? The load menu will show the new name.`)) return;
    try {
      const { unit, notes } = d.importUnit(pack, replace);
      state.slot = unit.slot;
      markDirty(); close(); render();
      status(`Imported ${unit.name} into slot ${unit.slot + 1}.${notes.length ? ' ' + notes.join(' ') : ''}`, notes.length > 0);
    } catch (e) { status(e.message, true); }
  };
  dlg.append(h('h2', {}, `Import ${file.name || 'unit'}`),
    h('p', {}, `${file.class ?? ''} · Lv ${file.level ?? '?'}${extras.length ? ` · with ${extras.join(' and ')}` : ''}`),
    h('p', { class: 'note' }, 'The character comes with stats, class, skills, kept class levels and equipment. ',
      'Relics and snapshot weapons are re-created in free slots in this save. Importing a story character next to the original can confuse story events.'),
    h('menu', {},
      h('button', { onclick: close }, 'Cancel'),
      h('button', { onclick: () => go(state.slot), title: `${cur.name} is removed; their plain gear stays in the inventory` }, `Replace ${cur.name}`),
      h('button', { class: 'primary', onclick: () => go(null), disabled: d.unitCount() >= UNIT.usable }, 'Add as new unit')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
}
$('import-unit').addEventListener('click', () => { $('import-file').value = ''; $('import-file').click(); });
$('import-file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importUnitFile(f); });

// ---------------------------------------------------------------- inventory
function renderInventory() {
  const pane = $('tab-inventory');
  const d = state.data;
  if (!d) { pane.replaceChildren(h('p', { class: 'muted pad' }, 'Open a save first.')); return; }
  const general = h('div', { class: 'card' }, h('h3', {}, 'Army'),
    h('div', { class: 'grid2' },
      h('label', {}, 'Goth'), numberInput(d.goth, (v) => { d.goth = v; markDirty(); }, { min: 0, max: 99999999, style: 'width:120px' }),
      h('label', {}, 'Army name'), h('input', { type: 'text', value: d.armyName, maxLength: 32, onchange: (e) => { d.armyName = e.target.value; markDirty(); } }),
      ...(d.knownLayout ? [
        h('label', { title: 'Units cannot level past this. The story raises it; the game maximum is 50.' }, 'Union Level'),
        numberInput(d.unionLevel, (v) => { d.unionLevel = v; markDirty(); renderInventory(); }, { min: 1, max: 50 }),
        h('label', { title: 'How many turns the Chariot Tarot can rewind (10 early in the game, 50 late).' }, 'Chariot rewind turns'),
        numberInput(d.chariotTurns, (v) => { d.chariotTurns = v; markDirty(); renderInventory(); }, { min: 1, max: 50 }),
      ] : [])),
    d.knownLayout ? h('p', { class: 'note' }, 'Union Level caps unit levels (max 50). Found from save comparisons; check in game after changing.') : null);
  if (!d.knownLayout) {
    pane.replaceChildren(h('div', { class: 'inv' }, general,
      h('div', { class: 'card' }, h('h3', {}, 'Inventory'), h('p', { class: 'muted' }, 'This save has a different layout, so stock editing is turned off to keep it safe.'))));
    return;
  }
  const filter = state.invFilter.toLowerCase();
  // relic copies by base id, and who has each one equipped
  const copies = new Map();
  for (let i = 0; i < INVENTORY.customCount; i++) if (d.customOwned(i)) { const b = d.customBase(i); copies.set(b, (copies.get(b) ?? 0) + 1); }
  const wearer = new Map();
  for (const u of d.units()) for (const id of u.equipment) if (id >= CUSTOM_BASE) wearer.set(id, u.name);
  const addRelic = (base, bonus) => {
    try { d.addRelic(base, bonus); markDirty(); renderInventory(); } catch (e) { status(e.message, true); }
  };
  const relicCell = (id) => {
    const stock = d.armsStock(id);
    return h('td', { class: 'num relic-cell' },
      h('span', { class: 'muted small' }, `relic · ${copies.get(id) ?? 0} owned `),
      stock ? h('button', { title: 'Relics are kept as single copies, not stock. Turns this stock into that many copies.',
        onclick: () => { for (let n = 0; n < stock; n++) d.addRelic(id, state.relicBonus); d.setArmsStock(id, 0); markDirty(); renderInventory(); } }, `Fix ${stock} stacked → copies`)
        : h('button', { title: 'Add one copy of this relic', onclick: () => addRelic(id, state.relicBonus) }, '+1 copy'));
  };
  const stockTable = (entries, get, set, relics = false) => {
    const shown = (id) => get(id) > 0 || (relics && isRelic(id) && copies.get(id));
    const rows = entries.filter(({ id, name }) => (!filter || name.toLowerCase().includes(filter)) && (!state.invOwnedOnly || shown(id)))
      .map(({ id, name }) => h('tr', { class: shown(id) ? '' : 'zero' }, h('td', { class: 'icon', tip: () => itemTip(id) }, art(() => spellIconFor(id))), h('td', { tip: () => itemTip(id) }, name),
        relics && isRelic(id) ? relicCell(id) : h('td', { class: 'num' }, h('input', { class: 'count', type: 'number', min: 0, max: MAX_STOCK, value: get(id),
          onchange: (e) => { set(id, Number(e.target.value)); markDirty(); e.target.value = get(id); } }))));
    return h('div', { class: 'list' }, h('table', {}, h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { class: 'muted' }, 'Nothing matches.')))));
  };
  // ---- relic copies
  const relicOptions = [{ id: 0, name: '— choose a relic —' }, ...[...state.relics].map((id) => ({ id, name: T().armsName(id) || `Equipment ${id}` })).sort((a, b) => a.name.localeCompare(b.name))];
  let pick = 0;
  const relicRows = [];
  for (let i = 0; i < INVENTORY.customCount; i++) {
    if (!d.customOwned(i)) continue;
    const id = CUSTOM_BASE + i, label = itemLabel(id);
    if (filter && !label.toLowerCase().includes(filter)) continue;
    const b = d.relicBonuses(i), max = Math.max(...b), total = b.reduce((x, y) => x + y, 0);
    relicRows.push({ label, row: h('tr', { tip: () => relicTip(i) }, h('td', { class: 'icon' }, art(() => itemIconFor(id))), h('td', {}, label),
      h('td', { class: 'num', title: `Bonus values: ${b.join(', ')}` }, `bonus ${total} (max ${max})`),
      h('td', {}, numberInput(max, (v) => { d.setRelicBonuses(i, v); markDirty(); renderInventory(); }, { min: 0, max: 15, title: 'Set every bonus of this copy to this value (0–15)', style: 'width:52px' })),
      h('td', { class: 'muted' }, wearer.get(id) ? `on ${wearer.get(id)}` : 'in stock'),
      h('td', {}, wearer.get(id) ? '' : h('button', { title: 'Remove this copy', onclick: () => { d.removeRelic(i); markDirty(); renderInventory(); } }, '×'))) });
  }
  relicRows.sort((a, b) => a.label.localeCompare(b.label));
  const relicCard = h('div', { class: 'card wide relics' }, h('h3', {}, `Relics (${[...copies.values()].reduce((a, b) => a + b, 0)} copies)`),
    h('div', { class: 'tools' },
      (() => { const holder = h('span', { class: 'relic-pick' }); const draw = () => holder.replaceChildren(iconSelect(relicOptions, pick, (v) => { pick = v; draw(); }, itemIconFor, 'item')); draw(); return holder; })(),
      h('label', { class: 'small' }, 'bonus ', numberInput(state.relicBonus, (v) => { state.relicBonus = Math.max(0, Math.min(15, v)); }, { min: 0, max: 15, style: 'width:52px' })),
      h('button', { onclick: () => { if (pick) addRelic(pick, state.relicBonus); } }, 'Add copy')),
    h('div', { class: 'list short' }, h('table', {}, h('tbody', {}, relicRows.length ? relicRows.map((r) => r.row) : h('tr', {}, h('td', { class: 'muted' }, filter ? 'Nothing matches.' : 'None owned.'))))),
    h('p', { class: 'note' }, 'Each relic is its own copy (equipment id 3000+n) with its own stat bonuses, which upgrading raises (0–15 seen). ',
      'A new copy duplicates an owned copy of the same relic when there is one, like a duplicate drop; otherwise every bonus is set to the bonus value. ',
      'The game upgrades a relic by combining two copies. Relics never use the stock counts, so stock edits for relics are blocked.'));
  const arms = [];
  for (let id = 1; id < state.armsType.length; id++) { const name = T().armsName(id); if (name) arms.push({ id, name }); }
  arms.sort((a, b) => a.name.localeCompare(b.name));
  const items = [];
  const ct = T().tables.commodity;
  for (let i = 1; i < Math.min(ct.count, INVENTORY.itemsCount); i++) { const name = T().commodityName(i); if (name) items.push({ id: 1000 + i, name }); }
  items.sort((a, b) => a.name.localeCompare(b.name));
  const tools = h('div', { class: 'tools' },
    h('input', { type: 'search', placeholder: 'Filter by name…', value: state.invFilter,
      oninput: (e) => { state.invFilter = e.target.value; renderInventory(); document.querySelector('#tab-inventory input[type=search]')?.focus(); } }),
    h('label', {}, h('input', { type: 'checkbox', checked: state.invOwnedOnly, onchange: (e) => { state.invOwnedOnly = e.target.checked; renderInventory(); } }), ' Owned only'),
    h('span', { class: 'muted small' }, `Stock is capped at ${MAX_STOCK}. It is the total owned: worn pieces are counted too.`));
  const special = [];
  for (let i = 0; i < INVENTORY.namedCount; i++) {
    const present = d.u8(d.snapshotOffset(i)), owned = d.namedOwned(i);
    if (!present && !owned) continue;
    const s = d.snapshot(i), who = wearerOf(NAMED_BASE + i);
    special.push(present
      ? h('tr', { class: 'clickable', tip: () => { const t = snapshotTip(i); return { ...t, lines: [...t.lines, 'Click to edit'] }; }, onclick: () => openSnapshotBuilder(i) },
        h('td', { class: 'icon' }, art(() => itemIconFor(SNAPSHOT.baseItem + s.type))),
        h('td', {}, s.name || '(no name)', h('div', { class: 'muted small' }, `${weaponTypeName(s.type)} · ATK ${s.atk} · ${enumName('element', s.element)}`)),
        h('td', { class: 'muted' }, who ? `on ${who}` : 'in stock'))
      : h('tr', { class: 'zero', tip: () => snapshotTip(i) },
        h('td', { class: 'icon' }, art(() => itemIconFor(SNAPSHOT.baseItem + s.type))),
        h('td', {}, `Cursed Weapon (${weaponTypeName(s.type)})`, h('div', { class: 'muted small' }, 'not made yet')), h('td', { class: 'muted' }, '')));
  }
  pane.replaceChildren(h('div', { class: 'inv' },
    h('div', { class: 'inv-col' }, general,
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Snapshot weapons'),
        h('button', { onclick: () => openSnapshotBuilder(null) }, '+ New snapshot weapon')),
        h('div', { class: 'list snapshots' }, h('table', {}, h('tbody', {}, special.length ? special : h('tr', {}, h('td', { class: 'muted' }, 'None owned.'))))),
        h('p', { class: 'note' }, 'Click a weapon to edit it.')),
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Equipment stock'), tools, stockTable(arms, (id) => d.armsStock(id), (id, n) => d.setArmsStock(id, n), true)),
    h('div', { class: 'card' }, h('h3', {}, 'Item stock'), tools.cloneNode(false), stockTable(items, (id) => d.itemStock(id), (id, n) => d.setItemStock(id, n))),
    relicCard));
  // the second card shares the first card's filter; give it a short note instead of a second filter box
  pane.querySelectorAll('.inv .card .tools')[1]?.append(h('span', { class: 'muted small' }, 'Uses the filter above.'));
}

// ---------------------------------------------------------------- snapshot builder
/** Item type (= weapon skill id) of snapshot weapon type t (its "Cursed Weapon" base item). */
const snapshotWeaponType = (t) => state.armsType[SNAPSHOT.baseItem + t] ?? 0;
const weaponTypeName = (t) => T().skillName(snapshotWeaponType(t)) || `Type ${t + 1}`;
const enumName = (kind, id) => state.enums?.[kind]?.find((o) => o.id === id)?.name ?? (kind === 'element' ? ELEMENTS[id] : '') ?? `#${id}`;
function wearerOf(id) {
  for (const u of state.data.units()) if (u.equipment.includes(id)) return u.name;
  return '';
}
/**
 * Create (n = null) or edit snapshot weapon n. Snapshot (cursed) weapons are
 * made in game by sacrificing a unit into a Cursed Weapon; the record keeps
 * the stats it took. This dialog writes those stats directly.
 */
function openSnapshotBuilder(n) {
  const d = state.data;
  const editing = n !== null;
  const types = Array.from({ length: SNAPSHOT.types }, (_, t) => {
    const used = Array.from({ length: SNAPSHOT.perType }, (_, k) => t * SNAPSHOT.perType + k).filter((k) => d.namedOwned(k) || d.u8(d.snapshotOffset(k))).length;
    return { id: t, name: `${weaponTypeName(t)} (${used} of ${SNAPSHOT.perType} slots used)` };
  });
  const existing = [];
  for (let k = 0; k < INVENTORY.namedCount; k++) if (d.u8(d.snapshotOffset(k))) existing.push({ id: k, name: `${d.snapshot(k).name || '(no name)'} · ${weaponTypeName(Math.floor(k / SNAPSHOT.perType))}` });
  // starting values: the weapon itself, or a sensible blank
  const blank = { name: '', type: 0, rt: 32, atk: 100, def: 10, hp: 0, mp: 0, str: 0, vit: 0, dex: 0, agi: 0, avd: 0, int: 0, mnd: 0, res: 0, damageType: 0, damageBonus: 0, obstacle: 3, race: 0, raceBonus: 0, element: 0, elementBonus: 0 };
  const s = editing ? d.snapshot(n) : { ...blank, type: types.find((t) => d.freeSnapshotSlot(t.id) >= 0)?.id ?? 0 };
  const dlg = h('dialog', { class: 'snapshot-dialog' });
  const close = () => { dlg.close(); dlg.remove(); };
  const num = (key) => {
    const [, , label, max] = SNAPSHOT.stats.find((x) => x[0] === key);
    return [h('label', {}, label), numberInput(s[key], (v) => { s[key] = Math.max(0, Math.min(max, v | 0)); }, { min: 0, max, title: max === 127 ? 'The game caps this at 127' : '' })];
  };
  const pick = (key, list, iconFor) => {
    const holder = h('span', { class: 'with-picker' });
    const draw = () => holder.replaceChildren(iconFor
      ? iconSelect(list, s[key], (v) => { s[key] = v; draw(); }, iconFor)
      : select(list, s[key], (v) => { s[key] = v; }));
    draw();
    return holder;
  };
  const err = h('p', { class: 'note bad' });
  const nameInput = h('input', { type: 'text', value: s.name, maxLength: SNAPSHOT.nameMax, placeholder: 'Name the weapon', oninput: (e) => { s.name = e.target.value; } });
  const copyFrom = existing.length ? select([{ id: -1, name: '— start from an existing weapon —' }, ...existing], -1, (k) => {
    if (k < 0) return;
    const src = d.snapshot(k);
    for (const [key] of SNAPSHOT.stats) s[key] = src[key];
    body.replaceChildren(...form());
  }) : null;
  const form = () => [
    h('div', { class: 'grid2' },
      h('label', {}, 'Name'), nameInput,
      h('label', {}, 'Weapon type'), editing
        ? h('span', {}, weaponTypeName(s.type), h('span', { class: 'muted small' }, ' (fixed by its slot)'))
        : pick('type', types, (t) => itemIconFor(SNAPSHOT.baseItem + t)),
      copyFrom ? h('label', {}, 'Copy stats') : null, copyFrom),
    h('h3', { style: 'margin-top:12px' }, 'Weapon'),
    h('div', { class: 'snap-grid' }, ...num('atk'), ...num('def'), ...num('rt'), ...num('obstacle')),
    h('h3', { style: 'margin-top:12px' }, 'Affinities'),
    h('div', { class: 'snap-grid' },
      h('label', {}, 'Damage type'), pick('damageType', state.enums?.damageType ?? [], damageTypeIconFor), ...num('damageBonus'),
      h('label', {}, 'Element'), pick('element', state.enums?.element ?? [], elementIconFor), ...num('elementBonus'),
      h('label', {}, 'Race'), pick('race', state.enums?.race ?? [], raceIconFor), ...num('raceBonus')),
    h('h3', { style: 'margin-top:12px' }, 'Stat bonuses'),
    h('div', { class: 'snap-grid' }, ...['hp', 'mp', 'str', 'vit', 'dex', 'agi', 'avd', 'int', 'mnd', 'res'].flatMap(num)),
  ];
  const body = h('div', {}, ...form());
  const save = () => {
    try {
      if (!s.name.trim()) throw new Error('Give the weapon a name.');
      if (editing) d.setSnapshot(n, s);
      else { const k = d.createSnapshot(s.type, s); status(`Created ${s.name} (snapshot #${k}).`); }
      markDirty(); close(); renderInventory();
      if (state.tab === 'units') renderUnit();
    } catch (e) { err.textContent = e.message; }
  };
  const del = editing ? h('button', {
    class: 'danger', disabled: !!wearerOf(NAMED_BASE + n), title: wearerOf(NAMED_BASE + n) ? `Equipped by ${wearerOf(NAMED_BASE + n)}; unequip it first` : 'Delete this weapon',
    onclick: () => { if (confirm(`Delete ${s.name}?`)) { try { d.deleteSnapshot(n); markDirty(); close(); renderInventory(); } catch (e) { err.textContent = e.message; } } },
  }, 'Delete') : null;
  dlg.append(h('h2', {}, editing ? `Edit snapshot weapon #${n}` : 'New snapshot weapon'),
    h('p', { class: 'note' }, 'In game a snapshot (cursed) weapon is made by sacrificing a unit; it keeps a snapshot of that unit’s stats. Here you set them directly. ',
      'Each weapon type has 5 slots. HP to RES are capped at 127 by the game.'),
    body, err,
    h('menu', {}, del, h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Cancel'), h('button', { class: 'primary', onclick: save }, editing ? 'Save changes' : 'Create weapon')));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  nameInput.focus();
}

async function renderBackups() {
  const pane = $('tab-backups');
  try {
    const { folder, backups } = await (await api('/api/backups')).json();
    pane.replaceChildren(h('div', { class: 'backups' },
      h('p', {}, 'Every save the editor writes is copied here first, in a folder named after the date and time:'),
      h('p', {}, h('code', {}, folder)),
      h('p', { class: 'muted' }, 'To undo a save, close the game and copy the backed-up GAME-….SAV file back into your save folder.'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Edited'), h('th', {}, 'Written to'), h('th', {}, 'Folder'))),
        h('tbody', {}, backups.length ? backups.map((b) => h('tr', {}, h('td', {}, b.time), h('td', {}, b.editedFrom), h('td', {}, b.writtenTo), h('td', { class: 'muted small' }, b.folder)))
          : h('tr', {}, h('td', { class: 'muted' }, 'No backups yet.'))))));
  } catch (e) { pane.replaceChildren(h('p', { class: 'pad bad' }, e.message)); }
}

// ---------------------------------------------------------------- saving
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function write(target) {
  const d = state.data;
  const leaderChanged = d.unit(0).name !== new SaveData(state.original).unit(0).name;
  status('Saving…');
  try {
    const res = await api(`/api/save?name=${encodeURIComponent(state.name)}&target=${encodeURIComponent(target)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main: toBase64(d.bytes), expectSha256: state.sha, leaderName: leaderChanged || target !== state.name ? d.unit(0).name : null }),
    });
    const result = await res.json();
    if (target === state.name && result.written) {
      state.sha = result.sha256;
      state.original = d.bytes.slice();
      clearDirty();
    }
    await loadSaveList(state.name);
    status(result.message);
  } catch (e) { status(`Not saved: ${e.message}`, true); }
}

function saveCopy() {
  const dlg = $('copy-dialog');
  const used = new Set(state.saves.map((s) => s.slot));
  let free = 1; while (used.has(free)) free++;
  $('copy-slot').value = free;
  const note = () => {
    const n = Number($('copy-slot').value);
    $('copy-note').textContent = n === 0 ? 'Slot 0 is the autosave.' : used.has(n) ? `Slot ${n} has a save; it will be backed up and replaced.` : `Slot ${n} is empty. New slot numbers may not show in the game's load list until it rescans; existing slots are the safest choice.`;
  };
  $('copy-slot').oninput = note; note();
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const n = Number($('copy-slot').value);
    write(`GAME-${String(n).padStart(8, '0')}.SAV`);
  };
  dlg.showModal();
}

// ---------------------------------------------------------------- wiring
$('save-select').addEventListener('change', (e) => openSave(e.target.value).catch((err) => status(err.message, true)));
$('reload').addEventListener('click', async () => {
  try {
    await loadSaveList();
    if (state.name && !state.dirty) await openSave(state.name);
  } catch (e) { status(e.message, true); }
});
$('revert').addEventListener('click', () => {
  if (!confirm('Undo every change since the save was opened or last saved?')) return;
  state.data = new SaveData(state.original.slice());
  state.slot = Math.min(state.slot, state.data.unitCount() - 1);
  clearDirty();
  render();
  status('Changes undone.');
});
$('save').addEventListener('click', () => write(state.name));
$('save-copy').addEventListener('click', saveCopy);
for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    for (const t of document.querySelectorAll('.tabs button')) t.setAttribute('aria-selected', String(t === tab));
    for (const name of ['units', 'inventory', 'backups']) $(`tab-${name}`).hidden = name !== state.tab;
    if (state.tab === 'inventory') renderInventory();
    if (state.tab === 'backups') renderBackups();
  });
}
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

boot();

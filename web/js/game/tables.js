// battle_data_release.dat tables used to turn IDs into names.
// Table slots and name-field offsets come from Gibbed's sheet formats,
// Asvel's datamining extracts and the tactics-ogre-tool modules; each table
// is checked by row size so a mismatch fails loudly instead of mislabeling.

import { isXlce, parsePakd, parseXlce, view } from '../lib/pakd.js';
import { battleData } from './battledata.js';
import {customLook} from './customcharacters.js';
import {source} from './source.js';
import { AI_ENTRY, AI_ROW, aiLabels } from './aiprofiles.js';
import {setProjectPoseGroups} from './actorposes.js';

const TABLES = {
  armament: { entry: 11, rowSize: 152 },
  commodity: { entry: 13, rowSize: 56 },
  class: { entry: 14, rowSize: 208 },
  effect: { entry: 16, rowSize: 180 },
  stage: { entry: 17, rowSize: 230 },
  unitTemplate: { entry: 23, rowSize: 84 },
  union: { entry: 36, rowSize: 4 },
  mapBlock: { entry: 24, rowSize: 34 },
  skill: { entry: 25, rowSize: 102, expandedRowSize: 166 },
  aiProfile: { entry: AI_ENTRY, rowSize: AI_ROW }, // see aiprofiles.js
  spellPreset: { entry: 72, rowSize: 24 },
};

const u16 = (row, offset) => view(row).getUint16(offset, true);

/**
 * The unit palette bank: battle data entry 2 is a pakd holding, among
 * textures, an ImageFile with no picture and 65 palettes of 256 RGBA colours
 * (0 = player blue/green = the default palette, 1 Bakram, 2 Galgastan, ...).
 */
function readPaletteBank(container) {
  if (!container || view(container).getUint32(0, true) !== 0x646B6170) return null;
  for (const e of parsePakd(container).entries) {
    const d = e.data;
    if (d.length < 0x40) continue;
    const v = view(d);
    if (v.getUint32(0, true) !== 0 || v.getUint16(8, true) !== 1 || v.getUint16(10, true) !== 16) continue;
    const textureOffset = v.getUint32(0x14, true), paletteBase = v.getUint32(0x18, true);
    const paletteTable = v.getUint32(0x1C, true), count = v.getUint32(0x20, true);
    if (textureOffset !== paletteBase || count < 20) continue; // palettes only
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = 0x10 + paletteBase + v.getUint32(0x10 + paletteTable + i * 4, true);
      const size = v.getUint32(p + 4, true);
      out.push(d.subarray(p + v.getUint32(p + 8, true), p + v.getUint32(p + 8, true) + size));
    }
    return out;
  }
  return null;
}
const pad = (n, width) => String(n).padStart(width, '0');

export const ELEMENTS = ['None', 'Air', 'Earth', 'Lightning', 'Water', 'Fire', 'Ice', 'Light', 'Dark', 'From template'];
export const FACING = ['East', 'South', 'West', 'North'];
export const TEAMS = { 1: 'Blue: guest / friendly', 2: 'Red: enemy', 3: 'Green: neutral / ally' };
export const ALIGNMENTS = ['None', 'Lawful', 'Neutral', 'Chaotic'];
export const CLANS = ['Unknown', 'Walister', 'Galgastan', 'Bakram', 'Xenobia', 'Lodis', 'Bolmocca', 'Balboede'];
export const ARMS_AUTO = 999; // keep an equipment slot empty during automatic generation
export const isSpell = (row) => row[2] >= 1 && row[2] <= 13;
const isFinisher = (row) => row[2] >= 22 && row[2] <= 43;

let previewTables=null;
export const previewPalette=index=>previewTables?.palette(index);

export class GameTables {
  static async load(texts, info) {
    info ??= await source.info();
    const [{ dat }, schema, rules] = await Promise.all([
      battleData(), fetch('data/schemas/template.json').then(r=>r.json()),
      info.specialClassChangeEnabled ? source.menuMods() : null,
    ]);
    const result = new GameTables(dat, texts, info.customCharacters ?? [], schema.labels ?? {}, info.trapAiProfile);
    result.classRules = rules;
    result.levelLimit = info.levelCap99Enabled ? 99 : 50;
    return result;
  }

  constructor(dat, texts, characters=[], labels={}, trapAiProfile=0) {
    this.customCharacters=characters;this.templateLabels=labels;this.trapAiProfile=trapAiProfile;
    this.texts = texts;
    this.dat = dat;
    this.levelLimit = 50;
    this.palettes = readPaletteBank(dat.pakd.entries[2]?.data);
    previewTables=this;
    // project characters animate like their sheet says (animation type byte = native family)
    try{const t=parseXlce(dat.pakd.entries[23].data);setProjectPoseGroups(characters.filter(c=>c.template<t.count).map(c=>[c.stem,t.row(c.template)[0x3c]]));}catch(e){console.warn('project character families:',e);}
  }

  get tables() {
    if (this.tablePack === this.dat.pakd) return this.loadedTables;
    const tables = {};
    for (const [name, spec] of Object.entries(TABLES)) {
      const entry = this.dat.pakd.entries[spec.entry];
      if (!entry || !isXlce(entry.data)) throw new Error(`battle data: table ${name} is missing`);
      const table = parseXlce(entry.data);
      if (table.rowSize !== spec.rowSize && table.rowSize !== spec.expandedRowSize) {
        throw new Error(`battle data: table ${name} has ${table.rowSize}-byte rows, expected ${spec.rowSize}`);
      }
      tables[name] = table;
    }
    this.tablePack = this.dat.pakd;
    this.loadedTables = tables;
    this.invalidateLists();
    return tables;
  }

  invalidateLists() { this.cachedLists = null; }

  get lists() {
    const tables = this.tables;
    return this.cachedLists ??= this.buildLists(tables);
  }

  updateProjectOptions(mods) {
    if (!mods) return;
    this.classRules = { ...mods.saved, settings: mods.value, communityClassGroups: mods.communityGroups,
                        builtinClassGroupOverrides: mods.builtinClassGroupOverrides };
    this.levelLimit = mods.value.levelCap99 ? 99 : 50;
    this.trapAiProfile = mods.value.trapAiProfile;
    this.invalidateLists();
  }

  /**
   * Palette a unit is drawn with (index into the 65-palette bank). Rule
   * inferred from the data: an explicit template palette (+0x3D, not 0/0xFF)
   * wins; then the class palette (+0x94) unless 0xFF ("faction-dependent");
   * then the unit's union (+0x17) primary palette.
   */
  unitPalette(row) {
    const templateId = view(row).getUint16(0x02, true);
    const t = this.tables.unitTemplate;
    const tpl = templateId < t.count ? t.row(templateId)[0x3D] : 0;
    if (tpl !== 0 && tpl !== 0xFF) return tpl;
    const c = this.tables.class;
    const cls = row[0x06] < c.count ? c.row(row[0x06])[0x94] : 0xFF;
    if (cls !== 0xFF) return cls;
    const u = this.tables.union;
    return row[0x17] < u.count ? u.row(row[0x17])[0x02] : 0;
  }

  /** 256 RGBA colours for a palette index, or null if the bank wasn't found. */
  palette(index) {
    return this.palettes?.[index] ?? this.palettes?.[0] ?? null;
  }

  text(key) {
    const v = this.texts.get(key);
    return v && v !== 'NOT USED' && v !== 'Not Use' && v !== 'nothing' ? v : '';
  }

  rowField(table, id, offset) {
    const t = this.tables[table];
    return id >= 0 && id < t.count ? u16(t.row(id), offset) : -1;
  }

  className(id, female = false) {
    const nameId = this.rowField('class', id, 0xB2);
    if (nameId < 0) return '';
    const base = `CLASS_TEXT_DATA_CLASS${pad(nameId, 4)}`;
    return (female && this.text(`${base}_FEMALE`)) || this.text(`${base}_MALE`) || this.text(`${base}_FEMALE`);
  }

  armsName(id) {
    const nameId = this.rowField('armament', id, 0x86);
    return nameId < 0 ? '' : this.text(`ARMSTEXT_LC_ARMS_${pad(nameId, 3)}_NAME`);
  }

  commodityName(id) {
    return this.text(`COMMODITYTEXT_LC_COMMODITY_${pad(id, 3)}_NAME`);
  }

  /** Items share one ID space: below 1000 are arms, 1000+ are consumables. */
  itemName(id) {
    if (!id) return '';
    if (id === ARMS_AUTO) return 'Leave empty (skip auto equipment)';
    return id < 1000 ? this.armsName(id) : this.commodityName(id - 1000);
  }

  skillName(id) {
    const nameId = this.rowField('skill', id, 0x5A);
    return nameId < 0 ? '' : this.text(`SKILLTEXT_LC_SKILL_${pad(nameId, 3)}_NAME`);
  }

  effectName(id) {
    const nameId = this.rowField('effect', id, 0x94);
    return nameId < 0 ? '' : this.text(`EFFECTTEXT_LC_EFFECT_${pad(nameId, 3)}_NAME`);
  }

  unitName(id) {
    return id ? this.text(`UNITNAME0_LC_UNITNAME_${pad(id, 4)}_TEXT`) : '';
  }

  /** Class-change permissions use the template's class set, including unique characters. */
  classOptionsFor(templateId, currentClass) {
    const templates=this.tables.unitTemplate,classes=this.tables.class;
    const tpl=templateId>=0&&templateId<templates.count?templates.row(templateId):null;
    const set=tpl?.[0x38],female=tpl?.[3]===1;
    const options=this.lists.class.map(o=>({...o,name:this.className(o.id,female)||o.name}));
    if(set===undefined||set>=64)return options;
    const native = (id) => !!(classes.row(id)[0x88+(set>>3)] & (1<<(set&7)));
    const rules = this.classRules;
    const active = rules?.settings?.specialClassChange;
    const community = active && rules.communityClassGroups?.find((group) => group.templates.includes(templateId));
    const builtin = active && !community && rules.builtinClassGroups?.find((group) => group.templates.includes(templateId));
    const edits = builtin && rules.builtinClassGroupOverrides?.[builtin.id];
    const templar = active && currentClass >= 81 && currentClass <= 96;
    const permitted = (id) => {
      if (templar) return id >= 81 && id <= 96 && id !== 92;
      if (active && id >= 81 && id <= 96) return false;
      if (community) return community.classes.includes(id);
      if (builtin) return edits?.[id] ?? (id === 12 && rules.settings.rougesReborn ? native(id) : builtin.classes.includes(id));
      return native(id);
    };
    const groups = [[], []];
    for (const o of options) {
      if (!o.id) { groups[0].push(o); continue; }
      const normal = permitted(o.id);
      groups[normal ? 0 : 1].push({ ...o, group: normal ? 'Normally allowed' : 'Other classes' });
    }
    return groups.flat();
  }

  customCharacter(id){return this.customCharacters.find(c=>c.template===Number(id))??null;}

  templateName(id) {
    if (!id || id >= this.tables.unitTemplate.count || !this.tables.unitTemplate.row(id).some(Boolean)) return '';
    const label = (this.templateLabels[id] ?? '').replace(/^<not used>\s*/i, '');
    return this.customCharacter(id)?.name || label || `Character sheet ${id}`;
  }

  itemRecord(id) {
    const kind = id < 1000 ? 'armament' : 'commodity';
    const index = id < 1000 ? id : id - 1000;
    const table = this.tables[kind];
    if (id === ARMS_AUTO || index < 0 || index >= table.count) return null;
    return { kind, index, row: table.row(index) };
  }

  spellProfileOptions(classId) {
    const options = [{ id: 0, name: 'Off' }];
    const profiles = this.tables.spellPreset;
    for (let index = 1; index < profiles.count; index++) {
      const [owner, profile] = profiles.row(index);
      if (owner === classId && profile && !options.some(o => o.id === profile)) {
        options.push({ id: profile, name: `Profile ${profile} · preset #${index}` });
      }
    }
    return options.sort((a,b) => a.id-b.id);
  }

  template(id) {
    const t = this.tables.unitTemplate;
    if (id < 0 || id >= t.count) return null;
    const row = t.row(id);
    const stat = (o) => row[o];
    return {
      female: row[0x03] === 1,
      hp: u16(row, 0x18), mp: u16(row, 0x1A),
      str: stat(0x1E), vit: stat(0x20), dex: stat(0x22), agi: stat(0x24),
      avd: stat(0x26), int: stat(0x28), mnd: stat(0x2A), res: stat(0x2C),
    };
  }

  // ---- unit graphics --------------------------------------------------
  // Each battle lists, per unit, [actor sprite set, unit sprite file] to load.
  // Rule (holds for all 8,632 stock units): a template with a sprite override
  // (template +0x3A) uses that set; otherwise the class row's set for the
  // template's gender (+0x90 male / +0x92 female), with the unit sprite being
  // one of the class's 7 colour variants (+0x68 male / +0x76 female).

  templateSprite(templateId) {
    return this.rowField('unitTemplate', templateId, 0x3A);
  }

  isFemale(templateId) {
    const t = this.tables.unitTemplate;
    return templateId >= 0 && templateId < t.count && t.row(templateId)[0x03] === 1;
  }

  classSprite(classId, female) {
    return this.rowField('class', classId, female ? 0x92 : 0x90);
  }

  classVariants(classId, female) {
    const t = this.tables.class;
    if (classId < 0 || classId >= t.count) return [];
    const row = t.row(classId);
    const base = female ? 0x76 : 0x68;
    return Array.from({ length: 7 }, (_, i) => u16(row, base + i * 2));
  }

  /** Remember which unit sprites each actor set uses across the stock battles. */
  observeSprites(docs) {
    this.actorSprites = new Map();
    this.previewUnits=docs.flatMap(d=>d.units).filter(u=>u.sprite[0]>0);
    for (const doc of docs) {
      for (const unit of doc.units) {
        const [actor, sprite] = unit.orig ? unit.orig.sprite : unit.sprite;
        if (!this.actorSprites.has(actor)) this.actorSprites.set(actor, new Set());
        this.actorSprites.get(actor).add(sprite);
      }
    }
  }

  /** Preview only: use a unique named owner for character-specific classes. */
  classLook(id,female=false){
    const units=(this.previewUnits??[]).filter(u=>u.row[6]===id);
    const named=units.filter(u=>{const n=u16(u.row,0);return n>0&&n!==255;});
    const owners=new Set(named.map(u=>u16(u.row,0)));
    const actor=this.classSprite(id,female)||this.classSprite(id,!female);
    const unique=owners.size===1&&(!actor||named.length===units.length);
    const diego = id === 63 ? named.find(u => u16(u.row,0) === 139) : null;
    const native = units.find(u => u.sprite[0] === actor && this.isFemale(u16(u.row,2)) === female);
    const unit = diego ?? (unique ? named[0] : native ?? (!actor ? named[0] ?? units[0] : null));
    if(unit)return {actor:unit.sprite[0],palette:this.unitPalette(unit.row),owner:this.unitName(u16(unit.row,0)) || null};
    const cls=this.tables.class.row(id);
    if (actor) return {actor,palette:cls[0x94]===255?0:cls[0x94]};
    const custom=this.customCharacters.find(c=>c.classId===id);
    if (custom) return customLook(custom);
    // Some story jobs, such as Shaman, are learned after recruitment.
    // Their original battle rows still supply the owners' artwork.
    const templates=this.tables.unitTemplate;
    const owner=(this.previewUnits??[]).find(u=>{
      const t=u16(u.row,2);
      const set=t<templates.count ? templates.row(t)[0x38] : 0;
      return set>=16 && set<64 && !!(cls[0x88+(set>>3)] & (1<<(set&7)));
    });
    return owner ? {actor:owner.sprite[0],palette:this.unitPalette(owner.row),owner:this.unitName(u16(owner.row,0))} : null;
  }

  templateLook(id){
    const row=this.tables.unitTemplate.row(id),unit=(this.previewUnits??[]).find(u=>u16(u.row,2)===id);
    const custom=this.customCharacter(id);
    if(unit)return {...(custom?customLook(custom):{}),actor:u16(row,0x3a)||unit.sprite[0],palette:this.unitPalette(unit.row)};
    if(custom)return customLook(custom);
    const actor = u16(row,0x3a);
    if (actor) return { actor, palette:row[0x3d]===255?0:row[0x3d] };
    const family = (n) => /^(.*?) [1-4]$/.exec((this.templateLabels[n]??'').replace(/^<not used>\s*/i,''))?.[1];
    const ownFamily = family(id);
    const donor = ownFamily && this.previewUnits?.find(u=>family(u16(u.row,2))===ownFamily);
    return donor ? { actor:donor.sprite[0], palette:this.unitPalette(donor.row) } : null;
  }

  /** Colour variants available for a unit, as unit sprite IDs. */
  spriteVariants(row) {
    const templateId = view(row).getUint16(0x02, true);
    const override = this.templateSprite(templateId);
    if (override > 0) return [...new Set([...(this.actorSprites?.get(override)??[]),...this.customCharacters.filter(c=>c.actor===override).map(c=>c.appearance)])].sort((a,b)=>a-b);
    return [...new Set(this.classVariants(row[0x06], this.isFemale(templateId)))];
  }

  /**
   * The sprite pair a unit needs after its class or template changed.
   * Keeps the colour variant slot when the class changes. Returns null when
   * the rule has no answer (the caller keeps the old pair and warns).
   */
  spriteFor(row, prevRow, prevSprite) {
    const templateId = view(row).getUint16(0x02, true);
    const override = this.templateSprite(templateId);
    if (override > 0) {
      if (prevSprite[0] === override) return prevSprite;
      const known = this.spriteVariants(row);
      return known.length ? [override, known[0]] : null;
    }
    const female = this.isFemale(templateId);
    const actor = this.classSprite(row[0x06], female);
    const variants = this.classVariants(row[0x06], female);
    if (actor <= 0 || !variants[0]) return null;
    const prevTemplate = view(prevRow).getUint16(0x02, true);
    const prevSlot = this.classVariants(prevRow[0x06], this.isFemale(prevTemplate)).indexOf(prevSprite[1]);
    return [actor, variants[Math.max(0, prevSlot)]];
  }

  buildLists(tables = this.tables) {
    const range = (n) => Array.from({ length: n }, (_, i) => i);
    const empty = { id: 0, name: '' };
    const records = (table, include, nameOf, prefix, base = 0) => range(table.count).flatMap((index) => {
      if (index === 0 && !base) return [empty];
      const row = table.row(index), id = base + index;
      return include(row, id) ? [{ id, name: nameOf(index) || `${prefix} ${id}` }] : [];
    });
    const arms = records(tables.armament, (row, id) => row[2] && id < 1000 && id !== ARMS_AUTO, id => this.armsName(id), 'Equipment');
    const commodities = records(tables.commodity, (row, id) => row[2] && id < 2000, id => this.commodityName(id), 'Item', 1000);
    const effect = records(tables.effect, (row) => row[2], id => this.effectName(id), 'Effect');
    const typeFilter = (test) => effect.filter(({ id }) => !id || test(tables.effect.row(id)));
    const spell = typeFilter(isSpell);
    const books = new Set(commodities.map(({ id }) => tables.commodity.row(id-1000)).filter(row=>row[2]===34).map(row=>u16(row,4)));
    const names = [...this.texts.keys()].map(key => /^UNITNAME0_LC_UNITNAME_(\d+)_TEXT$/.exec(key)).filter(Boolean)
      .map(m => Number(m[1])).filter(id => id > 0 && id <= 65535 && this.unitName(id)).sort((a,b) => a-b);
    return {
      class: records(tables.class, (row, id) => id < 256 && (row[0x55] || this.className(id)), id => this.className(id), 'Class')
        .map(o=>({...o,look:()=>o.id ? this.classLook(o.id) : null})),
      arms: [empty, { id: ARMS_AUTO, name: this.itemName(ARMS_AUTO) }, ...arms.slice(1)],
      commodity: [empty, ...commodities],
      recipeBook: [empty, ...commodities.filter(({id})=>tables.commodity.row(id-1000)[2]===37)],
      item: [empty, ...arms.slice(1).map(o=>({...o,group:'Equipment'})), ...commodities.map(o=>({...o,group:'Items'}))],
      skill: records(tables.skill, row=>row[2], id=>this.skillName(id), 'Skill'),
      effect,
      spell,
      autoSpell: spell.filter(({id})=>!id || books.has(id)),
      finisher: typeFilter(isFinisher),
      unitName: [empty, ...names.map(id=>({ id, name: this.unitName(id), look:()=>{const u=this.previewUnits?.find(u=>u16(u.row,0)===id);return u?{actor:u.sprite[0],palette:this.unitPalette(u.row)}:null;} }))],
      template: records(tables.unitTemplate, row=>row.some(Boolean), id=>this.templateName(id), 'Character sheet')
        .map(o=>({...o,group:this.customCharacter(o.id)?'Project characters':undefined,look:()=>o.id ? this.templateLook(o.id) : null})),
      ai: aiLabels(tables.aiProfile,this.trapAiProfile).filter(({id})=>id<256),
    };
  }
}

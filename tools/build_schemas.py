"""Build editor/web/data/schemas/*.json from tactics-ogre-tool module files.

Field offsets, sizes and labels come from the tactics-ogre-tool modules
(https://github.com/NotSpecCo/tactics-ogre-tool, GPL-3.0), themselves converted
from the community's Nightmare modules. Usage:
    python build_schemas.py <tactics-ogre-tool/modules> <out dir>
"""
import json, re, sys
from pathlib import Path

def json5(text):
    text = re.sub(r'^\s*//.*$', '', text, flags=re.M)
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c == "'":  # single-quoted string -> JSON string
            j, buf = i + 1, []
            while text[j] != "'":
                if text[j] == chr(92): buf.append(text[j + 1]); j += 2; continue  # backslash escape
                buf.append(text[j]); j += 1
            out.append(json.dumps(''.join(buf))); i = j + 1
        else:
            out.append(c); i += 1
    s = ''.join(out)
    s = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', s)
    s = re.sub(r'\b0x([0-9a-fA-F]+)\b', lambda m: str(int(m.group(1), 16)), s)
    s = re.sub(r',(\s*[}\]])', r'\1', s)
    return json.loads(s)

# option files whose values reference live game lists
REFS = {'class.json5': 'class', 'armament.json5': 'arms', 'skill.json5': 'skill', 'effect.json5': 'effect',
        'commodity_consumable.json5': 'item'}
NAME_REFS = {'name_class.json5': 'nameClass', 'name_armament.json5': 'nameArms', 'name_commodity.json5': 'nameCommodity',
             'name_effect.json5': 'nameEffect', 'name_skill.json5': 'nameSkill', 'name_spell.json5': 'nameSpell'}

# Labels and notes the modules get wrong or leave open (checked against the data).
OVERRIDES = {
    ('menu_shop', 'global_bought_counter'): {'label': 'Unlock flag 1', 'ref': 'shopFlag', 'type': 'uint', 'notes':
        "A global flag (counter) the item waits for. Deneb's orbs wait for 1910-1918, which an auction sets "
        "(one monster type each); 0 = no condition."},
    ('menu_shop', 'global_sold_counter'): {'label': 'Unlock flag 2', 'ref': 'shopFlag', 'type': 'uint', 'notes':
        'Another global flag the item waits for (the Glass Pumpkin waits for 1919); 0 = no condition.'},
    ('menu_shop', 'unknown_flag'): {'label': 'Unlock flag 3', 'ref': 'shopFlag', 'type': 'uint', 'notes':
        "A story flag the item waits for (the Songstress items wait for 1881, the Wicce's Mark for 2118); 0 = none."},
}
GROUP_LABELS = {('menu_shop', 'Shop Locations'): 'Shop level per town (0 = not sold there)'}

def convert(mod_dir, name, key, title):
    m = json5((mod_dir / f'{name}.json5').read_text(encoding='utf-8'))
    groups, current = [], {'label': 'General', 'fields': []}
    for f in m['fields']:
        if f.get('type') == 'section':
            if current['fields']: groups.append(current)
            label = f['label'].strip('_ ').strip()
            current = {'label': GROUP_LABELS.get((name, label), label), 'fields': []}
            continue
        field = {'key': f['id'], 'label': f['label'], 'offset': f['offset'], 'size': f['size']}
        if (name, f['id']) in OVERRIDES:
            field.update(OVERRIDES[(name, f['id'])])
            current['fields'].append(field)
            continue
        if f.get('notes'): field['notes'] = f['notes']
        t = f['type']
        opt = (f.get('options_file') or '').split('/')[-1]
        if t == 'dropdown' and opt in NAME_REFS: field['type'] = 'uint'; field['ref'] = NAME_REFS[opt]
        elif t == 'dropdown' and opt in REFS: field['type'] = 'uint'; field['ref'] = REFS[opt]
        elif t == 'dropdown':
            opts = json5((mod_dir / 'options' / opt).read_text(encoding='utf-8'))
            field['type'] = 'enum'; field['options'] = [[o['value'], o['label']] for o in opts]
        else:
            field['type'] = {'uint': 'uint', 'int': 'int'}.get(t, 'bytes')
        current['fields'].append(field)
    if current['fields']: groups.append(current)
    out = {'key': key, 'title': title, 'rowSize': m['entry']['size'], 'count': m['entry'].get('count'), 'groups': groups,
           'source': 'tactics-ogre-tool modules (GPL-3.0), from the community Nightmare modules'}
    if m['entry'].get('labels_file'):  # row names (characters, shop items)
        out['labels'] = {str(o['value']): o['label'] for o in json5((mod_dir / m['entry']['labels_file']).read_text(encoding='utf-8'))}
    return out

def set_columns(mod_dir, name, first, count):
    """Labels of a usability table's set columns (one byte per set, `count` from offset `first`)."""
    m = json5((mod_dir / f'{name}.json5').read_text(encoding='utf-8'))
    by = {f['offset']: f['label'] for f in m['fields'] if f.get('type') != 'section'}
    return [by.get(first + k, '<not used>') for k in range(count)]

if __name__ == '__main__':
    mod_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    for name, key, title in [('battle_class', 'class', 'Classes'), ('battle_armament', 'armament', 'Equipment'),
                             ('battle_commodity', 'commodity', 'Items'), ('battle_effect', 'effect', 'Spells & abilities'),
                             ('battle_unit_template', 'template', 'Characters'), ('menu_shop', 'shop', 'Shops')]:
        s = convert(mod_dir, name, key, title)
        (out / f'{key}.json').write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding='utf-8')
        print(key, 'groups', len(s['groups']), 'fields', sum(len(g['fields']) for g in s['groups']))
    # spell (effect) sets: battle data 51, a row per set entry, a byte per set; skills: battle data 25, bytes 0x10-0x4F
    sets = {'effect': set_columns(mod_dir, 'battle_effect_set', 0, 64), 'skill': set_columns(mod_dir, 'battle_skill', 0x10, 64),
            'source': 'tactics-ogre-tool modules (GPL-3.0)'}
    (out / 'sets.json').write_text(json.dumps(sets, ensure_ascii=False, indent=1), encoding='utf-8')
    print('sets', sum(l != '<not used>' for l in sets['effect']), 'spell sets,', sum(l != '<not used>' for l in sets['skill']), 'skill sets named')

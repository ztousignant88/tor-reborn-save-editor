# TO:R Save Editor

## Install and open

1. Install Python 3.10 or newer on Windows and add it to PATH.
2. Extract the `save-editor` folder beside the game's `Data` folder and `Tactics Ogre Reborn.exe`.
3. Double-click **Start Save Editor.bat**. Keep the console open while using the editor. Select a save in the browser.

The browser opens at `http://127.0.0.1:8650/` or the next available port. This package includes the editor modules it needs. Names, sprites, and icons come from your installed copy of the game.

If you unpack the editor somewhere else, launch it from PowerShell and point it to the game's Data folder.

```powershell
& ".\Start Save Editor.bat" --data "D:\SteamLibrary\steamapps\common\Tactics Ogre Reborn\Data"
```

The editor looks for saves under `Documents\My Games\Tactics Ogre Reborn` and opens the most recently used save folder. Check the folder shown in the status bar. To open a different profile or a folder of test copies, add `--saves "D:\Test Saves"` to the launcher command.

## What it edits

| Area | Fields |
|---|---|
| Units | name, class, level, loyalty, luck, element, 7 equipment slots, 4 spells, 4 carried items, 4 equipped skills with rank, the four stored parts of every stat |
| Roster | duplicate a unit into the next free slot; remove a unit (later units move up) |
| Inventory | Goth, army name, stock of every equipment piece and item (0–999) |
| Campaign records | Warren Report statistics and Chaos Frame faction reputation |

Pictures: unit sprites (roster and unit header), and icons for equipment,
spells, items, skills and the inventory lists. They come from the game's own
files, through the TO:R Editor's sprite and icon code. A unit's template
(+0x3F) gives its gender and race. Non-human races (Hawkman, Lizardman, Lamia,
Orc, Skeleton, Ghost, Faerie, Gremlin, Pumpkinhead) keep their race sprite in
any class. Story characters with a sprite of their own (Denam, Vyce, Leonar,
Hobyrim…) keep it in generic classes (class skill set +0x53 is 1–43), but
their unique class has its own sprite (Denam as Lord). Everyone else uses the
class sprite, or the template's when the class has none. Sprites may take a few seconds
on first load.

## Safety

- Nothing is written until you press **Save** or **Save to slot…**.
- Saving is refused while `Tactics Ogre Reborn.exe` is running. Saving is
  also refused if the file changed on disk after it was opened.
- The target file (and the source, for Save to slot) is copied to
  `save-editor/backups/<date-time>/` first. To undo a save, copy that file
  back.
- Only the main block (and, if the leader is renamed, the load-menu name) is
  re-encoded. The thumbnail and other blocks stay byte-identical. The written
  file is decoded again and compared before the save counts as done.

## Save layout (main block, 383,896 bytes, version `02010081`)

Worked out from the user's saves, the game exe and the community Cheat Engine
table (whose in-memory unit struct sits at save offset −0x3F for the first
fields).

| Offset | Meaning | How it was confirmed |
|---|---|---|
| 0x50 u32 | Goth | 30,000 in every new-game save; changes as Goth is spent |
| 0x4DB2D u8 | Union Level (unit level cap, max 50) | 3 and 5 in early Chapter 1 saves (guides give 5 at Almorica), 50 in every late save; units never exceed it |
| 0x4DB2E u8 | Chariot Tarot rewind limit (turns) | 10 early (the press notes rewinding starts at 10 turns), 50 late |
| 0x54 text | army name ("The Star") | directly before Goth in memory, per the cheat table |
| 0xC6 + n×0x7B5 | unit slot n (105 slots; 100–104 are game-reserved) | roster is always packed from slot 0 |
| unit +0x01 | name (37 bytes) | |
| unit +0x3F u16 | unit template: gender and race (Hawkman 1, Lamia 4, Bingham (Archer W), story characters) | every race unit's template matches its portrait |
| unit +0x41 u16 / +0x90 u8 | slot number | |
| unit +0x73 | 8 finishers (u16) | cheat table +0x34 |
| unit +0x83 / +0x84 | luck / loyalty | cheat table |
| unit +0x88 / +0x89 / +0x8C | class / level / element | class and level match the game's names |
| unit +0x93 | 7 equipment u16: right, left, head, body, arms, feet, accessory | slot types match the items found |
| unit +0x43 u16 | portrait = FileTable directory 30 id (`object/<name>NN.dat`) | Denam 123 = DenimLord00, Sara 491 = Rouge_f00 |
| unit +0x8D | bits 0–2 clan, bits 3–4 alignment (1 Lawful, 2 Neutral, 3 Chaotic) | cheat table; alignment values are only ever 1–3 |
| unit +0xF0 | 4 equipped skills × 6 bytes: id u16, rank u8, pad, xp u16 | slots 5–10 are empty in every save |
| unit +0x1D1 | 800-bit set: skills unlocked by level, across all classes | per the user's in-game knowledge |
| unit +0x251 | 100 × 8 bytes: rank u8, xp u32 per weapon skill (id = weapon type 1–21) | matches the equipped-skill cache |
| unit +0x575 + set | u8 level kept per class skill set (class +0x53): the unit keeps that set's skills up to this level in any class (permanent skills, e.g. from Bodysnatch) | confirmed in game: writing 50 at +0x57A gave Denam Rune Fencer (set 5) skills that persisted through class change. Jack keeps Warrior, Terror Knight, Dragoon, Lich, Divine Knight, Juggernaut at 50 |
| unit +0x675 | 800-bit set: a skill list that does not change with class | adding skills here did not show them in game |
| unit +0x12C / +0x134 | 4 spellbooks / 4 items (item ids) | earlier spell tests |
| unit +0x158.. | shown HP, MP, STR…RES | |
| unit +0x16E/+0x182/+0x196/+0x1AA (+0x1BC/+0x1C0/+0x1C4/+0x1C8 for HP) | stat parts ×10: base, class growth, level-up bonus, extra | sum/10 equals the shown value for STR–RES on all 97 units |
| 0x32C83 | 761 u16: equipment stock, the total owned **including worn pieces** | in every save stock ≥ the number of units wearing that piece (save 10: 9 worn / 9 stock); spare = stock − worn |
| 0x33275 | 1000 u16: item stock (id − 1000) | |
| 0x33A45 | 1000-bit set: relic copy owned (equipped or not) | every equipped relic has its bit set |
| 0x33AC2 / 0x33ACD | 85-bit set / 85 × 0x51 records: snapshot (cursed) weapons. +0 present, +1 name, +0x3D..+0x50 stats the game copies onto the "Cursed Weapon" base item: RT, ATK, DEF, HP..RES (capped 127), damage type + bonus %, damage to obstacles, race + bonus %, element + bonus % | exe 0x43E8C0; slot n/5 = weapon type (17 types × 5 slots); a set bit with an empty record = a Cursed Weapon not made yet |
| 0x35712 | 1000 × 94-byte relic copies: +0 base relic id, then u16 stat bonuses (0–15, rolled per drop, raised by upgrading) the game adds to the base item | every record's base is a relic (126 relic ids, tagged in the TO:R Editor's armament schema); relics never have stock counts; exe 0x383220 |

Equipment ids: below 1000 a normal piece; 2000+n a snapshot weapon (base row
0x262 + n/5); 3000+n relic copy n (exe 0x2E4BC0).

Relics: each copy is its own record, and the game upgrades a relic by combining two copies. Raising a relic's stock count gives a plain stack instead of copies, so the editor blocks it. The Inventory tab's Relics card adds copies (duplicating an owned copy of the same relic when there is one), sets a copy's bonuses, and removes unequipped copies. A "Fix stacked" button turns old relic stock into copies.

Saves of another size (two of the user's are 384,196 bytes) get unit edits
only. Inventory editing is off for them until that layout is mapped.

## Skills

Any skill can be equipped. Unedited saves already hold equipped skills that
the unit hasn't learned or its class doesn't list, and they load fine. The
skill list shows the unit's learned skills first, then all others.

Saves 93 and 94 share identical load-menu summaries, so in the game's load
list an edited copy can look the same as its source. Check that the save you
load shows the edit (Goth, army name) before judging a skill change.

## Not yet confirmed in game

The editor was tested on copies only, including byte-level checks of each
edit. Things to check in game:

- an edited save loads,
- element names match the game's,
- a duplicated unit plays normally,
- a removed unit leaves no gaps (party lists or deployments may refer to slots),
- a brand-new slot number appears in the load list.

## Snapshot weapon builder

Inventory → Snapshot weapons → **+ New snapshot weapon** (or click a weapon to edit it). In game these are cursed weapons made by sacrificing a unit; the builder sets the stats they keep directly: name (16 characters), weapon type (picks one of that type's 5 slots), ATK, DEF, RT, damage to obstacles, damage type / element / race with their bonus %, and HP–RES bonuses (the game caps those at 127). Values you don't touch are written back unchanged. A weapon that is equipped can't be deleted. Not yet checked in game.

## Character export / import

- **Export** (unit header) saves the selected character to `<name>.torunit.json`: the whole 0x7B5-byte unit record (stats, class, skills, kept class levels, equipment) plus copies of the relic and snapshot weapon records it has equipped.
- **Import unit…** (above the roster) reads such a file into the open save, either **as a new unit** (next free slot) or **replacing** the selected unit (whose plain gear goes back to stock).
- Relic and snapshot equipment ids only mean something inside one save, so on import those records are re-created in free slots of the target save and the equipment is pointed at them. One that doesn't fit (all 5 snapshot slots of its type used, or no free relic slot) is unequipped and the status bar says so.
- Saves with a different layout (384,196 bytes) import the unit without relics or snapshot weapons.
- Checked on copies: exporting Bingham from save 15 and importing him into save 10 gave a byte-identical unit apart from the slot number and the four rebuilt equipment ids. Not yet checked in game.

## Equipping and stock

Every piece is offered in the equipment lists ("Spare in inventory" first). Because the game's stock counts worn pieces too, the editor keeps it in step like the game does: putting on a piece with no spare raises its stock by one (so taking it off in game leaves it in the inventory), a piece with a spare changes nothing, and the piece taken off simply becomes spare. Duplicated and imported units count their gear as owned the same way; removing a unit leaves its gear in stock.

## Hover descriptions

Hovering a dropdown, a list entry, a skill chip, an inventory row or a field label shows a description.
Skills, spells, classes, items and equipment use the game's own help text (`LocalizeText_en-us.dat`).
Each table row names its description: skill u16 +0x5C, effect +0x16, class +0xB4 (4 digits), armament +0x62.
Consumables are keyed by their own index. Every named row of each table was checked to have text.
Equipment also lists its type, ATK/DEF/RT, stat bonuses and affinities (armament schema offsets).
Snapshot weapons and relic copies add their own stats and who wears them.
Field and heading descriptions are written in `main.js` (FIELD_HELP, SNAP_HELP, HEADING_HELP, STAT_HELP).

## Warren Report and Chaos Frame

Open **Inventory & Goth** and scroll below the stock lists. In **Warren Report**, you can edit battles, victories, allied casualties, enemies slain by faction, campaign days, Chariot Tarot uses, war funds, and play time. Changing enemies slain for a faction also updates the total. The game displays up to 9,999 per count.

In **Chaos Frame**, use the slider or number field to set each faction’s reputation from 0 to 100. A value of 50 is neutral. These controls are available in saves with the mapped inventory layout.

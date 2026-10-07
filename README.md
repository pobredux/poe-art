# poe-art

Item and status-effect art for Path of Exile 1 and 2, taken from each game patch and served from
`https://art.pobredux.com`.

A scheduled workflow asks GGG's patch servers for the current version of each game. When a game has a new
patch, it exports the item tables, item art, socket art and buff/debuff art from the patch CDN with
[ggpk-explorer](https://github.com/juddisjudd/ggpk-explorer), uploads new and changed images to the `poe-art`
R2 bucket, and commits the new map to `maps/`.

## Maps

`maps/poe1.json` and `maps/poe2.json` map English item names to the game's own art paths:

```json
{
  "game": "poe2",
  "version": "4.5.5.3",
  "images": "https://art.pobredux.com/poe2/",
  "bases": { "Amethyst Ring": "Art/2DItems/Rings/Basetypes/AmethystRing.webp" },
  "uniques": { "Astramentis": "Art/2DItems/Amulets/Uniques/Astramentis.webp" },
  "sockets": { "red": "Art/2DArt/UIImages/InGame/4K/ItemsSocketRed.webp" },
  "classIcons": { "IconDexFour_Ranger1": "Art/2DArt/UIImages/Common/IconDexFour_Ranger1.webp" },
  "skills": { "Discipline": "Art/2DArt/SkillIcons/4k/Discipline.webp" },
  "buffs": { "ignited": "Art/2DArt/BuffIcons/buffonfire.webp" },
  "buffNames": { "Ignited": "Art/2DArt/BuffIcons/buffonfire.webp" },
  "buffVisuals": { "ignited": "Art/2DArt/BuffIcons/buffonfire.webp" },
  "files": { "Art/2DItems/Rings/Basetypes/AmethystRing.webp": "3f9a1c2b" }
}
```

An image URL is `images + path + "?v=" + files[path]`. The bucket stores each image at `<game>/<path>`, and
`files` gives each path a tag that changes when GGG changes the art, so caches never serve an old image.

Look a unique up in `uniques` first and fall back to its base type in `bases`. Runeforged and Runemastered
bases, gems, runes and soul cores are all in `bases`. Names with accents are also listed without them, so
"Maelström Staff" is found as "Maelstrom Staff". `overrides/<game>.json` adds names the game does not use,
such as PoB's "Energy Blade One Handed" and "Energy Blade Two Handed", by pointing them at a base item's
metadata ID.

`sockets` has the item socket art: `red`, `green`, `blue`, `white` and `link` in both games, `abyss` in PoE1,
and `empty`, `rune` and `soulCore` augment sockets in PoE2. `src/config.ts` lists the UI sprites they come
from; PoE1 sprites are cut out of the game's sprite sheets.

`classIcons` has the game's class and ascendancy portraits, keyed by their sprite name. A class icon is
`Icon` and the class's attributes, such as `IconDex` (PoE1 Ranger) or `IconDexFour` (PoE2 Ranger). An
ascendancy adds `_` and its id: `IconDex_Raider` is PoE1's Warden and `IconDexFour_Ranger1` is PoE2's Deadeye.
Sprites for classes the game has not released yet are included.

`skills` maps skill and gem-variant display names to their in-game skill icons. These are the square icons the
HUD uses for skill-derived buffs and are distinct from the inventory art in `bases`.

`buffs` maps `BuffDefinitions` ids to their icons and includes every status category, including buffs,
debuffs, charges, flasks, hexes, marks and heralds. `buffNames` provides the corresponding display-name lookup.
It also includes skill-name aliases used by PoB, while retaining the applied effect's buff visual—for example,
`Summon Flame Golem` resolves through the `Flame Golem` buff rather than through gem inventory art.
`buffVisuals` maps every exported `BuffVisuals` id to its icon, including visuals which are not linked directly
to a buff definition. Buffs without an in-game icon are not listed.

The same map is published at `maps/<game>/<version>.json` and `maps/<game>/latest.json` on the art domain.
Images and versioned maps are cached for a year; `latest.json` for five minutes.

## Commands

```sh
bun install
bun run patch                 # print the current patch of each game
bun run stale                 # list games whose published map is older than the patch
bun run update                # export, map and upload every stale game
bun run update poe2 --force   # rebuild one game even if its patch has not changed
bun run update --dry-run      # export and map only; the map goes to work/
bun run update --reuse        # map an export already in work/ instead of downloading it again
bun run typecheck
```

`update` needs `ggpk-explorer` on `PATH`, or `GGPK_EXPLORER` set to it. On a machine without the ggpk-explorer
GUI's cached schema, set `DAT_SCHEMA` to a downloaded
[schema.min.json](https://github.com/poe-tool-dev/dat-schema/releases/latest/download/schema.min.json).

Uploads read `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from `.env` locally and from the
repository secrets in CI. `R2_BUCKET` and `ART_BASE_URL` default to `poe-art` and `https://art.pobredux.com`.

## Licence

The scripts are MIT licensed. The game art is not; see [NOTICE.md](NOTICE.md).

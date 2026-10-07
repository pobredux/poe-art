import path from "node:path";
import { BASE_URL, type Game } from "./config";

export interface ArtMap {
  game: Game;
  version: string;
  images: string;
  bases: Record<string, string>;
  uniques: Record<string, string>;
  sockets: Record<string, string>;
  classIcons: Record<string, string>;
  skills: Record<string, string>;
  buffs: Record<string, string>;
  buffNames: Record<string, string>;
  buffVisuals: Record<string, string>;
  files: Record<string, string>;
}

interface Row {
  name?: string;
  release_state?: string;
  is_alternate_art?: boolean;
  visual_identity?: { dds_file?: string };
  skill_name?: string;
  base_item?: { id?: string };
}

interface Overrides {
  bases?: Record<string, string>;
}

interface BuffVisualSource {
  id?: string;
  buff_id?: string;
  name?: string;
}

interface BuffVisualRow {
  icon?: string;
  name?: string;
  sources?: Record<string, BuffVisualSource[]>;
}

interface SkillGemRow {
  skill_name?: string;
  icon_dds_file?: string;
  base_item?: { id?: string; display_name?: string };
}

async function rows<T = Row>(file: string): Promise<[string, T][]> {
  const data = await Bun.file(file).json();
  return (Array.isArray(data) ? data.map((row, i) => [String(i), row]) : Object.entries(data)) as [string, T][];
}

const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (record: Map<string, string>) => Object.fromEntries([...record].sort(byKey));
const ascii = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "");
const loose = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** PoB names the applied effect after its skill; game buff definitions often use the base skill name. */
function buffNameCandidates(skillName: string): string[] {
  const names = new Set([skillName, `${skillName} Aura`]);
  const base = skillName.replace(/ of .+$/, "");
  names.add(base);
  names.add(`${base} Aura`);
  for (const name of [...names]) {
    if (name.startsWith("Summon ")) names.add(name.slice("Summon ".length));
  }
  return [...names];
}

export async function buildMap(
  game: Game,
  version: string,
  dir: string,
  sockets: Record<string, string>,
  classIcons: Record<string, string> = {},
) {
  const files = new Map<string, string>();
  const tags = new Map<string, string>();
  const missing = new Set<string>();

  async function art(dds: string): Promise<string | null> {
    const image = dds.replace(/\.dds$/i, ".webp");
    if (tags.has(image)) return image;
    const file = Bun.file(path.join(dir, image));
    if (!(await file.exists())) {
      missing.add(dds);
      return null;
    }
    tags.set(image, new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex").slice(0, 8));
    files.set(image, file.name!);
    return image;
  }

  async function collect(list: [string, Row][], skip: (row: Row) => boolean) {
    const out = new Map<string, string>();
    const released = (row: Row) => (row.release_state === "released" ? 0 : 1);
    const ranked = list
      .filter(([, row]) => row.name && row.visual_identity?.dds_file && !skip(row))
      .sort((a, b) => released(a[1]) - released(b[1]) || byKey(a, b));
    for (const [, row] of ranked) {
      if (out.has(row.name!)) continue;
      const image = await art(row.visual_identity!.dds_file!);
      if (image) out.set(row.name!, image);
    }
    return out;
  }

  const baseRows = await rows(path.join(dir, "base_items.min.json"));
  const bases = await collect(baseRows, () => false);
  const uniques = await collect(await rows(path.join(dir, "uniques.min.json")), (row) => row.is_alternate_art === true);

  const overridesFile = Bun.file(`overrides/${game}.json`);
  const overrides: Overrides = (await overridesFile.exists()) ? await overridesFile.json() : {};
  const byId = new Map(baseRows);
  const skills = new Map<string, string>();
  const skillGemFile = path.join(dir, "skill_gems.min.json");
  const gemRows = await rows<SkillGemRow>(skillGemFile);
  for (const [, gem] of gemRows) {
    const name = gem.skill_name ?? gem.base_item?.display_name;
    const image = gem.icon_dds_file && (await art(gem.icon_dds_file));
    if (name && image && !skills.has(name)) skills.set(name, image);
  }
  if (game === "poe1") {
    for (const [, gem] of gemRows) {
      if (!gem.skill_name || bases.has(gem.skill_name)) continue;
      const dds = gem.base_item?.id && byId.get(gem.base_item.id)?.visual_identity?.dds_file;
      const image = dds && (await art(dds));
      if (image) bases.set(gem.skill_name, image);
    }
  }
  for (const [name, id] of Object.entries(overrides.bases ?? {})) {
    const dds = byId.get(id)?.visual_identity?.dds_file;
    const image = dds && (await art(dds));
    if (!image) throw new Error(`${game}: override "${name}" names ${id}, which has no exported art`);
    bases.set(name, image);
  }
  for (const record of [bases, uniques]) {
    for (const [name, image] of [...record]) {
      const plain = ascii(name);
      if (plain !== name && !record.has(plain)) record.set(plain, image);
    }
  }

  const socketImages = new Map<string, string>();
  for (const [key, image] of Object.entries(sockets)) {
    if (!(await art(image.replace(/\.webp$/, ".dds")))) throw new Error(`${game}: socket ${key} was not exported`);
    socketImages.set(key, image);
  }

  const classImages = new Map<string, string>();
  for (const [name, image] of Object.entries(classIcons)) {
    if (!(await art(image.replace(/\.webp$/, ".dds")))) throw new Error(`${game}: class icon ${name} was not exported`);
    classImages.set(name, image);
  }

  const buffs = new Map<string, string>();
  const directBuffs = new Set<string>();
  const buffNames = new Map<string, string>();
  const directBuffNames = new Set<string>();
  const buffVisuals = new Map<string, string>();
  const nameOwners = new Map<string, string | null>();
  for (const [visualId, visual] of await rows<BuffVisualRow>(path.join(dir, "buff_visuals.min.json"))) {
    const image = visual.icon ? await art(visual.icon) : null;
    // Sanctum and boss buffs reuse player buff names; the buff whose id matches the name owns it.
    for (const source of visual.sources?.BuffDefinitions ?? []) {
      if (source.id && source.name && loose(source.id) === loose(source.name)) nameOwners.set(source.name, image);
    }
    if (!image) continue;
    buffVisuals.set(visualId, image);

    // A BuffDefinition's own visual wins over a visual inherited through one
    // of its templates. Template links fill in buffs without a direct visual.
    for (const source of visual.sources?.BuffDefinitions ?? []) {
      if (!source.id) continue;
      directBuffs.add(source.id);
      buffs.set(source.id, image);
      if (source.name) {
        directBuffNames.add(source.name);
        buffNames.set(source.name, image);
      }
    }
    for (const sources of Object.values(visual.sources ?? {})) {
      for (const source of sources) {
        if (source.buff_id && !directBuffs.has(source.buff_id) && !buffs.has(source.buff_id)) {
          buffs.set(source.buff_id, image);
        }
        if (source.name && !directBuffNames.has(source.name) && !buffNames.has(source.name)) {
          buffNames.set(source.name, image);
        }
      }
    }
    if (visual.name && !directBuffNames.has(visual.name) && !buffNames.has(visual.name)) {
      buffNames.set(visual.name, image);
    }
  }
  for (const [name, image] of nameOwners) {
    if (image) buffNames.set(name, image);
    else buffNames.delete(name);
  }
  // Auras, golems and transfigured skills use the skill's display name in PoB,
  // while the applied BuffDefinition uses names such as "Discipline Aura",
  // "Flame Golem" and "Righteous Fire". Publish exact skill-name aliases that
  // still point to the effect's BuffVisual rather than to gem or skill art.
  for (const [, gem] of gemRows) {
    const skillName = gem.skill_name ?? gem.base_item?.display_name;
    if (!skillName || buffNames.has(skillName)) continue;
    const match = buffNameCandidates(skillName).find((name) => buffNames.has(name));
    if (match) buffNames.set(skillName, buffNames.get(match)!);
  }
  for (const [name, image] of [...buffNames]) {
    const plain = ascii(name);
    if (plain !== name && !buffNames.has(plain)) buffNames.set(plain, image);
  }

  const map: ArtMap = {
    game,
    version,
    images: `${BASE_URL}/${game}/`,
    bases: sorted(bases),
    uniques: sorted(uniques),
    sockets: Object.fromEntries(socketImages),
    classIcons: sorted(classImages),
    skills: sorted(skills),
    buffs: sorted(buffs),
    buffNames: sorted(buffNames),
    buffVisuals: sorted(buffVisuals),
    files: sorted(tags),
  };
  return { map, files, missing: [...missing].sort() };
}

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SOCKETS, type Game } from "./config";
import { explorer } from "./export";

interface Sprite {
  texture: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function parseSprites(bytes: Uint8Array): Map<string, Sprite> {
  const text = new TextDecoder(bytes[1] === 0 ? "utf-16le" : "utf-8").decode(bytes);
  const sprites = new Map<string, Sprite>();
  for (const match of text.matchAll(/^"([^"]+)"\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/gm)) {
    const [x1, y1, x2, y2] = match.slice(3).map(Number) as [number, number, number, number];
    sprites.set(match[1]!, { texture: match[2]!, left: x1, top: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 });
  }
  return sprites;
}

async function uiSprites(game: Game, version: string, dir: string) {
  const raw = path.join(dir, "..", `${version}-ui`);
  const log = path.join(dir, "..", `${version}.log`);
  const source = ["--cdn", version, `--${game}`, "-o", raw];
  const index = path.join(raw, "art", "uiimages1.txt");
  if (!(await Bun.file(index).exists())) await explorer(["export", "Art/UIImages1.txt", ...source], log);
  const sprites = parseSprites(await Bun.file(index).bytes());

  async function cut(id: string): Promise<string> {
    const sprite = sprites.get(id);
    if (!sprite) throw new Error(`${game} ${version} has no UI sprite ${id}`);
    const png = path.join(raw, sprite.texture.toLowerCase().replace(/\.dds$/, ".png"));
    if (!(await Bun.file(png).exists())) await explorer(["export", sprite.texture, "--textures", "png", ...source], log);
    const file = `${id}.webp`;
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    const { left, top, width, height } = sprite;
    await sharp(png).extract({ left, top, width, height }).webp({ lossless: true }).toFile(path.join(dir, file));
    return file;
  }
  return { ids: [...sprites.keys()], cut };
}

export async function exportSockets(game: Game, version: string, dir: string): Promise<Record<string, string>> {
  const { cut } = await uiSprites(game, version, dir);
  const sockets: Record<string, string> = {};
  for (const [key, id] of Object.entries(SOCKETS[game])) sockets[key] = await cut(id);
  return sockets;
}

// The game names these Icon<attributes>[Four[b]][_<ascendancy id>], e.g. IconDexFour_Ranger1 or IconDex_Raider.
const CLASS_ICON = /^Art\/2DArt\/UIImages\/Common\/(Icon(?:Str|Dex|Int)\w*)$/;

export async function exportClassIcons(game: Game, version: string, dir: string): Promise<Record<string, string>> {
  const { ids, cut } = await uiSprites(game, version, dir);
  const icons: Record<string, string> = {};
  for (const id of ids) {
    const name = CLASS_ICON.exec(id)?.[1];
    if (name) icons[name] = await cut(id);
  }
  return icons;
}

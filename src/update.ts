import { appendFile } from "node:fs/promises";
import path from "node:path";
import { GAMES, type Game } from "./config";
import { exportGame } from "./export";
import { stackGemStrips } from "./gems";
import { buildMap } from "./map";
import { exportSockets } from "./sockets";
import { publish } from "./upload";
import { patchVersion } from "./version";

const args = Bun.argv.slice(2);
const flag = (name: string) => args.includes(name);
const games = args.filter((arg): arg is Game => (GAMES as string[]).includes(arg));
const selected = games.length ? games : GAMES;

async function publishedVersion(game: Game): Promise<string | null> {
  const file = Bun.file(`maps/${game}.json`);
  if (!(await file.exists())) return null;
  const map = (await file.json()) as { version: string; skills?: unknown; buffs?: unknown; buffNames?: unknown; buffVisuals?: unknown };
  // A map from before status art was added must rebuild even when the game
  // patch itself has not changed.
  return map.skills && map.buffs && map.buffNames && map.buffVisuals ? map.version : null;
}

async function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const stale: { game: Game; version: string }[] = [];
for (const game of selected) {
  const version = await patchVersion(game);
  const current = await publishedVersion(game);
  console.log(`${game}: patch ${version}, published ${current ?? "none"}`);
  if (flag("--force") || current !== version) stale.push({ game, version });
}

if (flag("--check")) {
  await output("stale", stale.map((s) => s.game).join(" "));
  process.exit(0);
}

const done: string[] = [];
for (const { game, version } of stale) {
  const dir = path.join("work", game, version);
  if (!(flag("--reuse") && (await Bun.file(path.join(dir, "base_items.min.json")).exists()))) {
    const run = await exportGame(game, version, dir);
    console.log(`${game}: exported in ${run.seconds}s, ${run.downloads} CDN bundles`);
  }
  if (game === "poe1") console.log(`${game}: stacked ${await stackGemStrips(dir)} gem images`);
  const sockets = await exportSockets(game, version, dir);
  const { map, files, missing } = await buildMap(game, version, dir, sockets);
  console.log(
    `${game}: ${Object.keys(map.bases).length} bases, ${Object.keys(map.uniques).length} uniques, ` +
      `${Object.keys(map.sockets).length} sockets, ${Object.keys(map.buffs).length} buffs, ` +
      `${Object.keys(map.skills).length} skills, ` +
      `${Object.keys(map.buffNames).length} buff names, ${Object.keys(map.buffVisuals).length} buff visuals, ` +
      `${files.size} images, ${missing.length} art files not exported`,
  );
  const json = `${JSON.stringify(map, null, 1)}\n`;
  if (flag("--dry-run")) {
    await Bun.write(path.join("work", game, `${version}.map.json`), json);
    continue;
  }
  const result = await publish(map, files);
  console.log(`${game}: uploaded ${result.uploaded} images, ${result.unchanged} unchanged in the bucket`);
  await Bun.write(`maps/${game}.json`, json);
  done.push(`${game} ${version}`);
}
await output("published", done.join(", "));

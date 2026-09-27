import { appendFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { EXPLORER, SCHEMA, type Game } from "./config";

export async function explorer(args: string[], log: string): Promise<string> {
  const proc = Bun.spawn([EXPLORER, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await appendFile(log, `$ ggpk-explorer ${args.join(" ")}\n${stdout}${stderr}`);
  if (code !== 0) {
    throw new Error(`ggpk-explorer ${args[0]} exited with ${code}\n${stderr}\n${stdout.split("\n").slice(-20).join("\n")}`);
  }
  return stdout;
}

export async function exportGame(game: Game, version: string, out: string): Promise<{ downloads: number; seconds: number }> {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const started = performance.now();
  const modules = "base_items,uniques,skill_gems,buff_visuals";
  const stdout = await explorer(
    [
      "export-data", "--cdn", version, `--${game}`, "--only", modules,
      "--images", "--strip-null", "--flat", "-o", out, ...(SCHEMA ? ["--schema", SCHEMA] : []),
    ],
    path.join(out, "..", `${version}.log`),
  );
  return {
    downloads: stdout.split("\n").filter((line) => line.includes("[CDN] Downloading")).length,
    seconds: Math.round((performance.now() - started) / 1000),
  };
}

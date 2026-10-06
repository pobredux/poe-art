import type { Socket } from "bun";
import { GAMES, type Game } from "./config";

type Server = { host: string; port: number; hello: number[]; version: RegExp };

const SERVERS: Record<Game, Server> = {
  // PoE2 left 4.x for the public 0.x (1.x from 1.0), so a later PoE1 may take 4.x.
  poe1: { host: "patch.pathofexile.com", port: 12995, hello: [1, 6], version: /^[34]\./ },
  poe2: { host: "patch.pathofexile2.com", port: 13060, hello: [1, 7], version: /^[01]\./ },
};

function parse(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] !== 2) throw new Error(`unexpected patch protocol version ${data[0]}`);
  let pos = 33;
  let url = "";
  for (let i = 0; i < 2; i++) {
    const units = view.getUint16(pos);
    pos += 2;
    url = new TextDecoder("utf-16le").decode(data.subarray(pos, pos + units * 2));
    pos += units * 2;
  }
  const version = url.match(/poecdn\.com\/([\d.]+)\/?$/)?.[1];
  if (!version) throw new Error(`no version in patch server reply: ${url}`);
  return version;
}

function ask(server: Server): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let connection: Socket | undefined;
    const timer = setTimeout(() => {
      connection?.terminate();
      reject(new Error(`${server.host} did not answer`));
    }, 10_000);
    Bun.connect({
      hostname: server.host,
      port: server.port,
      socket: {
        open(socket) {
          socket.write(new Uint8Array(server.hello));
        },
        data(socket, chunk) {
          chunks.push(new Uint8Array(chunk));
          const total = Buffer.concat(chunks);
          try {
            parse(total);
            clearTimeout(timer);
            socket.end();
            resolve(total);
          } catch {}
        },
        error(_socket, error) {
          clearTimeout(timer);
          reject(error);
        },
      },
    }).then((socket) => {
      connection = socket;
    }, reject);
  });
}

export async function patchVersion(game: Game): Promise<string> {
  const server = SERVERS[game];
  let reply: Uint8Array;
  try {
    reply = await ask(server);
  } catch (error) {
    console.log(`${game}: ${error instanceof Error ? error.message : error}, asking again`);
    reply = await ask(server);
  }
  const version = parse(reply);
  if (!server.version.test(version)) throw new Error(`unexpected ${game} version ${version}`);
  return version;
}

if (import.meta.main) {
  const games = Bun.argv.length > 2 ? (Bun.argv.slice(2) as Game[]) : GAMES;
  for (const game of games) console.log(`${game} ${await patchVersion(game)}`);
}

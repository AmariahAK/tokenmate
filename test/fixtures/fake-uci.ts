#!/usr/bin/env bun
// A UCI engine that is not one: it speaks just enough of the protocol for the
// process boundary to be tested and nothing else. No search, no chess, no
// third-party code — and parameterised from argv so one fixture can stand in for an
// engine with `UCI_Elo`, one without, a slow one and one that never answers:
//
//   --options=elo|skill|none   which options the engine advertises
//   --slow=MS                  wait before the scripted bestmove
//   --hang                     never answer `go` (the timeout path)
//   --mute                     never answer `uci` either (a dead binary)
//   --mate                     rank 1 is a mate score instead of centipawns
//   --bestmove=MOVE            override the move the engine returns
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const shape = value("options", "elo");
const slow = Number(value("slow", "0"));
const hang = flag("hang");
const mute = flag("mute");
const mate = flag("mate");
const forced = value("bestmove", "");

// The `UCI_Elo` range is Stockfish's measured clamp, because that is the range the
// ladder's native levels have to fit inside.
const OPTIONS: Record<string, string[]> = {
  elo: [
    "option name Threads type spin default 1 min 1 max 1024",
    "option name Hash type spin default 16 min 1 max 33554432",
    "option name MultiPV type spin default 1 min 1 max 500",
    "option name Skill Level type spin default 20 min 0 max 20",
    "option name UCI_LimitStrength type check default false",
    "option name UCI_Elo type spin default 1320 min 1320 max 3190",
  ],
  skill: [
    "option name MultiPV type spin default 1 min 1 max 500",
    "option name Skill Level type spin default 20 min 0 max 20",
  ],
  none: [],
};

// Loss-sorted, the way a real search reports MultiPV: rank 1 is best and every later
// rank gives up more, which is the shape the level ladder samples over.
const CANDIDATES: [string, number][] = [
  ["e2e4", 34],
  ["d2d4", 12],
  ["g1f3", -20],
  ["c2c4", -85],
  ["f2f4", -160],
  ["a2a3", -240],
  ["h2h4", -310],
  ["g2g4", -420],
];

let multipv = 1;

const write = (line: string) => process.stdout.write(`${line}\n`);

const search = () => {
  const ranks = Math.max(1, Math.min(multipv, CANDIDATES.length));
  for (let i = 0; i < ranks; i++) {
    const entry = CANDIDATES[i];
    if (!entry) break;
    const [move, cp] = entry;
    const score = mate && i === 0 ? "score mate 3" : `score cp ${cp}`;
    write(
      `info depth 12 seldepth 18 multipv ${i + 1} ${score} nodes 140000 nps 800000 time ${slow} pv ${move} e7e5 g1f3`,
    );
  }
  write(`bestmove ${forced || (CANDIDATES[0]?.[0] ?? "e2e4")}`);
};

const handle = (raw: string) => {
  const line = raw.trim();
  if (!line) return;
  if (line === "uci") {
    if (mute) return;
    write("id name FakeFish 0.1");
    write("id author tokenmate tests");
    for (const option of OPTIONS[shape] ?? []) write(option);
    write("uciok");
    return;
  }
  if (line === "isready") {
    write("readyok");
    return;
  }
  if (line === "ucinewgame") return;
  if (line.startsWith("setoption")) {
    const words = line.split(/\s+/);
    const at = words.indexOf("value");
    const name = words.slice(2, at < 0 ? undefined : at).join(" ");
    if (name === "MultiPV" && at >= 0) multipv = Math.max(1, Number(words[at + 1]) || 1);
    return;
  }
  if (line.startsWith("position")) return;
  if (line.startsWith("go")) {
    if (hang) return;
    if (slow > 0) setTimeout(search, slow);
    else search();
    return;
  }
  if (line === "stop") {
    search();
    return;
  }
  if (line === "quit") process.exit(0);
};

// Only listen when this file *is* the program. Anything that imports it — a test
// runner, a future harness — must not leave a process waiting on stdin.
if (import.meta.main) createInterface({ input: process.stdin }).on("line", handle);

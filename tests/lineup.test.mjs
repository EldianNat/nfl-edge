import test from "node:test";
import assert from "node:assert/strict";
import { optimize, expandSlots, ELIGIBLE, DEFAULT_SLOTS } from "../public/js/lineup.js";

// Deterministic PRNG so CI never flakes.
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const P = (id, pos, proj, extra = {}) => ({ id, name: id, pos, proj, playable: true, ...extra });

// Exhaustive best total: DP over (slot index, used-player mask).
function brute(players, slots) {
  const sl = expandSlots(slots).map((s) => s.slot);
  const memo = new Map();
  const go = (i, mask) => {
    if (i === sl.length) return 0;
    const key = i * 65536 + mask;
    if (memo.has(key)) return memo.get(key);
    let best = go(i + 1, mask);
    players.forEach((p, j) => {
      if (mask & (1 << j) || p.playable === false || !ELIGIBLE[sl[i]].includes(p.pos)) return;
      best = Math.max(best, p.proj + go(i + 1, mask | (1 << j)));
    });
    memo.set(key, best);
    return best;
  };
  return go(0, 0);
}

test("optimizer matches exhaustive search on random rosters", () => {
  const r = rng(12345);
  const POS = ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE", "TE", "K", "DST"];
  const configs = [
    DEFAULT_SLOTS,
    { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 0, K: 1, DST: 1 },
    { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 0, DST: 0 },
    { QB: 0, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPERFLEX: 2, K: 1, DST: 1 },
    { QB: 2, RB: 1, WR: 1, TE: 0, FLEX: 3, SUPERFLEX: 0, K: 0, DST: 1 },
  ];
  for (let t = 0; t < 400; t++) {
    const n = 4 + Math.floor(r() * 10);
    const players = Array.from({ length: n }, (_, i) => P("p" + i, POS[Math.floor(r() * POS.length)], Math.round(r() * 300) / 10, { playable: r() > 0.12 }));
    const slots = configs[t % configs.length];
    const res = optimize(players, slots);
    assert.ok(Math.abs(res.total - brute(players, slots)) < 1e-9, `case ${t}: optimizer ${res.total} vs best ${brute(players, slots)}`);
    // Every starter sits in a slot he is eligible for, and nobody starts twice.
    const ids = res.starters.filter((s) => s.player).map((s) => s.player.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of res.starters) if (s.player) assert.ok(ELIGIBLE[s.slot].includes(s.player.pos), `${s.player.pos} illegally in ${s.slot}`);
  }
});

test("best RBs take RB slots and the next best fills FLEX", () => {
  const res = optimize([P("r1", "RB", 20), P("r2", "RB", 15), P("r3", "RB", 12), P("w1", "WR", 11), P("w2", "WR", 9), P("w3", "WR", 8), P("t1", "TE", 7)], { QB: 0, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 0, DST: 0 });
  const by = (slot) => res.starters.filter((s) => s.slot === slot).map((s) => s.player?.id);
  assert.deepEqual(by("RB"), ["r1", "r2"]);
  assert.deepEqual(by("WR"), ["w1", "w2"]);
  assert.deepEqual(by("FLEX"), ["r3"]);
  assert.equal(res.total, 20 + 15 + 12 + 11 + 9 + 7);
});

test("a second QB goes to SUPERFLEX, never FLEX", () => {
  const res = optimize([P("q1", "QB", 22), P("q2", "QB", 21), P("r1", "RB", 10), P("w1", "WR", 9), P("w2", "WR", 8)], { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 1, SUPERFLEX: 1, K: 0, DST: 0 });
  assert.equal(res.starters.find((s) => s.slot === "SUPERFLEX").player.id, "q2");
  assert.equal(res.starters.find((s) => s.slot === "FLEX").player.id, "w2");
});

test("unplayable players (bye, out) are not started; open slots are reported", () => {
  const res = optimize([P("q1", "QB", 0, { playable: false }), P("r1", "RB", 10)], { QB: 1, RB: 2, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0 });
  assert.equal(res.starters.find((s) => s.slot === "QB").player, null);
  assert.equal(res.open, 2);
  assert.equal(res.total, 10);
});

test("locks: forced start beats a better player; bench removes a player; impossible locks warn", () => {
  const roster = [P("a", "WR", 15), P("b", "WR", 12), P("c", "WR", 6)];
  const slots = { QB: 0, RB: 0, WR: 2, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0 };
  assert.deepEqual(optimize(roster, slots, { c: "start" }).starters.map((s) => s.player.id).sort(), ["a", "c"]);
  assert.deepEqual(optimize(roster, slots, { a: "bench" }).starters.map((s) => s.player.id).sort(), ["b", "c"]);
  const res = optimize(roster, slots, { a: "start", b: "start", c: "start" });
  assert.equal(res.warnings.length, 1);
  assert.equal(res.starters.length, 2);
});

test("close calls: a bench player within a point of a starter is surfaced with a ~45% chance", () => {
  const res = optimize([P("a", "RB", 14), P("b", "RB", 13.2)], { QB: 0, RB: 1, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0 });
  const alt = res.starters[0].alt;
  assert.equal(alt.player.id, "b");
  assert.ok(Math.abs(alt.gap - 0.8) < 1e-9);
  assert.ok(alt.p > 0.4 && alt.p < 0.5);
  assert.equal(res.bench[0].target.player.id, "a");
});

test("a bench player who cannot legally take any starter's slot has no swap target", () => {
  const res = optimize([P("q", "QB", 20), P("k", "K", 8), P("k2", "K", 7)], { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 1, DST: 0 });
  assert.equal(res.bench.find((b) => b.player.id === "k2").target.player.id, "k");
  assert.equal(res.starters.find((s) => s.slot === "QB").alt, null);
});

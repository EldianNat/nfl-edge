// Lineup optimizer. Pure functions, shared by the browser and the tests.
//
// Choosing the best lineup is a max-weight matching of players to slots where eligibility is
// nested (RB ⊂ FLEX ⊂ SUPERFLEX), which is a transversal matroid: sorting players by projection and
// keeping each one that still lets every kept player be matched to a distinct slot is optimal.
import { normCdf } from "./math.js";

export const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DST"];
export const DEFAULT_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DST: 1 };
export const ELIGIBLE = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DST: ["DST"],
  FLEX: ["RB", "WR", "TE"], SUPERFLEX: ["QB", "RB", "WR", "TE"],
};
const ELIG = ELIGIBLE;
const ELIG_POS = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);

// Week-to-week standard deviation of a player's fantasy score (used for "chance to outscore").
export const sdFor = (p) => (p.pos === "K" ? 3 : p.pos === "DST" ? 4.5 : 0.3 * Math.max(0, p.proj) + 3);

export function expandSlots(slots = DEFAULT_SLOTS) {
  const out = [];
  for (const s of SLOT_ORDER) {
    const n = Math.max(0, Math.min(8, Math.floor(Number(slots[s]) || 0)));
    for (let i = 0; i < n; i++) out.push({ slot: s });
  }
  return out;
}

// Can every player in `set` be given a distinct eligible slot? Returns {ok, owner} (owner[slotIndex] = player index).
function match(set, slotList) {
  const owner = new Array(slotList.length).fill(-1);
  const assign = (pi, seen) => {
    for (let s = 0; s < slotList.length; s++) {
      if (seen[s] || !ELIG[slotList[s].slot].includes(set[pi].pos)) continue;
      seen[s] = true;
      if (owner[s] === -1 || assign(owner[s], seen)) { owner[s] = pi; return true; }
    }
    return false;
  };
  let ok = true;
  for (let i = 0; i < set.length && ok; i++) ok = assign(i, []);
  return { ok, owner };
}

const byProj = (a, b) => b.proj - a.proj || String(a.name).localeCompare(String(b.name));

// Place the chosen players into display slots: dedicated slots first, then FLEX, then SUPERFLEX.
function place(chosen, slotList) {
  const left = new Set(chosen);
  const res = slotList.map((s) => ({ slot: s.slot, player: null }));
  for (const pass of [["QB", "RB", "WR", "TE", "K", "DST"], ["FLEX"], ["SUPERFLEX"]]) {
    for (const r of res) {
      if (!pass.includes(r.slot)) continue;
      let best = null;
      for (const p of left) if (ELIG[r.slot].includes(p.pos) && (!best || byProj(p, best) < 0)) best = p;
      if (best) { r.player = best; left.delete(best); }
    }
  }
  if (left.size) { // should not happen; fall back to the matching itself
    const { owner } = match(chosen, slotList);
    return slotList.map((s, i) => ({ slot: s.slot, player: owner[i] >= 0 ? chosen[owner[i]] : null }));
  }
  return res;
}

/**
 * players: [{id, name, pos, proj, playable}]  (pos: QB RB WR TE K DST)
 * slots:   {QB:1, RB:2, ...}
 * locks:   {playerId: "start" | "bench"}
 */
export function optimize(players, slots = DEFAULT_SLOTS, locks = {}) {
  const slotList = expandSlots(slots);
  const warnings = [];
  const eligible = players.filter((p) => ELIG_POS.has(p.pos) && locks[p.id] !== "bench" && (p.playable !== false || locks[p.id] === "start"));
  const forced = eligible.filter((p) => locks[p.id] === "start").sort(byProj);
  const rest = eligible.filter((p) => locks[p.id] !== "start").sort(byProj);

  const chosen = [];
  for (const p of [...forced, ...rest]) {
    const full = chosen.length >= slotList.length;
    if (!full && match([...chosen, p], slotList).ok) chosen.push(p);
    else if (locks[p.id] === "start") warnings.push(`Can't fit ${p.name}: no open ${p.pos} slot left for a forced start.`);
  }

  const starters = place(chosen, slotList);
  const chosenSet = new Set(chosen);
  const benchAll = players.filter((p) => !chosenSet.has(p));

  // For each bench player, the starter he'd be closest to replacing (same-slot swap that keeps the lineup legal).
  const swappable = (s, b) => locks[s.id] !== "start" && match([...chosen.filter((x) => x !== s), b], slotList).ok;
  const pair = (s, b) => ({ gap: s.proj - b.proj, p: normCdf((b.proj - s.proj) / Math.hypot(sdFor(b), sdFor(s))) });
  const bench = benchAll.map((b) => {
    let target = null;
    if (b.playable !== false && locks[b.id] !== "bench") {
      for (const s of chosen) if (swappable(s, b)) { const x = pair(s, b); if (!target || x.gap < target.gap) target = { player: s, ...x }; }
    }
    return { player: b, target, locked: locks[b.id] === "bench" };
  }).sort((a, b) => byProj(a.player, b.player));
  for (const r of starters) {
    if (!r.player) continue;
    let alt = null;
    for (const b of benchAll) {
      if (b.playable === false || locks[b.id] === "bench" || !swappable(r.player, b)) continue;
      const x = pair(r.player, b);
      if (!alt || x.gap < alt.gap) alt = { player: b, ...x };
    }
    r.alt = alt;
    r.forced = locks[r.player.id] === "start";
  }

  return { starters, bench, total: chosen.reduce((a, p) => a + p.proj, 0), warnings, open: starters.filter((r) => !r.player).length };
}

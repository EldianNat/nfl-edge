// Back up / restore what this site keeps in the browser (teams, Hard Rock odds, parlay slip) so it can move
// to a new phone, a new browser, or a new web address. localStorage is per-address, so without this a URL
// change loses everything. Pure functions: easy to test, and imported data is sanitized before it is stored.
import { SLOT_ORDER, DEFAULT_SLOTS } from "./lineup.js";

export const PREFIX = "NFLEDGE1:";
export const KEYS = ["teams", "teamId", "hr", "slip", "custom", "stake"];
const SCORING = ["ppr", "half", "std"];
const PROP_STATS = ["recYds", "rushYds", "passYds", "rec"];

const toB64 = (s) => { let bin = ""; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const str = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
const finite = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// get(key) -> stored value or undefined.
export function exportBackup(get) {
  const data = {};
  for (const k of KEYS) { const v = get(k); if (v !== undefined && v !== null) data[k] = v; }
  return PREFIX + toB64(JSON.stringify({ v: 1, savedAt: new Date().toISOString(), data }));
}

export function sanitize(d) {
  const out = {};
  if (Array.isArray(d.teams)) {
    const seen = new Set();
    out.teams = d.teams.slice(0, 20).filter((t) => t && typeof t === "object" && typeof t.id === "string" && t.id && !seen.has(t.id) && seen.add(t.id)).map((t) => {
      const roster = [...new Set((Array.isArray(t.roster) ? t.roster : []).filter((x) => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, 300);
      const slots = {};
      for (const s of SLOT_ORDER) { const n = Number(t.slots?.[s]); slots[s] = Number.isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : DEFAULT_SLOTS[s]; }
      const locks = {};
      for (const [id, v] of Object.entries(t.locks && typeof t.locks === "object" ? t.locks : {})) if (roster.includes(id) && (v === "start" || v === "bench")) locks[id] = v;
      return { id: str(t.id, 40), name: str(t.name, 40) || "My Team", roster, scoring: SCORING.includes(t.scoring) ? t.scoring : "ppr", slots, locks };
    });
    if (!out.teams.length) delete out.teams;
  }
  if (typeof d.teamId === "string") out.teamId = d.teamId.slice(0, 40);
  if (d.hr && typeof d.hr === "object" && !Array.isArray(d.hr)) {
    out.hr = {};
    for (const [k, v] of Object.entries(d.hr).slice(0, 500)) { const n = finite(v); if (n !== null && Math.abs(n) >= 100 && Math.abs(n) <= 100000) out.hr[str(k, 120)] = n; }
  }
  if (Array.isArray(d.slip)) out.slip = d.slip.filter((x) => typeof x === "string").map((x) => x.slice(0, 120)).slice(0, 100);
  if (d.custom && typeof d.custom === "object" && !Array.isArray(d.custom)) {
    out.custom = {};
    for (const [id, c] of Object.entries(d.custom).slice(0, 100)) {
      if (!c || typeof c !== "object" || typeof c.pid !== "string" || (c.kind !== "td" && c.kind !== "prop")) continue;
      const e = { kind: c.kind, pid: str(c.pid, 40), label: str(c.label, 120) };
      if (c.kind === "prop") {
        if (!PROP_STATS.includes(c.stat) || (c.side !== "over" && c.side !== "under") || finite(c.line) === null) continue;
        Object.assign(e, { stat: c.stat, side: c.side, line: c.line });
      }
      out.custom[str(id, 120)] = e;
    }
  }
  const stake = finite(d.stake);
  if (stake !== null && stake >= 0 && stake <= 1e6) out.stake = stake;
  return out;
}

export function parseBackup(text) {
  const t = String(text ?? "").replace(/\s+/g, "");
  if (!t.startsWith(PREFIX)) return { ok: false, error: `That doesn't look like a backup code — it should start with ${PREFIX}` };
  let obj;
  try { obj = JSON.parse(fromB64(t.slice(PREFIX.length))); }
  catch { return { ok: false, error: "That backup code is damaged or cut off. Copy the whole code again and retry." }; }
  if (!obj || obj.v !== 1 || !obj.data || typeof obj.data !== "object") return { ok: false, error: "Unrecognized backup version." };
  const data = sanitize(obj.data);
  if (!Object.keys(data).length) return { ok: false, error: "That backup didn't contain anything to restore." };
  return { ok: true, data, savedAt: str(obj.savedAt, 40) };
}

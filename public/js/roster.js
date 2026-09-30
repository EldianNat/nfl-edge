// Turn pasted text ("Josh Allen", "1. Bijan Robinson - ATL RB", "Seattle D/ST", ...) into roster entries.
import { TEAM_FULL, TEAM_ALIAS } from "./teams.js";

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

// Lowercase, strip accents/punctuation, and drop generational suffixes so "Kenneth Walker III" == "Kenneth Walker".
export function normName(s) {
  const toks = String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.'’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return toks.filter((t, i) => !(i > 0 && SUFFIX.has(t))).join(" ");
}

const DST_WORDS = /\b(d st|dst|defense|defence|def|special teams|d)\b/g;
const CITY_AMBIGUOUS = new Set(["los angeles", "new york"]);
const TEAM_KEYS = Object.entries(TEAM_FULL).map(([abbr, full]) => {
  const parts = full.toLowerCase().split(" ");
  const nick = parts.pop();
  const city = parts.join(" ");
  return { abbr, names: new Set([normName(full), normName(nick), ...(CITY_AMBIGUOUS.has(city) ? [] : [normName(city)])]) };
});

// Which team does this text (already normalized, D/ST words removed) name?
function teamOf(norm, allowAbbr) {
  const t = norm.trim();
  for (const k of TEAM_KEYS) if (k.names.has(t)) return k.abbr;
  if (allowAbbr) {
    const up = t.toUpperCase();
    if (TEAM_FULL[up]) return up;
    if (TEAM_ALIAS[up]) return TEAM_ALIAS[up];
  }
  return null;
}

const containsWords = (hay, needle) => ` ${hay} `.includes(` ${needle} `);

/**
 * entries: [{id, name, pos, team}]. Returns {matched: [{entry, line, note}], unmatched: [line]}.
 */
export function parsePaste(text, entries) {
  const byKey = new Map();
  const dstByTeam = new Map();
  for (const e of entries) {
    if (e.pos === "DST") { dstByTeam.set(e.team, e); continue; }
    const k = normName(e.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length); // longest name wins

  const lines = String(text).split(/[\n\r;\t|]+/).flatMap((l) => (/,/.test(l) && !/^[^,]+,\s*[^,]+$/.test(l.trim()) ? l.split(",") : [l]));
  const matched = [], unmatched = [];
  const seen = new Set();
  const add = (entry, line, note) => { if (!seen.has(entry.id)) { seen.add(entry.id); matched.push({ entry, line, note }); } };

  for (const raw of lines) {
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim();
    if (!line || line.length < 2) continue;
    const norm = normName(line);
    if (!norm) continue;

    // Defense: explicit D/ST wording, or the whole line is just a team name.
    const hasDstWord = DST_WORDS.test(norm); DST_WORDS.lastIndex = 0;
    const stripped = norm.replace(DST_WORDS, " ").replace(/\s+/g, " ").trim();
    if (hasDstWord) {
      const t = teamOf(stripped, true);
      if (t && dstByTeam.has(t)) { add(dstByTeam.get(t), line); continue; }
    }

    // Player by name (longest known name contained in the line).
    let hit = null;
    for (const k of keys) if (containsWords(norm, k)) { hit = k; break; }
    if (!hit && /,/.test(line)) { // "Allen, Josh"
      const [last, first] = line.split(",").map((x) => normName(x));
      if (first && last && byKey.has(`${first} ${last}`)) hit = `${first} ${last}`;
    }
    let note;
    if (!hit) { // "J Allen" style: first initial + last name, only if unambiguous
      const toks = norm.split(" ");
      if (toks.length >= 2 && toks[0].length === 1) {
        const cands = entries.filter((e) => e.pos !== "DST" && normName(e.name).startsWith(toks[0]) && normName(e.name).split(" ").slice(1).join(" ") === toks.slice(1).join(" "));
        if (cands.length === 1) { add(cands[0], line, "matched by initial"); continue; }
      }
    }
    if (hit) {
      let cands = byKey.get(hit);
      if (cands.length > 1) {
        const withHint = cands.filter((e) => containsWords(norm, e.team.toLowerCase()) || containsWords(norm, e.pos.toLowerCase()));
        if (withHint.length) cands = withHint;
        else note = `${cands.length} players share this name; picked ${cands[0].pos} ${cands[0].team}`;
      }
      add(cands[0], line, note);
      continue;
    }

    // A bare team name ("Seahawks") is a defense.
    const t = teamOf(stripped, false);
    if (t && dstByTeam.has(t)) { add(dstByTeam.get(t), line); continue; }
    unmatched.push(line);
  }
  return { matched, unmatched };
}

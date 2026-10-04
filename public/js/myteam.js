// "My Team" tab: saved fantasy teams (roster + league settings) and the auto-generated best lineup.
// The page state lives in app.js; this module gets it through a context object `C`.
import { optimize, DEFAULT_SLOTS, SLOT_ORDER } from "./lineup.js";
import { parsePaste, normName } from "./roster.js";
import { exportBackup, parseBackup } from "./backup.js";

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DST"];
const SCORING = { ppr: "PPR", half: "Half PPR", std: "Standard" };
const FLEX_HELP = { FLEX: "RB/WR/TE", SUPERFLEX: "any QB/RB/WR/TE" };

const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const newTeam = (name, roster = [], base = {}) => ({ id: uid(), name, roster, scoring: base.scoring ?? "ppr", slots: { ...DEFAULT_SLOTS, ...(base.slots ?? {}) }, locks: {} });

export function initTeams(S, store) {
  let teams = store.get("teams", null);
  if (!Array.isArray(teams) || !teams.length) teams = [newTeam("My Team", store.get("roster", []))]; // carry over old ★ list
  for (const t of teams) { t.slots = { ...DEFAULT_SLOTS, ...(t.slots ?? {}) }; t.locks ??= {}; t.roster ??= []; t.scoring ||= "ppr"; }
  S.teams = teams;
  const id = store.get("teamId", teams[0].id);
  S.teamId = teams.some((t) => t.id === id) ? id : teams[0].id;
  Object.assign(S, { mtq: "", mtPasteOpen: false, mtPasteText: "", mtResult: null, mtConfirm: null, mtBackup: "", mtBackupMsg: null, mtRestoreText: "" });
}

export const curTeam = (S) => S.teams.find((t) => t.id === S.teamId) ?? S.teams[0];
const save = (C) => { C.store.set("teams", C.S.teams); C.store.set("teamId", C.S.teamId); };

export function toggleRoster(C, id) {
  const t = curTeam(C.S);
  if (t.roster.includes(id)) { t.roster = t.roster.filter((x) => x !== id); delete t.locks[id]; }
  else t.roster = [...t.roster, id];
  save(C);
}

// ---- helpers ---------------------------------------------------------------
function kickMs(g) {
  if (!g?.date) return Infinity;
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(`${g.date}T12:00:00Z`));
  return Date.parse(`${g.date}T${g.time || "13:00"}:00${tz.includes("EDT") ? "-04:00" : "-05:00"}`);
}
const started = (g) => !!g && (g.final || Date.now() >= kickMs(g));
function shortKick(g) {
  if (!g?.date) return "";
  const day = new Date(g.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  if (!g.time) return day;
  let [h, m] = g.time.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12;
  return `${day} ${h}:${String(m).padStart(2, "0")}${ap}`;
}

// Turn a roster id into something the optimizer understands.
function candidate(C, id, scoring) {
  const e = C.ENT.get(id);
  if (!e) return null;
  const c = { id, name: e.name, pos: e.pos, team: e.team, proj: 0, playable: false, note: null, ent: e, game: null };
  if (e.projected) {
    c.proj = Number(e[scoring] ?? e.ppr) || 0;
    c.playable = (e.avail ?? 1) > 0;
    c.game = C.GAMES.get(e.gameId) ?? null;
    if (!c.playable) c.note = (e.injury?.status || "Out").toUpperCase();
  } else c.note = C.SLATE.has(e.team) ? "No projection" : "BYE";
  return c;
}

const fmt1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");

function searchResults(C, t) {
  const q = normName(C.S.mtq || "");
  if (q.length < 2) return [];
  const toks = q.split(" ");
  const out = [];
  for (const e of C.ENT.values()) {
    if (t.roster.includes(e.id)) continue;
    e._k ??= `${normName(e.name)} ${e.team.toLowerCase()} ${e.pos.toLowerCase()}`;
    if (toks.every((tok) => ` ${e._k}`.includes(` ${tok}`))) out.push(e);
  }
  const score = (e) => (e._k.startsWith(q) ? 0 : 1);
  return out.sort((a, b) => score(a) - score(b) || (b[t.scoring] ?? b.ppr ?? -1) - (a[t.scoring] ?? a.ppr ?? -1) || a.name.localeCompare(b.name)).slice(0, 8);
}

function addIds(C, ids) {
  const t = curTeam(C.S);
  let added = 0;
  for (const id of ids) if (!t.roster.includes(id)) { t.roster.push(id); added++; }
  save(C);
  return added;
}

// ---- view ------------------------------------------------------------------
export function myTeamView(C) {
  const { S, D, h } = C;
  const t = curTeam(S);
  const cands = [], unknown = [];
  for (const id of t.roster) { const c = candidate(C, id, t.scoring); if (c) cands.push(c); else unknown.push(id); }
  const res = cands.length && D.targetWeek ? optimize(cands, t.slots, t.locks) : null;
  return `${C.early()}${teamBar(C, t)}${settings(C, t)}${lineupCard(C, t, res, cands)}${addCard(C, t)}${rosterCard(C, t, cands, unknown)}${backupCard(C)}`;
}

function teamBar(C, t) {
  const { S, h } = C;
  const conf = (k, label) => (S.mtConfirm === k ? `<button class="b" data-mt="${k}" style="border-color:var(--bad);color:var(--bad)">Click again to confirm</button>` : `<button class="b" data-mt="${k}">${label}</button>`);
  return `<div class="card"><div class="controls" style="margin:0">
    <select data-mti="team" aria-label="Choose team">${S.teams.map((x) => `<option value="${h.esc(x.id)}" ${x.id === t.id ? "selected" : ""}>${h.esc(x.name)}</option>`).join("")}</select>
    <input data-mti="name" value="${h.esc(t.name)}" maxlength="40" aria-label="Team name" style="min-width:140px">
    <button class="b" data-mt="newTeam">+ New team</button>
    ${t.roster.length ? conf("clear", "Clear roster") : ""}
    ${S.teams.length > 1 ? conf("delete", "Delete team") : ""}
  </div><div class="muted" style="margin-top:6px">Saved in this browser only. Use one team per league — each has its own roster, scoring and lineup slots.</div></div>`;
}

function settings(C, t) {
  const { h } = C;
  const inputs = SLOT_ORDER.map((s) => `<label class="muted" title="${FLEX_HELP[s] ?? s}" style="display:inline-flex;flex-direction:column;gap:2px;font-size:12px">${s === "SUPERFLEX" ? "SUPERFLEX" : s}<input class="odds" type="number" min="0" max="8" step="1" style="width:56px;text-align:center" data-mti="slot|${s}" value="${t.slots[s]}"></label>`).join("");
  return `<div class="card"><h3>League settings</h3><div class="controls" style="margin:0;align-items:flex-end">
    <label class="muted" style="display:inline-flex;flex-direction:column;gap:2px;font-size:12px">Scoring<select data-mti="scoring">${Object.entries(SCORING).map(([k, v]) => `<option value="${k}" ${t.scoring === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <span class="muted" style="font-size:12px;align-self:center">Starting slots →</span>${inputs}</div>
    <div class="muted" style="margin-top:6px">Set a slot to 0 if your league doesn't use it. FLEX = RB/WR/TE, SUPERFLEX = QB/RB/WR/TE. Kickers and defenses use the standard scoring (FG 3/4/5, XP 1; sack 1, takeaway 2, TD 6, points-allowed tiers).</div></div>`;
}

// Player cell: headshot, name, team; second line: opponent and kickoff.
function playerCell(h, p, withKick = true) {
  const e = p.ent;
  const sub = e.projected ? `${e.home ? "vs" : "@"} ${e.opp}${withKick && p.game ? " · " + shortKick(p.game) : ""}` : "";
  return `<td>${e.headshot ? `<img class="hs" loading="lazy" src="${h.esc(e.headshot)}" alt="">` : ""}<b>${h.esc(p.name)}</b> <span class="muted">${p.pos === "DST" ? "" : h.esc(p.team)}</span>${sub ? `<div class="muted sub">${h.esc(sub)}</div>` : ""}</td>`;
}
const chip = (h, text, c = "") => `<span class="chip ${c}">${h.esc(text)}</span>`;

function notesFor(C, p, r) {
  const { h } = C;
  const e = p.ent, out = [];
  if (p.note) out.push(chip(h, p.note, "w"));
  else if (e.injury?.status) out.push(chip(h, e.injury.status + (e.injury.detail ? ` – ${e.injury.detail}` : ""), "w"));
  if (e.projected && !p.note) {
    if (p.pos === "DST") out.push(chip(h, `${fmt1(e.detail?.sacks)} sacks · ${fmt1(e.detail?.takeaways)} TO · opp ${fmt1(e.oppImplied)} pts`));
    else if (p.pos === "K") out.push(chip(h, `team ${fmt1(e.implied)} pts`));
    else out.push(`<span class="chip">${h.grade(e.grade || "C")} matchup · team ${fmt1(e.implied)} pts</span>`);
  }
  if (e.low) out.push(chip(h, "Low usage"));
  if (r?.forced) out.push(chip(h, "🔒 You locked"));
  if (r?.alt && r.alt.gap <= 1.5) out.push(`<span class="chip w" title="${h.esc(Math.round(r.alt.p * 100) + "% chance " + r.alt.player.name + " outscores him")}">Toss-up: ${h.esc(r.alt.player.name)} (−${r.alt.gap.toFixed(1)})</span>`);
  if (started(p.game)) out.push(chip(h, p.game?.final ? "Game final" : "Game started"));
  return out.join(" ");
}

function lineupCard(C, t, res, cands) {
  const { D, h } = C;
  if (!t.roster.length) return `<div class="card"><h3>Best lineup</h3><p class="muted">Add your players below (search, or paste your whole roster) and the best lineup will appear here automatically.</p></div>`;
  if (!D.targetWeek) return `<div class="card"><h3>Best lineup</h3><p class="muted">No games are scheduled yet. Lineups will appear once next week's schedule posts.</p></div>`;
  const rows = res.starters.map((r) => {
    if (!r.player) return `<tr><td class="sl">${r.slot}</td><td colspan="3" class="muted">Empty — no eligible player on your roster</td></tr>`;
    const p = r.player;
    return `<tr><td class="sl">${r.slot}</td>${playerCell(h, p)}<td><b>${fmt1(p.proj)}</b></td><td class="wrap">${notesFor(C, p, r)}</td></tr>`;
  }).join("");
  const bench = res.bench.map((b) => {
    const p = b.player;
    let why;
    if (b.locked) why = "You benched him.";
    else if (p.note) why = "Can't play this week.";
    else if (b.target) why = `Behind ${h.esc(b.target.player.name)} by ${b.target.gap.toFixed(1)} — ${Math.round(b.target.p * 100)}% chance he outscores him.`;
    else why = `No open ${p.pos} slot.`;
    return `<tr>${playerCell(h, p)}<td>${fmt1(p.proj)}</td><td class="wrap muted">${why}</td><td class="wrap">${notesFor(C, p, null)}</td></tr>`;
  }).join("");
  const warn = [
    ...res.warnings,
    ...(res.open ? [`${res.open} slot${res.open > 1 ? "s" : ""} can't be filled from your roster: ${res.starters.filter((r) => !r.player).map((r) => r.slot).join(", ")}. Add a player, or set that slot to 0.`] : []),
  ].map((w) => `<div class="banner">${h.esc(w)}</div>`).join("");
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
    <h3 style="margin:0">Best lineup — Week ${D.targetWeek} <span class="muted">(${SCORING[t.scoring]})</span></h3>
    <div><span class="muted">Projected total</span> <span class="total">${res.total.toFixed(1)}</span> <button class="b" data-mt="copy">Copy lineup</button></div></div>
    ${warn}
    <div class="tbl" style="margin-top:8px"><table class="mt"><tr><th>Slot</th><th>Player</th><th>Proj</th><th class="wrap">Notes</th></tr>${rows}</table></div>
    <div class="muted" style="margin-top:6px">Chosen by an exact optimizer: it finds the highest-scoring legal lineup for your slots. A “toss-up” means a bench player is within 1.5 points, so use your own judgment (injury news, game script). Times are Eastern.</div></div>
    ${bench ? `<div class="card"><h3>Bench</h3><div class="tbl"><table><tr><th>Player</th><th>Proj</th><th class="wrap">Why he's on the bench</th><th class="wrap">Notes</th></tr>${bench}</table></div></div>` : ""}`;
}

function addCard(C, t) {
  const { S, h } = C;
  const res = searchResults(C, t);
  const r = S.mtResult;
  const rlist = res.map((e) => {
    const c = candidate(C, e.id, t.scoring);
    return `<div><span>${h.esc(e.name)} <span class="muted">${e.pos === "DST" ? "D/ST" : `${e.pos} ${e.team}`}${c?.note ? ` · ${h.esc(c.note)}` : ""}</span></span><span>${c?.playable ? `<span class="muted">${fmt1(c.proj)} pts</span> ` : ""}<button class="b" data-mt="add|${h.esc(e.id)}">+ Add</button></span></div>`;
  }).join("");
  const msg = r ? `<div class="banner" style="margin-top:8px"><b>Added ${r.added}</b>${r.dupes ? `, ${r.dupes} already on your roster` : ""}.${r.unmatched.length ? ` Couldn't match ${r.unmatched.length}: <span class="neg">${r.unmatched.map(h.esc).join("; ")}</span> — they're still in the box below; fix the spelling and try again, or use search.` : ""}${r.notes.length ? `<br>${r.notes.map(h.esc).join("<br>")}` : ""} <button class="b" data-mt="pasteDismiss" style="margin-left:6px">Dismiss</button></div>` : "";
  return `<div class="card"><h3>Add players</h3>
    <input class="wide" data-mti="q" placeholder="Search by name, team or position (players, kickers, or a defense like “Seahawks”)" value="${h.esc(S.mtq)}" autocomplete="off">
    ${rlist ? `<div class="results">${rlist}</div>` : S.mtq.trim().length >= 2 ? `<div class="muted" style="margin-top:6px">No matches.</div>` : ""}
    <div style="margin-top:10px"><button class="b" data-mt="pasteToggle">${S.mtPasteOpen ? "Hide paste box" : "Paste a whole roster…"}</button></div>
    ${S.mtPasteOpen ? `<div style="margin-top:8px"><div class="muted">Copy your roster from ESPN / Yahoo / Sleeper / NFL.com and paste it here — one player per line or comma-separated. Defenses can be “Seahawks D/ST”.</div>
      <textarea data-mti="pastebox" rows="8" placeholder="Josh Allen&#10;Bijan Robinson&#10;Jaxon Smith-Njigba&#10;Seattle D/ST">${h.esc(S.mtPasteText)}</textarea>
      <button class="b p" data-mt="pasteGo">Match &amp; add players</button></div>` : ""}
    ${msg}</div>`;
}

function rosterCard(C, t, cands, unknown) {
  const { h } = C;
  if (!t.roster.length) return "";
  const sorted = [...cands].sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos) || b.proj - a.proj);
  const rows = sorted.map((p) => {
    const lock = t.locks[p.id] ?? "";
    return `<tr><td class="sl">${p.pos}</td>${playerCell(h, p, false)}<td>${fmt1(p.proj)}</td><td class="wrap">${notesFor(C, p, null)}</td>
      <td><select data-mti="lock|${h.esc(p.id)}" aria-label="Lock ${h.esc(p.name)}"><option value="">Auto</option><option value="start" ${lock === "start" ? "selected" : ""}>Always start</option><option value="bench" ${lock === "bench" ? "selected" : ""}>Never start</option></select></td>
      <td><span class="x" data-mt="rm|${h.esc(p.id)}" title="Remove from team">✕</span></td></tr>`;
  }).join("");
  const missing = unknown.map((id) => `<tr><td colspan="5" class="muted">Unknown player (${h.esc(id)}) — no longer in the data</td><td><span class="x" data-mt="rm|${h.esc(id)}">✕</span></td></tr>`).join("");
  return `<div class="card"><h3>Roster <span class="muted">(${t.roster.length})</span></h3><div class="tbl"><table class="mt"><tr><th>Pos</th><th>Player</th><th>Proj</th><th class="wrap">Notes</th><th>Lock</th><th></th></tr>${rows}${missing}</table></div>
    <div class="muted" style="margin-top:6px">“Always start” forces a player into your lineup (for a must-start star, or a game you can't move); “Never start” keeps him out (say, a player you're trading away). Players on bye or ruled out are skipped automatically.</div></div>`;
}

function backupCard(C) {
  const { S, h } = C;
  const confirm = S.mtConfirm === "restore";
  return `<div class="card"><h3>Back up or move your data</h3>
    <div class="muted">Your teams, Hard Rock odds and parlay slip are saved only in this browser, on this web address. To move them to a new phone or browser (or if the site's address ever changes), create a backup code here, then paste it into the Restore box on the other one.</div>
    <div style="margin:8px 0"><button class="b p" data-mt="backupMake">Create backup code</button></div>
    ${S.mtBackup ? `<textarea readonly rows="4" aria-label="Backup code">${h.esc(S.mtBackup)}</textarea><div><button class="b" data-mt="backupCopy">Copy code</button></div>` : ""}
    <div style="margin-top:12px"><b>Restore</b> <span class="muted">— replaces the teams on this device</span></div>
    <textarea data-mti="restorebox" rows="3" placeholder="Paste a backup code (starts with NFLEDGE1:)">${h.esc(S.mtRestoreText)}</textarea>
    <button class="b" data-mt="restore" ${confirm ? 'style="border-color:var(--bad);color:var(--bad)"' : ""}>${confirm ? "Click again to confirm restore" : "Restore from code"}</button>
    ${S.mtBackupMsg ? `<div class="banner" style="margin-top:8px">${h.esc(S.mtBackupMsg)}</div>` : ""}</div>`;
}

// ---- events ----------------------------------------------------------------
function lineupText(C) {
  const t = curTeam(C.S);
  const cands = t.roster.map((id) => candidate(C, id, t.scoring)).filter(Boolean);
  const res = optimize(cands, t.slots, t.locks);
  const lines = [`${t.name} — Week ${C.D.targetWeek} best lineup (${SCORING[t.scoring]})`];
  for (const r of res.starters) lines.push(`${r.slot}: ${r.player ? `${r.player.name}${r.player.pos === "DST" ? "" : ` (${r.player.team})`} — ${fmt1(r.player.proj)}` : "—"}`);
  lines.push(`Projected total: ${res.total.toFixed(1)}`);
  if (res.bench.length) lines.push(`Bench: ${res.bench.map((b) => b.player.name).join(", ")}`);
  return lines.join("\n");
}

// Returns true when the page should re-render.
export function mtClick(C, action, arg, el) {
  const { S } = C, t = curTeam(S);
  if (action !== "clear" && action !== "delete" && action !== "restore") S.mtConfirm = null;
  switch (action) {
    case "add": addIds(C, [arg]); S.mtq = ""; return true;
    case "addFirst": { const r = searchResults(C, t)[0]; if (!r) return false; addIds(C, [r.id]); S.mtq = ""; return true; }
    case "rm": t.roster = t.roster.filter((x) => x !== arg); delete t.locks[arg]; save(C); return true;
    case "newTeam": {
      const n = newTeam(`Team ${S.teams.length + 1}`, [], t);
      S.teams.push(n); S.teamId = n.id; S.mtq = ""; S.mtResult = null; save(C); return true;
    }
    case "clear":
      if (S.mtConfirm !== "clear") { S.mtConfirm = "clear"; return true; }
      t.roster = []; t.locks = {}; S.mtConfirm = null; save(C); return true;
    case "delete":
      if (S.mtConfirm !== "delete") { S.mtConfirm = "delete"; return true; }
      S.teams = S.teams.filter((x) => x.id !== t.id); S.teamId = S.teams[0].id; S.mtConfirm = null; save(C); return true;
    case "pasteToggle": S.mtPasteOpen = !S.mtPasteOpen; return true;
    case "pasteDismiss": S.mtResult = null; return true;
    case "pasteGo": {
      const box = document.querySelector('[data-mti="pastebox"]');
      const text = box ? box.value : S.mtPasteText;
      const { matched, unmatched } = parsePaste(text, [...C.ENT.values()]);
      const fresh = matched.filter((m) => !t.roster.includes(m.entry.id));
      addIds(C, fresh.map((m) => m.entry.id));
      S.mtResult = { added: fresh.length, dupes: matched.length - fresh.length, unmatched, notes: matched.filter((m) => m.note).map((m) => `“${m.line}”: ${m.note}`) };
      S.mtPasteText = unmatched.join("\n");
      S.mtPasteOpen = unmatched.length > 0;
      return true;
    }
    case "backupMake":
    case "backupCopy": {
      const code = action === "backupMake" ? exportBackup((k) => C.store.get(k, undefined)) : S.mtBackup;
      S.mtBackup = code;
      S.mtBackupMsg = "Backup code created below. Copy it and paste it into the Restore box on your other device.";
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => { S.mtBackupMsg = "Backup code copied to your clipboard (also shown below). Paste it into the Restore box on your other device."; C.render(); }, () => {});
      return true;
    }
    case "restore": {
      const box = document.querySelector('[data-mti="restorebox"]');
      const text = box ? box.value : S.mtRestoreText;
      S.mtRestoreText = text;
      const r = parseBackup(text);
      if (!r.ok) { S.mtConfirm = null; S.mtBackupMsg = r.error; return true; }
      if (S.mtConfirm !== "restore") { S.mtConfirm = "restore"; S.mtBackupMsg = `Found a backup with ${r.data.teams?.length ?? 0} team(s). This replaces the teams on this device — click the button again to confirm.`; return true; }
      for (const [k, v] of Object.entries(r.data)) C.store.set(k, v);
      S.mtConfirm = null;
      location.reload();
      return false;
    }
    case "copy": {
      const txt = lineupText(C);
      const done = () => { el.textContent = "Copied ✓"; };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done, () => window.prompt("Copy your lineup:", txt));
      else window.prompt("Copy your lineup:", txt);
      return false;
    }
  }
  return false;
}

export function mtChange(C, field, arg, value) {
  const { S } = C, t = curTeam(S);
  switch (field) {
    case "team": if (S.teams.some((x) => x.id === value)) { S.teamId = value; S.mtq = ""; S.mtResult = null; S.mtConfirm = null; save(C); } return true;
    case "name": t.name = value.trim().slice(0, 40) || t.name; save(C); return true;
    case "scoring": if (SCORING[value]) { t.scoring = value; save(C); } return true;
    case "slot": { const n = Math.max(0, Math.min(8, Math.floor(Number(value)) || 0)); t.slots[arg] = n; save(C); return true; }
    case "lock": if (value) t.locks[arg] = value; else delete t.locks[arg]; save(C); return true;
    case "restorebox": S.mtRestoreText = value; return false; // no re-render: it would swallow the click on "Restore"
    case "pastebox": S.mtPasteText = value; return false; // no re-render: it would swallow the click on "Match & add"
    case "q": return false;
  }
  return false;
}

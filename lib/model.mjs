// Team + game + player models. Pure functions: rows in, plain objects out.
import { normCdf, noVig, americanToDecimal, ev, probToAmerican } from "../public/js/math.js";

export const MARGIN_SD = 13.5; // NFL single-game margin standard deviation
export const TOTAL_SD = 13.0;
export const HFA = 1.5;
export const PLAYS_PER_GAME = 63; // converts EPA/play to points/game
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// ---- CSV ------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// ---- Team ratings ---------------------------------------------------------
// Opponent-adjusted offense/defense ratings by iteration.
// obs: [{team, opp, f (produced), a (allowed)}]. Returns {off, def}: points above
// average produced / allowed per game. Positive def = worse defense.
export function adjustRatings(obs, shrinkGames = 5, iters = 20) {
  const teams = [...new Set(obs.map((o) => o.team))];
  const avg = mean(obs.map((o) => o.f));
  const off = Object.fromEntries(teams.map((t) => [t, 0]));
  const def = Object.fromEntries(teams.map((t) => [t, 0]));
  const by = Object.fromEntries(teams.map((t) => [t, obs.filter((o) => o.team === t)]));
  for (let k = 0; k < iters; k++) {
    for (const t of teams) {
      off[t] = mean(by[t].map((o) => o.f - avg - (def[o.opp] ?? 0)));
      def[t] = mean(by[t].map((o) => o.a - avg - (off[o.opp] ?? 0)));
    }
  }
  for (const t of teams) {
    const n = by[t].length;
    const s = n / (n + shrinkGames);
    off[t] *= s;
    def[t] *= s;
  }
  return { off, def, avg };
}

export function buildTeamRatings(games, teamRows) {
  const done = games.filter((g) => g.home_score !== "" && g.away_score !== "");
  const ptsObs = done.flatMap((g) => [
    { team: g.home_team, opp: g.away_team, f: +g.home_score, a: +g.away_score },
    { team: g.away_team, opp: g.home_team, f: +g.away_score, a: +g.home_score },
  ]);
  if (!ptsObs.length) return null;

  const key = (gid, t) => `${gid}|${t}`;
  const epa = new Map();
  for (const r of teamRows) {
    const plays = (num(r.attempts) ?? 0) + (num(r.carries) ?? 0) + (num(r.sacks_suffered) ?? 0);
    if (!plays) continue;
    const e = ((num(r.passing_epa) ?? 0) + (num(r.rushing_epa) ?? 0)) / plays;
    epa.set(key(r.game_id, r.team), { e, plays, opp: r.opponent_team, pass: (num(r.passing_epa) ?? 0) / Math.max(1, (num(r.attempts) ?? 0) + (num(r.sacks_suffered) ?? 0)), rush: (num(r.rushing_epa) ?? 0) / Math.max(1, num(r.carries) ?? 0) });
  }
  const epaObs = [];
  for (const [k, v] of epa) {
    const [gid, team] = k.split("|");
    const other = epa.get(key(gid, v.opp));
    if (!other) continue;
    epaObs.push({ team, opp: v.opp, f: v.e * PLAYS_PER_GAME, a: other.e * PLAYS_PER_GAME });
  }

  const P = adjustRatings(ptsObs);
  const E = epaObs.length ? adjustRatings(epaObs) : null;
  const teams = {};
  for (const t of Object.keys(P.off)) {
    const n = ptsObs.filter((o) => o.team === t).length;
    const mine = ptsObs.filter((o) => o.team === t);
    const off = E && E.off[t] != null ? 0.5 * P.off[t] + 0.5 * E.off[t] : P.off[t];
    const def = E && E.def[t] != null ? 0.5 * P.def[t] + 0.5 * E.def[t] : P.def[t];
    const rows = [...epa.entries()].filter(([k]) => k.endsWith(`|${t}`)).map(([, v]) => v);
    const oppRows = [...epa.entries()].filter(([, v]) => v.opp === t).map(([, v]) => v);
    teams[t] = {
      games: n,
      off: round(off), def: round(def), net: round(off - def),
      ppg: round(mean(mine.map((o) => o.f)), 1), papg: round(mean(mine.map((o) => o.a)), 1),
      epaOff: round(mean(rows.map((r) => r.e)), 3), epaDef: round(mean(oppRows.map((r) => r.e)), 3),
      passEpa: round(mean(rows.map((r) => r.pass)), 3), rushEpa: round(mean(rows.map((r) => r.rush)), 3),
    };
  }
  return { teams, avgPts: P.avg };
}

const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// ---- Games ----------------------------------------------------------------
// carryover: <1 when ratings come from last season (regress to the mean).
export function projectGame(g, R, { effGames, carryover = 1, windPenalty = true } = {}) {
  const H = R.teams[g.home_team], A = R.teams[g.away_team];
  if (!H || !A) return null;
  const hfa = g.location === "Neutral" ? 0 : HFA;
  const c = carryover;
  const homePts = R.avgPts + c * (H.off + A.def) + hfa / 2;
  const awayPts = R.avgPts + c * (A.off + H.def) - hfa / 2;
  let rawMargin = homePts - awayPts;
  let rawTotal = homePts + awayPts;
  const wind = num(g.wind);
  const factors = [];
  if (windPenalty && wind != null && wind >= 15 && g.roof !== "dome" && g.roof !== "closed") {
    rawTotal -= wind >= 20 ? 3 : 1.5;
    factors.push(`Wind ${wind} mph trims the total`);
  }
  const spread = num(g.spread_line), totalLine = num(g.total_line);
  const w = Math.min(0.4, Math.max(0.05, 0.05 + 0.03 * effGames));
  const margin = spread != null ? w * rawMargin + (1 - w) * spread : rawMargin;
  const total = totalLine != null ? w * rawTotal + (1 - w) * totalLine : rawTotal;
  return { rawMargin, rawTotal, margin, total, modelWeight: w, homePts: (total + margin) / 2, awayPts: (total - margin) / 2, factors };
}

export function buildGame(g, R, opts) {
  const p = projectGame(g, R, opts);
  if (!p) return null;
  const spread = num(g.spread_line), totalLine = num(g.total_line);
  const mlA = num(g.away_moneyline), mlH = num(g.home_moneyline);
  const homeWin = normCdf(p.margin / MARGIN_SD);
  const out = {
    id: g.game_id, week: +g.week, type: g.game_type, date: g.gameday, time: g.gametime, away: g.away_team, home: g.home_team,
    stadium: g.stadium, roof: g.roof, wind: num(g.wind), temp: num(g.temp), div: g.div_game === "1",
    awayQb: g.away_qb_name || null, homeQb: g.home_qb_name || null,
    line: { spread, total: totalLine, mlAway: mlA, mlHome: mlH, spreadOddsAway: num(g.away_spread_odds), spreadOddsHome: num(g.home_spread_odds), overOdds: num(g.over_odds), underOdds: num(g.under_odds) },
    proj: { homePts: round(p.homePts, 1), awayPts: round(p.awayPts, 1), margin: round(p.margin, 1), total: round(p.total, 1), rawMargin: round(p.rawMargin, 1), rawTotal: round(p.rawTotal, 1), modelWeight: round(p.modelWeight) },
    probs: { homeWin: round(homeWin, 3), awayWin: round(1 - homeWin, 3) },
    factors: p.factors,
    fairMl: { away: probToAmerican(1 - homeWin), home: probToAmerican(homeWin) },
    legs: [],
  };
  const legs = out.legs;
  const add = (type, side, label, line, odds, prob, oddsOther) => {
    if (odds == null) return;
    let fair = null;
    if (oddsOther != null) fair = noVig(odds, oddsOther)[0];
    legs.push({ id: `${g.game_id}|${type}|${side}`, gameId: g.game_id, week: out.week, type, side, label, line, odds, prob: round(prob, 3), fairProb: fair == null ? null : round(fair, 3), edge: fair == null ? null : round(prob - fair, 3), ev: round(ev(prob, odds), 3) });
  };
  add("ML", "away", `${g.away_team} ML`, null, mlA, 1 - homeWin, mlH);
  add("ML", "home", `${g.home_team} ML`, null, mlH, homeWin, mlA);
  if (spread != null) {
    const homeCover = normCdf((p.margin - spread) / MARGIN_SD);
    const sh = num(g.home_spread_odds), sa = num(g.away_spread_odds);
    add("SPREAD", "away", `${g.away_team} ${spread > 0 ? "+" : ""}${spread}`, spread, sa, 1 - homeCover, sh);
    add("SPREAD", "home", `${g.home_team} ${-spread > 0 ? "+" : ""}${-spread}`, -spread, sh, homeCover, sa);
    out.probs.homeCover = round(homeCover, 3);
    out.probs.awayCover = round(1 - homeCover, 3);
  }
  if (totalLine != null) {
    const over = 1 - normCdf((totalLine - p.total) / TOTAL_SD);
    const oo = num(g.over_odds), uo = num(g.under_odds);
    add("TOTAL", "over", `Over ${totalLine}`, totalLine, oo, over, uo);
    add("TOTAL", "under", `Under ${totalLine}`, totalLine, uo, 1 - over, oo);
    out.probs.over = round(over, 3);
    out.probs.under = round(1 - over, 3);
  }
  return out;
}

// ---- Players --------------------------------------------------------------
const POS = ["QB", "RB", "WR", "TE"];
const TOP_N = { QB: 24, RB: 36, WR: 48, TE: 20 };
const STATS = ["passing_yards", "passing_tds", "passing_interceptions", "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards", "receiving_tds", "fantasy_points", "fantasy_points_ppr"];
const CV = { passYds: 0.3, rushYds: 0.65, recYds: 0.75, rec: 0.6 };
const DECAY = 0.75;
const PROP_STATS = ["passing_yards", "passing_tds", "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards", "receiving_tds"];
const AVAIL = { out: 0, doubtful: 0.25, questionable: 0.9 };

function gradeFor(pct) {
  return pct <= 0.1 ? "A+" : pct <= 0.2 ? "A" : pct <= 0.35 ? "B" : pct <= 0.65 ? "C" : pct <= 0.8 ? "D" : "F";
}

// weekGames: built game objects for the target week. injuries: rows for target week.
export function buildPlayers(playerRows, weekGames, injuries, { carryover = 1, headshots = true } = {}) {
  const byPlayer = new Map();
  for (const r of playerRows) {
    if (!POS.includes(r.position)) continue;
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  for (const rows of byPlayer.values()) rows.sort((a, b) => +a.week - +b.week);

  // Positional baselines (avg per game of top-N players at each position).
  const base = {};
  for (const pos of POS) {
    const list = [...byPlayer.values()].filter((rows) => rows[0].position === pos).map((rows) => ({ rows, ppg: mean(rows.map((r) => num(r.fantasy_points_ppr) ?? 0)) })).sort((a, b) => b.ppg - a.ppg).slice(0, TOP_N[pos]);
    base[pos] = Object.fromEntries(STATS.map((s) => [s, mean(list.flatMap((p) => [mean(p.rows.map((r) => num(r[s]) ?? 0))]))]));
  }

  // Fantasy points allowed to each position by each defense.
  const allowed = {};
  const perWeek = new Map();
  for (const r of playerRows) {
    if (!POS.includes(r.position)) continue;
    const k = `${r.opponent_team}|${r.position}|${r.week}`;
    perWeek.set(k, (perWeek.get(k) ?? 0) + (num(r.fantasy_points_ppr) ?? 0));
  }
  for (const [k, v] of perWeek) {
    const [team, pos] = k.split("|");
    ((allowed[pos] ??= {})[team] ??= []).push(v);
  }
  const ratio = {};
  for (const pos of POS) {
    const lg = mean(Object.values(allowed[pos] ?? {}).map(mean));
    ratio[pos] = {};
    for (const [team, arr] of Object.entries(allowed[pos] ?? {})) {
      const shr = arr.length / (arr.length + 3);
      ratio[pos][team] = { m: 1 + 0.6 * shr * (mean(arr) / lg - 1), pa: mean(arr), n: arr.length };
    }
  }
  const gradeMap = {};
  for (const pos of POS) {
    const sorted = Object.entries(ratio[pos]).sort((a, b) => b[1].m - a[1].m); // best matchup first
    gradeMap[pos] = Object.fromEntries(sorted.map(([t], i) => [t, gradeFor(i / Math.max(1, sorted.length - 1))]));
  }

  // Real-stat matchups (used for props and TD legs, not fantasy points): what each defense
  // actually allows to each position, per stat, vs. the league average for that position.
  const stat = {};
  const sw = new Map();
  for (const r of playerRows) {
    if (!POS.includes(r.position)) continue;
    for (const st of PROP_STATS) {
      const k = `${st}|${r.position}|${r.opponent_team}|${r.week}`;
      sw.set(k, (sw.get(k) ?? 0) + (num(r[st]) ?? 0));
    }
  }
  const acc = {};
  for (const [k, v] of sw) {
    const [st, pos, team] = k.split("|");
    (((acc[st] ??= {})[pos] ??= {})[team] ??= []).push(v);
  }
  for (const st of PROP_STATS) {
    for (const pos of POS) {
      const teams = Object.entries(acc[st]?.[pos] ?? {});
      const lg = mean(teams.map(([, a]) => mean(a)));
      if (!(lg > (st.endsWith("_tds") ? 0.05 : 1))) continue; // skip irrelevant position/stat pairs
      const kk = st.endsWith("_tds") ? 6 : 3; // touchdowns are noisier
      const ms = teams.map(([t, a]) => [t, Math.min(1.35, Math.max(0.7, 1 + 0.6 * (a.length / (a.length + kk)) * (mean(a) / lg - 1))), mean(a)]).sort((a, b) => b[1] - a[1]);
      ((stat[st] ??= {})[pos] = {});
      ms.forEach(([t, m, avg], i) => (stat[st][pos][t] = { m, rank: i + 1, of: ms.length, avg, lg }));
    }
  }
  const pmOf = (st, pos, opp) => { const x = stat[st]?.[pos]?.[opp]; return x ? 1 + carryover * (x.m - 1) : 1; };
  const pmInfo = (st, pos, opp) => { const x = stat[st]?.[pos]?.[opp]; return x ? { mult: round(pmOf(st, pos, opp), 2), rank: x.rank, of: x.of, allowed: round(x.avg, 1), league: round(x.lg, 1) } : null; };

  const inj = new Map(injuries.map((r) => [r.gsis_id, r]));
  const slate = new Map();
  for (const g of weekGames) {
    slate.set(g.home, { opp: g.away, home: true, imp: g.proj.homePts, game: g });
    slate.set(g.away, { opp: g.home, home: false, imp: g.proj.awayPts, game: g });
  }
  const avgImp = mean([...slate.values()].map((s) => s.imp)) || 22;

  const out = [];
  for (const rows of byPlayer.values()) {
    const last = rows[rows.length - 1];
    const s = slate.get(last.team);
    if (!s) continue;
    const pos = last.position;
    const ws = rows.map((_, i) => DECAY ** (rows.length - 1 - i));
    const wsum = ws.reduce((a, b) => a + b, 0);
    const proj = {};
    for (const st of STATS) {
      const k = st.endsWith("_tds") ? 6 : 2; // touchdowns are noisy: regress harder
      const prior = base[pos][st] * 0.85;
      proj[st] = (rows.reduce((a, r, i) => a + ws[i] * (num(r[st]) ?? 0), 0) + k * prior) / (wsum + k);
    }
    const raw = { ...proj };
    const mu = ratio[pos][s.opp];
    const matchup = mu ? 1 + carryover * (mu.m - 1) : 1;
    const script = Math.pow(s.imp / avgImp, 0.6);
    const mult = matchup * script;
    for (const st of STATS) proj[st] *= mult;
    // Rebuild fantasy points from the regressed components (raw totals carry TD luck).
    const base0 = proj.passing_yards * 0.04 + proj.passing_tds * 4 - proj.passing_interceptions * 2 + proj.rushing_yards * 0.1 + proj.rushing_tds * 6 + proj.receiving_yards * 0.1 + proj.receiving_tds * 6;
    proj.fantasy_points = base0;
    proj.fantasy_points_ppr = base0 + proj.receptions;

    const i = inj.get(last.player_id);
    const status = (i?.report_status || "").toLowerCase();
    const avail = AVAIL[status] ?? 1;
    const ppr = proj.fantasy_points_ppr * avail;
    if (ppr < 2.5 && avail === 1) continue;
    // Props / TD legs use real stats and the defense's stat-specific matchup, never fantasy points.
    const sc = script;
    const P = {
      passYds: raw.passing_yards * pmOf("passing_yards", pos, s.opp) * sc,
      passTd: raw.passing_tds * pmOf("passing_tds", pos, s.opp) * sc,
      rushAtt: raw.carries * pmOf("carries", pos, s.opp) * sc,
      rushYds: raw.rushing_yards * pmOf("rushing_yards", pos, s.opp) * sc,
      rec: raw.receptions * pmOf("receptions", pos, s.opp) * sc,
      tgt: raw.targets * pmOf("targets", pos, s.opp) * sc,
      recYds: raw.receiving_yards * pmOf("receiving_yards", pos, s.opp) * sc,
    };
    const lam = (raw.rushing_tds * pmOf("rushing_tds", pos, s.opp) + raw.receiving_tds * pmOf("receiving_tds", pos, s.opp)) * sc * avail;
    const matchups = {};
    const want = { QB: [["passYds", "passing_yards"], ["rushYds", "rushing_yards"], ["td", "rushing_tds"]], RB: [["rushYds", "rushing_yards"], ["rec", "receptions"], ["recYds", "receiving_yards"], ["td", "rushing_tds"]], WR: [["recYds", "receiving_yards"], ["rec", "receptions"], ["td", "receiving_tds"]], TE: [["recYds", "receiving_yards"], ["rec", "receptions"], ["td", "receiving_tds"]] };
    for (const [k, st] of want[pos]) { const x = pmInfo(st, pos, s.opp); if (x) matchups[k] = x; }
    const tdProb = 1 - Math.exp(-lam);
    out.push({
      id: last.player_id, name: last.player_display_name, pos, team: last.team, opp: s.opp, home: s.home, gameId: s.game.id, headshot: headshots ? last.headshot_url || null : null,
      gp: rows.length, last: rows.slice(-4).map((r) => round(num(r.fantasy_points_ppr) ?? 0, 1)),
      ppr: round(ppr, 1), std: round(proj.fantasy_points * avail, 1), half: round(((proj.fantasy_points + proj.fantasy_points_ppr) / 2) * avail, 1),
      matchup: round(matchup, 2), grade: gradeMap[pos][s.opp] ?? "C", implied: round(s.imp, 1),
      injury: i?.report_status ? { status: i.report_status, detail: i.report_primary_injury || "" } : null, avail,
      stats: {
        passYds: round(P.passYds, 1), passTd: round(P.passTd, 2), rushAtt: round(P.rushAtt, 1), rushYds: round(P.rushYds, 1),
        rec: round(P.rec, 1), tgt: round(P.tgt, 1), recYds: round(P.recYds, 1), tdRate: round(lam, 3),
      },
      matchups,
      tdProb: round(tdProb, 3), fairTd: probToAmerican(tdProb),
    });
  }
  for (const pos of POS) {
    out.filter((p) => p.pos === pos).sort((a, b) => b.ppr - a.ppr).forEach((p, i) => (p.rank = i + 1));
  }
  out.sort((a, b) => b.ppr - a.ppr);
  return { players: out, cv: CV };
}

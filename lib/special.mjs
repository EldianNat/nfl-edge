// Kicker and team-defense (D/ST) projections, using the common default fantasy scoring:
//   K:   FG 3 (40-49 yds: 4, 50+: 5), XP 1
//   D/ST: sack 1, takeaway 2, defensive/special-teams TD 6, safety 2, plus points-allowed tiers
//         (0: 10, 1-6: 7, 7-13: 4, 14-20: 1, 21-27: 0, 28-34: -1, 35+: -4)
import { normCdf } from "../public/js/math.js";
import { dstName } from "../public/js/teams.js";
import { gradeFor, DECAY } from "./model.mjs";

const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const kickerPoints = (r) =>
  3 * ((num(r.fg_made_0_19) ?? 0) + (num(r.fg_made_20_29) ?? 0) + (num(r.fg_made_30_39) ?? 0)) +
  4 * (num(r.fg_made_40_49) ?? 0) +
  5 * ((num(r.fg_made_50_59) ?? 0) + (num(r.fg_made_60_) ?? 0)) +
  (num(r.pat_made) ?? 0);

export const paTierPoints = (pa) => (pa === 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4);

const PA_TIERS = [[-Infinity, 0.5, 10], [0.5, 6.5, 7], [6.5, 13.5, 4], [13.5, 20.5, 1], [20.5, 27.5, 0], [27.5, 34.5, -1], [34.5, Infinity, -4]];
// Expected points-allowed score when the opponent's points ~ Normal(mean, sd).
export const expectedPaPoints = (mu, sd = 9.5) => PA_TIERS.reduce((s, [lo, hi, pts]) => s + pts * (normCdf((hi - mu) / sd) - normCdf((lo - mu) / sd)), 0);

export const dstPoints = ({ sacks, takeaways, tds, safeties, pa }) => sacks + 2 * takeaways + 6 * tds + 2 * safeties + paTierPoints(pa);

const slateOf = (weekGames) => {
  const slate = new Map();
  for (const g of weekGames) {
    slate.set(g.home, { opp: g.away, home: true, imp: g.proj.homePts, oppImp: g.proj.awayPts, game: g });
    slate.set(g.away, { opp: g.home, home: false, imp: g.proj.awayPts, oppImp: g.proj.homePts, game: g });
  }
  return slate;
};

function rankAndGrade(list) {
  const sorted = list.sort((a, b) => b.ppr - a.ppr); // sorts in place
  sorted.forEach((p, i) => { p.rank = i + 1; p.grade = gradeFor(i / Math.max(1, sorted.length - 1)); });
}

export function buildKickers(playerRows, weekGames, injuries, { carryover = 1, headshots = true } = {}) {
  const ks = playerRows.filter((r) => r.position === "K");
  if (!ks.length) return [];
  const by = new Map();
  for (const r of ks) { if (!by.has(r.player_id)) by.set(r.player_id, []); by.get(r.player_id).push(r); }
  for (const rows of by.values()) rows.sort((a, b) => +a.week - +b.week);
  const lg = mean(ks.map(kickerPoints));
  const teamMax = {};
  for (const r of ks) teamMax[r.team] = Math.max(teamMax[r.team] ?? 0, +r.week);
  const slate = slateOf(weekGames);
  const avgImp = mean([...slate.values()].map((s) => s.imp)) || 22;
  const inj = new Map(injuries.map((r) => [r.gsis_id, r]));
  const AVAIL = { out: 0, doubtful: 0.25, questionable: 0.95 };

  const out = [];
  for (const rows of by.values()) {
    const last = rows[rows.length - 1];
    if (+last.week < teamMax[last.team]) continue; // replaced by a newer kicker
    const s = slate.get(last.team);
    if (!s) continue;
    const ws = rows.map((_, i) => DECAY ** (rows.length - 1 - i));
    const k = 6; // kicker output is very noisy (low year-to-year stability): lean hard on the league mean
    let proj = (rows.reduce((a, r, i) => a + ws[i] * kickerPoints(r), 0) + k * lg) / (sum(ws) + k);
    proj = lg + carryover * (proj - lg);
    proj *= Math.pow(s.imp / avgImp, 0.5);
    const g = s.game;
    if (g.wind != null && g.roof !== "dome" && g.roof !== "closed") proj *= g.wind >= 20 ? 0.88 : g.wind >= 15 ? 0.94 : 1;
    const i = inj.get(last.player_id);
    const avail = AVAIL[(i?.report_status || "").toLowerCase()] ?? 1;
    const p1 = round(proj * avail);
    out.push({
      id: last.player_id, name: last.player_display_name, pos: "K", team: last.team, opp: s.opp, home: s.home, gameId: g.id,
      headshot: headshots ? last.headshot_url || null : null, gp: rows.length, last: rows.slice(-4).map((r) => kickerPoints(r)),
      ppr: p1, half: p1, std: p1, matchup: 1, implied: round(s.imp), oppImplied: round(s.oppImp),
      injury: i?.report_status ? { status: i.report_status, detail: i.report_primary_injury || "" } : null, avail,
    });
  }
  rankAndGrade(out);
  return out;
}

// teamRows: stats_team rows (REG, stats season). scores: Map game_id -> {home, away, homeScore, awayScore}.
export function buildDefenses(teamRows, scores, weekGames, { carryover = 1 } = {}) {
  if (!teamRows.length) return [];
  const T = (r, k) => num(r[k]) ?? 0;
  const take = (r) => T(r, "def_interceptions") + T(r, "fumble_recovery_opp");
  const tdsOf = (r) => T(r, "def_tds") + T(r, "special_teams_tds");
  const give = (r) => T(r, "passing_interceptions") + T(r, "rushing_fumbles_lost") + T(r, "receiving_fumbles_lost") + T(r, "sack_fumbles_lost");
  const lg = { sacks: mean(teamRows.map((r) => T(r, "def_sacks"))), take: mean(teamRows.map(take)), tds: mean(teamRows.map(tdsOf)), saf: mean(teamRows.map((r) => T(r, "def_safeties"))) };
  const by = new Map();
  for (const r of teamRows) { if (!by.has(r.team)) by.set(r.team, []); by.get(r.team).push(r); }
  for (const rows of by.values()) rows.sort((a, b) => +a.week - +b.week);
  const reg = (arr, prior, k) => (sum(arr) + k * prior) / (arr.length + k);
  const co = (x, prior) => prior + carryover * (x - prior);
  const slate = slateOf(weekGames);

  const out = [];
  for (const [team, s] of slate) {
    const rows = by.get(team);
    if (!rows) continue;
    const opp = by.get(s.opp) ?? [];
    const defSacks = co(reg(rows.map((r) => T(r, "def_sacks")), lg.sacks, 4), lg.sacks);
    const defTake = co(reg(rows.map(take), lg.take, 6), lg.take);
    const tds = co(reg(rows.map(tdsOf), lg.tds, 12), lg.tds);
    const saf = co(reg(rows.map((r) => T(r, "def_safeties")), lg.saf, 12), lg.saf);
    const oppSack = co(reg(opp.map((r) => T(r, "sacks_suffered")), lg.sacks, 4), lg.sacks);
    const oppGive = co(reg(opp.map(give), lg.take, 6), lg.take);
    const sacks = defSacks * clamp(oppSack / lg.sacks, 0.6, 1.6);
    const takeaways = defTake * clamp(oppGive / lg.take, 0.6, 1.6);
    const paPts = expectedPaPoints(s.oppImp);
    const proj = sacks + 2 * takeaways + 6 * tds + 2 * saf + paPts;
    const last = rows.slice(-4).map((r) => {
      const sc = scores.get(r.game_id);
      if (!sc) return null;
      const pa = sc.home === r.team ? sc.awayScore : sc.homeScore;
      return dstPoints({ sacks: T(r, "def_sacks"), takeaways: take(r), tds: tdsOf(r), safeties: T(r, "def_safeties"), pa });
    }).filter((x) => x != null);
    out.push({
      id: `DST|${team}`, name: dstName(team), pos: "DST", team, opp: s.opp, home: s.home, gameId: s.game.id, headshot: null,
      gp: rows.length, last, ppr: round(proj), half: round(proj), std: round(proj), matchup: 1,
      implied: round(s.imp), oppImplied: round(s.oppImp), injury: null, avail: 1,
      detail: { sacks: round(sacks), takeaways: round(takeaways), paPts: round(paPts) },
    });
  }
  rankAndGrade(out);
  return out;
}

// Players we know of but did not project this week (bye, inactive, no recent usage), so a roster can still hold them.
export function buildOthers(playerRows, projectedIds, teamsOnSlate, allTeams) {
  const seen = new Map();
  for (const r of playerRows) {
    if (!["QB", "RB", "WR", "TE", "K"].includes(r.position) || projectedIds.has(r.player_id)) continue;
    const opp = (num(r.carries) ?? 0) + (num(r.targets) ?? 0) + (num(r.attempts) ?? 0);
    const prev = seen.get(r.player_id);
    if (!prev || +r.week >= prev.week) seen.set(r.player_id, { week: +r.week, row: r, opp: (prev?.opp ?? 0) + opp });
    else prev.opp += opp;
  }
  const out = [];
  for (const [id, v] of seen) if (v.row.position === "K" || v.opp >= 1) out.push([id, v.row.player_display_name, v.row.position, v.row.team]);
  for (const t of allTeams) if (!teamsOnSlate.has(t)) out.push([`DST|${t}`, dstName(t), "DST", t]);
  return out;
}

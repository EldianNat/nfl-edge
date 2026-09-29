// Weekly (or hourly) data refresh: nflverse CSVs -> public/data/*.json
// Safe to run any time. If nothing upstream changed, no file is rewritten.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseCsv, buildTeamRatings, buildGame, buildPlayers, MARGIN_SD } from "../lib/model.mjs";

const OUT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public", "data");
const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

async function get(path, { optional = false } = {}) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${BASE}/${path}`, { headers: { "user-agent": "nfl-edge-refresh" }, redirect: "follow" });
      if (res.status === 404 && optional) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return parseCsv(await res.text());
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  throw new Error(`Failed to fetch ${path}: ${last.message}`);
}
const readJson = async (f) => { try { return JSON.parse(await readFile(join(OUT, f), "utf8")); } catch { return null; } };
const hash = (o) => createHash("sha1").update(JSON.stringify(o)).digest("hex");

function kickoffMs(g) {
  if (!g.gameday) return Infinity;
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(`${g.gameday}T12:00:00Z`));
  const off = tz.includes("EDT") ? "-04:00" : "-05:00";
  return Date.parse(`${g.gameday}T${g.gametime || "13:00"}:00${off}`);
}

async function main() {
  const all = await get("schedules/games.csv");
  const now = new Date();
  const seasons = [...new Set(all.map((g) => +g.season))].sort((a, b) => a - b);
  // Current season = latest one whose first game is within 45 days.
  let season = seasons[seasons.length - 1];
  while (season > seasons[0] && Date.parse(all.filter((g) => +g.season === season).map((g) => g.gameday).sort()[0]) - now > 45 * 864e5) season--;

  const games = all.filter((g) => +g.season === season);
  const played = (g) => g.home_score !== "" && g.away_score !== "";
  const unplayed = games.filter((g) => !played(g));
  const regDone = games.filter((g) => played(g) && g.game_type === "REG");
  const statsSeason = regDone.length ? season : season - 1;
  const usingPrior = statsSeason !== season;
  const carryover = usingPrior ? 0.65 : 1;

  const [teamRows, playerRows, injRows] = await Promise.all([
    get(`stats_team/stats_team_week_${statsSeason}.csv`),
    get(`stats_player/stats_player_week_${statsSeason}.csv`),
    get(`injuries/injuries_${season}.csv`, { optional: true }),
  ]);
  const ratingGames = all.filter((g) => +g.season === statsSeason && g.game_type === "REG");
  const R = buildTeamRatings(ratingGames, teamRows.filter((r) => r.season_type === "REG"));
  if (!R) throw new Error("No completed games to rate teams from");

  const missing = [...new Set(games.flatMap((g) => [g.home_team, g.away_team]))].filter((t) => !R.teams[t]);
  if (missing.length) console.warn(`WARNING: no ratings for ${missing.join(", ")} (team code mismatch or new team)`);

  const maxGames = Math.max(...Object.values(R.teams).map((t) => t.games));
  const effGames = usingPrior ? 2 : maxGames;
  const opts = { effGames, carryover };

  let targetWeek = null, weekGames = [];
  if (unplayed.length) {
    targetWeek = Math.min(...unplayed.map((g) => +g.week));
    weekGames = games.filter((g) => +g.week === targetWeek).map((g) => buildGame(g, R, opts)).filter(Boolean).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  }

  const inj = injRows && targetWeek ? injRows.filter((r) => +r.week === targetWeek) : [];
  const { players, cv } = weekGames.length ? buildPlayers(playerRows.filter((r) => r.season_type === "REG"), weekGames, inj, { carryover }) : { players: [], cv: {} };

  const teams = Object.entries(R.teams).map(([team, t]) => ({ team, ...t })).sort((a, b) => b.net - a.net).map((t, i) => ({ ...t, rank: i + 1 }));

  const site = {
    season, targetWeek, statsSeason, usingPriorSeason: usingPrior, gamesRated: maxGames,
    marginSd: MARGIN_SD, avgPts: Math.round(R.avgPts * 10) / 10,
    injuryWeek: inj.length ? targetWeek : null,
    games: weekGames, players, teams, cv,
    sources: { nflverse: BASE.replace("/releases/download", ""), lines: "nflverse schedules (consensus closing/current lines) – not Hard Rock Bet" },
  };

  // --- Track record: log picks before kickoff, grade after final ---------------
  const log = (await readJson("picks-log.json")) ?? { picks: [] };
  const byId = new Map(log.picks.map((p) => [p.gameId, p]));
  for (const g of weekGames) {
    const raw = games.find((x) => x.game_id === g.id);
    if (byId.get(g.id)?.lockedAt || played(raw) || Date.now() >= kickoffMs(raw)) continue; // never rewrite after kickoff
    const pick = { gameId: g.id, season, week: g.week, away: g.away, home: g.home, loggedAt: now.toISOString(), lockedAt: null, spread: g.line.spread, total: g.line.total, projMargin: g.proj.margin, projTotal: g.proj.total };
    pick.ml = { side: g.probs.homeWin >= 0.5 ? "home" : "away", prob: Math.max(g.probs.homeWin, g.probs.awayWin) };
    if (g.probs.homeCover != null) pick.ats = { side: g.probs.homeCover >= 0.5 ? "home" : "away", prob: Math.max(g.probs.homeCover, g.probs.awayCover) };
    if (g.probs.over != null) pick.ou = { side: g.probs.over >= 0.5 ? "over" : "under", prob: Math.max(g.probs.over, g.probs.under) };
    byId.set(g.id, pick);
  }
  // Lock picks whose kickoff has passed.
  for (const p of byId.values()) {
    const raw = all.find((x) => x.game_id === p.gameId);
    if (!p.lockedAt && raw && Date.now() >= kickoffMs(raw)) p.lockedAt = now.toISOString();
    if (raw && played(raw) && !p.result) {
      const margin = +raw.home_score - +raw.away_score, tot = +raw.home_score + +raw.away_score;
      const r = { homeScore: +raw.home_score, awayScore: +raw.away_score };
      r.ml = margin === 0 ? "push" : (margin > 0 ? "home" : "away") === p.ml.side ? "win" : "loss";
      if (p.ats) r.ats = margin === p.spread ? "push" : (margin > p.spread ? "home" : "away") === p.ats.side ? "win" : "loss";
      if (p.ou) r.ou = tot === p.total ? "push" : (tot > p.total ? "over" : "under") === p.ou.side ? "win" : "loss";
      p.result = r;
    }
  }
  const picks = [...byId.values()].sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
  const tally = (key, min = 0) => {
    const rs = picks.filter((p) => p.result?.[key] && p[key === "ml" ? "ml" : key].prob >= min);
    const c = (v) => rs.filter((p) => p.result[key] === v).length;
    return { w: c("win"), l: c("loss"), p: c("push") };
  };
  const record = { ml: tally("ml"), ats: tally("ats"), ou: tally("ou"), atsConf: tally("ats", 0.54), ouConf: tally("ou", 0.54), mlConf: tally("ml", 0.65) };
  const newLog = { picks, record };

  await mkdir(OUT, { recursive: true });
  const prevSite = await readJson("site.json");
  const siteHash = hash(site);
  let changed = false;
  if (prevSite?.dataHash !== siteHash) {
    await writeFile(join(OUT, "site.json"), JSON.stringify({ generatedAt: now.toISOString(), dataHash: siteHash, ...site }));
    changed = true;
  }
  if (hash((await readJson("picks-log.json")) ?? {}) !== hash(newLog)) {
    await writeFile(join(OUT, "picks-log.json"), JSON.stringify(newLog, null, 1));
    changed = true;
  }
  console.log(`${changed ? "Updated" : "No change"}: ${season} wk ${targetWeek ?? "-"}  | ${weekGames.length} games, ${players.length} players, ratings from ${statsSeason} (${maxGames} gp)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

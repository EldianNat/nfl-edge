import { normCdf, americanToProb, americanToDecimal, probToAmerican, ev, parlay, fmtOdds, fmtLine } from "./js/math.js";

// ---------- state ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("nfledge:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("nfledge:" + k, JSON.stringify(v)); } catch {} },
};
const S = {
  tab: store.get("tab", "games"),
  hr: store.get("hr", {}),          // legId -> Hard Rock American odds override
  slip: store.get("slip", []),      // leg ids
  custom: store.get("custom", {}),  // id -> {label, prob, gameId}
  stake: store.get("stake", 10),
  scoring: store.get("scoring", "ppr"),
  pos: "ALL", q: "", team: "ALL", mine: false,
  roster: store.get("roster", []),
  prop: store.get("prop", { player: "", stat: "recYds", line: "", over: "", under: "" }),
  pg: store.get("pg", "ALL"),      // prop checker game filter
  psort: store.get("psort", "chance"), // "chance" | "game"
  ppos: "ALL",
  ss: { a: "", b: "" },
};
let D, LOG, LEGS = new Map(), PLAYERS = new Map(), GAMES = new Map();

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p, d = 0) => (p == null ? "–" : (p * 100).toFixed(d) + "%");
const signed = (x, d = 1) => (x > 0 ? "+" : "") + x.toFixed(d);
const cls = (x) => (x > 0.0005 ? "pos" : x < -0.0005 ? "neg" : "");
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

function kickoff(g) {
  if (!g.date) return "TBD";
  const day = new Date(g.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (!g.time) return day;
  let [h, m] = g.time.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a"; h = h % 12 || 12;
  return `${day} · ${h}:${String(m).padStart(2, "0")}${ap} ET`;
}
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? "just now" : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago`; };

// ---------- legs ----------
function legInfo(id) {
  const base = LEGS.get(id);
  const c = S.custom[id];
  const src = base ?? (c ? { ...c, odds: null } : null);
  if (!src) return null;
  const hr = num(S.hr[id]);
  const odds = hr ?? src.odds ?? probToAmerican(src.prob);
  return { ...src, id, odds, isHr: hr != null, hasPrice: hr != null || src.odds != null, ev: ev(src.prob, odds) };
}
const evCell = (l) => `<span class="${cls(l.ev)}">${l.hasPrice ? signed(l.ev * 100, 1) + "%" : "–"}</span>`;
const oddsInput = (id) => `<input class="odds" inputmode="numeric" data-hr="${esc(id)}" placeholder="HR" value="${S.hr[id] ?? ""}" aria-label="Hard Rock odds">`;

function addSlip(id) {
  if (!S.slip.includes(id)) S.slip.push(id);
  store.set("slip", S.slip); store.set("custom", S.custom); updatePill();
}
const updatePill = () => { $("#slipCount").textContent = S.slip.length || ""; };

// ---------- views ----------
const views = {
  games() {
    if (!D.games.length) return `<div class="card">No upcoming games found. The season may be over — the site will pick up automatically when the next schedule posts.</div>`;
    const all = D.games.flatMap((g) => g.legs).filter((l) => !GAMES.get(l.gameId).final);
    const best = [...all].sort((a, b) => b.ev - a.ev).slice(0, 6);
    const likely = [...all].sort((a, b) => b.prob - a.prob).slice(0, 6);
    const mini = (arr) => `<div class="tbl"><table><tr><th>Leg</th><th>Model</th><th>Odds</th><th>EV</th><th></th></tr>${arr.map((l) => `<tr><td>${esc(l.label)}<div class="muted">${esc(GAMES.get(l.gameId).away)} @ ${esc(GAMES.get(l.gameId).home)}</div></td><td>${pct(l.prob)}</td><td>${fmtOdds(l.odds)}</td><td>${evCell(legInfo(l.id))}</td><td><button class="b" data-add="${esc(l.id)}">+ slip</button></td></tr>`).join("")}</table></div>`;
    return `${early()}
      <div class="two"><div class="card"><h3>Best value legs</h3><div class="muted">Highest model edge vs. the consensus price</div>${mini(best)}</div>
      <div class="card"><h3>Most likely legs</h3><div class="muted">Highest model hit probability</div>${mini(likely)}</div></div>
      <h2>Week ${D.targetWeek} games</h2><div class="grid">${D.games.map(gameCard).join("")}</div>`;
  },
  parlay: parlayView, fantasy: fantasyView, props: propsView, teams: teamsView, record: recordView,
  about() {
    return `<div class="card"><h2 style="margin-top:0">How it works</h2>
    <p><b>Data.</b> Everything comes from the free <a href="https://github.com/nflverse/nflverse-data" style="color:var(--blue)">nflverse</a> data feeds (schedules & consensus lines, team EPA, player stats, injury reports). A scheduled GitHub Action re-runs the pipeline every few hours; the site rebuilds itself whenever new data lands. Nothing to do by hand each week.</p>
    <p><b>Team ratings.</b> Each team gets an offense and defense rating, opponent-adjusted by iteration, from two signals averaged together: points and EPA/play (converted to points/game). Ratings are shrunk toward average for small samples.</p>
    <p><b>Game projections.</b> Rating gap + home-field (1.5) + wind adjustments give a raw margin and total. Because the betting market is very sharp, the raw number is <em>blended with the consensus line</em>. The model's weight grows from ${pct(0.08)} early in the season toward 40% as games accumulate. This keeps early-season edges honest.</p>
    <p><b>Leg probabilities.</b> Margin ~ Normal(projection, ${D.marginSd}) and total ~ Normal(projection, 13). "Edge" compares the model probability to the no-vig consensus probability. "EV" uses whatever price you enter (Hard Rock Bet's) or the consensus price.</p>
    <p><b>Parlays.</b> Combined probability multiplies leg probabilities, so it assumes the legs are independent. Keep to one leg per game; same-game legs are correlated and this math misprices them.</p>
    <p><b>Fantasy.</b> Per-player component projections (yards, catches, TDs) use recency-weighted averages regressed toward positional norms (TDs regressed hardest), then scaled by opponent fantasy-points-allowed to that position and the team's projected scoring. Injury-report status reduces the projection.</p>
    <p><b>Props and touchdown legs use real stats, not fantasy points.</b> For each defense we track what it actually allows per game to each position (passing, rushing and receiving yards, catches, touchdowns), compare it to the league average, and apply that stat-specific matchup to the player's projection. Only the Fantasy tab uses blended fantasy-point matchups.</p>
    <p><b>Hard Rock Bet.</b> No sportsbook publishes a free odds feed, so the automatic lines are the nflverse consensus. Type Hard Rock's actual price in any "HR" box and edges, EV, and parlay payout recalculate. Your entries are saved in your browser only.</p>
    <p><b>Limits.</b> No public feed gives player prop lines or full play-by-play weather/matchup detail in real time; models are simple on purpose. Treat outputs as one input, not a guarantee. Early in the season (few games) everything is noisy.</p></div>`;
  },
};

const early = () => D.gamesRated < 6 && !D.usingPriorSeason
  ? `<div class="banner">Only <b>${D.gamesRated}</b> games of ${D.season} data so far, so team ratings lean heavily on the market line and player projections are regressed to the mean. Edges will sharpen as the season goes on.</div>` : D.usingPriorSeason ? `<div class="banner">The ${D.season} season hasn't started. Ratings use ${D.statsSeason} results, regressed toward average.</div>` : "";

function gameCard(g) {
  const L = (type, side) => g.legs.find((l) => l.type === type && l.side === side);
  const row = (name, l) => {
    if (!l) return "";
    const i = legInfo(l.id);
    return `<tr><td>${esc(l.label)}</td><td>${pct(l.prob)}</td><td>${fmtOdds(l.odds)}</td><td class="${cls(l.edge)}">${l.edge == null ? "–" : signed(l.edge * 100, 1)}</td><td>${oddsInput(l.id)}</td><td>${evCell(i)}</td><td><button class="b" data-add="${esc(l.id)}" title="Add to parlay slip">+</button></td></tr>`;
  };
  const w = g.probs.homeWin;
  const chips = [g.div && "Division game", g.wind != null && g.wind >= 12 && `Wind ${g.wind} mph`, g.temp != null && g.temp <= 32 && `${g.temp}°F`, g.roof === "dome" && "Dome", ...g.factors].filter(Boolean);
  const A = D.teams.find((t) => t.team === g.away), H = D.teams.find((t) => t.team === g.home);
  return `<div class="card game"><div class="top"><span>${kickoff(g)}</span><span>${esc(g.stadium || "")}</span></div>
    <div class="matchup"><div class="tm">${g.away}<small>#${A?.rank ?? "?"} · ${esc(g.awayQb || "")}</small></div>
    <div class="score">${g.proj.awayPts.toFixed(0)} – ${g.proj.homePts.toFixed(0)}<small>model score</small></div>
    <div class="tm" style="text-align:right">${g.home}<small>#${H?.rank ?? "?"} · ${esc(g.homeQb || "")}</small></div></div>
    <div class="muted" style="display:flex;justify-content:space-between"><span>${pct(1 - w)} win</span><span>${pct(w)} win</span></div>
    <div class="bar"><i style="width:${(1 - w) * 100}%"></i></div>
    <div class="tbl"><table><tr><th>Leg</th><th>Model</th><th>Cons.</th><th>Edge</th><th>Hard Rock</th><th>EV</th><th></th></tr>
    ${row("s", L("SPREAD", "away"))}${row("s", L("SPREAD", "home"))}${row("t", L("TOTAL", "over"))}${row("t", L("TOTAL", "under"))}${row("m", L("ML", "away"))}${row("m", L("ML", "home"))}</table></div>
    <div class="muted" style="margin-top:6px">Projection ${g.home} ${g.proj.margin > 0 ? "-" : "+"}${Math.abs(g.proj.margin).toFixed(1)}, total ${g.proj.total.toFixed(1)} · model-only ${g.proj.rawMargin > 0 ? g.home + " by " : g.away + " by "}${Math.abs(g.proj.rawMargin).toFixed(1)}</div>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}</div>`;
}

// ----- parlay -----
function suggestions() {
  const pool = D.games.flatMap((g) => g.legs).filter((l) => !GAMES.get(l.gameId).final).map((l) => legInfo(l.id));
  const pickOne = (sorted, n, filter = () => true) => {
    const used = new Set(), out = [];
    for (const l of sorted) { if (used.has(l.gameId) || !filter(l)) continue; used.add(l.gameId); out.push(l); if (out.length === n) break; }
    return out;
  };
  return [
    { name: "Safest 3", note: "Highest hit chance, one leg per game", legs: pickOne([...pool].sort((a, b) => b.prob - a.prob), 3) },
    { name: "Best value 3", note: "Best model edge with ≥50% legs", legs: pickOne([...pool].sort((a, b) => b.ev - a.ev), 3, (l) => l.prob >= 0.5) },
    { name: "Balanced 4", note: "Legs 52–70%, ranked by edge", legs: pickOne([...pool].sort((a, b) => b.ev - a.ev), 4, (l) => l.prob >= 0.52 && l.prob <= 0.7) },
  ];
}
function parlayView() {
  const legs = S.slip.map(legInfo).filter(Boolean);
  const P = legs.length ? parlay(legs) : null;
  const games = legs.map((l) => l.gameId).filter(Boolean);
  const dupe = games.length !== new Set(games).size;
  const stake = num(S.stake) ?? 0;
  const slip = legs.length ? `<div class="tbl"><table><tr><th>Leg</th><th>Game</th><th>Model</th><th>Hard Rock odds</th><th>EV</th><th></th></tr>${legs.map((l) => `<tr><td>${esc(l.label)}</td><td class="muted">${esc(GAMES.get(l.gameId)?.away ?? "")} @ ${esc(GAMES.get(l.gameId)?.home ?? "")}</td><td>${pct(l.prob)}</td><td><input class="odds" inputmode="numeric" data-hr="${esc(l.id)}" value="${S.hr[l.id] ?? ""}" placeholder="${l.hasPrice ? fmtOdds(l.odds) : "enter"}"></td><td>${evCell(l)}</td><td><span class="x" data-rm="${esc(l.id)}">✕</span></td></tr>`).join("")}</table></div>` : `<p class="muted">Empty. Add legs with the “+” buttons on the Games tab, or load a suggested parlay below.</p>`;
  const sum = P ? `<div class="two" style="margin-top:12px">
    <div><div class="muted">Model hit chance</div><div class="big">${pct(P.prob, 1)}</div></div>
    <div><div class="muted">Parlay odds</div><div class="big">${fmtOdds(P.american)}</div></div>
    <div><div class="muted">Stake $<input class="odds" data-stake value="${S.stake}"> pays</div><div class="big">$${(stake * P.decimal).toFixed(2)}</div></div>
    <div><div class="muted">Expected value per $${stake || 0}</div><div class="big ${cls(P.ev)}">${signed(P.ev * stake, 2)}</div><div class="muted">Break-even chance: ${pct(1 / P.decimal, 1)}</div></div></div>
    ${dupe ? `<div class="banner" style="margin-top:10px">Two legs share a game. Those are correlated, and the math above treats them as independent, so it's unreliable.</div>` : ""}
    <div style="margin-top:8px"><button class="b" data-clear>Clear slip</button></div>` : "";
  const sg = suggestions().map((s) => { const p = s.legs.length ? parlay(s.legs) : null; return `<div class="card"><h3>${s.name}</h3><div class="muted">${s.note}</div>${p ? `<ul style="padding-left:18px;margin:8px 0">${s.legs.map((l) => `<li>${esc(l.label)} <span class="muted">(${pct(l.prob)}, ${fmtOdds(l.odds)})</span></li>`).join("")}</ul><div><b>${pct(p.prob, 1)}</b> hit · pays <b>${fmtOdds(p.american)}</b> · EV <span class="${cls(p.ev)}">${signed(p.ev * 100, 1)}%</span></div><button class="b p" style="margin-top:8px" data-load="${s.legs.map((l) => esc(l.id)).join(",")}">Load into slip</button>` : `<p class="muted">Not enough legs.</p>`}</div>`; }).join("");
  return `${early()}<div class="card"><h3>Your slip</h3><div class="muted">Prices default to the consensus line. Overwrite with what Hard Rock Bet shows to get your real EV.</div>${slip}${sum}</div>
  <h2>Suggested parlays</h2><div class="grid">${sg}</div>
  <p class="muted">Every added leg multiplies the book's margin. A “+EV” number here is the model's opinion, not a certainty.</p>`;
}

// ----- fantasy -----
const grade = (g) => `<span class="grade g${g[0]}">${g}</span>`;
const pv = (p) => (p[S.scoring] ?? p.ppr);
function filtered() {
  const q = S.q.trim().toLowerCase();
  return D.players.filter((p) => (S.pos === "ALL" || p.pos === S.pos) && (S.team === "ALL" || p.team === S.team) && (!q || p.name.toLowerCase().includes(q)) && (!S.mine || S.roster.includes(p.id))).sort((a, b) => pv(b) - pv(a));
}
function sd(p) { return 0.3 * pv(p) + 3; }
function fantasyView() {
  const rows = filtered();
  const teams = [...new Set(D.players.map((p) => p.team))].sort();
  const opts = (arr, cur) => arr.map((x) => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
  const dl = `<datalist id="pl">${D.players.map((p) => `<option value="${esc(p.name)} (${p.team})">`).join("")}</datalist>`;
  const find = (v) => D.players.find((p) => `${p.name} (${p.team})` === v);
  const A = find(S.ss.a), B = find(S.ss.b);
  let verdict = "";
  if (A && B) {
    const pa = normCdf((pv(A) - pv(B)) / Math.hypot(sd(A), sd(B)));
    const w = pa >= 0.5 ? A : B;
    verdict = `<div class="card" style="margin-top:10px"><div class="big">Start ${esc(w.name)}</div><div>${esc(A.name)} ${pv(A).toFixed(1)} vs ${esc(B.name)} ${pv(B).toFixed(1)} — <b>${pct(Math.max(pa, 1 - pa))}</b> chance the pick outscores the other.</div>
    <div class="muted">${esc(A.name)}: vs ${A.opp} ${grade(A.grade)} · team implied ${A.implied} · ${A.injury ? esc(A.injury.status) : "healthy"} &nbsp;|&nbsp; ${esc(B.name)}: vs ${B.opp} ${grade(B.grade)} · team implied ${B.implied} · ${B.injury ? esc(B.injury.status) : "healthy"}</div></div>`;
  }
  return `${early()}
  <div class="card"><h3>Start / Sit</h3><div class="controls"><input list="pl" data-ss="a" placeholder="Player A" value="${esc(S.ss.a)}"> <b>vs</b> <input list="pl" data-ss="b" placeholder="Player B" value="${esc(S.ss.b)}">${dl}</div>${verdict}</div>
  <h2>Week ${D.targetWeek} projections</h2>
  <div class="controls">
    <select data-f="scoring">${["ppr", "half", "std"].map((s) => `<option value="${s}" ${S.scoring === s ? "selected" : ""}>${{ ppr: "PPR", half: "Half PPR", std: "Standard" }[s]}</option>`).join("")}</select>
    <select data-f="pos">${opts(["ALL", "QB", "RB", "WR", "TE"], S.pos)}</select>
    <select data-f="team">${opts(["ALL", ...teams], S.team)}</select>
    <input data-f="q" placeholder="Search player" value="${esc(S.q)}">
    <label class="muted"><input type="checkbox" data-f="mine" ${S.mine ? "checked" : ""}> My roster (★)</label>
    ${D.injuryWeek ? "" : `<span class="chip w">Injury report for week ${D.targetWeek} not published yet</span>`}
  </div>
  <div class="card tbl"><table><tr><th></th><th>Player</th><th>Opp</th><th>Proj</th><th>Matchup</th><th>Team pts</th><th>Last games</th><th>Any-time TD</th><th>Status</th></tr>
  ${rows.slice(0, 150).map((p) => `<tr><td><button class="star ${S.roster.includes(p.id) ? "on" : ""}" data-star="${p.id}">★</button></td><td>${p.headshot ? `<img class="hs" loading="lazy" src="${esc(p.headshot)}" alt="">` : ""}${esc(p.name)} <span class="muted">${p.pos} ${p.team}</span></td><td>${p.home ? "vs" : "@"} ${p.opp}</td><td><b>${pv(p).toFixed(1)}</b></td><td>${grade(p.grade)} <span class="muted">×${p.matchup.toFixed(2)}</span></td><td>${p.implied}</td><td class="muted">${p.last.join(" · ")}</td><td>${pct(p.tdProb)} <span class="muted">${fmtOdds(p.fairTd)}</span></td><td>${p.injury ? `<span class="${/out|doubt/i.test(p.injury.status) ? "neg" : "warn"}">${esc(p.injury.status)}</span>` : ""}</td></tr>`).join("")}</table></div>
  ${rows.length > 150 ? `<p class="muted">Showing top 150 of ${rows.length}. Filter to narrow.</p>` : ""}
  <p class="muted">Matchup grade = how many fantasy points the opposing defense has allowed to that position (A+ = best matchup). “Any-time TD” is the model's rushing+receiving TD chance with its fair price.</p>`;
}

// ----- props -----
const STATS = {
  recYds: { label: "Receiving yards", key: "recYds", cv: 0.75 }, rushYds: { label: "Rushing yards", key: "rushYds", cv: 0.65 },
  passYds: { label: "Passing yards", key: "passYds", cv: 0.3 }, rec: { label: "Receptions", key: "rec", cv: 0.6 },
  td: { label: "Anytime TD", key: null },
};
const MU_LABEL = { passYds: "pass yds", rushYds: "rush yds", recYds: "rec yds", rec: "catches", td: "TDs" };
function propChips(p) {
  const key = { td: "td", passYds: "passYds", rushYds: "rushYds", recYds: "recYds", rec: "rec" }[S.prop.stat];
  const list = key && p.matchups[key] ? [[key, p.matchups[key]]] : Object.entries(p.matchups);
  return list.map(([k, x]) => `<span class="chip" title="Real per-game average allowed by ${p.opp} to ${p.pos}s vs. league average">${p.opp} allows ${x.allowed} ${MU_LABEL[k]}/g to ${p.pos}s (lg ${x.league}) · #${x.rank} of ${x.of}</span>`).join("");
}
function propsView() {
  if (S.pg !== "ALL" && !GAMES.has(S.pg)) S.pg = "ALL";
  const pool = D.players.filter((x) => (S.pg === "ALL" || x.gameId === S.pg) && (S.ppos === "ALL" || x.pos === S.ppos));
  const gOrder = new Map(D.games.map((g, i) => [g.id, i]));
  const gameSel = `<select data-pf="pg"><option value="ALL">All games</option>${D.games.map((g) => `<option value="${g.id}" ${S.pg === g.id ? "selected" : ""}>${g.away} @ ${g.home} · ${kickoff(g)}</option>`).join("")}</select>`;
  const posSel = `<select data-pf="ppos">${["ALL", "QB", "RB", "WR", "TE"].map((x) => `<option ${S.ppos === x ? "selected" : ""}>${x}</option>`).join("")}</select>`;
  const sortSel = `<select data-pf="psort"><option value="chance" ${S.psort === "chance" ? "selected" : ""}>Sort: highest chance</option><option value="game" ${S.psort === "game" ? "selected" : ""}>Sort: by game (kickoff order)</option></select>`;
  const p = D.players.find((x) => `${x.name} (${x.team})` === S.prop.player);
  const st = STATS[S.prop.stat];
  const inp = ((S.prop.by ??= {})[S.prop.stat] ??= { line: "", over: "", under: "" });
  const MIN = { recYds: 5, rushYds: 3, passYds: 30, rec: 0.5 };
  const half = (x) => Math.round(x - 0.5) + 0.5;
  let out = "";
  if (p) {
    if (S.prop.stat === "td") {
      const o = num(inp.over);
      out = `<div class="big">${pct(p.tdProb, 1)}</div><div>Anytime TD chance for ${esc(p.name)}. Fair price <b>${fmtOdds(p.fairTd)}</b> — take it only if Hard Rock pays better.${o != null ? ` At ${fmtOdds(o)}: EV <b class="${cls(ev(p.tdProb, o))}">${signed(ev(p.tdProb, o) * 100, 1)}%</b>` : ""}</div>`;
    } else {
      const mu = p.stats[st.key] * (p.avail || 1) || 0, line = num(inp.line);
      const s = Math.max(0.5, st.cv * mu);
      if (mu < MIN[S.prop.stat]) {
        out = `<div class="banner">${esc(p.name)} (${p.pos}) isn't projected for meaningful ${st.label.toLowerCase()} (${mu.toFixed(1)}). Pick a different stat or player.</div>`;
      } else {
        const ladder = [...new Set((S.prop.stat === "rec" ? [-2, -1, 0, 1, 2].map((d) => half(mu + d)) : [0.6, 0.8, 1, 1.2, 1.4].map((f) => half(mu * f))).filter((x) => x > 0))];
        const lad = `<div class="tbl" style="margin-top:8px"><table><tr><th>Line</th><th>Over</th><th>Under</th><th>Fair over price</th></tr>${ladder.map((L) => { const o = 1 - normCdf((L - mu) / s); return `<tr><td>${L}</td><td>${pct(o, 1)}</td><td>${pct(1 - o, 1)}</td><td>${fmtOdds(probToAmerican(o))}</td></tr>`; }).join("")}</table></div>`;
        const head = `<div class="muted">${esc(p.name)} · projected ${st.label.toLowerCase()}</div><div class="big">${mu.toFixed(1)}</div>`;
        if (line == null) out = `${head}<div class="muted">Enter Hard Rock's line above for an exact over/under chance. Model chance at typical lines:</div>${lad}`;
        else {
          const over = 1 - normCdf((line - mu) / s), oo = num(inp.over), uo = num(inp.under);
          out = `${head}<div class="two"><div><div class="muted">Over ${line}</div><div class="big">${pct(over, 1)}</div><div>fair ${fmtOdds(probToAmerican(over))}${oo != null ? ` · EV <b class="${cls(ev(over, oo))}">${signed(ev(over, oo) * 100, 1)}%</b>` : ""}</div></div>
          <div><div class="muted">Under ${line}</div><div class="big">${pct(1 - over, 1)}</div><div>fair ${fmtOdds(probToAmerican(1 - over))}${uo != null ? ` · EV <b class="${cls(ev(1 - over, uo))}">${signed(ev(1 - over, uo) * 100, 1)}%</b>` : ""}</div></div></div>
          <div class="muted">Normal distribution, sd ≈ ${(st.cv * 100).toFixed(0)}% of projection. Other lines:</div>${lad}`;
        }
      }
    }
    out += `<div class="chips"><span class="chip">${p.pos} ${p.team} ${p.home ? "vs" : "@"} ${p.opp}</span>${propChips(p)}${p.injury ? `<span class="chip w">${esc(p.injury.status)}</span>` : ""}</div>`;
  } else out = `<p class="muted">Choose a player above to see the numbers.</p>`;
  const td = [...pool].sort((a, b) => S.psort === "game" ? (gOrder.get(a.gameId) - gOrder.get(b.gameId)) || b.tdProb - a.tdProb : b.tdProb - a.tdProb).slice(0, S.pg === "ALL" && S.psort === "chance" ? 25 : 80);
  return `${early()}<div class="card"><h3>Prop checker</h3><div class="muted">Pick a game to narrow the player list, then type the line and price from Hard Rock Bet's prop menu.</div>
  <div class="controls" style="margin-top:8px">${gameSel} ${posSel}</div>
  <div class="controls" style="margin-top:8px"><input list="pl2" data-p="player" placeholder="Player" value="${esc(S.prop.player)}"><datalist id="pl2">${pool.map((x) => `<option value="${esc(x.name)} (${x.team})">`).join("")}</datalist>
  <select data-p="stat">${Object.entries(STATS).map(([k, v]) => `<option value="${k}" ${S.prop.stat === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
  ${S.prop.stat === "td" ? "" : `<input class="odds" data-p="line" placeholder="Line" value="${esc(inp.line)}">`}
  <input class="odds" data-p="over" placeholder="${S.prop.stat === "td" ? "Yes odds" : "Over odds"}" value="${esc(inp.over)}">
  ${S.prop.stat === "td" ? "" : `<input class="odds" data-p="under" placeholder="Under odds" value="${esc(inp.under)}">`}</div>${out}</div>
  <h2>Anytime TD leaders</h2><div class="controls">${sortSel}<span class="muted">${pool.length} players${S.pg !== "ALL" ? " in this game" : ""}</span></div><div class="card tbl"><table><tr><th>Player</th><th>Opp</th><th>Chance</th><th>Def. TDs allowed to pos</th><th>Fair price</th><th>Hard Rock</th><th>EV</th><th></th></tr>
  ${td.map((p) => { const id = "td|" + p.id; const hr = num(S.hr[id]); return `<tr><td>${esc(p.name)} <span class="muted">${p.pos} ${p.team}</span></td><td>${p.home ? "vs" : "@"} ${p.opp}</td><td>${pct(p.tdProb)}</td><td class="muted">${p.matchups.td ? `${p.matchups.td.allowed}/g (lg ${p.matchups.td.league}) #${p.matchups.td.rank}` : "–"}</td><td>${fmtOdds(p.fairTd)}</td><td>${oddsInput(id)}</td><td>${hr != null ? `<span class="${cls(ev(p.tdProb, hr))}">${signed(ev(p.tdProb, hr) * 100, 1)}%</span>` : "–"}</td><td><button class="b" data-addtd="${p.id}">+ slip</button></td></tr>`; }).join("")}</table></div>`;
}

// ----- teams / record -----
function teamsView() {
  return `${early()}<div class="card tbl"><table><tr><th>#</th><th>Team</th><th>Net</th><th>Off</th><th>Def</th><th>EPA/play off</th><th>EPA/play def</th><th>Pass EPA</th><th>Rush EPA</th><th>PF</th><th>PA</th></tr>
  ${D.teams.map((t) => `<tr><td>${t.rank}</td><td><b>${t.team}</b></td><td class="${cls(t.net)}">${signed(t.net)}</td><td>${signed(t.off)}</td><td>${signed(-t.def)}</td><td>${t.epaOff.toFixed(3)}</td><td>${t.epaDef.toFixed(3)}</td><td>${t.passEpa.toFixed(2)}</td><td>${t.rushEpa.toFixed(2)}</td><td>${t.ppg}</td><td>${t.papg}</td></tr>`).join("")}</table></div>
  <p class="muted">Net/Off/Def are opponent-adjusted points per game vs. an average team, shrunk for small samples (Def is shown so positive = good). EPA columns are raw per-play averages; for defense, lower is better.</p>`;
}
function recordView() {
  const R = LOG?.record, picks = LOG?.picks ?? [];
  const t = (r) => (r && r.w + r.l + r.p ? `${r.w}-${r.l}${r.p ? "-" + r.p : ""} <span class="muted">(${pct(r.w / Math.max(1, r.w + r.l))})</span>` : `<span class="muted">none graded yet</span>`);
  const tile = (n, r) => `<div class="card"><div class="muted">${n}</div><div class="big">${t(r)}</div></div>`;
  const rows = [...picks].sort((a, b) => b.week - a.week).slice(0, 40).map((p) => {
    const res = (k) => (p.result?.[k] ? `<span class="${p.result[k] === "win" ? "pos" : p.result[k] === "loss" ? "neg" : ""}">${p.result[k]}</span>` : `<span class="muted">${p.lockedAt ? "pending" : "open"}</span>`);
    const atsPick = p.ats ? (p.ats.side === "home" ? p.home : p.away) : "–", mlPick = p.ml.side === "home" ? p.home : p.away;
    return `<tr><td>Wk ${p.week}</td><td>${p.away} @ ${p.home}</td><td>${mlPick} ${res("ml")}</td><td>${atsPick} ${res("ats")}</td><td>${p.ou ? p.ou.side : "–"} ${res("ou")}</td><td>${p.result ? p.result.awayScore + "-" + p.result.homeScore : ""}</td></tr>`;
  }).join("");
  return `<div class="banner">The model logs its picks <b>before kickoff</b> and grades them after the final, so this record can't be back-filled. Logging started when this site went live; results appear as games finish.</div>
  <div class="grid">${tile("Straight-up winners", R?.ml)}${tile("Against the spread", R?.ats)}${tile("Over/Under", R?.ou)}${tile("ATS, higher-confidence (54%+)", R?.atsConf)}${tile("Winners, 65%+", R?.mlConf)}${tile("O/U, higher-confidence (54%+)", R?.ouConf)}</div>
  <h2>Logged picks</h2><div class="card tbl">${rows ? `<table><tr><th>Wk</th><th>Game</th><th>Winner</th><th>ATS</th><th>Total</th><th>Final (away-home)</th></tr>${rows}</table>` : `<p class="muted">No picks logged yet.</p>`}</div>`;
}

// ---------- render + events ----------
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const y = window.scrollY;
  $("#view").innerHTML = (views[S.tab] ?? views.games)();
  window.scrollTo(0, y);
}
function go(tab) { S.tab = tab; store.set("tab", tab); render(); }

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab],[data-add],[data-addtd],[data-rm],[data-load],[data-clear],[data-star]");
  if (!t) return;
  const d = t.dataset;
  if (d.tab) return go(d.tab);
  if (d.add) { addSlip(d.add); t.textContent = "✓"; return; }
  if (d.addtd) { const p = D.players.find((x) => x.id === d.addtd); const id = "td|" + p.id; S.custom[id] = { label: `${p.name} anytime TD`, prob: p.tdProb, gameId: p.gameId }; addSlip(id); t.textContent = "✓"; return; }
  if (d.rm) { S.slip = S.slip.filter((x) => x !== d.rm); store.set("slip", S.slip); updatePill(); return render(); }
  if (d.load) { S.slip = d.load.split(","); store.set("slip", S.slip); updatePill(); return render(); }
  if (d.clear !== undefined) { S.slip = []; store.set("slip", []); updatePill(); return render(); }
  if (d.star) { S.roster = S.roster.includes(d.star) ? S.roster.filter((x) => x !== d.star) : [...S.roster, d.star]; store.set("roster", S.roster); return render(); }
});
document.addEventListener("change", (e) => {
  const el = e.target, d = el.dataset;
  if (d.hr !== undefined) { const v = num(el.value); if (v == null || Math.abs(v) < 100) delete S.hr[d.hr]; else S.hr[d.hr] = v; store.set("hr", S.hr); return render(); }
  if (d.stake !== undefined) { S.stake = num(el.value) ?? 0; store.set("stake", S.stake); return render(); }
  if (d.f) { S[d.f] = el.type === "checkbox" ? el.checked : el.value; if (d.f === "scoring") store.set("scoring", S.scoring); return render(); }
  if (d.ss) { S.ss[d.ss] = el.value; return render(); }
  if (d.pf) { S[d.pf] = el.value; if (d.pf === "pg" || d.pf === "psort") store.set(d.pf, S[d.pf]); return render(); }
  if (d.p) { if (["line", "over", "under"].includes(d.p)) ((S.prop.by ??= {})[S.prop.stat] ??= {})[d.p] = el.value; else S.prop[d.p] = el.value; store.set("prop", S.prop); return render(); }
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.f === "q") { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('[data-f="q"]'); q?.focus(); q?.setSelectionRange(pos, pos); }
});

async function boot() {
  try {
    const [site, log] = await Promise.all([fetch("data/site.json", { cache: "no-cache" }).then((r) => r.json()), fetch("data/picks-log.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    D = site; LOG = log;
  } catch {
    $("#view").innerHTML = `<div class="card">Data hasn't been generated yet. Run <code>npm run refresh</code>, then reload.</div>`; $("#status").textContent = "No data"; return;
  }
  for (const g of D.games) { g.final = false; GAMES.set(g.id, g); for (const l of g.legs) LEGS.set(l.id, l); }
  for (const p of D.players) PLAYERS.set(p.id, p);
  // Drop slip entries whose game left this week's slate (stale after weekly rollover).
  S.slip = S.slip.filter((id) => LEGS.has(id) || S.custom[id]);
  S.custom = Object.fromEntries(Object.entries(S.custom).map(([id, c]) => { const p = PLAYERS.get(id.slice(3)); return p ? [id, { ...c, prob: p.tdProb, gameId: p.gameId }] : null; }).filter(Boolean));
  S.slip = S.slip.filter((id) => LEGS.has(id) || S.custom[id]);
  store.set("slip", S.slip);
  const wk = D.targetWeek ? `Week ${D.targetWeek}` : "Off-season";
  $("#status").textContent = `${D.season} ${wk} · data updated ${ago(D.generatedAt)} · ratings from ${D.gamesRated} game${D.gamesRated === 1 ? "" : "s"}`;
  updatePill(); render();
}
boot();

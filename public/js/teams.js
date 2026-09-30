// Team names shared by the refresh script (D/ST entries) and the browser (roster paste matching).
// Abbreviations are the ones nflverse uses (LA = Rams).
export const TEAM_FULL = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LA: "Los Angeles Rams", LAC: "Los Angeles Chargers", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};

// Other abbreviations platforms use.
export const TEAM_ALIAS = { LAR: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", LVR: "LV", SD: "LAC", STL: "LA", SFO: "SF", TAM: "TB", NWE: "NE", NOR: "NO", KAN: "KC", GNB: "GB" };

export const dstName = (team) => `${TEAM_FULL[team] ?? team} D/ST`;

import test from "node:test";
import assert from "node:assert/strict";
import { normName, parsePaste } from "../public/js/roster.js";
import { dstName } from "../public/js/teams.js";
import { expectedPaPoints, paTierPoints, kickerPoints, dstPoints } from "../lib/special.mjs";

const E = (id, name, pos, team) => ({ id, name, pos, team });
const dir = [
  E("1", "Josh Allen", "QB", "BUF"), E("2", "Jaxon Smith-Njigba", "WR", "SEA"), E("3", "Kenneth Walker III", "RB", "KC"),
  E("4", "Amon-Ra St. Brown", "WR", "DET"), E("5", "Marvin Harrison Jr.", "WR", "ARI"), E("6", "Dallas Goedert", "TE", "PHI"),
  E("7", "Ja'Marr Chase", "WR", "CIN"), E("8", "Michael Carter", "RB", "ARI"), E("9", "Michael Carter", "WR", "NYJ"),
  E("10", "Jake Elliott", "K", "PHI"), E("11", "Justin Tucker", "K", "BAL"),
  ...["SEA", "DAL", "LA", "WAS", "NYJ", "SF"].map((t) => E("DST|" + t, dstName(t), "DST", t)),
];
const ids = (r) => r.matched.map((m) => m.entry.id);

test("normName folds punctuation, accents and suffixes", () => {
  assert.equal(normName("Kenneth Walker III"), "kenneth walker");
  assert.equal(normName("Amon-Ra St. Brown"), "amon ra st brown");
  assert.equal(normName("Ja'Marr Chase"), "jamarr chase");
  assert.equal(normName("Marvin Harrison Jr."), "marvin harrison");
});

test("paste: plain names, numbering, bullets, team/pos decorations", () => {
  const r = parsePaste("1. Josh Allen\n- Jaxon Smith Njigba\nKenneth Walker - KC RB\nAmon-Ra St Brown (DET - WR)\nMarvin Harrison", dir);
  assert.deepEqual(ids(r), ["1", "2", "3", "4", "5"]);
  assert.equal(r.unmatched.length, 0);
});

test("paste: comma-separated list and 'Last, First'", () => {
  assert.deepEqual(ids(parsePaste("Josh Allen, Ja'Marr Chase, Justin Tucker", dir)), ["1", "7", "11"]);
  assert.deepEqual(ids(parsePaste("Allen, Josh", dir)), ["1"]);
});

test("paste: defenses by nickname, city, abbreviation with D/ST wording, and full name", () => {
  const r = parsePaste("Seahawks D/ST\nDallas Cowboys\nLAR DEF\nWSH D/ST\nSan Francisco 49ers Defense\nNYJ DST", dir);
  assert.deepEqual(ids(r), ["DST|SEA", "DST|DAL", "DST|LA", "DST|WAS", "DST|SF", "DST|NYJ"]);
});

test("paste: a player whose first name is a city is NOT a defense", () => {
  const r = parsePaste("Dallas Goedert\nDallas Cowboys", dir);
  assert.deepEqual(ids(r), ["6", "DST|DAL"]);
});

test("paste: duplicate names use team/position hints, otherwise flag it; unmatched lines are returned", () => {
  const hinted = parsePaste("Michael Carter NYJ", dir);
  assert.deepEqual(ids(hinted), ["9"]);
  const ambiguous = parsePaste("Michael Carter", dir);
  assert.equal(ambiguous.matched.length, 1);
  assert.ok(ambiguous.matched[0].note.includes("share this name"));
  const r = parsePaste("Josh Allen\nSome Guy Nobody Knows\nJosh Allen", dir);
  assert.deepEqual(ids(r), ["1"]); // duplicate line ignored
  assert.deepEqual(r.unmatched, ["Some Guy Nobody Knows"]);
});

test("paste: first-initial form only when unambiguous", () => {
  assert.deepEqual(ids(parsePaste("J. Elliott", dir)), ["10"]);
  assert.deepEqual(parsePaste("M. Carter", dir).matched.length, 0); // two Carters: don't guess
});

test("kicker and defense scoring", () => {
  assert.equal(kickerPoints({ fg_made_0_19: "0", fg_made_20_29: "1", fg_made_30_39: "1", fg_made_40_49: "1", fg_made_50_59: "1", fg_made_60_: "", pat_made: "3" }), 3 + 3 + 4 + 5 + 3);
  assert.deepEqual([0, 3, 6, 7, 13, 14, 20, 21, 27, 28, 34, 35, 50].map(paTierPoints), [10, 7, 7, 4, 4, 1, 1, 0, 0, -1, -1, -4, -4]);
  assert.equal(dstPoints({ sacks: 3, takeaways: 2, tds: 1, safeties: 0, pa: 17 }), 3 + 4 + 6 + 1);
});

test("expected points-allowed score falls as the opponent's expected score rises", () => {
  const v = [10, 14, 17, 20, 24, 28, 34].map((m) => expectedPaPoints(m));
  for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], `not decreasing at ${i}`);
  assert.ok(expectedPaPoints(22) > 0 && expectedPaPoints(22) < 2);
  assert.ok(expectedPaPoints(10) > 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import { exportBackup, parseBackup, sanitize, PREFIX } from "../public/js/backup.js";
import { DEFAULT_SLOTS } from "../public/js/lineup.js";

const team = { id: "t1", name: "Café League ⚡", roster: ["00-0034857", "DST|SEA", "00-0034857"], scoring: "half", slots: { ...DEFAULT_SLOTS, FLEX: 2 }, locks: { "00-0034857": "start", "not-on-roster": "bench" } };
const store = { teams: [team], teamId: "t1", hr: { "2026_04_PIT_CLE|SPREAD|away": 250 }, slip: ["2026_04_PIT_CLE|SPREAD|away", "td|abc"], custom: { "td|abc": { kind: "td", pid: "abc", label: "X anytime TD", prob: 0.5, gameId: "g" } }, stake: 25 };
const get = (k) => store[k];

test("backup round-trips, including unicode names", () => {
  const code = exportBackup(get);
  assert.ok(code.startsWith(PREFIX));
  const r = parseBackup(code);
  assert.ok(r.ok);
  assert.equal(r.data.teams[0].name, "Café League ⚡");
  assert.equal(r.data.teams[0].scoring, "half");
  assert.equal(r.data.teams[0].slots.FLEX, 2);
  assert.deepEqual(r.data.teams[0].roster, ["00-0034857", "DST|SEA"]); // duplicate dropped
  assert.deepEqual(r.data.teams[0].locks, { "00-0034857": "start" }); // lock for a player not on the roster dropped
  assert.equal(r.data.hr["2026_04_PIT_CLE|SPREAD|away"], 250);
  assert.equal(r.data.stake, 25);
  assert.equal(r.data.custom["td|abc"].kind, "td");
});

test("tolerates whitespace and line breaks from copy/paste", () => {
  const code = exportBackup(get);
  const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40, 90)}\r\n ${code.slice(90)} \n`;
  assert.ok(parseBackup(wrapped).ok);
});

test("rejects garbage, truncated codes and wrong versions", () => {
  assert.equal(parseBackup("hello").ok, false);
  assert.equal(parseBackup("").ok, false);
  assert.equal(parseBackup(null).ok, false);
  const code = exportBackup(get);
  assert.equal(parseBackup(code.slice(0, code.length - 25)).ok, false);
  assert.equal(parseBackup(PREFIX + btoa(JSON.stringify({ v: 2, data: { stake: 1 } }))).ok, false);
  assert.equal(parseBackup(PREFIX + btoa("{}")).ok, false);
});

test("sanitize clamps and drops bad values", () => {
  const s = sanitize({
    teams: [{ id: "a", name: "x".repeat(100), roster: ["ok", 5, "y".repeat(80)], scoring: "weird", slots: { QB: 99, RB: -3, WR: "x" }, locks: {} }, { id: "a", name: "dupe" }, { name: "no id" }, null],
    hr: { good: -110, tiny: 5, huge: 1e9, text: "abc" },
    slip: ["a", 3, "b"], stake: -5,
    custom: { ok: { kind: "prop", pid: "p", stat: "recYds", side: "over", line: 55.5, label: "L" }, badstat: { kind: "prop", pid: "p", stat: "evil", side: "over", line: 1 }, badkind: { kind: "x", pid: "p" } },
  });
  assert.equal(s.teams.length, 1);
  assert.equal(s.teams[0].name.length, 40);
  assert.deepEqual(s.teams[0].roster, ["ok"]);
  assert.equal(s.teams[0].scoring, "ppr");
  assert.equal(s.teams[0].slots.QB, 8);
  assert.equal(s.teams[0].slots.RB, 0);
  assert.equal(s.teams[0].slots.WR, DEFAULT_SLOTS.WR);
  assert.deepEqual(s.hr, { good: -110 });
  assert.deepEqual(s.slip, ["a", "b"]);
  assert.equal(s.stake, undefined);
  assert.deepEqual(Object.keys(s.custom), ["ok"]);
});

test("a backup with only odds (no teams) is still restorable", () => {
  const r = parseBackup(exportBackup((k) => ({ hr: { a: 120 } })[k]));
  assert.ok(r.ok);
  assert.deepEqual(r.data, { hr: { a: 120 } });
});

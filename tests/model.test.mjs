import test from "node:test";
import assert from "node:assert/strict";
import { normCdf, americanToProb, probToAmerican, noVig, parlay } from "../public/js/math.js";
import { parseCsv, adjustRatings } from "../lib/model.mjs";

test("normCdf basics", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
});

test("odds conversions round-trip", () => {
  assert.ok(Math.abs(americanToProb(-110) - 0.5238) < 1e-3);
  assert.ok(Math.abs(americanToProb(+150) - 0.4) < 1e-9);
  assert.equal(probToAmerican(0.6), -150);
  assert.equal(probToAmerican(0.4), 150);
});

test("noVig sums to 1", () => {
  const [a, b] = noVig(-110, -110);
  assert.ok(Math.abs(a - 0.5) < 1e-9 && Math.abs(a + b - 1) < 1e-9);
});

test("parlay math", () => {
  const p = parlay([{ prob: 0.5, odds: 100 }, { prob: 0.5, odds: 100 }]);
  assert.equal(p.american, 300);
  assert.ok(Math.abs(p.ev - (0.25 * 4 - 1)) < 1e-9);
});

test("csv handles quoted commas and CRLF", () => {
  const r = parseCsv('a,b,c\r\n1,"x,y",3\r\n4,"he said ""hi""",6\r\n');
  assert.deepEqual(r[0], { a: "1", b: "x,y", c: "3" });
  assert.equal(r[1].b, 'he said "hi"');
});

test("adjustRatings credits strength of schedule", () => {
  // A and B both score 30 but A did it vs. strong defense C, B vs. weak defense D.
  const obs = [
    { team: "A", opp: "C", f: 30, a: 20 }, { team: "C", opp: "A", f: 20, a: 30 },
    { team: "B", opp: "D", f: 30, a: 20 }, { team: "D", opp: "B", f: 20, a: 30 },
    { team: "C", opp: "D", f: 10, a: 10 }, { team: "D", opp: "C", f: 10, a: 10 },
  ];
  const r = adjustRatings(obs, 0);
  assert.ok(r.off.A > 0 && r.off.B > 0);
});

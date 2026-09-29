// Shared by the refresh script (Node) and the browser. Pure functions only.

export const normCdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

export const americanToDecimal = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const americanToProb = (a) => 1 / americanToDecimal(a);
export const decimalToAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const probToAmerican = (p) => {
  p = Math.min(0.995, Math.max(0.005, p));
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
};

// Remove the bookmaker's margin from a two-way market. Returns [pA, pB].
export const noVig = (oddsA, oddsB) => {
  const a = americanToProb(oddsA);
  const b = americanToProb(oddsB);
  return [a / (a + b), b / (a + b)];
};

// Expected profit per $1 staked.
export const ev = (prob, american) => prob * americanToDecimal(american) - 1;

// legs: [{prob, odds}] assumed independent (the UI warns on same-game legs).
export function parlay(legs) {
  const prob = legs.reduce((s, l) => s * l.prob, 1);
  const decimal = legs.reduce((s, l) => s * americanToDecimal(l.odds), 1);
  return { prob, decimal, american: decimalToAmerican(decimal), ev: prob * decimal - 1 };
}

export const fmtOdds = (a) => (a == null || Number.isNaN(a) ? "–" : a > 0 ? `+${a}` : `${a}`);
export const fmtLine = (n) => (n > 0 ? `+${n}` : `${n}`);

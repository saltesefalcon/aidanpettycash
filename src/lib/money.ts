// src/lib/money.ts
export const HST_RATE = 0.13;

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// If user enters a gross (tax-included) amount
export function splitGross(gross: number, rate = HST_RATE) {
  const net = round2(gross / (1 + rate));
  const hst = round2(gross - net);
  return { gross: round2(gross), net, hst };
}

// If user enters a net (pre-tax) amount
export function buildFromNet(net: number, rate = HST_RATE) {
  const hst = round2(net * rate);
  const gross = round2(net + hst);
  return { gross, net: round2(net), hst };
}

/* The generalised v2 engine must reduce EXACTLY to the verified v1 engine
   (and therefore to the Excel workbook) when every new feature is switched
   off: one person, Gompertz mortality, no tax, no housing, no fees. */

import { Household, deriveCMA, globalStockFraction } from './engine.mjs';

// --- the original US salary curve, reproduced for the reduction test -------
const SAL_SCALES = [1.0, 1.0, 0.01, 0.001, 0.0001];
const SAL_COEFS = [
  [7.27627,7.396984,8.024823,9.842184,6.719267,7.476994,6.223654,4.309414],
  [0.236958,0.258253,0.182566,0.004165,0.29959,0.253529,0.306952,0.551487],
  [-0.575408,-0.759774,-0.529951,0.062806,-0.775848,-0.746513,-0.603368,-1.722771],
  [0.065291,0.100645,0.076131,-0.015404,0.092649,0.100216,0.043638,0.242685],
  [-0.003012,-0.005097,-0.004392,0.001003,-0.004368,-0.005176,-0.000689,-0.012938],
];
const usSalaryCurve = (age, person) => {
  const col = 2 * person.educ + (person.sex - 1);
  let poly = 0;
  for (let k = 0; k <= 4; k++) poly += SAL_SCALES[k] * SAL_COEFS[k][col] * Math.pow(age, k);
  return Math.exp(poly);
};

// US Social Security, as in the workbook
const BEND_INCOME = [9912.0, 59760.0, 117000.0], BEND_PAYOUT = [0.9, 0.32, 0.15];
const SI_MULT = [[-5,0.70],[-4,0.75],[-3,0.80],[-2,0.8666666666666667],
                 [-1,0.9333333333333333],[0,1.0],[1,1.08],[2,1.16],[3,1.24]];
function usStatePension(person, hh) {
  const retAge = person.workUntilAge;
  const nYears = retAge - 18;
  if (nYears <= 0) return 0;
  const hist = [];
  for (let a = 18; a < retAge; a++) {
    hist.push(person.salary * usSalaryCurve(a, person) / usSalaryCurve(person.age, person));
  }
  hist.sort((a, b) => b - a);
  const n = Math.min(nYears, 35);
  let s = 0; for (let i = 0; i < n && i < hist.length; i++) s += hist[i];
  const avg = s / n;
  const bends = [Math.min(avg, BEND_INCOME[0]),
    Math.min(Math.max(avg-BEND_INCOME[0],0), BEND_INCOME[1]-BEND_INCOME[0]),
    Math.min(Math.max(avg-BEND_INCOME[1],0), BEND_INCOME[2]-BEND_INCOME[1])];
  const benefit = bends.reduce((acc,x,i)=>acc+x*BEND_PAYOUT[i], 0);
  const yob = 2026 - person.age;
  const fullAge = yob < 1940 ? 65 : (yob > 1956 ? 67 : 66);
  const d = retAge - fullAge;
  const mult = d <= -5 ? 0.70 : d >= 3 ? 1.24 : SI_MULT[d + 5][1];
  return benefit * mult;
}

const ctx = {
  mortalityTable: { kind: 'gompertz', M: 88.0, b: 10.6450483499578 },  // male
  salaryCurve: usSalaryCurve,
  statePension: usStatePension,
  tax: null,
};

const compatCMA = deriveCMA(0.2, 0.25, 0.15, 0, 0.025, 1e-8);

const p = {
  people: [{
    age: 27, sex: 1, healthShift: 3,          // deltaM = 3 -> modal age 91
    workUntilAge: 68, pensionAge: 68,
    salary: 60000, educ: 3,
  }],
  cbar: 18000,
  savings: { shares: 75000, bonds: 0, cash: 25000, pension: 0 },
  housing: { own: false },
  maxAge: 99, curYear: 2026,
  theta: 0.6, rho: 0.02, eta: 0.4, alpha: 1,
  beqMode: 'opt', beqFixed: 2000000, gamma: 0.25, phi: 0.05,
  eqHC: 0.2, eqLiab: 0.15, globHC: 0.25, globLiab: 0,
  rf: 0.025, fee: 0, pensionTaxHaircut: 0,
  cma: compatCMA,
};

const r = new Household(p, ctx).solve();

// Reference values from the Excel workbook / verified v1 engine.
const REF = {
  h: 0.0321132228983938,
  g: 0.0047334659652882305,
  H0: 2314142.308878334,
  L0Risky: 502133.8031778638,
  F0: 100000,
  w0SansLI: 1912008.50570047,
  D0: 29.538367167817206,
  maxBeq: 7326777.10230199,
  beqDiv: 33.7929617592293,
  beq: 1256116.45,                  // 50-digit ground truth (v1's improvement)
  equityShareUncon0: 5.876159466082521,
};

let fail = 0;
const row = (n, mine, ref, tol = 1e-9) => {
  const err = Math.abs(mine - ref) / Math.max(Math.abs(ref), 1e-12);
  const ok = err < tol; if (!ok) fail++;
  console.log(`${n.padEnd(24)} ${mine.toFixed(6).padStart(20)} ${ref.toFixed(6).padStart(20)}  ${err.toExponential(2).padStart(9)}  ${ok?'OK':'FAIL'}`);
};

console.log('v2 engine reduced to the v1 case — must match the Excel workbook\n');
console.log(`${'quantity'.padEnd(24)} ${'v2 engine'.padStart(20)} ${'excel / v1'.padStart(20)}  ${'rel.err'.padStart(9)}`);
console.log('-'.repeat(82));
row('h certainty-equiv', r.h, REF.h);
row('g growth rate', r.g, REF.g);
row('H0 human capital', r.H0, REF.H0);
row('L0 liabilities', r.L0Risky, REF.L0Risky);
row('F0 financial wealth', r.F0, REF.F0);
row('W0 sans life ins.', r.w0SansLI, REF.w0SansLI);
row('Delta0 divisor', r.D0, REF.D0);
row('max bequest', r.maxBeq, REF.maxBeq);
row('bequest divisor', r.beqDiv, REF.beqDiv);
row('optimal bequest', r.beq, REF.beq, 1e-5);

// The glide path depends on net worth, which depends on the bequest. Excel's
// reference figure was produced by its 99-point grid, so pin the bequest to
// that value to compare like with like.
const rx = new Household({ ...p, beqMode: 'fixed', beqFixed: 1099016.5653452992 }, ctx).solve();
row('W0 (bequest pinned)', rx.W0, 1625207.2298453995);
row('CD0 (bequest pinned)', rx.CD0, 55020.212207806246);
row('equity share uncon', rx.years[0].equityShareUncon, REF.equityShareUncon0, 1e-6);
row('alloc domestic y0', rx.years[0].allocUncon[0], 189297.46664644228, 1e-6);
row('alloc bonds y0', rx.years[0].allocUncon[3], -1424500.114401482, 1e-6);

console.log(fail === 0
  ? '\n*** REDUCTION EXACT — v2 reproduces the workbook ***'
  : `\n*** ${fail} MISMATCH(ES) — v2 does not reduce to v1 ***`);
process.exit(fail === 0 ? 0 : 1);

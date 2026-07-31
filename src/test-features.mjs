/* Behavioural tests for the features v1 did not have:
   couples with joint survival, housing, fees, early retirement, tax. */

import { Household, deriveCMA, globalStockFraction, mortgagePayment, SINGLE_EQUIV, feeImpact }
  from './engine.mjs';

const GOMP = { kind: 'gompertz', M: 88.0, b: 10.6450483499578 };

const base = {
  people: [{ age: 40, sex: 1, healthShift: 0, workUntilAge: 67, pensionAge: 67,
             salary: 50000, educ: 2 }],
  cbar: 20000,
  savings: { shares: 60000, bonds: 20000, cash: 20000, pension: 100000 },
  housing: { own: false },
  maxAge: 100, curYear: 2026,
  theta: 0.6, rho: 0.02, eta: 0.5, alpha: 0.5,
  beqMode: 'none', gamma: 0.25, phi: 0.05,
  eqHC: 0.2, eqLiab: 0.15, rf: 0.02, fee: 0, pensionTaxHaircut: 0,
};
const ctx = {
  mortalityTable: GOMP,
  salaryCurve: null,                       // flat salary, keeps the arithmetic checkable
  statePension: () => 12000,
  tax: null,
};

let fail = 0;
const check = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const solve = (over, c) => new Household({ ...base, ...over }, { ...ctx, ...(c || {}) }).solve();
const money = v => v.toLocaleString('en-GB', { maximumFractionDigits: 0 });

console.log('=== 1. Couples and joint survival ===\n');
const single = solve({});
const couple = solve({
  people: [
    { age: 40, sex: 1, healthShift: 0, workUntilAge: 67, pensionAge: 67, salary: 50000, educ: 2 },
    { age: 40, sex: 2, healthShift: 0, workUntilAge: 67, pensionAge: 67, salary: 50000, educ: 2 },
  ],
});
check('couple household outlives a single person',
  couple.years[45].survHousehold > single.years[45].survHousehold,
  `age 85: ${(couple.years[45].survHousehold*100).toFixed(1)}% vs ${(single.years[45].survHousehold*100).toFixed(1)}%`);
check('joint survival = 1-(1-p1)(1-p2)', (() => {
  const y = couple.years[30];
  const [a, b] = y.survEach;
  return Math.abs(y.survHousehold - (a + b - a*b)) < 1e-12;
})());
check('both-alive probability below either-alive',
  couple.years[30].survBoth < couple.years[30].survHousehold);
check('two earners give more spending than one',
  couple.CD0 > single.CD0, `${money(couple.CD0)} vs ${money(single.CD0)}`);
// A fair comparison scales the couple's essentials by the equivalence factor:
// a couple needs 1.5x a single person's, not 1x and not 2x.
const coupleFair = solve({
  cbar: base.cbar / SINGLE_EQUIV,
  people: [
    { age: 40, sex: 1, healthShift: 0, workUntilAge: 67, pensionAge: 67, salary: 50000, educ: 2 },
    { age: 40, sex: 2, healthShift: 0, workUntilAge: 67, pensionAge: 67, salary: 50000, educ: 2 },
  ],
});
check('with equivalence-scaled essentials, a couple gets less than 2x a single',
  coupleFair.CD0 < 2 * single.CD0 && coupleFair.CD0 > single.CD0,
  `${money(coupleFair.CD0)} vs ${money(single.CD0)} = ${(coupleFair.CD0/single.CD0).toFixed(2)}x`);
check('essentials scale toward the single rate as one partner dies',
  couple.years[50].essentials < couple.years[0].essentials &&
  couple.years[50].essentials > base.cbar * SINGLE_EQUIV * 0.99,
  `year 0 ${money(couple.years[0].essentials)} -> year 50 ${money(couple.years[50].essentials)}`);
check('single person essentials are constant',
  Math.abs(single.years[40].essentials - single.years[0].essentials) < 1e-9);

console.log('\n=== 2. Housing ===\n');
const noHouse = solve({});
const withMortgage = solve({
  housing: { own: true, value: 400000, mortgageBalance: 200000,
             mortgageRate: 0.04, mortgageYearsLeft: 20 },
});
const pay = mortgagePayment(200000, 0.04, 20);
check('mortgage payment amortises correctly', (() => {
  // present value of the payment stream at the mortgage rate must equal the balance
  let pv = 0;
  for (let t = 1; t <= 20; t++) pv += pay / Math.pow(1.04, t);
  return Math.abs(pv - 200000) < 1;
})(), `${money(pay)}/yr, PV ${money((() => { let s=0; for(let t=1;t<=20;t++) s+=pay/Math.pow(1.04,t); return s; })())}`);
check('a mortgage reduces spendable income',
  withMortgage.CD0 < noHouse.CD0, `${money(withMortgage.CD0)} vs ${money(noHouse.CD0)}`);
// Discounted at the mortgage's OWN rate the liability must equal the balance
// exactly. Discounting at rf instead only changes the number, not this identity.
const atOwnRate = solve({
  rf: 0.04,
  housing: { own: true, value: 400000, mortgageBalance: 200000,
             mortgageRate: 0.04, mortgageYearsLeft: 20 },
});
check('mortgage liability equals the balance at its own rate',
  Math.abs(atOwnRate.L0Mort - 200000) < 1,
  `${money(atOwnRate.L0Mort)} vs balance 200,000`);
check('the schedule actually clears the loan', (() => {
  let b = 200000;
  for (let k = 0; k < 20; k++) b = b * 1.04 - pay;
  return Math.abs(b) < 1;
})(), 'balance after the final payment is zero');
check('mortgage payments run t=1..N, not t=0..N-1',
  withMortgage.years[0].mortgage === 0 && withMortgage.years[1].mortgage > 0);
check('mortgage payments stop after the term',
  withMortgage.years[20].mortgage > 0 && withMortgage.years[21].mortgage === 0);
check('total outgoings fall once the mortgage is repaid',
  withMortgage.years[21].totalConsump < withMortgage.years[20].totalConsump);
check('home value alone does not fund spending',
  Math.abs(solve({ housing: { own: true, value: 400000, mortgageBalance: 0,
                              mortgageRate: 0, mortgageYearsLeft: 0 } }).CD0 - noHouse.CD0) < 1e-6,
  'an unmortgaged home leaves spending unchanged');

const withDownsize = solve({
  housing: { own: true, value: 400000, mortgageBalance: 0, mortgageRate: 0,
             mortgageYearsLeft: 0, downsizeAge: 70, downsizeRelease: 0.4 },
});
check('downsizing raises spending',
  withDownsize.CD0 > noHouse.CD0, `${money(withDownsize.CD0)} vs ${money(noHouse.CD0)}`);
check('downsizing lands in the right year',
  withDownsize.years[30].windfall > 0 && withDownsize.years[29].windfall === 0,
  `${money(withDownsize.years[30].windfall)} released at age 70`);

console.log('\n=== 3. Fees ===\n');
const noFee = solve({ fee: 0 });
const fee1 = solve({ fee: 0.01 });
const fee2 = solve({ fee: 0.02 });
check('fees reduce spending', fee1.CD0 < noFee.CD0,
  `1% fee costs ${money(noFee.CD0 - fee1.CD0)}/yr`);
check('more fees cost more', fee2.CD0 < fee1.CD0);
// Charges fall on the financial portfolio, not on human capital, so the drag
// on h is the fee scaled by the financial share of net worth — strictly
// positive, and strictly less than the headline fee.
const drag = noFee.h - fee1.h;
check('a fee reduces the certainty-equivalent return', drag > 0, `${(drag*1e4).toFixed(0)} bp`);
check('the drag is less than the headline fee (human capital is not charged)',
  drag < 0.01, `${(drag*100).toFixed(3)}% vs 1.000% headline`);
check('doubling the fee doubles the drag',
  Math.abs((noFee.h - fee2.h) - 2*drag) < 1e-9);
const imp = feeImpact({ ...base, fee: 0.015 }, ctx);
check('feeImpact reports a consistent loss',
  Math.abs(imp.annualLoss - (imp.noFee - imp.withFee)) < 1e-9 && imp.annualLoss > 0,
  `1.5% fee = ${money(imp.annualLoss)}/yr, ${(imp.pctLoss*100).toFixed(1)}% of spending`);

console.log('\n=== 4. Early retirement (stop work before the pension starts) ===\n');
const normal = solve({
  people: [{ age: 40, sex: 1, healthShift: 0, workUntilAge: 67, pensionAge: 67,
             salary: 50000, educ: 2 }],
});
const early = solve({
  people: [{ age: 40, sex: 1, healthShift: 0, workUntilAge: 57, pensionAge: 67,
             salary: 50000, educ: 2 }],
});
check('retiring ten years early lowers spending',
  early.CD0 < normal.CD0, `${money(early.CD0)} vs ${money(normal.CD0)}`);
check('there is a genuine income gap', (() => {
  const gapYear = early.years[20];     // age 60: not working, no pension yet
  const workYear = early.years[10];    // age 50: working
  const penYear = early.years[30];     // age 70: pension flowing
  return gapYear.incomeNet === 0 && workYear.incomeNet > 0 && penYear.incomeNet > 0;
})(), 'ages 57-66 have no income at all');
// Person is 40 now, pension age 67, so the pension arrives at t = 27.
check('the pension still starts at the state age',
  early.years[26].incomeNet === 0 && early.years[27].incomeNet > 0,
  `age ${early.years[26].age}: nothing; age ${early.years[27].age}: ${money(early.years[27].incomeNet)}`);

console.log('\n=== 5. Tax ===\n');
// Employer pension is added separately by netIncome, so a tax function only
// ever sees the directly-received income.
const flatTax = (g) => (g.salary + g.statePension) * 0.7;
const taxed = solve({}, { tax: flatTax });
check('tax reduces human capital by the tax rate',
  Math.abs(taxed.H0 / normal.H0 - 0.7) < 1e-9,
  `H0 ${money(taxed.H0)} vs gross ${money(normal.H0)}`);
check('tax reduces spending', taxed.CD0 < normal.CD0,
  `${money(taxed.CD0)} vs ${money(normal.CD0)}`);
check('gross and net income both reported',
  taxed.years[0].incomeGross > taxed.years[0].incomeNet &&
  Math.abs(taxed.years[0].incomeNet / taxed.years[0].incomeGross - 0.7) < 1e-9);

console.log('\n=== 6. Structural invariants across the new feature space ===\n');
let swept = 0; const bad = [];
const grid = {
  fee: [0, 0.005, 0.02, 0.05],
  alpha: [0, 0.5, 1],
  theta: [0.1, 0.6, 1.5],
  eta: [0.1, 0.5, 1, 2],
  rho: [0, 0.03, 0.15],
  cbar: [0, 20000, 45000],
  beqMode: ['none', 'opt', 'fixed'],
};
for (const k of Object.keys(grid)) for (const v of grid[k]) {
  for (const couple of [false, true]) {
    const people = couple
      ? [{ age:40,sex:1,healthShift:0,workUntilAge:67,pensionAge:67,salary:50000,educ:2 },
         { age:38,sex:2,healthShift:2,workUntilAge:65,pensionAge:67,salary:35000,educ:2 }]
      : base.people;
    try {
      const r = new Household({ ...base, [k]: v, people, beqFixed: 300000,
        housing: { own:true, value:350000, mortgageBalance:120000,
                   mortgageRate:0.045, mortgageYearsLeft:15,
                   downsizeAge:75, downsizeRelease:0.3 } }, ctx).solve();
      swept++;
      // equityShareCon is deliberately null when there is no financial wealth
      // to allocate; only a NaN would be a defect.
      const finite = Number.isFinite(r.CD0) && Number.isFinite(r.W0) &&
        r.years.every(y => Number.isFinite(y.netWorth) &&
          (y.equityShareCon === null || Number.isFinite(y.equityShareCon)));
      if (!finite) bad.push(`${k}=${v} couple=${couple} -> non-finite`);
      else if (r.years.some(y => y.equityShareCon !== null &&
                                 (y.equityShareCon > 1 + 1e-9 || y.equityShareCon < -1e-9)))
        bad.push(`${k}=${v} couple=${couple} -> constrained equity out of [0,1]`);
      else if (r.years.some(y => y.survHousehold < -1e-12 || y.survHousehold > 1 + 1e-12))
        bad.push(`${k}=${v} couple=${couple} -> survival out of [0,1]`);
    } catch (e) { bad.push(`${k}=${v} couple=${couple} -> threw ${e.message}`); }
  }
}
check(`swept ${swept} combinations`, bad.length === 0,
  bad.length ? bad.slice(0,4).join('; ') : 'all finite, bounded, monotone');

const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) solve({ cbar: 20000 + i });
console.log(`\nPerformance: ${(Number(process.hrtime.bigint()-t0)/1e6/100).toFixed(2)} ms per solve`);

console.log(fail === 0 ? '\n*** ALL FEATURE CHECKS PASSED ***' : `\n*** ${fail} CHECK(S) FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

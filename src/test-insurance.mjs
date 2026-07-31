/* Income protection: pricing, sizing, and the risk-aversion question. */
import { insuranceAnalysis, Household } from './engine.mjs';
import { UK, CZ } from './countries.mjs';
import { disabilityRate, abilityToWork, probDisabledBefore } from './disability.mjs';

const ctxFor = (C) => ({
  mortalityTable: C.lifeTable, salaryCurve: C.salaryCurve,
  statePension: (p, h) => C.statePension(p, h), tax: C.tax.bind(C),
  hazard: (person, age) => disabilityRate(C.code, age, person.sex, person.occClass ?? 1),
  ability: (person, age) => abilityToWork(C.code, person.age, age, person.sex, person.occClass ?? 1),
});
const paramsFor = (C, o = {}) => {
  const st = Math.round(C.pensionAgeFor(1991));
  return {
    people: [{ age: 35, sex: 1, healthShift: 0, trajectory: 1, salary: C.defaults.salary,
               workUntilAge: st, pensionAge: st, statutoryPensionAge: st,
               employerPensionRate: 0.03, birthYear: 1991, occClass: 1, ...(o.person || {}) }],
    cbar: C.defaults.cbar, savings: { ...C.defaults.savings }, housing: { own: false },
    maxAge: 105, curYear: 2026, theta: 0.396, eta: 0.5, rho: 0.02, alpha: 0.4,
    beqMode: 'none', gamma: 0.25, phi: 0.08, eqHC: 0.15, eqLiab: 0.15,
    rf: C.rf, fee: C.defaultFee, pensionTaxHaircut: C.pensionTaxHaircut, ...o,
  };
};

let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

for (const C of [UK, CZ]) {
  const ctx = ctxFor(C), p = paramsFor(C);
  const f = v => Math.round(v).toLocaleString(C.locale);
  console.log(`\n================ ${C.code} ================\n`);

  // --- human capital must fall once earnings can stop --------------------
  const withRisk = new Household(p, ctx).solve();
  const noRisk = new Household({ ...p, ignoreDisability: true }, ctx).solve();
  ok('disability risk lowers human capital', withRisk.H0 < noRisk.H0,
     `${f(withRisk.H0)} vs ${f(noRisk.H0)} (−${((1 - withRisk.H0 / noRisk.H0) * 100).toFixed(1)}%)`);
  ok('and therefore lowers sustainable spending', withRisk.CD0 < noRisk.CD0,
     `${f(withRisk.CD0)} vs ${f(noRisk.CD0)}`);
  const eqRisk = withRisk.years[0].equityShareCon, eqNo = noRisk.years[0].equityShareCon;
  ok('and lowers the recommended equity share',
     eqRisk == null || eqNo == null || eqRisk <= eqNo + 1e-9,
     `${eqRisk == null ? 'n/a' : (eqRisk * 100).toFixed(0) + '%'} vs ${eqNo == null ? 'n/a' : (eqNo * 100).toFixed(0) + '%'}`);

  // --- the analysis -------------------------------------------------------
  const t0 = Date.now();
  const r = insuranceAnalysis(p, ctx, { loading: 0.5 });
  const ms = Date.now() - t0;
  console.log(`\n  chance of long-term incapacity before ${p.people[0].pensionAge}: ${(r.probability * 100).toFixed(1)}%`);
  console.log(`  representative age it happens : ${r.meanAge.toFixed(0)}`);
  console.log(`  net earnings it would replace : ${f(r.netAtFailure)}`);
  console.log(`  fair cost per 1 of cover      : ${r.fairRate.toFixed(4)}`);
  console.log(`  uninsured, spending falls by  : ${f(r.uninsuredLoss)}/yr`);
  console.log(`  cover that makes you whole    : ${f(r.needCover)}/yr, premium ${f(r.needPremium)}/yr`);
  console.log(`  worth buying at 50% loading   : ${f(r.bestCover)}/yr, premium ${f(r.bestPremium)}/yr`);
  console.log(`  computed in ${ms} ms\n`);

  ok('probability is in a plausible range', r.probability > 0.03 && r.probability < 0.5,
     `${(r.probability * 100).toFixed(1)}%`);
  ok('fair price is positive and sane', r.fairRate > 0 && r.fairRate < 1, r.fairRate.toFixed(4));
  ok('cover makes the two states equal',
     Math.abs(r.need.hurt.CD0 - r.need.able.CD0) / Math.max(1, r.need.able.CD0) < 0.02,
     `${f(r.need.hurt.CD0)} vs ${f(r.need.able.CD0)}`);
  ok('being uninsured costs real spending', r.uninsuredLoss > 0, `${f(r.uninsuredLoss)}/yr`);
  // Runs debounced on demand, not on every keystroke, so ~1s is fine.
  ok('runs fast enough to compute on demand', ms < 1500, `${ms} ms`);

  // --- Mossin: fair pricing implies (near) full cover ---------------------
  const fairOnly = insuranceAnalysis(p, ctx, { loading: 0 });
  const loaded = insuranceAnalysis(p, ctx, { loading: 1.0 });
  console.log('');
  ok('at a fair price you insure essentially fully',
     fairOnly.bestCover >= fairOnly.needCover * 0.9,
     `${(100 * fairOnly.bestCover / fairOnly.needCover).toFixed(0)}% of full cover`);
  ok('loading is what makes you buy less',
     loaded.bestCover < fairOnly.bestCover,
     `${(100 * loaded.bestCover / loaded.needCover).toFixed(0)}% at 100% loading vs ` +
     `${(100 * fairOnly.bestCover / fairOnly.needCover).toFixed(0)}% at fair`);

  console.log('\n  how the optimum moves with price:');
  for (const L of [0, 0.25, 0.5, 1.0, 2.0]) {
    const x = insuranceAnalysis(p, ctx, { loading: L });
    console.log(`    loading ${String(Math.round(L * 100)).padStart(3)}%  buy ${f(x.bestCover).padStart(9)}/yr` +
                `  = ${(100 * x.bestCover / x.needCover).toFixed(0).padStart(3)}% of full`);
  }

  /* Risk aversion over CONSUMPTION is governed by eta, the elasticity of
     intertemporal substitution; theta is portfolio risk tolerance and does not
     enter the insurance decision at all. Varying eta is the right test. */
  console.log('\n  how the optimum moves with risk aversion over consumption (50% loading):');
  const line = [];
  let prev = null, monotone = true;
  for (const eta of [1.0, 0.5, 0.25]) {
    const x = insuranceAnalysis(paramsFor(C, { eta }), ctx, { loading: 0.5 });
    const share = 100 * x.bestCover / x.needCover;
    if (prev !== null && share < prev - 2) monotone = false;
    prev = share;
    line.push(`RRA ${(1 / eta).toFixed(0)}: ${share.toFixed(0)}%`);
  }
  console.log('    ' + line.join('   '));
  ok('a more risk-averse person buys at least as much cover', monotone,
     'real, but second-order next to the price');

  // --- occupation and sex move the price the way the data says ------------
  const manual = insuranceAnalysis(paramsFor(C, { person: { occClass: 3 } }), ctx, { loading: 0.5 });
  ok('manual work costs more to insure', manual.fairRate > r.fairRate,
     `${manual.fairRate.toFixed(4)} vs ${r.fairRate.toFixed(4)}`);
  if (C.code === 'UK') {
    const female = insuranceAnalysis(paramsFor(C, { person: { sex: 2 } }), ctx, { loading: 0.5 });
    ok('UK female incidence is higher, per CMI', female.probability > r.probability,
       `${(female.probability * 100).toFixed(1)}% vs ${(r.probability * 100).toFixed(1)}%`);
  }
}

console.log(fail === 0 ? '\n*** ALL INSURANCE CHECKS PASSED ***' : `\n*** ${fail} CHECK(S) FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

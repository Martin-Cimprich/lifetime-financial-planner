/* Economic sanity across realistic households in both countries.
   These are the checks a user would notice if they were wrong. */
import { Household } from './engine.mjs';
import { UK, CZ, riskAversionFromGamble, thetaFromRiskAversion } from './countries.mjs';

const CY = 2026;
const ctxFor = C => ({
  mortalityTable: C.lifeTable, salaryCurve: C.salaryCurve,
  statePension: (p, h) => C.statePension(p, h), tax: C.tax.bind(C),
});
const person = (C, o = {}) => ({
  age: 35, sex: 1, healthShift: 0, trajectory: 1,
  salary: C.defaults.salary, workUntilAge: Math.round(C.pensionAgeFor(CY - 35)),
  pensionAge: Math.round(C.pensionAgeFor(CY - 35)),
  employerPensionRate: C.defaults.employerPensionRate, birthYear: CY - 35, ...o,
});
const params = (C, o = {}) => ({
  people: [person(C)], cbar: C.defaults.cbar, savings: { ...C.defaults.savings },
  housing: { own: true, value: C.defaults.homeValue, mortgageBalance: C.defaults.mortgageBalance,
             mortgageRate: C.defaults.mortgageRate, mortgageYearsLeft: C.defaults.mortgageYears },
  maxAge: 105, curYear: CY, theta: 0.396, eta: 0.5, rho: 0.02, alpha: 0.4,
  beqMode: 'none', beqFixed: 0, gamma: 0.25, phi: 0.05,
  eqHC: 0.2, eqLiab: 0.15, rf: C.rf, fee: C.defaultFee,
  pensionTaxHaircut: C.pensionTaxHaircut, ...o,
});
const run = (C, o) => new Household(params(C, o), ctxFor(C)).solve();

let fail = 0;
const ok = (name, cond, detail) => {
  if (!cond) fail++;
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

for (const C of [UK, CZ]) {
  const f = v => Math.round(v).toLocaleString(C.locale);
  console.log(`\n================= ${C.code} =================\n`);
  const base = run(C);
  console.log(`  baseline: spend ${f(base.CD0)}/yr, net worth ${f(base.W0)}, ` +
              `equity ${(base.years[0].equityShareCon*100).toFixed(0)}%\n`);

  // --- direction of effect -------------------------------------------------
  ok('more savings raises spending',
     run(C, { savings: { ...C.defaults.savings, cash: C.defaults.savings.cash + C.defaults.salary } }).CD0 > base.CD0);
  ok('higher essentials lowers discretionary',
     run(C, { cbar: C.defaults.cbar * 1.5 }).CD0 < base.CD0);
  ok('working longer raises spending',
     run(C, { people: [person(C, { workUntilAge: 70, pensionAge: 70 })] }).CD0 > base.CD0);
  ok('retiring early lowers spending',
     run(C, { people: [person(C, { workUntilAge: 57 })] }).CD0 < base.CD0);
  ok('a bigger mortgage lowers spending',
     run(C, { housing: { own:true, value:C.defaults.homeValue, mortgageBalance:C.defaults.mortgageBalance*2,
                         mortgageRate:C.defaults.mortgageRate, mortgageYearsLeft:C.defaults.mortgageYears } }).CD0 < base.CD0);
  ok('paying off the mortgage raises spending',
     run(C, { housing: { own:true, value:C.defaults.homeValue, mortgageBalance:0,
                         mortgageRate:0, mortgageYearsLeft:0 } }).CD0 > base.CD0);
  ok('higher fees lower spending',
     run(C, { fee: C.defaultFee + 0.01 }).CD0 < base.CD0);
  ok('leaving an inheritance lowers spending',
     run(C, { beqMode: 'fixed', beqFixed: C.defaults.salary * 5 }).CD0 < base.CD0);
  ok('annuitising raises spending',
     run(C, { alpha: 1 }).CD0 > run(C, { alpha: 0 }).CD0);
  ok('better health lowers annual spending (money spread further)',
     run(C, { people: [person(C, { healthShift: 7 })] }).CD0 < base.CD0);
  ok('women get slightly less per year (longer life)',
     run(C, { people: [person(C, { sex: 2 })] }).CD0 < base.CD0);
  ok('downsizing raises spending',
     run(C, { housing: { own:true, value:C.defaults.homeValue, mortgageBalance:C.defaults.mortgageBalance,
                         mortgageRate:C.defaults.mortgageRate, mortgageYearsLeft:C.defaults.mortgageYears,
                         downsizeAge:72, downsizeRelease:0.4 } }).CD0 > base.CD0);

  // --- risk appetite drives the allocation monotonically -------------------
  const eq = pi => {
    const th = Math.max(0.03, Math.min(3, thetaFromRiskAversion(riskAversionFromGamble(pi))));
    return run(C, { theta: th }).years[0].equityShareCon;
  };
  const shares = [0.02, 0.05, 0.10, 0.15].map(eq);
  ok('more risk-averse answer => less equity',
     shares.every((v, i) => i === 0 || v <= shares[i-1] + 1e-9),
     shares.map(v => (v*100).toFixed(0) + '%').join(' → '));

  // --- the state pension behaves as the country's law says -----------------
  if (C.code === 'UK') {
    const lo = C.statePension(person(C, { salary: 20000 }));
    const hi = C.statePension(person(C, { salary: 200000 }));
    ok('UK pension is flat-rate: earnings do not change it',
       Math.abs(lo - hi) < 1, `${f(lo)} vs ${f(hi)}`);
  } else {
    const lo = C.statePension(person(C, { salary: 300000 }));
    const hi = C.statePension(person(C, { salary: 3000000 }));
    ok('CZ pension is earnings-related but capped',
       hi > lo && hi < lo * 3, `${f(lo)} vs ${f(hi)} (ratio ${(hi/lo).toFixed(2)})`);
    const veryHi = C.statePension(person(C, { salary: 10000000 }));
    ok('CZ pension stops growing above 4x average wage',
       Math.abs(veryHi - hi) / hi < 0.05, `${f(hi)} vs ${f(veryHi)}`);
  }

  // --- couples -------------------------------------------------------------
  const couple = run(C, {
    cbar: Math.round(C.defaults.cbar * 1.5),
    people: [person(C), person(C, { sex: 2, salary: Math.round(C.defaults.salary * 0.85) })],
  });
  ok('a couple spends more than a single person', couple.CD0 > base.CD0,
     `${f(couple.CD0)} vs ${f(base.CD0)}`);
  ok('couple household outlives an individual',
     couple.years[40].survHousehold > base.years[40].survHousehold,
     `${(couple.years[40].survHousehold*100).toFixed(0)}% vs ${(base.years[40].survHousehold*100).toFixed(0)}% at age 75`);

  // --- structural ----------------------------------------------------------
  ok('spending is positive throughout', base.years.every(y => y.discConsump > 0));
  ok('net worth never negative on the baseline', base.years.every(y => y.netWorth > 0));
  ok('equity share within [0,1] wherever it is defined',
     base.years.every(y => y.equityShareCon === null ||
       (y.equityShareCon >= -1e-9 && y.equityShareCon <= 1 + 1e-9)));
  ok('mortgage runs t=1..N then stops',
     base.years[0].mortgage === 0 &&
     base.years[C.defaults.mortgageYears].mortgage > 0 &&
     base.years[C.defaults.mortgageYears + 1].mortgage === 0);
  ok('every projected value is finite',
     base.years.every(y => [y.netWorth,y.finWealth,y.humanCapital,y.liabilities,
                            y.discConsump,y.totalConsump,y.survHousehold].every(Number.isFinite)));
}

console.log(fail === 0 ? '\n*** ALL PERSONA CHECKS PASSED ***' : `\n*** ${fail} CHECK(S) FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

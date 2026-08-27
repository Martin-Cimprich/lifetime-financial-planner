/* Long-term care: the calibration, the incremental charge, and the home. */
import { Household, Mortality } from './engine.mjs';
import { UK, CZ } from './countries.mjs';
import { careRate, calibrateCare, careFit, careNetAnnual,
         CARE_ANCHORS, CARE_COST, CARE_DISPLACES } from './care.mjs';

let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const survFor = (C) => (age) => {
  let s = 0;
  for (const sex of [1, 2]) s += new Mortality(C.lifeTable, sex, 0).survive(65, Math.max(0, age - 65));
  return s / 2;
};

const ctxFor = (C) => ({
  mortalityTable: C.lifeTable, salaryCurve: C.salaryCurve,
  statePension: (p, h) => C.statePension(p, h), tax: C.tax.bind(C),
  careRate: (age) => careRate(C.code, age),
  careNetAnnual: (essPer) => careNetAnnual(C.code, essPer),
});

const paramsFor = (C, o = {}) => {
  const st = Math.round(C.pensionAgeFor(1991));
  const D = C.defaults;
  return {
    people: [{ age: 35, sex: 1, healthShift: 0, trajectory: 1, salary: D.salary,
               workUntilAge: st, pensionAge: st, statutoryPensionAge: st,
               employerPensionRate: D.employerPensionRate, birthYear: 1991,
               occClass: 0, existingCover: 0, ...(o.person || {}) }],
    cbar: D.cbar, savings: { ...D.savings },
    housing: { own: true, value: D.homeValue, mortgageBalance: D.mortgageBalance,
               mortgageRate: D.mortgageRate, mortgageYearsLeft: D.mortgageYears,
               downsizeAge: 0, downsizeRelease: 0 },
    maxAge: 105, curYear: 2026, theta: 0.396, eta: 0.5, rho: 0.02, alpha: 0.4,
    beqMode: 'none', gamma: 0.25, phi: 0.08, eqHC: 0.15, eqLiab: 0.15,
    rf: C.rf, fee: C.defaultFee, pensionTaxHaircut: C.pensionTaxHaircut, ...o,
  };
};

for (const C of [UK, CZ]) {
  const ctx = ctxFor(C);
  const f = (v) => Math.round(v).toLocaleString(C.locale);
  console.log(`\n================ ${C.code} ================\n`);

  /* --- the calibration reproduces what it was fitted to ------------------
     Only two figures are published, so the curve is fitted rather than
     transcribed. That makes reproducing both of them the whole validation. */
  const fit = calibrateCare(C.code, survFor(C));
  const surv = survFor(C);
  const ages = []; for (let a = 65; a <= 105; a++) ages.push(a);
  const w = ages.map(surv);
  const mean = (from) => {
    let n = 0, d = 0;
    ages.forEach((a, i) => { if (a < from) return; n += w[i] * careRate(C.code, a); d += w[i]; });
    return d > 0 ? n / d : 0;
  };
  const A = CARE_ANCHORS[C.code];
  console.log(`  fitted: doubling every ${(Math.log(2) / fit.k).toFixed(1)} years of age`);
  console.log(`  rate at 70/75/80/85/90/95: ` +
    [70, 75, 80, 85, 90, 95].map(a => (careRate(C.code, a) * 100).toFixed(1) + '%').join('  '));
  ok('reproduces the published rate for the over-65s',
     Math.abs(mean(65) - A.all65) < 0.0006,
     `${(mean(65) * 100).toFixed(2)}% vs published ${(A.all65 * 100).toFixed(1)}%`);
  ok('reproduces the published rate for the over-85s',
     Math.abs(mean(85) - A.over85) < 0.002,
     `${(mean(85) * 100).toFixed(2)}% vs published ${(A.over85 * 100).toFixed(1)}%`);
  ok('nothing before 65 — working-age incapacity is the other panel',
     careRate(C.code, 64) === 0 && careRate(C.code, 40) === 0);
  {
    let mono = true;
    for (let a = 65; a < 105; a++) if (careRate(C.code, a + 1) < careRate(C.code, a)) mono = false;
    ok('prevalence rises with age throughout', mono);
  }
  ok('and never exceeds certainty', careRate(C.code, 105) <= 1);

  /* --- the charge is incremental, not the whole fee ---------------------- */
  const gross = CARE_COST[C.code].grossAnnual;
  const net = careNetAnnual(C.code, C.defaults.cbar);
  console.log(`\n  a year in care: gross ${f(gross)}, net of displaced essentials ${f(net)}`);
  ok('a care home replaces spending as well as adding it', net < gross,
     `${f(net)} < ${f(gross)}, displacing ${(CARE_DISPLACES * 100).toFixed(0)}% of essentials`);
  ok('and the incremental cost is still substantial', net > gross * 0.2, f(net));
  ok('a bigger essential budget displaces more',
     careNetAnnual(C.code, C.defaults.cbar * 2) < net);

  /* --- the home pays for it, but only where the home is free ------------- */
  const owner = new Household(paramsFor(C), ctx).solve();
  const renter = new Household(paramsFor(C, { housing: { own: false } }), ctx).solve();
  console.log(`\n  expected care cost ${f(owner.L0CareGross)}; ` +
    `owner: ${f(owner.careFromHome)} from the house, ${f(owner.L0Care)} left; ` +
    `renter: ${f(renter.L0Care)} left`);
  ok('the same risk costs the same before the house is counted',
     Math.abs(owner.L0CareGross - renter.L0CareGross) < 1, f(owner.L0CareGross));
  ok('a renter carries the whole liability',
     Math.abs(renter.L0Care - renter.L0CareGross) < 1 && renter.careFromHome === 0);
  ok('an owner with enough equity carries none of it',
     owner.L0Care === 0 && owner.careFromHome > 0,
     `${f(owner.careEquity)} of equity against ${f(owner.L0CareGross)} of expected cost`);
  ok('the house is never credited with more than it is worth',
     owner.careFromHome <= owner.careEquity + 1);
  /* Equity already earmarked for downsizing is a windfall on the asset side and
     cannot also pay for care. */
  const down = new Household(paramsFor(C, {
    housing: { own: true, value: C.defaults.homeValue, mortgageBalance: C.defaults.mortgageBalance,
               mortgageRate: C.defaults.mortgageRate, mortgageYearsLeft: C.defaults.mortgageYears,
               downsizeAge: 72, downsizeRelease: 1 } }), ctx).solve();
  ok('equity released by downsizing cannot pay for care as well',
     down.careEquity === 0 && down.L0Care > 0,
     `all equity released, so ${f(down.L0Care)} stays on the balance sheet`);

  /* --- what it does to the answer ---------------------------------------- */
  const renterOff = new Household(paramsFor(C, { housing: { own: false }, ignoreCare: true }), ctx).solve();
  ok('allowing for care lowers what a renter can spend',
     renter.CD0 < renterOff.CD0,
     `${f(renter.CD0)} vs ${f(renterOff.CD0)} (${((renter.CD0 / renterOff.CD0 - 1) * 100).toFixed(1)}%)`);
  const ownerOff = new Household(paramsFor(C, { ignoreCare: true }), ctx).solve();
  ok('and leaves an owner where they were, because the house pays',
     Math.abs(owner.CD0 - ownerOff.CD0) < 1,
     `${f(owner.CD0)} either way`);
  ok('turning it off is exactly the no-care answer',
     Math.abs(renterOff.CD0 - new Household(paramsFor(C, { housing: { own: false } }),
       { ...ctx, careRate: undefined }).solve().CD0) < 1e-6);

  /* --- older households are more exposed, which is the whole point ------- */
  const older = new Household(paramsFor(C, { housing: { own: false },
    person: { age: 60, workUntilAge: Math.round(C.pensionAgeFor(1966)) } }), ctx).solve();
  ok('a nearer household faces a larger expected cost',
     older.L0CareGross > renter.L0CareGross,
     `${f(older.L0CareGross)} at 60 vs ${f(renter.L0CareGross)} at 35`);

  /* --- couples: the house is not free while a partner is living in it ---- */
  const st = Math.round(C.pensionAgeFor(1991));
  const mk = (age) => ({ age, sex: 1, healthShift: 0, trajectory: 1, salary: C.defaults.salary,
    workUntilAge: st, pensionAge: st, statutoryPensionAge: st,
    employerPensionRate: C.defaults.employerPensionRate, birthYear: 2026 - age,
    occClass: 0, existingCover: 0 });
  const couple = new Household(paramsFor(C, { people: [mk(35), mk(35)] }), ctx).solve();
  ok('a couple faces more care cost than one person',
     couple.L0CareGross > owner.L0CareGross,
     `${f(couple.L0CareGross)} vs ${f(owner.L0CareGross)}`);
  ok('but the house cannot pay for all of it — someone still lives there',
     couple.careFromHome < couple.L0CareGross,
     `${f(couple.careFromHome)} of ${f(couple.L0CareGross)}`);
}

/* The two countries are structurally opposite, and the model should show it:
   Czech care is capped by regulation and the care itself is met by prispevek na
   peci, so the exposure relative to essential spending is far smaller than the
   uncapped English one. */
{
  const share = (C) => careNetAnnual(C.code, C.defaults.cbar) / C.defaults.cbar;
  console.log(`\n  a year in care, as a multiple of a year's essential spending:`);
  console.log(`    UK ${share(UK).toFixed(2)}x    CZ ${share(CZ).toFixed(2)}x`);
  ok('the uncapped English exposure is far larger than the regulated Czech one',
     share(UK) > share(CZ) * 2,
     `${share(UK).toFixed(2)}x vs ${share(CZ).toFixed(2)}x of essential spending`);
}

console.log(fail === 0 ? '\n*** ALL CARE CHECKS PASSED ***' : `\n*** ${fail} CHECK(S) FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

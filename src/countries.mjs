/* ===========================================================================
   Country modules: mortality, earnings curves, tax, state pension.

   Every figure carries its source and the year it applies to. Where a rule is
   simplified for a planning model rather than a tax return, the simplification
   is stated in a comment.
   =========================================================================== */

import { UK_LIFE_TABLE, CZ_LIFE_TABLE } from './lifetables.mjs';

/* --------------------------------------------------------------- earnings */
/* Cubic fits in log-earnings to published median earnings by age band.
   UK: ONS ASHE 2025, full-time median gross annual pay, Table 6.7a.
   CZ: ISPV 2025 mzdová sféra, median gross monthly, by věková kategorie.
   Fit error is within +/-1.5% across ages 22-60; the fitted peak reproduces
   the published peak band (UK 40-49, CZ 30-39). */
const SALARY_FIT = {
  UK: {
    male:   [7.7219e-6, -0.0017056089, 0.1074803031, 8.644344551],
    female: [1.05454e-5, -0.0020429234, 0.1184344259, 8.5115511536],
  },
  CZ: {
    male:   [2.04079e-5, -0.0030720662, 0.1460352896, 8.6021359557],
    female: [1.71643e-5, -0.0024625362, 0.1104143801, 9.0459045667],
  },
};

/** Career trajectory tilt: how steeply pay rises relative to the population. */
export const TRAJECTORY = { flat: 0, typical: 1, steep: 1.6 };

function makeSalaryCurve(cc) {
  return (age, person) => {
    const c = SALARY_FIT[cc][person.sex === 2 ? 'female' : 'male'];
    const a = Math.max(18, Math.min(75, age));
    const base = c[0]*a*a*a + c[1]*a*a + c[2]*a + c[3];
    // A trajectory multiplier stretches or flattens the profile around age 40
    // without changing its level at the person's current age (the engine
    // normalises by the curve's value at that age anyway).
    const tilt = person.trajectory == null ? 1 : person.trajectory;
    const c0 = SALARY_FIT[cc][person.sex === 2 ? 'female' : 'male'];
    const at40 = c0[0]*64000 + c0[1]*1600 + c0[2]*40 + c0[3];
    return Math.exp(at40 + (base - at40) * tilt);
  };
}

/* ============================== UNITED KINGDOM ============================ */
/* Tax year 2025/26 (England, Wales & Northern Ireland). Scotland sets its own
   income tax bands; a Scottish user should treat the tax figures as indicative.
   Sources: gov.uk income tax rates, National Insurance rates, new State Pension. */

const UK_PA = 12570;              // personal allowance
const UK_PA_TAPER_START = 100000; // PA reduced by 1 for every 2 above this
const UK_BASIC_LIMIT = 37700;     // taxable income taxed at 20%
const UK_ADDL_THRESHOLD = 125140;
const UK_NI_PT = 12570, UK_NI_UEL = 50270;
const UK_STATE_PENSION_FULL = 11973;   // 2025/26, GBP/yr, 35 qualifying years
const UK_AE_LOWER = 6240, UK_AE_UPPER = 50270;  // auto-enrolment band

/** UK income tax on non-savings income. */
export function ukIncomeTax(gross) {
  const pa = Math.max(0, UK_PA - Math.max(0, gross - UK_PA_TAPER_START) / 2);
  const taxable = Math.max(0, gross - pa);
  let tax = 0;
  tax += Math.min(taxable, UK_BASIC_LIMIT) * 0.20;
  if (taxable > UK_BASIC_LIMIT) {
    const higher = Math.min(taxable, UK_ADDL_THRESHOLD - pa) - UK_BASIC_LIMIT;
    if (higher > 0) tax += higher * 0.40;
  }
  const addl = taxable - (UK_ADDL_THRESHOLD - pa);
  if (addl > 0) tax += addl * 0.45;
  return tax;
}

/** Employee Class 1 National Insurance. Not charged on pension income, and
    not charged at all once the employee is over State Pension age. */
export function ukNI(salary, overSPA) {
  if (overSPA || salary <= UK_NI_PT) return 0;
  const main = Math.min(salary, UK_NI_UEL) - UK_NI_PT;
  const upper = Math.max(0, salary - UK_NI_UEL);
  return main * 0.08 + upper * 0.02;
}

/** State Pension age by birth year, per the legislated timetable. */
export function ukStatePensionAge(birthYear) {
  if (birthYear < 1961) return 66;
  if (birthYear < 1978) return 67;
  return 68;
}

/**
 * The new State Pension is FLAT-RATE — it does not depend on earnings at all.
 * 35 qualifying years gives the full amount, 10 is the cliff below which
 * nothing is paid, and in between it is strictly pro rata.
 */
export function ukStatePension(person) {
  const years = person.niYears != null
    ? person.niYears
    : Math.max(0, Math.min(35, person.workUntilAge - 21));
  if (years < 10) return 0;
  return UK_STATE_PENSION_FULL * Math.min(1, years / 35);
}

/** Statutory auto-enrolment employer contribution, on the qualifying band. */
export function ukEmployerPension(salary, rate) {
  const band = Math.max(0, Math.min(salary, UK_AE_UPPER) - UK_AE_LOWER);
  return band * (rate != null ? rate : 0.03);
}

export const UK = {
  code: 'UK', lang: 'en', currency: 'GBP', locale: 'en-GB',
  taxYear: '2025/26',
  lifeTable: UK_LIFE_TABLE,
  salaryCurve: makeSalaryCurve('UK'),
  medianSalary: 39039,
  avgWage: 39039,
  rf: 0.015,                 // real risk-free rate, index-linked gilts ~1.5%
  defaultFee: 0.005,         // workplace default fund; DIY passive is nearer 0.30%
  pensionAgeFor: ukStatePensionAge,
  minPrivatePensionAge: 57,  // rises from 55 to 57 in April 2028
  statePensionCanBeTakenEarly: false,
  /* Drawing a pension pot: 25% is tax-free and the rest is taxed as income.
     A retiree whose other income keeps them in the basic-rate band therefore
     loses about 0.75 x 20% = 15% of the pot to tax. */
  pensionTaxHaircut: 0.15,
  statePension: (person) => ukStatePension(person),
  employerPension: ukEmployerPension,
  /** Tax on directly-received income for one person in one year. */
  tax(g, person, t, hh) {
    const age = person.age + t;
    const overSPA = age >= person.pensionAge;
    // The State Pension is taxable, but bears no National Insurance.
    const taxable = g.salary + g.statePension;
    const tax = ukIncomeTax(taxable);
    const ni = ukNI(g.salary, overSPA);
    return taxable - tax - ni;
  },
  /* Defaults describe a plausible median UK household: ASHE median full-time
     pay, essentials at roughly half of net pay, and a mortgage costing about a
     fifth of it. Rates are REAL, so 1.5% is a ~4.5% nominal mortgage. */
  defaults: {
    salary: 39000, cbar: 16000,
    savings: { shares: 12000, bonds: 0, cash: 6000, pension: 25000 },
    homeValue: 290000, mortgageBalance: 120000, mortgageRate: 0.015, mortgageYears: 22,
    employerPensionRate: 0.03,
  },
};

/* ================================= CZECHIA ================================ */
/* 2026 parameters. Sources: zákon o daních z příjmů, ČSSZ, MPSV.
   průměrná mzda 2026 = 48,967 CZK/month. */

const CZ_AVG_WAGE_M = 48967;
const CZ_TAX_23_THRESHOLD = 36 * CZ_AVG_WAGE_M;      // 1,762,812 CZK/yr
const CZ_CREDIT = 30840;                              // sleva na poplatníka
const CZ_SOCIAL_CAP = 48 * CZ_AVG_WAGE_M;            // 2,350,416 CZK/yr
const CZ_RED1 = Math.ceil(0.44 * CZ_AVG_WAGE_M);      // 21,546 CZK/month (published)
const CZ_RED2 = Math.ceil(4.00 * CZ_AVG_WAGE_M);      // 195,868 CZK/month (published)
const CZ_BASE_PENSION_M = 4900;                      // základní výměra, CZK/month
const CZ_PENSION_TAX_EXEMPT = 806400;                // 36x minimum wage, CZK/yr

/** Czech income tax: 15% then 23%, less the basic taxpayer credit. */
export function czIncomeTax(gross) {
  const lower = Math.min(gross, CZ_TAX_23_THRESHOLD);
  const upper = Math.max(0, gross - CZ_TAX_23_THRESHOLD);
  return Math.max(0, lower * 0.15 + upper * 0.23 - CZ_CREDIT);
}

/** Employee social (7.1%, capped) and health (4.5%, uncapped) insurance. */
export function czSocialHealth(salary) {
  const social = Math.min(salary, CZ_SOCIAL_CAP) * 0.071;
  const health = salary * 0.045;
  return social + health;
}

/** Retirement age: 65 up to the 1965 cohort, +1 month per year, capped at 67. */
export function czRetirementAge(birthYear) {
  if (birthYear <= 1965) return 65;
  if (birthYear >= 1989) return 67;
  return 65 + (birthYear - 1965) / 12;
}

/* Zákon č. 286/2024 Sb. puts both the accrual rate and the zápočet below the
   first redukční hranice on a ten-year glide path, keyed to the year the
   pension is AWARDED, not the current year:
     accrual  1.500% -> 1.450% by 2035, falling 0.005 pp per award year
     zápočet    100% ->    90% by 2035, falling 1 pp per award year
   A life-cycle model projects people retiring in the 2040s and 2050s, so using
   the 2026 values for everyone overstates the state pension by ~7.6%.
   Source: ČSSZ, "Přehled nejdůležitějších údajů pro sociální zabezpečení
   v roce 2026" (10 Dec 2025). */
const czGlideStep = (awardYear) => Math.max(0, Math.min(10, (awardYear || 2026) - 2025));
export const czAccrualRate = (awardYear) => 0.015 - 0.00005 * czGlideStep(awardYear);
export const czZapocet = (awardYear) => 1.00 - 0.01 * czGlideStep(awardYear);

/**
 * Starobní důchod = základní výměra + procentní výměra.
 *
 * The percentage component is the accrual rate per insured year applied to the
 * výpočtový základ — the personal assessment base after the redukční hranice.
 * Those thresholds are what make the Czech system strongly redistributive:
 * earnings above 4x the average wage add nothing at all.
 *
 * Early claiming reduces the RATE by 1.5 percentage points of the výpočtový
 * základ per commenced 90-day block (0.75 pp from 2026 for 45+ years of
 * qualifying service). It does NOT scale the whole pension, and it never
 * touches the základní výměra.
 *
 * Statutory rounding: the výpočtový základ and the procentní výměra are each
 * rounded up to whole crowns. With those in place this reproduces ČSSZ's
 * published 2026 table exactly.
 */
export function czStatePension(person, avgMonthlyEarnings, opts = {}) {
  const awardYear = opts.awardYear || 2026;
  const ovz = avgMonthlyEarnings;
  const vz = Math.ceil(
    czZapocet(awardYear) * Math.min(ovz, CZ_RED1)
    + 0.26 * Math.max(0, Math.min(ovz, CZ_RED2) - CZ_RED1));
  const years = person.insuredYears != null
    ? person.insuredYears
    : Math.max(0, Math.min(50, person.workUntilAge - 20));

  let rate = czAccrualRate(awardYear) * years;

  // Early claiming: a permanent cut to the rate, in points of the VZ.
  const blocks = opts.earlyBlocks || 0;
  if (blocks > 0) {
    // From 1.1.2026 the cut halves for 45+ years of "hard" service. Study and
    // unemployment do not count toward that test, so it is passed in
    // explicitly rather than inferred from the general insured-years figure.
    const perBlock = (opts.longServiceYears || 0) >= 45 ? 0.0075 : 0.015;
    rate -= blocks * perBlock;
  }
  rate = Math.max(0, rate);

  const procentni = Math.ceil(rate * vz);
  return (CZ_BASE_PENSION_M + procentni) * 12;
}

export const CZ = {
  code: 'CZ', lang: 'cs', currency: 'CZK', locale: 'cs-CZ',
  taxYear: '2026',
  lifeTable: CZ_LIFE_TABLE,
  salaryCurve: makeSalaryCurve('CZ'),
  medianSalary: 43241 * 12,
  avgWage: CZ_AVG_WAGE_M * 12,
  rf: 0.015,
  defaultFee: 0.015,          // bank-distributed podílové fondy run ~2% TER; ETFs far less
  pensionAgeFor: czRetirementAge,
  minPrivatePensionAge: 60,   // DPS payout normally from 60
  statePensionCanBeTakenEarly: true,
  earlyRetirementMaxYears: 3,
  earlyRetirementPenaltyPer90Days: 0.015,
  /* DPS: a lump sum is taxed on the gains only, an annuity is exempt. The
     effective drag on the pot is small compared with the UK. */
  pensionTaxHaircut: 0.05,
  statePension(person, hh) {
    // Personal assessment base = average indexed monthly earnings over the
    // working life, which in a real-terms model is the average of the salary
    // curve across the working years.
    const curve = this.salaryCurve;
    const startAge = 22, endAge = person.workUntilAge;
    if (endAge <= startAge) return CZ_BASE_PENSION_M * 12;
    let sum = 0, n = 0;
    for (let a = startAge; a < endAge; a++) {
      sum += person.salary * curve(a, person) / curve(person.age, person);
      n++;
    }
    const avgMonthly = (sum / n) / 12;

    /* Compare the claim age with the statutory age on the SAME basis. The
       interface shows whole years, so the statutory age is rounded the same
       way; comparing a rounded claim age against a fractional statutory age
       would hand a spurious early-retirement cut to every cohort whose
       statutory age happens to round down. */
    const statutory = person.statutoryPensionAge != null
      ? person.statutoryPensionAge
      : Math.round(this.pensionAgeFor(person.birthYear || 1990));
    const yearsEarly = statutory - person.pensionAge;

    // Předčasný důchod is payable at most 3 years early. Earlier than that,
    // there is no entitlement at all — not a reduced one.
    if (yearsEarly > this.earlyRetirementMaxYears + 1e-9) return 0;

    const blocks = yearsEarly > 0 ? Math.ceil(yearsEarly * 365 / 90) : 0;
    const longService = person.longServiceYears != null
      ? person.longServiceYears
      : Math.max(0, Math.min(50, person.workUntilAge - 22));   // excludes study

    return czStatePension(person, avgMonthly, {
      awardYear: (person.birthYear || 1990) + person.pensionAge,
      earlyBlocks: blocks,
      longServiceYears: longService,
    });
  },
  employerPension: (salary, rate) => salary * (rate != null ? rate : 0.03),
  tax(g, person, t, hh) {
    const salary = g.salary;
    const pension = g.statePension;
    const salaryTax = czIncomeTax(salary) + czSocialHealth(salary);
    // The state pension is exempt below 36x the minimum wage; almost nobody
    // exceeds that, but the rule is applied rather than assumed away.
    const pensionTax = pension > CZ_PENSION_TAX_EXEMPT
      ? czIncomeTax(pension - CZ_PENSION_TAX_EXEMPT) : 0;
    return salary - salaryTax + pension - pensionTax;
  },
  /* Median Czech household: ISPV median pay, essentials ~20k CZK/month, and a
     hypotéka of 2m CZK. Rates are REAL, so 2% is a ~5% nominal mortgage. */
  defaults: {
    salary: 43241 * 12, cbar: 240000,
    savings: { shares: 150000, bonds: 0, cash: 120000, pension: 120000 },
    homeValue: 5500000, mortgageBalance: 2000000, mortgageRate: 0.02, mortgageYears: 22,
    employerPensionRate: 0.03,
  },
};

export const COUNTRIES = { UK, CZ };

/* ------------------------------------------------------- risk elicitation */
/**
 * Convert a stated willingness to pay to avoid a 50/50 gamble into a CRRA
 * coefficient of relative risk aversion.
 *
 * For a gamble that multiplies wealth by (1+up) or (1-down) with equal
 * probability, and a certainty equivalent of (1-pi) times wealth:
 *     0.5[(1+up)^(1-g) + (1-down)^(1-g)] = (1-pi)^(1-g)
 * Solved for g by bisection. This is the Barsky-Juster-Kimball-Shapiro
 * income-gamble question in its willingness-to-pay form.
 */
export function riskAversionFromGamble(pi, up = 0.20, down = 0.20) {
  /* Campbell's "demon gamble": a symmetric 50/50 coin toss on LIFETIME wealth.
     Symmetry makes the Arrow-Pratt approximation gamma ~= 2*pi/x^2 exact to
     first order, and staking lifetime wealth rather than pocket money is what
     defuses the Rabin critique. We solve the exact CRRA equation rather than
     the approximation, which understates gamma badly above pi ~ 5%.
     Validated against Kimball-Sahm-Shapiro (2008) Table 1. */
  const certEquiv = (gm) => {
    if (Math.abs(gm - 1) < 1e-9) {
      return Math.exp(0.5 * (Math.log(1 + up) + Math.log(1 - down)));
    }
    const e = 1 - gm;
    return Math.pow(0.5 * (Math.pow(1 + up, e) + Math.pow(1 - down, e)), 1 / e);
  };
  // f is decreasing in gamma over the economically meaningful range, but the
  // raw expected-utility equation has a second, spurious root at very high
  // gamma. Scan upward and bisect on the FIRST sign change.
  const f = (gm) => certEquiv(gm) - (1 - pi);
  let lo = 0.05, flo = f(lo);
  if (flo <= 0) return lo;
  let hi = null;
  for (let g = 0.1; g <= 30; g += 0.1) {
    if (f(g) <= 0) { hi = g; break; }
  }
  if (hi === null) return 30;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Willingness to pay implied by a given risk aversion — the inverse mapping. */
export function gambleFromRiskAversion(gamma, up = 0.20, down = 0.20) {
  const e = 1 - gamma;
  const ce = Math.abs(gamma - 1) < 1e-9
    ? Math.exp(0.5 * (Math.log(1 + up) + Math.log(1 - down)))
    : Math.pow(0.5 * (Math.pow(1 + up, e) + Math.pow(1 - down, e)), 1 / e);
  return 1 - ce;
}

/** The model's risk tolerance theta is the reciprocal of relative risk aversion. */
export const thetaFromRiskAversion = (gamma) => 1 / gamma;
export const riskAversionFromTheta = (theta) => 1 / theta;

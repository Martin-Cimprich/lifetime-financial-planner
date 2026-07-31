/* ===========================================================================
   Disability incidence — the probability that a working person permanently
   loses the ability to earn.

   UK: CMI Working Paper 48, Income Protection Model IPM 1991-98, claim
   inception intensities per 1,000 healthy lives, deferred period 52 weeks,
   males occupation class 1. The 52-week column is used deliberately: shorter
   deferred periods count people who later recover, and this model treats the
   loss as permanent. A claim that survives a full year off work is much closer
   to permanent incapacity, and it is the column that lines up with the Czech
   invalidity data — at age 40 the two agree to three decimal places, from
   completely independent sources thirty years apart. WP48 is the most recent FULLY PUBLIC CMI table;
   IP06 and IP11 are subscriber-only. Values below are quoted from Appendix A.4
   at five-year ages and interpolated log-linearly in between.
   https://www.actuaries.org.uk/system/files/documents/pdf/cmiwp48_0.pdf

   The 1991-98 experience is materially heavier than modern business. WP48's own
   actual-vs-expected table implies a DP26 ratio of about 0.70 for 2003-06, so
   the UK level is scaled by 0.65 to bring it to current experience.

   CZ: derived from CSSZ open data — newly awarded third-degree invalidity
   pensions (working capacity reduced by 70% or more) by five-year age band,
   divided by the Eurostat resident population less those already receiving an
   invalidity pension. Third degree is the closest Czech analogue to "unable to
   work". These are POPULATION rates, so they are an upper bound for a medically
   underwritten life.
   https://data.cssz.cz/dump/invalidita.csv

   Both sources independently imply incidence roughly DOUBLING EVERY 8-9 YEARS
   of age. That is the assumption actually doing the work here; the levels are
   less certain than the shape.

   CAVEAT worth stating plainly: even a 52-week claim is not always permanent,
   so treating every incidence as a permanent loss overstates the damage
   somewhat. The bias is conservative — it makes the case for insurance look
   stronger than it is, not weaker.
   =========================================================================== */

/** CMI IPM 1991-98, DP52, male OC1, per 1,000 healthy lives per year. */
export const UK_DP52_PER_1000 = {
  25: 0.67, 30: 0.61, 35: 0.75, 40: 1.15, 45: 1.98,
  50: 3.50, 55: 5.92, 60: 9.26, 65: 13.29,
};

/** CSSZ 2024, third-degree invalidity, per 1,000 at risk, both sexes. */
export const CZ_3RD_PER_1000 = {
  22: 0.396, 27: 0.305, 32: 0.407, 37: 0.582, 42: 0.751,
  47: 1.241, 52: 1.826, 57: 2.938,
  // The 60-64 band turns down because people reach state pension age, not
  // because morbidity falls. Excluded deliberately.
};

/** Modern-experience scaling for the 1991-98 UK table (WP48 A/E, DP52 = 0.63). */
export const UK_CURRENCY_SCALE = 0.65;

/* Females show materially higher inception. WP48 section 9 gives ~190% at DP13
   and says longer deferred periods are "perhaps a little higher". */
export const FEMALE_FACTOR = 1.9;

/* CMI occupation classes, inception actual-vs-expected relative to class 1.
   1 professional/clerical ... 4 heavy manual. */
export const OCCUPATION_FACTOR = [1.0, 1.2, 1.6, 2.5];

const interp = (table, age) => {
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const lo = ages[0], hi = ages[ages.length - 1];
  if (age <= lo) return table[lo];
  if (age >= hi) {
    // Extrapolate on the observed doubling, rather than flat-lining.
    const last = table[hi], prev = table[ages[ages.length - 2]];
    const perYear = Math.pow(last / prev, 1 / (hi - ages[ages.length - 2]));
    return last * Math.pow(perYear, age - hi);
  }
  let i = 0; while (ages[i + 1] < age) i++;
  const a0 = ages[i], a1 = ages[i + 1];
  const f = (age - a0) / (a1 - a0);
  return Math.exp(Math.log(table[a0]) * (1 - f) + Math.log(table[a1]) * f);
};

/**
 * Annual probability of permanently losing the ability to earn.
 * @param country 'UK' | 'CZ'
 * @param age
 * @param sex 1 male, 2 female
 * @param occClass 0-3, CMI classes 1-4
 */
export function disabilityRate(country, age, sex, occClass = 1) {
  const base = country === 'CZ'
    ? interp(CZ_3RD_PER_1000, age) / 1000
    : interp(UK_DP52_PER_1000, age) / 1000 * UK_CURRENCY_SCALE;
  // The Czech figure is already both-sexes, so only the UK table is sexed.
  const sexF = (country === 'CZ') ? 1 : (sex === 2 ? FEMALE_FACTOR : 1);
  return base * sexF * (OCCUPATION_FACTOR[occClass] ?? 1);
}

/** Probability of still being able to earn at `age`, starting able at `from`. */
export function abilityToWork(country, from, age, sex, occClass = 1) {
  let p = 1;
  for (let a = Math.floor(from); a < Math.floor(age); a++) {
    p *= (1 - disabilityRate(country, a, sex, occClass));
    if (p <= 0) return 0;
  }
  return p;
}

/** Cumulative probability of becoming unable to earn between two ages. */
export const probDisabledBefore = (country, from, to, sex, occClass = 1) =>
  1 - abilityToWork(country, from, to, sex, occClass);

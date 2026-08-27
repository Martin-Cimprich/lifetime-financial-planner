/* ===========================================================================
   Long-term care — the late-life liability the plan otherwise ignores.

   This is the one uninsured catastrophe left in the model: low probability,
   very large, and arriving at the age when there is no earning capacity left to
   absorb it. It is charged as an expected cost on the liability side, the way
   disability risk is charged against human capital, rather than shown as a
   scenario — because a plan that ignores it is overstating what can be spent.

   THE TWO COUNTRIES ARE STRUCTURALLY OPPOSITE, and that is the finding worth
   having. England has no cap at all: the Dilnot cap of GBP 86,000 was legislated
   for October 2025 and then scrapped on 29 July 2024, so a self-funder pays the
   full fee until capital falls to the means-test limit, and the exposure runs to
   the whole estate. Czechia caps the charge by regulation and covers the care
   itself through prispevek na peci, so the household's exposure is a fraction of
   the same risk. A shared model would hide the most important difference between
   them.

   ---------------------------------------------------------------- prevalence

   What is needed is the probability of being IN residential care at a given age,
   conditional on being alive — a prevalence, not a lifetime incidence — because
   that is what multiplies an annual cost to give an expected annual cost.

   UK: ONS, Census 2021, "Older people living in care homes in 2021 and changes
   since 2011". 278,946 usual residents aged 65+ were living in care homes in
   England and Wales; 2.5% of the 65+ population, and 10.8% of the 85+
   population (down from 13.7% in 2011).
   https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/ageing/articles/olderpeoplelivingincarehomesin2021andchangessince2011/2023-10-09

   CZ: MPSV, Statisticka rocenka z oblasti prace a socialnich veci 2024. At the
   end of 2024 there were roughly 34,000 users of domovy pro seniory and 25,500
   of domovy se zvlastnim rezimem. Against a 65+ population near 2.24 million,
   and allowing for the minority of residents under 65, that is about 2.4% of the
   65+ population.
   https://mpsv.gov.cz/statisticka-rocenka-z-oblasti-prace-a-socialnich-veci-2024

   THE TWO LEVELS AGREE — 2.5% and 2.4%, from two completely different care
   systems and two independent statistical offices. That agreement is the reason
   the age SHAPE, which only the UK publishes, is used for both. The shape is the
   assumption actually doing the work here, exactly as with disability incidence,
   and it is weaker evidence than the levels.

   Only two published points constrain the UK shape, so it is not transcribed but
   CALIBRATED: an exponential in age, with its two parameters solved so that the
   curve reproduces both published figures under the country's own life table as
   the age weighting. Using the life table rather than today's population is
   deliberate — the curve is applied to the model's own projected survival path,
   so consistency with that path matters more than consistency with the current
   age structure. Both reproductions are asserted in test-care.mjs.

   ---------------------------------------------------------------------- cost

   UK: carehome.co.uk's 2026 survey puts the UK average at GBP 1,298 a week for
   residential care and GBP 1,535 for nursing care. Residential is used, as the
   larger of the two populations. In England capital above GBP 23,250 means
   self-funding in full, and self-funder rates run materially above the rates
   councils pay, so the published average is if anything an understatement of
   what a self-funder faces. There is no lifetime cap.

   CZ: capped by regulation. From 1 January 2026 the maximum uhrada is 290 CZK a
   day for full board and 335 CZK a day for accommodation (380 for a single
   room), and at least 15% of the resident's income must be left to them. The
   care itself is met by prispevek na peci, which for adults in 2026 is 1,300 /
   5,400 / 14,800 / 23,000 CZK a month across the four degrees of dependence;
   third degree is used, as the level that corresponds to needing residential
   care.
   =========================================================================== */

/** Published prevalence anchors: share of the age group living in care. */
export const CARE_ANCHORS = {
  UK: { all65: 0.025, over85: 0.108 },   // ONS Census 2021, England and Wales
  CZ: { all65: 0.024, over85: 0.108 },   // MPSV 2024 level, UK shape
};

/** Gross cost, and what the state carries, in each country's own currency. */
export const CARE_COST = {
  UK: {
    grossAnnual: 1298 * 52,        // residential, carehome.co.uk 2026 survey
    stateAnnual: 0,                // means-tested to nothing above the capital limit
    capitalLimit: 23250,           // England, upper limit: above it you self-fund
    lifetimeCap: null,             // the Dilnot cap was scrapped on 29 July 2024
  },
  CZ: {
    /* Board and accommodation only. The care component is charged separately and
       is met by prispevek na peci — 14,800 CZK a month at third degree in 2026,
       paid to the facility — so it is excluded from the gross figure rather than
       netted off it. Deducting it from the board charge as well would credit the
       household twice for the same transfer, which is what a first pass did. */
    grossAnnual: (290 + 335) * 365,   // maximum uhrada, board and accommodation
    stateAnnual: 0,
    capitalLimit: null,               // not capital-tested
    lifetimeCap: null,
  },
};

/* What a care home replaces rather than adds. A resident stops paying for their
   own housing, heating, food and most of what "essential spending" covers, so
   charging the whole fee on top of unchanged essentials would count the same
   pound twice. Two thirds is a judgement, stated here rather than buried: it is
   the share of a single person's essential budget that board and lodging
   displaces. It is the least evidenced number in this file. */
export const CARE_DISPLACES = 0.65;

/* An exponential in age fitted to the two published anchors. Held as a constant
   per country rather than solved on every call: the solve needs a life table,
   which lives in the country module, so calibrateCare() below does it once. */
const fitted = {};

/**
 * Prevalence of residential care at `age`, conditional on being alive.
 * Zero below 65 — the model is not trying to describe care for working-age
 * disability, which the income-protection panel handles instead.
 */
export function careRate(country, age) {
  const f = fitted[country];
  if (!f || age < 65) return 0;
  return Math.min(0.95, f.p0 * Math.exp(f.k * (age - 65)));
}

/**
 * Solve p0 and k so the curve reproduces both published figures, weighting each
 * age by the probability of being alive at it. Called once per country at
 * startup with that country's own life table.
 *
 * @param survive (age) => probability of being alive at that age, from 65
 */
export function calibrateCare(country, survive) {
  const A = CARE_ANCHORS[country];
  if (!A) return null;
  const ages = [];
  for (let a = 65; a <= 105; a++) ages.push(a);
  const w = ages.map(survive);

  // Weighted mean of exp(k(a-65)) over a set of ages: the shape, before scaling.
  const shape = (k, from) => {
    let num = 0, den = 0;
    ages.forEach((a, i) => {
      if (a < from) return;
      num += w[i] * Math.exp(k * (a - 65));
      den += w[i];
    });
    return den > 0 ? num / den : 0;
  };
  /* The ratio of the two anchors pins k on its own: scaling cancels. Bisect on
     it, because the ratio rises monotonically with k. */
  const want = A.over85 / A.all65;
  let lo = 0.001, hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const r = shape(mid, 85) / Math.max(shape(mid, 65), 1e-15);
    if (r < want) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const p0 = A.all65 / Math.max(shape(k, 65), 1e-15);
  fitted[country] = { p0, k };
  return { p0, k };
}

/** For tests and for the copy: what the calibration came out as. */
export const careFit = (country) => fitted[country] || null;

/**
 * Net annual cost of a year in care to the household, on top of what it was
 * already spending. `essentialsPerPerson` is that person's share of essential
 * spending, most of which board and lodging replaces.
 */
export function careNetAnnual(country, essentialsPerPerson) {
  const c = CARE_COST[country];
  if (!c) return 0;
  const displaced = CARE_DISPLACES * Math.max(0, essentialsPerPerson);
  return Math.max(0, c.grossAnnual - c.stateAnnual - displaced);
}

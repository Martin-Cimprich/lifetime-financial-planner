/* ===========================================================================
   Life-cycle planner engine, v2.

   Generalises the Idzorek-Kaplan parent life-cycle model (Idzorek & Kaplan,
   "Lifetime Financial Advice", CFA Institute Research Foundation 2024;
   workbook (c) 2026 Paul D. Kaplan, non-commercial licence) to:

     - real national life tables instead of US-calibrated Gompertz
     - couples, with joint survival and an equivalence scale
     - income tax and social contributions
     - a home: mortgage as a liability stream, optional downsizing
     - investment fees
     - early retirement (stop working before the state pension starts)

   With a single person, no tax, no housing, no fees and the original Gompertz
   mortality, it reduces exactly to the verified v1 engine. That reduction is
   asserted in the test suite.
   =========================================================================== */

export const MALE = 1, FEMALE = 2;

/* ---------------------------------------------------------------- mortality */

/** Gompertz survival, kept so we can reproduce the original workbook. */
export function gompertzTable(sex, maxAge = 120) {
  const M = [88.0, 91.0][sex - 1], b = [10.6450483499578, 8.8840011008432][sex - 1];
  const S = (age) => Math.exp((1 - Math.exp(0)) * Math.exp((age - M) / b));
  // qx implied by the Gompertz survival curve, age by age
  const qx = [];
  for (let a = 0; a <= maxAge; a++) {
    const sa = Math.exp(-Math.exp((a - M) / b) * (Math.exp(1 / b) - 1) * 0 + 0);
    qx.push(null);
  }
  return { kind: 'gompertz', M, b };
}

/**
 * Survival curve for one person.
 * `table` is either {kind:'gompertz', M, b} or {kind:'lifetable', qx:{male:[],female:[]}}.
 *
 * `healthShift` is expressed in YEARS ADDED TO LIFE: positive means healthier
 * and longer-lived, matching the workbook's deltaM. Both table kinds follow
 * that sign — the Gompertz path moves the modal age up, the life-table path
 * reads mortality at a correspondingly younger age.
 */
export class Mortality {
  constructor(table, sex, healthShift = 0) {
    this.table = table; this.sex = sex; this.shift = healthShift;
  }
  /** Probability of surviving from exact age `a` to exact age `a + n`. */
  survive(a, n) {
    if (n <= 0) return 1;
    if (this.table.kind === 'gompertz') {
      const m = this.table.M + this.shift, b = this.table.b;
      return Math.exp((1 - Math.exp(n / b)) * Math.exp((a - m) / b));
    }
    const qx = this.sex === FEMALE ? this.table.qx.female : this.table.qx.male;
    const last = qx.length - 1;
    let p = 1;
    for (let k = 0; k < n; k++) {
      const idx = Math.min(last, Math.max(0, Math.round(a + k - this.shift)));
      p *= (1 - qx[idx]);
      if (p <= 0) return 0;
    }
    return p;
  }
}

/* ------------------------------------------------------------ capital market */

export const ASSET_CLASSES = [
  { w: 0.17311229703644826, equity: true,  global: false },
  { w: 0.07419098444419213, equity: true,  global: false },
  { w: 0.21891677075053934, equity: true,  global: true  },
  { w: 0.05677302146020211, equity: true,  global: true  },
  { w: 0.18658453502895422, equity: false, global: false },
  { w: 0.06219484500965141, equity: false, global: false },
  { w: 0,                   equity: false, global: false },
  { w: 0.2282275462700125,  equity: false, global: true  },
  { w: 0,                   equity: false, global: false },
];

export const COV_MAT = [
[0.02376613683549868,0.025387590602155768,0.022095420642398368,0.023796450565855668,0.00026538901384189566,0.0014080002352681766,0.0006128493063460156,0.003277444391415615,-0.0001155025704978169],
[0.025387590602155768,0.032209723217076304,0.026060943787670657,0.029009040631782834,0.00021741024869993344,0.0017576076454239068,0.000978189384051462,0.003493635615966325,-0.00009327761122290896],
[0.022095420642398368,0.026060943787670657,0.027924078398149844,0.030436819069651018,0.000715254037135101,0.002225632136135404,0.0012617776417456663,0.006135094403300821,-0.0000738138615225124],
[0.023796450565855668,0.029009040631782834,0.030436819069651018,0.04588627865403846,0.0008900340755303406,0.0028540114178557878,0.0014969439792476035,0.006746124926714032,-0.00008366806127016196],
[0.00026538901384189566,0.00021741024869993344,0.000715254037135101,0.0008900340755303406,0.0014385631074620893,0.0017323811690892414,0.0012540238156718935,0.001989501544055613,0.00003407501191622874],
[0.0014080002352681766,0.0017576076454239068,0.002225632136135404,0.0028540114178557878,0.0017323811690892414,0.003379223450395645,0.001546241826955205,0.00294490228825892,0.000020217412122914354],
[0.0006128493063460156,0.000978189384051462,0.0012617776417456663,0.0014969439792476035,0.0012540238156718935,0.001546241826955205,0.0020104870032966573,0.0017152404876594226,0.000016213522643202647],
[0.003277444391415615,0.003493635615966325,0.006135094403300821,0.006746124926714032,0.001989501544055613,0.00294490228825892,0.0017152404876594226,0.006944408731689815,0.000019797294038534874],
[-0.0001155025704978169,-0.00009327761122290896,-0.0000738138615225124,-0.00008366806127016196,0.00003407501191622874,0.000020217412122914354,0.000016213522643202647,0.000019797294038534874,0.000030303799190241333]];

function stockPortfolio() {
  const s = ASSET_CLASSES.reduce((a, x) => a + (x.equity ? x.w : 0), 0);
  return ASSET_CLASSES.map(x => (x.equity ? x.w / s : 0));
}
function assetMix(eq, glob) {
  let stockSum = 0, globSum = 0;
  for (const a of ASSET_CLASSES) if (a.equity) { stockSum += a.w; if (a.global) globSum += a.w; }
  return ASSET_CLASSES.map(a => {
    if (!a.equity) return (1 - eq) * a.w / (1 - stockSum);
    return a.global ? eq * glob * a.w / globSum : eq * (1 - glob) * a.w / (stockSum - globSum);
  });
}
export function globalStockFraction() {
  let s = 0, g = 0;
  for (const a of ASSET_CLASSES) if (a.equity) { s += a.w; if (a.global) g += a.w; }
  return g / s;
}
const sdStocksFn = (rf, s) => { const o = Math.exp(s * s); return (1 + rf) * o * Math.sqrt(o - 1); };
function sigmaSDFFn(rf, sd, tol = 1e-13) {
  let lo = 0, hi = 2 * sd, mid = 0;
  if ((sdStocksFn(rf, lo) - sd) * (sdStocksFn(rf, hi) - sd) > 0) return NaN;
  while (0.5 * Math.abs(lo - hi) >= tol) {
    mid = (lo + hi) / 2;
    if ((sdStocksFn(rf, mid) - sd) * (sdStocksFn(rf, lo) - sd) < 0) hi = mid; else lo = mid;
  }
  return mid;
}
function erCovS(covS, rf, sigmaSDF) {
  const KK = covS / (Math.pow(1 + rf, 2) * Math.exp(sigmaSDF * sigmaSDF));
  return (1 + rf) * ((1 + Math.sqrt(1 + 4 * KK)) / 2) - 1;
}
function logStdDev(er, sd) { const r = sd / (1 + er); return Math.sqrt(Math.log(1 + r * r)); }

/** Discount rates and volatilities implied by the risk exposures. */
export function deriveCMA(eqHC, globHC, eqLiab, globLiab, rf, bisectTol) {
  const ports = [stockPortfolio(), assetMix(eqHC, globHC), assetMix(eqLiab, globLiab)];
  const P = [[0,0,0],[0,0,0],[0,0,0]];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    let s = 0;
    for (let i = 0; i < 9; i++) { if (!ports[a][i]) continue;
      for (let j = 0; j < 9; j++) s += ports[a][i] * COV_MAT[i][j] * ports[b][j]; }
    P[a][b] = s;
  }
  const sdStocks = Math.sqrt(P[0][0]);
  const sigmaSDF = sigmaSDFFn(rf, sdStocks, bisectTol);
  const kY = erCovS(P[0][1], rf, sigmaSDF), kC = erCovS(P[0][2], rf, sigmaSDF);
  return { rf, kY, kC, sigmaSDF, sdStocks, portCovMat: P,
           sigmaY: logStdDev(kY, Math.sqrt(P[1][1])),
           sigmaC: logStdDev(kC, Math.sqrt(P[2][2])) };
}

/**
 * Long-only projection of the unconstrained net-worth allocation.
 *
 * DEVIATION (economic, and deliberate). The workbook's ReallocNeg zeroes the
 * negative positions and rescales ALL the positives down proportionally. For a
 * young household that scales the equity holding down alongside the cash, and
 * so moves AWAY from the target equity exposure: it is strictly dominated by
 * simply holding everything in equities. In a worked case with 96% of the
 * balance sheet in human capital, ReallocNeg lands 124,580 short of the target
 * equity exposure where an all-equity portfolio is only 93,872 short.
 *
 * Since theta is defined as the equity share of net worth, the right long-only
 * answer is to get the EQUITY exposure as close to target as the budget allows,
 * then put whatever is left where the unconstrained solution wanted it. That is
 * what this does. `reallocNeg` is kept below so the original workbook can still
 * be reproduced exactly.
 *
 * Input/output: [domestic, global, totalEquity, bonds, cash].
 */
export function longOnlyAlloc(unc, Ft, globFrac) {
  if (!(Ft > 0)) return [0, 0, 0, 0, 0];
  const wantEq = unc[2];
  const eq = Math.max(0, Math.min(Ft, wantEq));
  let rest = Ft - eq;
  // Whatever is left follows the unconstrained solution's preference between
  // bonds and cash; where it wanted to be short bonds, long-only means cash.
  const wantBonds = Math.max(0, unc[3]);
  const bonds = Math.min(rest, wantBonds);
  rest -= bonds;
  const cash = rest;
  const glob = eq * globFrac, dom = eq - glob;
  return [dom, glob, eq, bonds, cash];
}

/** The original workbook's heuristic, retained for exact reproduction. */
export function reallocNeg(unc) {
  const idx = [0, 1, 3, 4];
  let sumAll = 0, sumPos = 0;
  for (const i of idx) { sumAll += unc[i]; if (unc[i] >= 0) sumPos += unc[i]; }
  const ratio = sumPos === 0 ? 0 : sumAll / sumPos;
  const out = [0,0,0,0,0];
  for (const i of idx) out[i] = unc[i] >= 0 ? ratio * unc[i] : 0;
  out[2] = out[0] + out[1];
  return out;
}

export function goldenMax(f, lo, hi, iters = 200) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = hi - gr*(hi-lo), d = lo + gr*(hi-lo), fc = f(c), fd = f(d);
  for (let i = 0; i < iters && hi - lo > 1e-12 * Math.max(1, Math.abs(lo)); i++) {
    if (fc > fd) { hi = d; d = c; fd = fc; c = hi - gr*(hi-lo); fc = f(c); }
    else         { lo = c; c = d; fc = fd; d = lo + gr*(hi-lo); fd = f(d); }
  }
  return (lo + hi) / 2;
}

export const PCTL = [
  { label:'95th', z: 1.6448536269514715 }, { label:'90th', z: 1.2815515655446006 },
  { label:'75th', z: 0.6744897501960819 }, { label:'50th', z: 0 },
  { label:'25th', z:-0.6744897501960819 }, { label:'10th', z:-1.2815515655446006 },
  { label:'5th',  z:-1.6448536269514726 },
];

/* ------------------------------------------------------------------ helpers */

/** Level annual payment amortising `balance` over `years` at `rate`. */
export function mortgagePayment(balance, rate, years) {
  if (balance <= 0 || years <= 0) return 0;
  if (rate <= 1e-9) return balance / years;
  return balance * rate / (1 - Math.pow(1 + rate, -years));
}

/**
 * OECD-modified equivalence: a couple needs 1.5x what one person needs, so a
 * survivor's essential spending is 1/1.5 of the couple's.
 */
export const SINGLE_EQUIV = 1 / 1.5;

/* ================================================================== engine */

export class Household {
  /**
   * @param {object} p  see DEFAULTS in the country modules for the full shape
   * @param {object} ctx {mortalityTable, salaryCurve, tax, statePension}
   */
  constructor(p, ctx) {
    this.p = p; this.ctx = ctx;
    this.people = p.people;
    this.n = this.people.length;
    // Horizon runs from the YOUNGEST person's age to the plan's maximum age.
    this.baseAge = Math.min(...this.people.map(x => x.age));
    this.maxYear = Math.max(1, p.maxAge - this.baseAge);
    this.mort = this.people.map(x =>
      new Mortality(ctx.mortalityTable, x.sex, x.healthShift || 0));
    // The home/foreign equity split is no longer a user input: everyone is
    // assumed globally diversified in the reference proportions. It stays a
    // parameter so the original workbook's settings can be reproduced exactly.
    this.globHC = p.globHC != null ? p.globHC : globalStockFraction();
    this.globLiab = p.globLiab != null ? p.globLiab : globalStockFraction();
    this.cma = p.cma || deriveCMA(p.eqHC, this.globHC, p.eqLiab, this.globLiab,
                                  p.rf, p.bisectTol);
    this._af = new Map();
  }

  /** Age of person i at household year t. */
  ageAt(i, t) { return this.people[i].age + t; }

  /**
   * Probability person i is alive at household year t, conditioned on dying by
   * the plan horizon so that survival reaches exactly zero there. This is the
   * original workbook's treatment; for a real life table the conditioning is
   * negligible because survival past 105 is already ~0.
   */
  pAlive(i, t) {
    const key = i * 1e4 + t;
    this._sc = this._sc || new Map();
    const hit = this._sc.get(key); if (hit !== undefined) return hit;
    const person = this.people[i];
    let out;
    // Each person is conditioned on THEIR OWN horizon. Using the household
    // horizon would leave an older partner alive past the plan's maximum age,
    // because maxYear is measured from the youngest person's age.
    const ownYears = Math.max(0, this.p.maxAge - person.age);
    if (t > this.maxYear || t > ownYears) out = 0;
    else {
      const raw = this.mort[i].survive(person.age, t);
      const tail = this.mort[i].survive(person.age, ownYears + 1);
      out = tail >= 1 ? 0 : (raw - tail) / (1 - tail);
      if (!(out > 0)) out = 0;
    }
    this._sc.set(key, out); return out;
  }

  /** Probability the household still exists (at least one person alive). */
  pHousehold(t) {
    if (this.n === 1) return this.pAlive(0, t);
    const a = this.pAlive(0, t), b = this.pAlive(1, t);
    return a + b - a * b;
  }
  /** Probability both are alive. */
  pBoth(t) { return this.n === 1 ? this.pAlive(0, t) : this.pAlive(0, t) * this.pAlive(1, t); }

  /**
   * Expected essential-spending multiplier in year t, conditional on the
   * household existing: 1.0 while both are alive, SINGLE_EQUIV once only one is.
   */
  equivScale(t) {
    if (this.n === 1) return 1;
    const any = this.pHousehold(t);
    if (any <= 0) return SINGLE_EQUIV;
    const both = this.pBoth(t);
    return (both * 1 + (any - both) * SINGLE_EQUIV) / any;
  }

  /* --- annuitisation ---------------------------------------------------- */
  retYearOf(i) {
    const w = this.people[i].workUntilAge;
    return w > this.people[i].age ? w - this.people[i].age : 0;
  }
  /** Household annuitisation starts when the LAST earner stops working. */
  get retYear() { return Math.max(...this.people.map((_, i) => this.retYearOf(i))); }

  annFactor1Y(t) {
    if (t <= this.retYear) return 1;
    const prev = this.pHousehold(t - 1);
    if (prev <= 0) return 1;
    const q = this.pHousehold(t) / prev;      // one-year household survival
    if (q <= 0) return 1;
    return 1 / (1 - this.p.alpha + this.p.alpha / q);
  }
  annFactor(t, v) {
    if (t >= v) return 1;
    const key = t * 1e4 + v;
    const hit = this._af.get(key); if (hit !== undefined) return hit;
    let f = 1;
    for (let s = t + 1; s <= v; s++) f *= this.annFactor1Y(s);
    this._af.set(key, f); return f;
  }
  /** Household survival from t to v. */
  survHH(t, v) {
    const a = this.pHousehold(t);
    return a <= 0 ? 0 : this.pHousehold(v) / a;
  }

  pdv(vec, t, k) {
    let s = 0;
    for (let v = t; v <= this.maxYear; v++)
      s += vec[v] * this.annFactor(t, v) * Math.pow(1 + k, t - v);
    return s;
  }

  /* --- preferences ------------------------------------------------------ */
  static priceFn(th, rf, s) {
    return Math.pow(1 + rf, th - 1) * Math.exp(0.5 * th * (th - 1) * s * s);
  }
  certEquivGross() {
    const { rf, sigmaSDF } = this.cma, th = this.p.theta;
    return th === 1
      ? (1 + rf) * Math.exp(0.5 * sigmaSDF * sigmaSDF) - 1
      : Math.pow(Household.priceFn(th, rf, sigmaSDF), 1 / (th - 1)) - 1;
  }
  /**
   * Certainty-equivalent return, net of investment charges.
   *
   * h is the return on NET WORTH, but charges fall only on the financial
   * portfolio — nobody pays a platform fee on their future salary. Taking the
   * headline fee straight off h would therefore charge it against human
   * capital too, overstating the lifetime cost several-fold for a young
   * household whose balance sheet is mostly future earnings. The drag is
   * scaled by the share of net worth that is actually financial, averaged over
   * the plan and weighted by survival. Pass feeScope:'total' for the naive
   * whole-balance-sheet treatment.
   */
  certEquiv() {
    const gross = this.certEquivGross();
    const fee = this.p.fee || 0;
    if (fee <= 0) return gross;
    if (this.p.feeScope === 'total' || this.p._probe) return gross - fee;
    return gross - fee * this.financialShareOfNetWorth();
  }
  /** Survival-weighted average of financial wealth as a share of net worth. */
  financialShareOfNetWorth() {
    if (this._finShare != null) return this._finShare;
    this._finShare = 1;                    // provisional, so the probe terminates
    let num = 0, den = 0;
    try {
      const probe = new Household({ ...this.p, fee: 0, _probe: true }, this.ctx);
      for (const y of probe.solve().years) {
        const w = y.survHousehold;
        if (!(w > 0) || !Number.isFinite(y.netWorth) || y.netWorth <= 0) continue;
        num += w * Math.max(0, Math.min(1, y.finWealth / y.netWorth));
        den += w;
      }
    } catch { /* fall back to charging the fee on the whole balance sheet */ }
    this._finShare = den > 0 ? num / den : 1;
    return this._finShare;
  }
  growthRate(h) { return Math.pow((1 + h) / (1 + this.p.rho), this.p.eta) - 1; }

  consumpDiv(t, h) {
    if (t > this.maxYear) return 0;
    const g = this.growthRate(h), fac = (1 + g) / (1 + h), eta = this.p.eta;
    let s = 0;
    for (let v = t; v <= this.maxYear; v++)
      s += Math.pow(this.survHH(t, v), eta) * Math.pow(this.annFactor(t, v), 1 - eta)
         * Math.pow(fac, v - t);
    return s;
  }
  ivaFn(t, v, g) {
    return Math.pow(this.survHH(t, v) / this.annFactor(t, v), this.p.eta)
         * Math.pow(1 + g, v - t);
  }

  /** Price of permanent life cover per unit of benefit, paid when the household ends. */
  liPerm(t) {
    const rf = this.cma.rf;
    let s = 0;
    for (let v = t + 1; v <= this.maxYear + 1; v++) {
      const a = v - 1 <= this.maxYear ? this.survHH(t, v - 1) : 0;
      const b = v <= this.maxYear ? this.survHH(t, v) : 0;
      s += (a - b) * Math.pow(1 + rf, t - v);
    }
    return s;
  }

  /* --- bequest (numerically stable forms) -------------------------------- */
  consumpConstEquiv(beq, w0SansLI, ctx) {
    const { D0, W, wSum, IV, liPerm0 } = ctx;
    const cd0 = (w0SansLI - beq * liPerm0) / D0;
    if (cd0 <= 0) return 1e-9;
    const eta = this.p.eta;
    if (eta === 1) {
      let u = 0;
      for (let t = 0; t < W.length; t++) u += W[t] * Math.log(IV[t] * cd0);
      return Math.exp(u / wSum);
    }
    const pw = (eta - 1) / eta;
    let s = 0;
    for (let t = 0; t < W.length; t++) s += W[t] * Math.pow(IV[t] * cd0, pw);
    return Math.pow(s / wSum, 1 / pw);
  }
  intergenUtil(beq, cHat, beqDiv) {
    const { gamma, phi } = this.p;
    if (gamma === 1) return (1 - phi) * Math.log(cHat) + phi * Math.log(beq / beqDiv);
    const pw = (gamma - 1) / gamma;
    return ((1 - phi) * Math.pow(cHat, pw) + phi * Math.pow(beq / beqDiv, pw)) / pw;
  }

  /* --- cash-flow construction -------------------------------------------- */

  /**
   * Gross income for person i in household year t, split into its sources.
   * Working income stops at workUntilAge; the state pension starts at
   * pensionAge. The gap between them is the early-retirement problem.
   */
  grossIncome(i, t) {
    const person = this.people[i];
    const age = person.age + t;
    const out = { salary: 0, statePension: 0, employerPension: 0, disabilityBenefit: 0 };
    if (age < person.workUntilAge) {
      out.salary = this.ctx.salaryCurve
        ? person.salary * this.ctx.salaryCurve(age, person) / this.ctx.salaryCurve(person.age, person)
        : person.salary;
      // The employer's pension contribution is money you would not otherwise
      // receive, so it belongs in human capital. Your own contribution is not
      // extra income — it only moves money between pots — so it is excluded.
      out.employerPension = out.salary * (person.employerPensionRate || 0);
    }
    if (age >= person.pensionAge) {
      out.statePension = person.statePensionOverride != null
        ? person.statePensionOverride
        : this.ctx.statePension(person, this);
    }
    // Income protection pays between the date earnings stop and pension age.
    if (person.disabilityBenefit > 0 &&
        age >= (person.disabilityFrom ?? Infinity) &&
        age < (person.disabilityTo ?? -Infinity)) {
      out.disabilityBenefit = person.disabilityBenefit;
    }
    return out;
  }

  /**
   * After-tax income for person i in year t. Employer pension contributions
   * are added net of the tax expected when the pot is eventually drawn.
   */
  netIncome(i, t) {
    const g = this.grossIncome(i, t);
    const deferred = g.employerPension * (1 - (this.p.pensionTaxHaircut || 0));
    // UK and Czech income-protection benefits are paid free of income tax when
    // the policy is personally owned, so the benefit is added net.
    const benefit = g.disabilityBenefit || 0;
    if (!this.ctx.tax) return g.salary + g.statePension + deferred + benefit;
    return this.ctx.tax(g, this.people[i], t, this) + deferred + benefit;
  }

  /* --- solve ------------------------------------------------------------- */
  solve() {
    const T = this.maxYear, { rf, kY, kC, sigmaY, sigmaC } = this.cma;
    const h = this.p.h != null ? this.p.h : this.certEquiv();
    const g = this.growthRate(h);

    // --- income, essentials, mortgage, windfalls -------------------------
    const incVec = new Array(T + 1).fill(0);
    const incGross = new Array(T + 1).fill(0);
    const essVec = new Array(T + 1).fill(0);
    const mortVec = new Array(T + 1).fill(0);
    const windfall = new Array(T + 1).fill(0);

    const H = this.p.housing || {};
    const mPay = H.own ? mortgagePayment(H.mortgageBalance || 0,
                                         H.mortgageRate || 0,
                                         H.mortgageYearsLeft || 0) : 0;

    for (let t = 0; t <= T; t++) {
      for (let i = 0; i < this.n; i++) {
        // Income is weighted by the earner still being alive; with one person
        // this matches the original model, which conditions on survival.
        const w = this.n === 1 ? 1 : (this.pAlive(i, t) / Math.max(this.pHousehold(t), 1e-12));
        const gInc = this.grossIncome(i, t);
        incGross[t] += (gInc.salary + gInc.statePension + gInc.employerPension) * Math.min(w, 1);
        incVec[t]   += this.netIncome(i, t) * Math.min(w, 1);
      }
      essVec[t] = this.p.cbar * this.equivScale(t);
      // mortgagePayment() is the level payment of an ORDINARY annuity, so the
      // stream must run t = 1..N. Booking it from t = 0 would over-repay the
      // loan by one year's interest.
      if (H.own && t >= 1 && t <= (H.mortgageYearsLeft || 0)) mortVec[t] = mPay;
    }

    // Downsizing releases equity in a single year.
    if (H.own && H.downsizeAge && H.downsizeRelease > 0) {
      const dt = Math.round(H.downsizeAge - this.baseAge);
      if (dt >= 0 && dt <= T) {
        /* Net off the balance still outstanding when the house is sold, not
           today's. The repayments between now and then are already on the
           balance sheet as L0Mort; deducting the opening balance again would
           charge the same debt twice. */
        let bal = H.mortgageBalance || 0;
        const r = H.mortgageRate || 0;
        for (let k = 0; k < Math.min(dt, H.mortgageYearsLeft || 0); k++) {
          bal = bal * (1 + r) - mPay;
        }
        const equity = Math.max(0, (H.value || 0) - Math.max(0, bal));
        windfall[dt] += equity * H.downsizeRelease;
      }
    }

    // --- balance sheet ----------------------------------------------------
    const H0r = this.pdv(incVec, 0, kY);          // human capital, after tax
    const H0w = this.pdv(windfall, 0, rf);        // downsizing proceeds
    const H0 = H0r + H0w;
    const L0Ess = this.pdv(essVec, 0, kC);
    const L0Mort = this.pdv(mortVec, 0, rf);      // a contractual, riskless stream
    const L0Risky = L0Ess + L0Mort;

    const sav = this.p.savings;
    const F0 = sav.shares + sav.bonds + sav.cash
             + (sav.pension || 0) * (1 - (this.p.pensionTaxHaircut || 0));
    const w0SansLI = F0 + H0 - L0Risky;

    const D0 = this.consumpDiv(0, h), liPerm0 = this.liPerm(0);

    const W = [], IV = []; let wSum = 0;
    for (let t = 0; t <= T; t++) {
      const w = this.survHH(0, t) / Math.pow(1 + this.p.rho, t);
      W.push(w); wSum += w; IV.push(this.ivaFn(0, t, g));
    }
    const cx = { D0, W, wSum, IV, liPerm0 }, beqDiv = wSum;
    // Negative when essentials already exceed lifetime resources; a bequest is
    // never negative, so clamp before either branch uses it.
    const maxBeq = Math.max(0, liPerm0 > 0 ? w0SansLI / liPerm0 : 0);

    let beq = 0;
    if (this.p.beqMode === 'opt' && maxBeq > 0) {
      const obj = B => this.intergenUtil(B, this.consumpConstEquiv(B, w0SansLI, cx), beqDiv);
      beq = goldenMax(obj, 1e-9 * maxBeq, 0.999999 * maxBeq);
    } else if (this.p.beqMode === 'fixed') {
      const want = Number.isFinite(this.p.beqFixed) ? Math.max(0, this.p.beqFixed) : 0;
      beq = Math.min(want, 0.999 * maxBeq);
    }

    const L0Cash = beq * liPerm0;
    const L0 = L0Risky + L0Cash;
    const W0 = F0 + H0 - L0;
    const CD0 = W0 / D0;

    // --- projection -------------------------------------------------------
    const th = this.p.theta, sSDF = this.cma.sigmaSDF;
    const muIVA = 0.5*(1-th)*th*sSDF*sSDF, sigmaIVA = th*sSDF;
    const muC = -0.5*sigmaC*sigmaC, muY = -0.5*sigmaY*sigmaY;
    const globFrac = globalStockFraction();

    const years = [];
    for (let t = 0; t <= T; t++) {
      const HR = this.pdv(incVec, t, kY) + this.pdv(windfall, t, rf);
      const LR = this.pdv(essVec, t, kC) + this.pdv(mortVec, t, rf);
      const LC = beq * this.liPerm(t);
      const Dt = this.consumpDiv(t, h);
      const numIVA = this.ivaFn(0, t, g) * CD0;
      const Wt = Dt * numIVA;
      const Ft = Wt - HR + LR + LC;

      const nwEq = th*Wt, nwGl = globFrac*nwEq, nwDom = nwEq-nwGl, nwCash = Wt-nwEq;
      const hcEq = HR*this.p.eqHC, hcGl = hcEq*this.globHC, hcDom = hcEq-hcGl, hcB = HR-hcEq;
      const lEq = LR*this.p.eqLiab, lGl = lEq*this.globLiab, lDom = lEq-lGl, lB = LR-lEq;
      const unc = [nwDom-hcDom+lDom, nwGl-hcGl+lGl, 0, 0-hcB+lB, nwCash+LC];
      unc[2] = unc[0] + unc[1];
      const con = this.p.constrainedMethod === 'reallocNeg'
        ? reallocNeg(unc)
        : longOnlyAlloc(unc, Ft, globFrac);
      const st = Math.sqrt(t);

      years.push({
        t, age: this.baseAge + t, year: this.p.curYear + t,
        ages: this.people.map((_, i) => this.ageAt(i, t)),
        incomeNet: incVec[t], incomeGross: incGross[t],
        essentials: essVec[t], mortgage: mortVec[t], windfall: windfall[t],
        humanCapital: HR, liabilities: LR + LC, liabEssentials: LR, liabBequest: LC,
        netWorth: Wt, finWealth: Ft, delta: Dt,
        discConsump: numIVA, totalConsump: numIVA + essVec[t] + mortVec[t],
        survHousehold: this.pHousehold(t), survBoth: this.pBoth(t),
        survEach: this.people.map((_, i) => this.pAlive(i, t)),
        /* With no financial wealth there is no share to report. Returning 0
           would be indistinguishable from a genuine "hold all cash" answer,
           and would stop the leverage warning firing for exactly the
           young-with-no-savings households it exists for. */
        equityShareUncon: Ft > 1e-6 ? unc[2]/Ft : null,
        equityShareCon:   Ft > 1e-6 ? con[2]/Ft : null,
        equityAmountUncon: unc[2], equityAmountCon: con[2],
        allocUncon: unc, allocCon: con,
        bandsConsump: PCTL.map(q => numIVA*Math.exp(t*muIVA + q.z*st*sigmaIVA)),
        bandsIncome:  PCTL.map(q => incVec[t]*Math.exp(t*muY + q.z*st*sigmaY)),
      });
    }

    return {
      h, g, H0, H0r, H0w, L0, L0Risky, L0Ess, L0Mort, L0Cash, F0, W0, w0SansLI,
      D0, CD0, beq, maxBeq, beqDiv, liPerm0, mortgagePayment: mPay,
      retYear: this.retYear, maxYear: T, baseAge: this.baseAge,
      years, cma: this.cma, muIVA, sigmaIVA,
      cHat: this.consumpConstEquiv(beq, w0SansLI, cx),
    };
  }
}

/**
 * "What if I could not work from age X?"
 *
 * Re-solves with earnings stopping permanently at `stopAge` for person `who`,
 * then finds the level annual benefit, payable from that age to their state
 * pension age, that restores baseline spending. That benefit is the income
 * protection cover this household actually needs — derived from its own balance
 * sheet rather than a rule of thumb like "60% of salary".
 *
 * Deterministic: it answers "what would it cost" without claiming to know how
 * likely it is. The probability is layered on separately.
 */
export function incomeShock(p, ctx, stopAge, who = 0) {
  const baseline = new Household(p, ctx).solve();
  const shocked = (benefit) => {
    const people = p.people.map((person, i) => i !== who ? person : {
      ...person,
      workUntilAge: Math.min(person.workUntilAge, stopAge),
      /* Being unable to work does not wipe out your state pension: the UK
         credits National Insurance while you are on incapacity benefits, and
         Czech invalidity counts as an insured period. Pin the record to the
         career you would have had, or the shock double-counts the loss. */
      niYears: person.niYears ?? Math.max(0, Math.min(35, person.workUntilAge - 21)),
      insuredYears: person.insuredYears ?? Math.max(0, Math.min(50, person.workUntilAge - 20)),
      // The benefit stops at state pension age, as income protection does.
      disabilityBenefit: benefit,
      disabilityFrom: stopAge,
      disabilityTo: person.pensionAge,
    });
    return new Household({ ...p, people }, ctx).solve();
  };
  const noCover = shocked(0);
  // Bisect on the benefit that restores baseline spending.
  let lo = 0, hi = Math.max(1, p.people[who].salary * 3), mid = 0;
  if (shocked(hi).CD0 < baseline.CD0) return {
    baseline, noCover, benefit: hi, restored: shocked(hi), capped: true,
  };
  for (let k = 0; k < 60; k++) {
    mid = (lo + hi) / 2;
    if (shocked(mid).CD0 < baseline.CD0) lo = mid; else hi = mid;
  }
  const benefit = (lo + hi) / 2;
  return {
    baseline, noCover, benefit, restored: shocked(benefit), capped: false,
    lossPerYear: baseline.CD0 - noCover.CD0,
    lossPct: baseline.CD0 > 0 ? (baseline.CD0 - noCover.CD0) / baseline.CD0 : 0,
    yearsOfCover: Math.max(0, p.people[who].pensionAge - stopAge),
  };
}

/** Lifetime cost of fees: what spending would be at zero cost, minus actual. */
export function feeImpact(p, ctx) {
  const withFee = new Household(p, ctx).solve();
  const noFee = new Household({ ...p, fee: 0 }, ctx).solve();
  return {
    withFee: withFee.CD0, noFee: noFee.CD0,
    annualLoss: noFee.CD0 - withFee.CD0,
    pctLoss: noFee.CD0 > 0 ? (noFee.CD0 - withFee.CD0) / noFee.CD0 : 0,
  };
}

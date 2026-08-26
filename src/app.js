/* ============================ application layer ============================ */
const C = COUNTRIES[BUILD.country];
const T = I18N[BUILD.lang];
const CY = new Date().getFullYear();

/* ------------------------------------------------------------------ state */
function freshState() {
  const D = C.defaults;
  const by = CY - 35;
  const pAge = Math.round(C.pensionAgeFor(by));
  return {
    couple: false,
    people: [
      { age: 35, sex: 1, health: 1, trajectory: 1, jobRisk: 1, salary: D.salary,
        workUntilAge: pAge, pensionAge: pAge, employerPensionRate: D.employerPensionRate,
        occClass: 0, existingCover: 0 },
      { age: 35, sex: 2, health: 1, trajectory: 1, jobRisk: 1, salary: Math.round(D.salary * 0.85),
        workUntilAge: pAge, pensionAge: pAge, employerPensionRate: D.employerPensionRate,
        occClass: 0, existingCover: 0 },
    ],
    cbar: D.cbar,
    savings: { ...D.savings },
    own: true, homeValue: D.homeValue, mortgageBalance: D.mortgageBalance,
    mortgageRate: D.mortgageRate, mortgageYears: D.mortgageYears,
    downsize: false, downsizeAge: 72, downsizeRelease: 0.3,
    riskPay: 0.05,          // willingness to pay to avoid the demon gamble
    shape: 1,               // 0 = front-load, 1 = level, 2 = back-load
    smooth: 1,              // 0 = keep steady, 1 = trim, 2 = cut and rebuild
    alpha: 0.4,
    beqMode: 'none', beqFixed: Math.round(D.salary * 5), beqWeight: 1,
    fee: C.defaultFee,
    rf: C.rf, maxAge: 105,
    /* The insurer's margin is the one number that decides how much cover is
       worth buying and the one number a normal person cannot know. It is
       estimated from each person's occupation answer; null means "use the
       estimate". An override applies to the whole household, because it is a
       fact about the market rather than about a person. */
    loadingOverride: null,
  };
}
let S = freshState();
let touched = false, lastR = null;
/* Cleared if the document is not allowed to rewrite its own URL, which also
   means the share link cannot carry the scenario. */
let urlWritable = true;
const effLoading = (i = 0) => S.loadingOverride != null
  ? S.loadingOverride
  : marketLoading(BUILD.country, S.people[i]?.occClass ?? 0);

/* ----------------------------------------------------------------- format */
const nf0 = new Intl.NumberFormat(C.locale, { style:'currency', currency:C.currency, maximumFractionDigits:0 });
const nfC = new Intl.NumberFormat(C.locale, { style:'currency', currency:C.currency,
                                              notation:'compact', compactDisplay:'short', maximumSignificantDigits:3 });
const money = v => nf0.format(Math.round(v));
const moneyK = v => nfC.format(v);
const pct = (v,d=0) => (v*100).toFixed(d) + '%';
const sym = (() => { const p = nf0.formatToParts(1).find(x=>x.type==='currency'); return p?p.value:''; })();
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_,k)=> o[k] != null ? o[k] : '');

/* -------------------------------------------------- preference conversion */
/* The interface asks questions people can answer about themselves; these turn
   the answers into the model's parameters. */
function thetaFromAnswer(st = S) {
  const gamma = riskAversionFromGamble(st.riskPay);
  return Math.max(0.03, Math.min(3, thetaFromRiskAversion(gamma)));
}
const ETA_BY_SMOOTH = [0.25, 0.5, 1.0];          // steadier spending = lower EIS
/* How share-like a person's earnings are. Idzorek & Kaplan put the typical
   range at 5-40%; the top option goes beyond it for people genuinely paid in
   equity or commission. */
const EQ_HC_BY_JOB = [0.05, 0.15, 0.30, 0.50];
/* Weight on the bequest inside the intergenerational aggregator. The research
   was right that phi has no lay meaning, but "let the model decide" needs one,
   and leaving it hard-coded meant the model's answer came from a number the
   user could neither see nor steer. Asked as importance, mapped here. */
const PHI_BY_WEIGHT = [0.02, 0.08, 0.20];
/* The spending-shape answer is inverted through the Euler equation. Real
   spending grows at g = ((1+h)/(1+rho))^eta - 1, so a chosen slope implies rho. */
function rhoFromShape(h, eta, st = S) {
  const target = [-0.010, 0.0, 0.010][st.shape];  // real change per year
  const rho = (1 + h) / Math.pow(1 + target, 1 / eta) - 1;
  return Math.max(-0.02, Math.min(0.25, rho));
}

function buildParams(st = S) {
  const people = (st.couple ? st.people : [st.people[0]]).map(p => ({
    age: p.age, sex: p.sex,
    healthShift: [-4, 0, 3, 7][p.health],
    trajectory: [0.4, 1, 1.6][p.trajectory],
    salary: p.salary,
    workUntilAge: p.workUntilAge,
    pensionAge: p.pensionAge,
    // Passed explicitly so the country module compares the claim age with the
    // statutory age on the SAME rounding basis the interface shows.
    statutoryPensionAge: Math.round(C.pensionAgeFor(CY - p.age)),
    employerPensionRate: p.employerPensionRate,
    // Each earner carries their own occupation class and their own cover: the
    // hazard, the price and the gap left to buy are all personal.
    occClass: p.occClass ?? 0,
    existingCover: Math.max(0, p.existingCover || 0),
    birthYear: CY - p.age,
  }));
  const theta = thetaFromAnswer(st);
  const eta = ETA_BY_SMOOTH[st.smooth];
  const cma = deriveCMA(0.2, globalStockFraction(), 0.15, globalStockFraction(), st.rf);
  const hGross = theta === 1
    ? (1 + st.rf) * Math.exp(0.5 * cma.sigmaSDF ** 2) - 1
    : Math.pow(Math.pow(1 + st.rf, theta - 1) * Math.exp(0.5 * theta * (theta - 1) * cma.sigmaSDF ** 2),
               1 / (theta - 1)) - 1;
  const h = hGross - st.fee;
  return {
    people, cbar: st.cbar,
    savings: { shares: st.savings.shares, bonds: st.savings.bonds,
               cash: st.savings.cash, pension: st.savings.pension },
    housing: st.own ? {
      own: true, value: st.homeValue, mortgageBalance: st.mortgageBalance,
      mortgageRate: st.mortgageRate, mortgageYearsLeft: st.mortgageYears,
      downsizeAge: st.downsize ? st.downsizeAge : 0,
      downsizeRelease: st.downsize ? st.downsizeRelease : 0,
    } : { own: false },
    maxAge: st.maxAge, curYear: CY,
    theta, eta, rho: rhoFromShape(h, eta, st), alpha: st.alpha,
    beqMode: st.beqMode, beqFixed: st.beqFixed, gamma: 0.25,
    phi: PHI_BY_WEIGHT[st.beqWeight ?? 1],
    // Averaged across the household, weighted by each person's earnings.
    eqHC: (() => {
      const ppl = st.couple ? st.people : [st.people[0]];
      const tot = ppl.reduce((s,p)=>s+Math.max(0,p.salary),0);
      if (!(tot > 0)) return EQ_HC_BY_JOB[ppl[0].jobRisk ?? 1];
      return ppl.reduce((s,p)=>s+EQ_HC_BY_JOB[p.jobRisk ?? 1]*Math.max(0,p.salary),0)/tot;
    })(),
    eqLiab: 0.15, rf: st.rf, fee: st.fee,
    pensionTaxHaircut: C.pensionTaxHaircut,
  };
}
const ctx = {
  mortalityTable: C.lifeTable,
  salaryCurve: C.salaryCurve,
  statePension: (person, hh) => C.statePension(person, hh),
  tax: C.tax.bind(C),
  // Published disability incidence: earnings only arrive while you can earn.
  hazard: (person, age) => disabilityRate(BUILD.country, age, person.sex, person.occClass ?? 0),
  ability: (person, age) =>
    abilityToWork(BUILD.country, person.age, age, person.sex, person.occClass ?? 0),
};

/* ------------------------------------------------------------------- rail */
const el = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  for (const k in (attrs||{})) {
    if (k === 'html') e.innerHTML = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of (kids||[])) if (c) e.appendChild(c);
  return e;
};
/* Money fields show thousands separators. A type="number" input cannot, so
   these are text inputs with a numeric keypad hint. Digits are grouped while
   the field is idle and left plain while it has focus, so typing is never
   fought by a reformat mid-keystroke. */
const groupNum = new Intl.NumberFormat(C.locale, { maximumFractionDigits: 0 });
const fmtGroup = v => Number.isFinite(v) ? groupNum.format(Math.round(v)) : '';
const parseGroup = s => {
  const cleaned = String(s).replace(/[^0-9.,-]/g, '')
    .replace(/[\s  ]/g, '')
    .replace(/,/g, (C.locale === 'cs-CZ') ? '.' : '');
  const n = parseFloat(cleaned.replace(/(\..*)\./g, '$1'));
  return Number.isFinite(n) ? n : NaN;
};

function fieldMoney(label, get, set, hint) {
  const inp = el('input', { type:'text', inputmode:'numeric', autocomplete:'off',
                            'aria-label':label });
  inp.value = fmtGroup(get());
  inp.addEventListener('input', () => {
    const raw = parseGroup(inp.value);
    if (!Number.isFinite(raw)) return;
    set(Math.max(0, raw)); touched = true; render();
  });
  inp.addEventListener('focus', () => { const v = get(); inp.value = Number.isFinite(v) ? String(Math.round(v)) : ''; });
  inp.addEventListener('blur',  () => { inp.value = fmtGroup(get()); });
  const f = el('div', { class:'field' }, [
    el('span', { class:'flabel', text:label }),
    el('div', { class:'money' }, [el('span', { class:'cur', text:sym }), inp]),
    hint ? el('div', { class:'hint', text:hint }) : null,
  ]);
  f._update = () => { if (document.activeElement !== inp) inp.value = fmtGroup(get()); };
  return f;
}
function fieldNum(label, get, set, min, max, step, suffix) {
  const inp = el('input', { type:'number', min, max, step, 'aria-label':label });
  inp.value = get();
  inp.addEventListener('input', () => {
    const raw = parseFloat(inp.value);
    if (!Number.isFinite(raw)) return;              // mid-edit, leave state alone
    let v = Math.min(Number(max), Math.max(Number(min), raw));
    // Whole-number fields (ages, years) must stay whole: a typed 67.5 would
    // otherwise reach the model and surface as "0.5 years" in the copy.
    if (Number(step) === 1) v = Math.round(v);
    set(v); touched = true; render();
  });
  // Normalise what is shown once the user commits, so the field never displays
  // something different from the value the model actually used.
  inp.addEventListener('change', () => {
    const cur = get();
    if (Number.isFinite(cur) && String(cur) !== inp.value) inp.value = cur;
  });
  const box = suffix
    ? el('div', { class:'withSuffix' }, [inp, el('span', { class:'suffix', text:suffix })])
    : inp;
  const f = el('div', { class:'field' }, [el('span', { class:'flabel', text:label }), box]);
  f._update = () => { if (document.activeElement !== inp) inp.value = get(); };
  return f;
}
function seg(label, opts, get, set, help, column) {
  const box = el('div', { class:'seg' + (column ? ' col' : ''), role:'group' });
  const btns = [];
  opts.forEach((o, i) => {
    const b = el('button', { type:'button', text:o });
    b.addEventListener('click', () => { set(i); touched = true; render(); });
    box.appendChild(b); btns.push(b);
  });
  /* The pressed state must be re-read on every render, not just at build time:
     most of these controls do not rebuild the rail, so without this the model
     recomputes but the button never lights up and the click looks dead. */
  const paint = () => btns.forEach((b,i) => b.setAttribute('aria-pressed', String(get() === i)));
  paint();
  const kids = [];
  if (label) {
    const lab = el('span', { class:'flabel', text:label });
    if (help) {
      const q = el('button', { class:'qmark', type:'button', text:'?',
                               'aria-label':label, 'aria-expanded':'false' });
      const h = el('div', { class:'help', hidden:'' , text:help });
      q.addEventListener('click', () => {
        h.hidden = !h.hidden;
        q.setAttribute('aria-expanded', String(!h.hidden));
      });
      lab.appendChild(q);
      kids.push(lab, box, h);
    } else kids.push(lab, box);
  } else kids.push(box);
  const f = el('div', { class:'field seg-field' }, kids);
  f._update = paint;
  return f;
}
function slider(label, get, set, min, max, step, fmt, lo, hi, readoutFn) {
  const val = el('span', { class:'val', text:fmt(get()) });
  const inp = el('input', { type:'range', min, max, step, 'aria-label':label });
  inp.value = get();
  const ro = el('div', { class:'readout' });
  const upd = () => { val.textContent = fmt(get()); if (readoutFn) ro.innerHTML = readoutFn(); };
  inp.addEventListener('input', () => { set(parseFloat(inp.value)); touched = true; render(); });
  const f = el('div', { class:'field slider' }, [
    el('div', { class:'top' }, [el('span', { class:'flabel', text:label }), val]),
    inp,
    el('div', { class:'scale' }, [el('span',{text:lo}), el('span',{text:hi})]),
    readoutFn ? ro : null,
  ]);
  f._update = upd; upd();
  return f;
}
function stepBox(n, title, kids, open) {
  const s = el('details', { class:'step' });
  if (open) s.setAttribute('open','');
  s.appendChild(el('summary', {}, [el('span',{class:'stepnum',text:String(n)}), document.createTextNode(' '+title)]));
  s.appendChild(el('div', { class:'stepbody' }, kids));
  return s;
}

function personBlock(i) {
  const p = S.people[i];
  const title = i === 0 ? T.s2 : T.s2b;
  const byNow = () => CY - p.age;
  const kids = [
    el('div', { class:'row2' }, [
      fieldNum(T.age, ()=>p.age, v=>{
        p.age = Math.max(18, Math.min(95, v));
        const pa = Math.round(C.pensionAgeFor(CY - p.age));
        p.pensionAge = pa;
        if (p.workUntilAge > pa) p.workUntilAge = pa;
      }, 18, 95, 1),
      fieldMoney(T.salary, ()=>p.salary, v=>p.salary=Math.max(0,v)),
    ]),
    seg(T.sex, [T.male, T.female], ()=>p.sex-1, v=>p.sex=v+1, T.sexHelp),
    seg(T.health, T.healthOpts, ()=>p.health, v=>p.health=v, T.healthHelp),
    seg(T.trajectory, T.trajOpts, ()=>p.trajectory, v=>p.trajectory=v, T.trajHelp),
    seg(T.jobRisk, T.jobRiskOpts, ()=>p.jobRisk ?? 1, v=>p.jobRisk=v, T.jobRiskHelp),
    el('div', { class:'readout', id:'jobrisk-out-'+i }),
    el('div', { class:'row2' }, [
      fieldNum(T.stopWork, ()=>p.workUntilAge, v=>p.workUntilAge=Math.max(p.age, Math.min(85, v)), p.age, 85, 1),
      fieldNum(T.pensionStarts, ()=>p.pensionAge, v=>p.pensionAge=Math.max(50, Math.min(85, v)), 50, 85, 1),
    ]),
    el('div', { class:'hint', text: T.pensionAuto + ': ' + Math.round(C.pensionAgeFor(byNow())) }),
    fieldNum(T.employerPension, ()=>Math.round(p.employerPensionRate*1000)/10,
             v=>p.employerPensionRate=v/100, 0, 30, 0.5, '%'),
  ];
  return el('div', { class:'person' }, [el('h4', { text:title }), ...kids]);
}

function buildRail() {
  const rail = document.getElementById('rail');
  rail.innerHTML = '';

  rail.appendChild(stepBox(1, T.s1, [
    seg(null, [T.justMe, T.couple], ()=>S.couple?1:0, v=>{
      const now = !!v;
      if (now !== S.couple) S.cbar = Math.round(now ? S.cbar / SINGLE_EQUIV : S.cbar * SINGLE_EQUIV);
      S.couple = now;
    }),
  ], true));

  const people = [personBlock(0)];
  if (S.couple) people.push(personBlock(1));
  rail.appendChild(stepBox(2, S.couple ? T.s2 + ' + ' + T.s2b : T.s2, people, true));

  const sav = S.savings;
  rail.appendChild(stepBox(3, T.s3, [
    fieldMoney(T.essentials, ()=>S.cbar, v=>S.cbar=Math.max(0,v),
              S.own ? T.essentialsHelp : T.essentialsHelpRent),
    el('div', { class:'field' }, [
      el('span', { class:'flabel', text:T.savings }),
      el('div', { class:'row2' }, [
        fieldMoney(T.savShares, ()=>sav.shares, v=>sav.shares=Math.max(0,v)),
        fieldMoney(T.savBonds, ()=>sav.bonds, v=>sav.bonds=Math.max(0,v)),
        fieldMoney(T.savCash, ()=>sav.cash, v=>sav.cash=Math.max(0,v)),
        fieldMoney(T.savPension, ()=>sav.pension, v=>sav.pension=Math.max(0,v)),
      ]),
      el('div', { class:'hint', text:T.savHelp }),
      el('div', { class:'hint', text:T.pensionPotNote }),
    ]),
  ], true));

  const homeKids = [ seg(T.ownHome, [T.rent, T.own], ()=>S.own?1:0, v=>S.own=!!v,
                        S.own ? T.homeHelp : T.homeHelpRent) ];
  if (S.own) {
    homeKids.push(
      el('div', { class:'row2' }, [
        fieldMoney(T.homeValue, ()=>S.homeValue, v=>S.homeValue=Math.max(0,v)),
        fieldMoney(T.mortgageBalance, ()=>S.mortgageBalance, v=>S.mortgageBalance=Math.max(0,v)),
      ]),
      el('div', { class:'row2' }, [
        fieldNum(T.mortgageRate, ()=>Math.round(S.mortgageRate*1000)/10, v=>S.mortgageRate=v/100, -2, 15, 0.1, '%'),
        fieldNum(T.mortgageYears, ()=>S.mortgageYears, v=>S.mortgageYears=Math.max(0,Math.min(50,v)), 0, 50, 1),
      ]),
      el('div', { class:'hint', text:T.rateHelp }),
      seg(T.downsize, [T.no, T.yes], ()=>S.downsize?1:0, v=>S.downsize=!!v, T.downsizeHelp)
    );
    if (S.downsize) homeKids.push(el('div', { class:'row2' }, [
      fieldNum(T.downsizeAge, ()=>S.downsizeAge, v=>S.downsizeAge=Math.max(50,Math.min(95,v)), 50, 95, 1),
      fieldNum(T.downsizeRelease, ()=>Math.round(S.downsizeRelease*100), v=>S.downsizeRelease=v/100, 0, 100, 5, '%'),
    ]));
  }
  rail.appendChild(stepBox(4, T.s4, homeKids, true));

  const riskBox = el('div', { class:'qbox' }, [
    el('div', { class:'qt', text:T.qRisk }),
    el('div', { class:'qb', html:T.qRiskBody }),
  ]);
  const riskSlider = slider('', ()=>S.riskPay*100, v=>S.riskPay=v/100, 0.5, 20, 0.5,
    v=>v.toFixed(1)+'%', T.qRiskNothing, T.qRiskLots,
    () => {
      const th = thetaFromAnswer();
      const fw = lastR
        ? (lastR.years[0].equityShareCon == null ? T.noSavingsShort : pct(lastR.years[0].equityShareCon))
        : '—';
      return fill(T.riskReadout, { eq: pct(Math.min(1,th)), fw })
        + '<br><span style="opacity:.8">' + fill(T.riskFootnote, { g: riskAversionFromGamble(S.riskPay).toFixed(1) }) + '</span>';
    });
  riskBox.appendChild(riskSlider);

  rail.appendChild(stepBox(5, T.s5, [
    riskBox,
    seg(T.qShape, T.qShapeOpts, ()=>S.shape, v=>S.shape=v, T.qShapeHelp, true),
    el('div', { class:'readout', id:'shape-out' }),
    seg(T.qSmooth, T.qSmoothOpts, ()=>S.smooth, v=>S.smooth=v, T.qSmoothHelp, true),
    slider(T.qAnnuity, ()=>S.alpha*100, v=>S.alpha=v/100, 0, 100, 5, v=>v.toFixed(0)+'%',
           T.annNone, T.annAll, ()=>T.annHelp),
    el('div', { class:'readout', id:'ann-out' }),
    seg(T.qBequest, T.beqOpts, ()=>({none:0,fixed:1,opt:2})[S.beqMode],
        v=>S.beqMode=['none','fixed','opt'][v], T.beqHelp, true),
    S.beqMode === 'fixed' ? fieldMoney(T.beqAmount, ()=>S.beqFixed, v=>S.beqFixed=Math.max(0,v)) : null,
    S.beqMode === 'opt'
      ? seg(T.beqWeight, T.beqWeightOpts, ()=>S.beqWeight ?? 1, v=>S.beqWeight=v, T.beqWeightHelp, true)
      : null,
    S.beqMode !== 'none' ? el('div', { class:'readout', id:'beq-out' }) : null,
  ].filter(Boolean), true));

  rail.appendChild(stepBox(6, T.s6, [
    slider(T.fee, ()=>S.fee*100, v=>S.fee=v/100, 0, 3, 0.05, v=>v.toFixed(2)+'%',
           '0%', '3%', () => {
             if (!lastR || !lastR._fee) return T.feeHelp;
             return fill(T.feeReadout, { loss: money(lastR._fee.annualLoss),
                                         pct: pct(lastR._fee.pctLoss,1) });
           }),
    el('div', { class:'hint', text:T.feeHelp }),
    el('div', { class:'row2' }, [
      fieldNum(T.rf, ()=>Math.round(S.rf*1000)/10, v=>S.rf=v/100, -2, 8, 0.1, '%'),
      fieldNum(T.horizon, ()=>S.maxAge, v=>S.maxAge=Math.max(70,Math.min(115,v)), 70, 115, 1),
    ]),
    (() => {
      /* A readout rather than a hint: it has to move when the rate moves. */
      const box = el('div', { class:'field readout' });
      box._update = () => {
        const r = impliedReturns(S.rf);
        box.innerHTML = fill(T.rfImplied, {
          eq: pct(r.eq, 1), geo: pct(r.eqGeo, 1), sd: pct(r.sdEq, 0), bond: pct(r.bond, 1),
        }) + '<br><span style="opacity:.85">' + T[BUILD.country === 'CZ' ? 'rfSourceCZ' : 'rfSourceUK'] + '</span>';
      };
      box._update();
      return box;
    })(),
    /* The insurer's margin lives here rather than in the insurance panel: it
       decides the answer, but asking a normal person for it produces a guess
       dressed as an input. Estimated by occupation, visible and overridable. */
    slider(T.ipLoading, () => Math.round(effLoading(0) * 100),
           v => { S.loadingOverride = v / 100; }, 0, 150, 5, v => v.toFixed(0) + '%',
           '0%', '150%',
           () => fill(T.ipLoadingHelp, {
             est: (S.couple ? S.people : [S.people[0]])
                    .map((p, i) => `${pct(marketLoading(BUILD.country, p.occClass ?? 0))} ` +
                                  `(${i === 0 ? T.s2 : T.s2b})`).join(', '),
             src: S.loadingOverride == null ? T.ipLoadingAuto : T.ipLoadingManual,
           })),
  ], false));
}

/* ------------------------------------------------------------ walkthrough */
/* The model contains one idea most people have never met, and a page full of
   controls is a poor way to meet it. Five steps, one idea each, one control
   each — driving the real model, so the charts below move as the reader plays.
   It borrows the state rather than taking it: whatever the reader does here can
   be kept or handed back at the end. */
let tour = null;   // { step, saved }

const TOUR = [
  { t:'tour1T', b:'tour1B',
    control: () => slider(T.tourAge, () => S.people[0].age, v => {
      S.people[0].age = Math.round(v);
      const pa = Math.round(C.pensionAgeFor(CY - S.people[0].age));
      S.people[0].pensionAge = pa;
      if (S.people[0].workUntilAge > pa) S.people[0].workUntilAge = pa;
    }, 22, 70, 1, v => v.toFixed(0), '22', '70'),
    fig: R => ({ k: T.rowHC, v: moneyK(R.H0),
                 n: fill(T.tour1Fig, { p: pct(R.H0 / Math.max(1, R.F0 + R.H0)) }) }) },

  { t:'tour2T', b:'tour2B',
    control: () => seg(T.jobRisk, T.jobRiskOpts, () => S.people[0].jobRisk ?? 1,
                       v => S.people[0].jobRisk = v, T.jobRiskHelp, true),
    fig: R => ({ k: T.cardEquity,
                 v: R.years[0].equityShareCon == null ? T.noSavingsShort
                    : pct(R.years[0].equityShareCon),
                 n: T.tour2Fig }) },

  { t:'tour3T', b:'tour3B',
    control: () => slider(T.tourRisk, () => S.riskPay * 100, v => S.riskPay = v / 100,
                          0.5, 20, 0.5, v => v.toFixed(1) + '%', T.qRiskNothing, T.qRiskLots),
    fig: R => ({ k: T.cardEquity,
                 v: R.years[0].equityShareCon == null ? T.noSavingsShort
                    : pct(R.years[0].equityShareCon),
                 n: fill(T.tour3Fig, { g: riskAversionFromGamble(S.riskPay).toFixed(1) }) }) },

  { t:'tour4T', b:'tour4B',
    // Nobody can stop working before today, so the floor is the reader's age.
    control: () => slider(T.stopWork, () => S.people[0].workUntilAge,
                          v => S.people[0].workUntilAge = Math.round(v),
                          S.people[0].age, 80, 1, v => v.toFixed(0),
                          String(S.people[0].age), '80'),
    fig: R => ({ k: T.heroLabel, v: money(R.CD0),
                 n: fill(T.tour4Fig, { m: money(R.CD0 / 12) }) }) },

  { t:'tour5T', b:'tour5B',
    control: () => seg(T.ipOcc, T.ipOccOpts, () => S.people[0].occClass ?? 0,
                       v => { S.people[0].occClass = v; }, T.ipOccHelp, true),
    fig: () => {
      const r = (ipLast || []).filter(Boolean)[0];
      if (!r) return { k: T.ipProb, v: '—', n: '' };
      return { k: T.ipProb, v: pct(r.probability, 1),
               n: fill(T.tour5Fig, { c: r.bestCover > 0 ? money(r.bestCover) : T.cardIPNothingV }) };
    } },
];

function startTour() {
  tour = { step: 0, saved: JSON.parse(JSON.stringify(S)) };
  buildTour(); render();
  document.getElementById('tour')?.scrollIntoView({ block:'start' });
}
/** keep = true leaves the reader wherever the walkthrough took them. */
function endTour(keep) {
  const saved = tour?.saved;
  tour = null;
  if (!keep && saved) {
    S = saved; compareWith = null;
    buildRail(); buildInsuranceControls(); setText(); buildScenarios();
  }
  buildTour(); render();
}

function buildTour() {
  const host = document.getElementById('tour');
  if (!host) return;
  host.innerHTML = '';
  if (!tour) { host.hidden = true; return; }
  host.hidden = false;
  const st = TOUR[tour.step], last = tour.step === TOUR.length - 1;

  const close = el('button', { class:'tclose', type:'button', text:T.tourClose });
  close.addEventListener('click', () => endTour(false));
  host.appendChild(el('div', { class:'thead' }, [
    el('div', { class:'eyebrow', text: fill(T.tourOf, { i: tour.step + 1, n: TOUR.length }) }),
    close,
  ]));
  host.appendChild(el('h2', { text: T[st.t] }));
  host.appendChild(el('p', { class:'tbody', html: T[st.b] }));

  const figBox = el('div', { class:'tfig', id:'tour-fig' });
  host.appendChild(el('div', { class:'tgrid' }, [
    el('div', { class:'tctl' }, [st.control()]),
    figBox,
  ]));

  const nav = el('div', { class:'tnav' });
  const back = el('button', { type:'button', text:T.tourBack });
  if (tour.step === 0) back.setAttribute('disabled', '');
  back.addEventListener('click', () => { tour.step--; buildTour(); render(); });
  nav.appendChild(back);
  if (last) {
    const keep = el('button', { class:'pri', type:'button', text:T.tourKeep });
    keep.addEventListener('click', () => endTour(true));
    const undo = el('button', { type:'button', text:T.tourRestore });
    undo.addEventListener('click', () => endTour(false));
    nav.appendChild(keep); nav.appendChild(undo);
  } else {
    const next = el('button', { class:'pri', type:'button', text:T.tourNext });
    next.addEventListener('click', () => { tour.step++; buildTour(); render(); });
    nav.appendChild(next);
  }
  const dots = el('div', { class:'dots' });
  TOUR.forEach((_, i) => dots.appendChild(el('i', { class: i === tour.step ? 'on' : '' })));
  nav.appendChild(dots);
  host.appendChild(nav);
}

/** The one figure the current step is about, refreshed with everything else. */
function paintTour(R) {
  if (!tour) return;
  const box = document.getElementById('tour-fig');
  if (!box) return;
  const f = TOUR[tour.step].fig(R);
  box.innerHTML = `<div class="k">${f.k}</div><div class="v">${f.v}</div>` +
                  (f.n ? `<div class="n">${f.n}</div>` : '');
}

/* -------------------------------------------------------------- scenarios */
/* "Retire at 62" against "retire at 67" is the question people actually have,
   and until now the tool could hold only one answer at a time. A saved scenario
   is a whole state; pinning one puts the difference on every figure below.

   Storage is per country, because a Czech scenario means nothing in the UK
   build, and every access is guarded: a browser in private mode throws on
   localStorage rather than returning null. */
const SCEN_KEY = 'lfp.scenarios.' + BUILD.country;
const SCEN_MAX = 12;
let scenarios = [], scenStore = true, compareWith = null;
// null = not yet chosen by the reader, so follow whether anything is saved.
let scenOpen = null;

function scenLoadAll() {
  let raw = null;
  // Storage being unavailable and its contents being unreadable are different
  // problems: only the first one is worth telling the user about.
  try { raw = localStorage.getItem(SCEN_KEY); }
  catch (e) { scenarios = []; scenStore = false; return; }
  try {
    scenarios = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(scenarios)) scenarios = [];
  } catch (e) { scenarios = []; }
  scenarios = scenarios.filter(s => s && typeof s.name === 'string' && s.state);
}
function scenPersist() {
  try { localStorage.setItem(SCEN_KEY, JSON.stringify(scenarios)); }
  catch (e) { scenStore = false; buildScenarios(); }
}
/** A deep copy, so later edits to the live state cannot reach back into a save. */
const scenSnapshot = () => JSON.parse(JSON.stringify(S));

/** Headline spending for a saved state — the one figure a chip can show. */
function scenFigure(st) {
  try {
    const R = new Household(buildParams(st), ctx).solve();
    return Number.isFinite(R.CD0) ? moneyK(R.CD0) : '—';
  } catch (e) { return '—'; }
}

function scenSave(name) {
  const nm = (name || '').trim().slice(0, 40) || T.scenUntitled;
  const at = scenarios.findIndex(x => x.name === nm);
  const rec = { name: nm, state: scenSnapshot() };
  if (at >= 0) scenarios[at] = rec;
  else { scenarios.unshift(rec); scenarios = scenarios.slice(0, SCEN_MAX); }
  scenPersist(); buildScenarios(); render();
}

function buildScenarios() {
  const box = document.getElementById('scenbar');
  if (!box) return;
  box.innerHTML = '';
  const wrap = el('details');
  wrap.open = scenOpen == null ? scenarios.length > 0 : scenOpen;
  wrap.addEventListener('toggle', () => { scenOpen = wrap.open; });
  wrap.appendChild(el('summary', { text: scenarios.length
    ? fill(T.scenSummaryN, { n: scenarios.length }) : T.scenSummary }));
  const inner = el('div', { class:'sinner' });
  const row = el('div', { class:'srow' });

  const inp = el('input', { type:'text', placeholder:T.scenNamePh, 'aria-label':T.scenNamePh,
                            maxlength:'40' });
  const go = () => { scenSave(inp.value); inp.value = ''; };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const btn = el('button', { class:'sbtn', type:'button', text:T.scenSave });
  btn.addEventListener('click', go);
  row.appendChild(inp); row.appendChild(btn);

  scenarios.forEach((sc, i) => {
    const on = compareWith === i;
    const chip = el('span', { class:'chip' + (on ? ' on' : '') });
    chip.appendChild(el('span', { class:'nm', text:sc.name }));
    chip.appendChild(el('span', { class:'fig', text:scenFigure(sc.state) }));
    const load = el('button', { type:'button', text:T.scenLoad });
    load.addEventListener('click', () => {
      tour = null; buildTour();
      S = JSON.parse(JSON.stringify(sc.state));
      touched = true; compareWith = null;
      buildRail(); buildInsuranceControls(); setText(); buildScenarios(); render();
    });
    const cmp = el('button', { type:'button', text: on ? T.scenComparing : T.scenCompare,
                               'aria-pressed': String(on) });
    cmp.addEventListener('click', () => {
      compareWith = on ? null : i; buildScenarios(); render();
    });
    const del = el('button', { class:'x', type:'button', text:'\u00d7',
                               'aria-label': T.scenDelete + ' ' + sc.name });
    del.addEventListener('click', () => {
      scenarios.splice(i, 1);
      if (compareWith === i) compareWith = null;
      else if (compareWith != null && compareWith > i) compareWith--;
      scenPersist(); buildScenarios(); render();
    });
    chip.appendChild(load); chip.appendChild(cmp); chip.appendChild(del);
    row.appendChild(chip);
  });

  inner.appendChild(row);
  const hint = !scenStore ? T.scenUnavailable : (scenarios.length ? T.scenHintSome : T.scenHintNone);
  inner.appendChild(el('div', { class:'shint', text:hint }));
  wrap.appendChild(inner);
  box.appendChild(wrap);
}

/** The pinned scenario solved, or null. Recomputed once per render. */
function comparedResult() {
  if (compareWith == null || !scenarios[compareWith]) return null;
  try {
    const p = buildParams(scenarios[compareWith].state);
    const R = new Household(p, ctx).solve();
    if (!Number.isFinite(R.CD0)) return null;
    // The state pension is attached after the solve for the live result too;
    // without it here the pension card silently never shows a difference.
    R._pension = p.people.reduce((s, person) => s + ctx.statePension(person, null), 0);
    return R;
  } catch (e) { return null; }
}

/** "+£1,240 vs Retire at 62", coloured, or the flat case said in words.
    dir: 1 more is better, -1 less is better, 0 neither — a bequest is a choice
    and an equity share is a recommendation, so neither gets a verdict colour. */
function deltaHTML(now, then, fmt, dir = 1) {
  if (then == null || now == null || !Number.isFinite(then) || !Number.isFinite(now)) return '';
  const name = scenarios[compareWith]?.name ?? '';
  const d = now - then;
  // Below a tenth of a percent the difference is not a difference.
  if (Math.abs(d) <= Math.abs(then) * 0.001) {
    return `<div class="delta flat">${fill(T.scenSame, { name })}</div>`;
  }
  const cls = dir === 0 ? 'flat' : ((d > 0) === (dir > 0) ? 'up' : 'dn');
  const sign = d > 0 ? '+' : '\u2212';
  return `<div class="delta ${cls}">${sign}${fmt(Math.abs(d))} ${fill(T.scenVs, { name })}</div>`;
}

/* ----------------------------------------------------------------- charts */
const CSSVAR = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function niceTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const span = max - min; if (span <= 0) return [min, min + 1];
  const raw = span/(count||5), mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw/mag;
  const step = (norm<1.5?1:norm<3?2:norm<7?5:10)*mag;
  const out=[]; for (let v=Math.ceil(min/step)*step; v<=max+step*.001; v+=step) out.push(v);
  return out;
}
function frame(id, o) {
  const svg = document.getElementById(id);
  const W = 900, H = o.H || 340, m = { t:14, r:16, b:36, l:70 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (n,a) => { const e = document.createElementNS(NS,n); for (const k in a) e.setAttribute(k,a[k]); return e; };
  const iw = W-m.l-m.r, ih = H-m.t-m.b;
  // Guard the scales. Whatever the inputs, an SVG coordinate must be a number:
  // a collapsed range or a non-finite value would otherwise reach the DOM.
  const xSpan = (o.x1 - o.x0) || 1;
  const ySpan = (o.y1 - o.y0) || 1;
  const clampY = m.t - 1000, clampYmax = m.t + ih + 1000;
  const x = v => Number.isFinite(v) ? m.l + (v-o.x0)/xSpan*iw : m.l;
  const y = v => {
    if (!Number.isFinite(v)) return m.t + ih;
    const r = m.t + ih - (v-o.y0)/ySpan*ih;
    return Math.max(clampY, Math.min(clampYmax, r));
  };
  const cid = 'clip-'+id;
  const defs = mk('defs',{}); const cp = mk('clipPath',{id:cid});
  cp.appendChild(mk('rect',{x:m.l,y:m.t-2,width:iw,height:ih+2}));
  defs.appendChild(cp); svg.appendChild(defs);
  const g = mk('g',{'clip-path':`url(#${cid})`}); svg.appendChild(g);
  return { svg, mk, x, y, m, iw, ih, W, H, clip:g };
}
function axes(F, o) {
  const grid = F.mk('g',{class:'grid'});
  for (const t of o.yTicks) {
    grid.appendChild(F.mk('line',{x1:F.m.l,x2:F.m.l+F.iw,y1:F.y(t),y2:F.y(t)}));
    const tx = F.mk('text',{x:F.m.l-8,y:F.y(t)+4,'text-anchor':'end'});
    tx.textContent = o.yFmt(t); F.svg.appendChild(tx);
  }
  F.svg.insertBefore(grid, F.svg.firstChild);
  const ax = F.mk('g',{class:'axis'});
  ax.appendChild(F.mk('line',{x1:F.m.l,x2:F.m.l+F.iw,y1:F.y(o.y0),y2:F.y(o.y0)}));
  F.svg.appendChild(ax);
  for (const t of o.xTicks) {
    const tx = F.mk('text',{x:F.x(t),y:F.m.t+F.ih+22,'text-anchor':'middle'});
    tx.textContent = Math.round(t); F.svg.appendChild(tx);
  }
}
const path = pts => pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
function line(F, pts, stroke, w, dash) {
  const a = { d: path(pts.map(p=>[F.x(p[0]),F.y(p[1])])), fill:'none', stroke,
              'stroke-width':w||2, 'stroke-linejoin':'round', 'stroke-linecap':'round' };
  if (dash) a['stroke-dasharray'] = dash;
  F.clip.appendChild(F.mk('path', a));
}
function band(F, a, b, fill, op) {
  const d = path(a.map(p=>[F.x(p[0]),F.y(p[1])])) + ' ' +
    b.slice().reverse().map(p=>'L'+F.x(p[0]).toFixed(1)+' '+F.y(p[1]).toFixed(1)).join(' ') + ' Z';
  F.clip.appendChild(F.mk('path',{d,fill,opacity:op==null?.16:op,stroke:'none'}));
}
function area(F, pts, y0, fill, op) {
  const d = path(pts.map(p=>[F.x(p[0]),F.y(p[1])]))
    + ` L ${F.x(pts[pts.length-1][0]).toFixed(1)} ${F.y(y0).toFixed(1)}`
    + ` L ${F.x(pts[0][0]).toFixed(1)} ${F.y(y0).toFixed(1)} Z`;
  F.clip.appendChild(F.mk('path',{d,fill,opacity:op==null?.18:op,stroke:'none'}));
}
function marker(F, xv, label, color) {
  F.clip.appendChild(F.mk('line',{x1:F.x(xv),x2:F.x(xv),y1:F.m.t,y2:F.m.t+F.ih,
    stroke:color,'stroke-width':1,'stroke-dasharray':'3 3',opacity:.6}));
  const t = F.mk('text',{x:F.x(xv)+4,y:F.m.t+11,'text-anchor':'start',fill:color,'font-size':'10.5'});
  t.textContent = label; F.svg.appendChild(t);
}
function note(F, text, color) {
  const t = F.mk('text',{x:F.m.l+F.iw-4,y:F.m.t+12,'text-anchor':'end',fill:color,'font-size':'10.5'});
  t.textContent = text; F.svg.appendChild(t);
}
function legend(id, items) {
  document.getElementById(id).innerHTML = items.map(i =>
    `<span><i class="swatch${i.band?' band':''}" style="background:${i.color}"></i>${i.label}</span>`).join('');
}

function drawSpend(R, cmp) {
  const teal=CSSVAR('--teal'), brick=CSSVAR('--brick'), ink3=CSSVAR('--ink-3');
  const ys=R.years, x0=ys[0].age, x1=ys[ys.length-1].age;
  const floor = y => y.essentials + y.mortgage;
  // Scale to the full 5th-95th band so the whole range of outcomes is visible.
  let ymax=0, y95=0;
  for (const y of ys) { y95=Math.max(y95, y.bandsConsump[0]+floor(y));
                        ymax=Math.max(ymax, y.totalConsump); }
  const yT = niceTicks(0, Math.max(y95, ymax*1.2)*1.02, 6);
  const F = frame('ch-spend', { x0,x1,y0:0,y1:yT[yT.length-1],H:340 });
  axes(F, { y0:0, yTicks:yT, xTicks:niceTicks(x0,x1,7).filter(v=>v>=x0&&v<=x1), yFmt:moneyK });
  const P = k => ys.map(y=>[y.age, y.bandsConsump[k]+floor(y)]);
  band(F,P(0),P(6),teal,.10); band(F,P(1),P(5),teal,.12); band(F,P(2),P(4),teal,.16);
  area(F, ys.map(y=>[y.age,floor(y)]), 0, brick, .22);
  line(F, ys.map(y=>[y.age,floor(y)]), brick, 1.75);
  line(F, ys.map(y=>[y.age,y.totalConsump]), teal, 2.25);
  /* The compared plan, dashed. Its ages need not line up with this one — the
     frame clips, which is the honest thing to do with a plan that starts or
     ends somewhere else. */
  const violet = CSSVAR('--violet');
  if (cmp) line(F, cmp.years.map(y=>[y.age,y.totalConsump]), violet, 1.9, '5 4');
  const rt = R.retYear;
  if (rt>0 && rt<=R.maxYear) marker(F, ys[rt].age, T.retire, ink3);

  const items = [{color:teal,label:T.legTotal},{color:teal,label:T.legRange,band:true},
                 {color:brick, label: R.L0Mort > 0 ? T.legFloor : T.legFloorRent}];
  if (cmp) items.push({ color:violet, label: scenarios[compareWith]?.name ?? '' });
  legend('leg-spend', items);
}
function drawWealth(R) {
  const teal=CSSVAR('--teal'), amber=CSSVAR('--amber'), brick=CSSVAR('--brick'),
        slate=CSSVAR('--slate'), ink3=CSSVAR('--ink-3');
  const ys=R.years, x0=ys[0].age, x1=ys[ys.length-1].age;
  let ymax=0, ymin=0;
  for (const y of ys){ ymax=Math.max(ymax,y.humanCapital,y.netWorth,y.finWealth);
                       ymin=Math.min(ymin,-y.liabilities); }
  const yT = niceTicks(ymin, ymax, 6);
  const F = frame('ch-wealth', { x0,x1,y0:yT[0],y1:yT[yT.length-1],H:340 });
  axes(F, { y0:yT[0], yTicks:yT, xTicks:niceTicks(x0,x1,7).filter(v=>v>=x0&&v<=x1), yFmt:moneyK });
  F.clip.appendChild(F.mk('line',{x1:F.m.l,x2:F.m.l+F.iw,y1:F.y(0),y2:F.y(0),stroke:ink3,'stroke-width':1}));
  area(F, ys.map(y=>[y.age,y.humanCapital]), 0, amber, .16);
  area(F, ys.map(y=>[y.age,-y.liabilities]), 0, brick, .16);
  line(F, ys.map(y=>[y.age,y.humanCapital]), amber, 2);
  line(F, ys.map(y=>[y.age,-y.liabilities]), brick, 2);
  line(F, ys.map(y=>[y.age,y.finWealth]), teal, 2.25);
  line(F, ys.map(y=>[y.age,y.netWorth]), slate, 2, '5 3');
  const rt=R.retYear; if (rt>0&&rt<=R.maxYear) marker(F, ys[rt].age, T.retire, ink3);
  legend('leg-wealth',[{color:amber,label:T.legHC},{color:teal,label:T.legSav},
                       {color:brick,label:T.legLiab},{color:slate,label:T.legNW}]);
}
function drawGlide(R) {
  const teal=CSSVAR('--teal'), ink3=CSSVAR('--ink-3'), violet=CSSVAR('--violet');
  const ys=R.years, x0=ys[0].age, x1=ys[ys.length-1].age;
  let peak=0; for (const y of ys) if (y.equityShareUncon != null) peak=Math.max(peak,y.equityShareUncon);
  const yT = niceTicks(0, 1.08, 5);
  const F = frame('ch-glide', { x0,x1,y0:0,y1:yT[yT.length-1],H:300 });
  axes(F, { y0:0, yTicks:yT, xTicks:niceTicks(x0,x1,7).filter(v=>v>=x0&&v<=x1), yFmt:v=>pct(v) });
  F.clip.appendChild(F.mk('line',{x1:F.m.l,x2:F.m.l+F.iw,y1:F.y(1),y2:F.y(1),
    stroke:violet,'stroke-width':1,'stroke-dasharray':'2 3',opacity:.7}));
  const defUn = ys.filter(y=>y.equityShareUncon != null);
  const defCon = ys.filter(y=>y.equityShareCon != null);
  if (defUn.length > 1) line(F, defUn.map(y=>[y.age,y.equityShareUncon]), ink3, 1.5, '4 3');
  if (defCon.length > 1) line(F, defCon.map(y=>[y.age,y.equityShareCon]), teal, 2.5);
  const rt=R.retYear; if (rt>0&&rt<=R.maxYear) marker(F, ys[rt].age, T.retire, ink3);
  if (peak>1.08) note(F, pct(peak), ink3);
  legend('leg-glide',[{color:teal,label:T.legCan},{color:ink3,label:T.legIdeal}]);
  const now=ys[0], atRet=ys[Math.min(rt,R.maxYear)];
  // Describe the shape the chart actually has rather than assuming it falls.
  let peakIdx = 0;
  ys.forEach((y,i)=>{ if ((y.equityShareCon ?? -1) > (ys[peakIdx].equityShareCon ?? -1)) peakIdx = i; });
  const humped = peakIdx > 2 && (ys[peakIdx].equityShareCon ?? 0) > (now.equityShareCon ?? 0) * 1.15;
  // Only blame the mortgage if there actually is one.
  const shape = !humped ? T.glideFalls
    : (R.L0Mort > 0 ? fill(T.glideHump, { a: ys[peakIdx].age })
                    : fill(T.glideHumpNoMortgage, { a: ys[peakIdx].age }));
  const fmtShare = v => v == null ? T.noSavingsShort : pct(v);
  document.getElementById('glide-note').innerHTML =
    `<b>${fmtShare(now.equityShareCon)}</b> ${BUILD.lang==='cs'?'dnes':'today'} → ` +
    `<b>${fmtShare(atRet.equityShareCon)}</b> (${T.retire}). ${shape}`;
}
function drawSurv(R) {
  const violet=CSSVAR('--violet'), teal=CSSVAR('--teal'), amber=CSSVAR('--amber');
  const ys=R.years, x0=ys[0].age, x1=ys[ys.length-1].age;
  const F = frame('ch-surv', { x0,x1,y0:0,y1:1,H:250 });
  axes(F, { y0:0, yTicks:[0,.25,.5,.75,1], xTicks:niceTicks(x0,x1,7).filter(v=>v>=x0&&v<=x1), yFmt:v=>pct(v) });
  area(F, ys.map(y=>[y.age,y.survHousehold]), 0, violet, .14);
  line(F, ys.map(y=>[y.age,y.survHousehold]), violet, 2.25);
  const items = [{color:violet,label:S.couple?T.legHH:T.chSurvSingle}];
  if (S.couple) {
    line(F, ys.map(y=>[y.age,y.survBoth]), amber, 1.75, '4 3');
    line(F, ys.map(y=>[y.age,y.survEach[0]]), teal, 1.25);
    items.push({color:amber,label:T.legBoth},{color:teal,label:T.legYou});
  }
  let med=ys[0].age; for (const y of ys) if (y.survHousehold>=0.5) med=y.age;
  marker(F, med, '50%', violet);
  legend('leg-surv', items);
}

/* -------------------------------------------------------------- headline */
function derivationHTML(R) {
  const rows = [
    ['', T.rowSavings, R.F0],
    ['+', T.rowHC, R.H0],
    ['−', T.rowEss, -R.L0Ess],
    R.L0Mort > 0 ? ['−', T.rowMort, -R.L0Mort] : null,
    R.L0Cash > 0 ? ['−', T.rowBeq, -R.L0Cash] : null,
  ].filter(Boolean);
  const body = rows.map(r =>
    `<tr><td><span class="op">${r[0]}</span>${r[1]}</td><td>${money(Math.abs(r[2]))}</td></tr>`).join('');
  return `<table>${body}
    <tr class="sum"><td>${T.rowNW}</td><td>${money(R.W0)}</td></tr>
    <tr><td><span class="op">÷</span>${T.divisorRow}</td><td>${R.D0.toFixed(1)}</td></tr>
    <tr class="sum"><td>${T.heroLabel}</td><td>${money(R.CD0)}</td></tr></table>`;
}
function drawHeadline(R, cmp) {
  const y0 = R.years[0];
  const c0 = cmp ? cmp.years[0] : null;
  const mortNote = R.mortgagePayment > 0 ? T.andMortgage : '';
  const cards = [
    { hero:true, k:T.heroLabel, accent:'var(--teal)',
      v:`${money(R.CD0)} <span style="font-size:.5em;font-weight:400;color:var(--ink-2)">${T.perYear}</span>`,
      n:fill(T.heroNote,{ m:money(R.CD0/12),
                          t:money(R.CD0 + y0.essentials + y0.mortgage), mort:mortNote }),
      d: cmp ? deltaHTML(R.CD0, cmp.CD0, money, 1) : '',
      why:true },
    { k:T.cardNetWorth, v:moneyK(R.W0), accent:'var(--slate)',
      n:`${moneyK(R.F0)} + ${moneyK(R.H0)} − ${moneyK(R.L0)}`,
      d: cmp ? deltaHTML(R.W0, cmp.W0, moneyK, 1) : '' },
    { k:T.cardEquity,
      v: y0.equityShareCon == null ? T.noSavingsShort : pct(y0.equityShareCon),
      accent:'var(--teal)',
      n: y0.equityShareCon == null ? T.noSavingsNote
         : (y0.equityShareUncon > 1.05 ? `${T.legIdeal}: ${pct(y0.equityShareUncon)}` : ''),
      d: cmp ? deltaHTML(y0.equityShareCon, c0.equityShareCon, v => pct(v, 1), 0) : '' },
    { k:T.cardPension, v:moneyK(R._pension), accent:'var(--amber)',
      n:`${C.code} · ${C.taxYear}`,
      d: cmp ? deltaHTML(R._pension, cmp._pension, moneyK, 1) : '' },
    /* Filled in by paintIPCard when the insurance solve lands — it is far too
       slow to run inside the headline redraw. */
    { k:T.cardIP, v:'—', accent:'var(--brick)', n:'', ip:true },
  ];
  if (S.beqMode !== 'none') cards.push(
    { k:T.cardBequest, v:moneyK(R.beq), accent:'var(--violet)', n:'',
      d: cmp ? deltaHTML(R.beq, cmp.beq, moneyK, 0) : '' });

  document.getElementById('headline').innerHTML = cards.map((c,i) =>
    `<div class="stat${c.hero?' hero':''}" style="--accent:${c.accent}">
       <div class="k"${c.ip?' id="ip-headline-k"':''}>${c.k}</div>
       <div class="v"${c.ip?' id="ip-headline-v"':''}>${c.v}</div>
       ${c.ip?'<div class="n" id="ip-headline-n"></div>':''}
       ${c.n?`<div class="n">${c.n}</div>`:''}
       ${c.d||''}
       ${c.why?`<button class="why noprint" id="whybtn">${T.explain}</button>
                <div class="derivation" id="deriv" hidden>${derivationHTML(R)}</div>`:''}
     </div>`).join('');
  const b = document.getElementById('whybtn');
  if (b) b.addEventListener('click', () => {
    const d = document.getElementById('deriv'); d.hidden = !d.hidden;
  });
}
function drawAlerts(R) {
  const A = [], y0 = R.years[0];
  if (R.CD0 <= 0) A.push({t:'crit',h:T.alertNoSolution,b:T.alertNoSolutionBody});
  else if (R.CD0 < S.cbar*0.08) A.push({t:'warn',h:T.alertThin,b:T.alertThinBody});
  for (const p of (S.couple ? S.people : [S.people[0]])) {
    if (p.workUntilAge < p.pensionAge) {
      A.push({ t:'warn', h:T.alertGap,
        b:fill(T.alertGapBody,{a:p.workUntilAge,b:p.pensionAge,y:p.pensionAge-p.workUntilAge}) });
      break;
    }
  }
  if (y0.equityShareCon != null && y0.equityShareCon < 0.15 && R.L0Mort > R.F0 * 0.8)
    A.push({ t:'warn', h:T.alertLowEq,
      b:fill(T.alertLowEqBody, { m: money(R.L0Mort), f: money(R.F0) }) });
  if (y0.equityShareCon == null)
    A.push({ t:'warn', h:T.noSavingsShort, b:T.noSavingsAlert });
  if (y0.equityShareUncon != null && y0.equityShareUncon > 3)
    A.push({t:'warn',h:T.alertEquity,b:fill(T.alertEquityBody,{p:pct(y0.equityShareUncon)})});
  if (BUILD.country === 'UK' && T.alertScotland)
    A.push({t:'warn',h:T.alertScotland,b:T.alertScotlandBody});
  document.getElementById('alerts').innerHTML =
    A.map(a=>`<div class="alert ${a.t}"><div><b>${a.h}</b> ${a.b}</div></div>`).join('');
}
/* Income protection priced from published incidence, sized from the household's
   own balance sheet. Slow enough (~0.5s) to run on demand rather than on every
   keystroke, so the headline card it feeds is painted separately when it lands. */
let ipTimer = null, ipLast = null;
/* One analysis per earner. Each is priced on their own occupation, their own
   hazard and the cover they already hold; the headline card carries the
   household total, because that is the cheque the household writes. Two solves
   for a couple, so it stays debounced and out of the keystroke path. */
function drawInsurance(force) {
  const box = document.getElementById('ip-results');
  if (!box) return;
  clearTimeout(ipTimer);
  ipTimer = setTimeout(() => {
    const p = buildParams();
    const rs = p.people.map((_, i) => {
      try { return insuranceAnalysis(p, ctx, { who: i, loading: effLoading(i) }); }
      catch (e) { return null; }
    });
    if (!rs.some(Boolean)) { box.innerHTML = ''; ipLast = null; paintIPCard(); return; }
    ipLast = rs;
    paintIPCard();
    box.innerHTML = rs.map((r, i) => r ? ipSectionHTML(r, i, rs.length > 1) : '').join('');
    const src = document.getElementById('ip-source');
    if (src) src.textContent = BUILD.country === 'CZ' ? T.ipSourceCZ : T.ipSourceUK;
  }, force ? 0 : 350);
}

/** The four stat cards and the explanatory note for one earner. */
function ipSectionHTML(r, i, named) {
  const held = r.existingCover > 0;
  const nothing = r.bestCover <= 0;
  const shareOfFull = r.needCover > 0 ? r.bestCover / r.needCover : 0;
  const list = [
    { k: named ? T.ipProbN : T.ipProb, v: pct(r.probability, 1), accent: 'var(--brick)' },
    { k: named ? T.ipNeedN : T.ipNeed, v: money(r.needCover), accent: 'var(--slate)' },
    { k: held ? T.ipBuyMore : T.ipBuy,
      v: nothing ? T.cardIPNothingV : money(r.extraCover), accent: 'var(--teal)' },
    { k: held ? T.ipPremiumExtra : (named ? T.ipPremiumN : T.ipPremium),
      v: nothing ? T.cardIPNothingV : money(r.extraPremium), accent: 'var(--amber)' },
  ];
  const cards = list.map(c =>
    `<div class="stat" style="--accent:${c.accent}">
       <div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');

  /* Campbell's rule: with a markup L and risk aversion gamma, stop insuring
     once the remaining exposure is L/gamma of your wealth — and do not insure
     at all anything smaller than that. Shown alongside what this person's loss
     actually is, because the point only lands with both numbers.

     The rule is a small-risk approximation and losing your earnings is not a
     small risk, so on extreme settings it declines something the exact solve
     still buys. Where they part company the copy says so rather than stating
     the rule's verdict as if it were the answer above it. */
  const verdict = r.worthInsuring ? T.ipSmallYes
    : (r.bestCover > r.needCover * 0.15 ? T.ipSmallApprox : T.ipSmallNo);
  const parts = [nothing ? T.ipNoteNone : fill(T.ipNote, { share: pct(shareOfFull) })];
  parts.push('<br><span style="opacity:.85">' + fill(named ? T.ipSmallRuleN : T.ipSmallRule, {
    load: pct(r.loading), rra: (1 / buildParams().eta).toFixed(0),
    thr: pct(r.selfInsureThreshold),
    loss: pct(r.uninsuredDrop),
    verdict: fill(verdict, { buy: money(r.bestCover) }),
  }) + '</span>');
  if (r.overInsured) parts.push('<br><b>' + fill(named ? T.ipOverN : T.ipOver, {
    have: money(r.existingCover), want: money(r.bestCover) }) + '</b>');

  return (named ? `<div class="eyebrow" style="margin:4px 0 7px">${i === 0 ? T.s2 : T.s2b}</div>` : '')
    + `<div class="headline" style="margin-bottom:12px">${cards}</div>`
    + `<div class="note" style="margin-bottom:18px">${parts.join('')}</div>`;
}

/* The headline card is painted whenever the (slow) analysis lands, and left
   showing its previous value in between rather than flickering to a dash. */
function paintIPCard() {
  const v = document.getElementById('ip-headline-v');
  const k = document.getElementById('ip-headline-k');
  const n = document.getElementById('ip-headline-n');
  if (!v) return;
  if (!ipLast || !ipLast.length) { v.textContent = '—'; if (n) n.textContent = ''; return; }
  const rs = ipLast.filter(Boolean);
  const extraCover = rs.reduce((a, r) => a + r.extraCover, 0);
  const extraPrem  = rs.reduce((a, r) => a + r.extraPremium, 0);
  const anyWorth   = rs.some(r => r.bestCover > 0);
  const anyHeld    = rs.some(r => r.existingCover > 0);
  /* Two zeros that mean opposite things: at this margin no cover is worth
     buying at all, versus you already hold what the plan calls for. Printing a
     money figure for the first read as a recommendation to buy a token amount,
     directly above prose telling the reader to carry the risk themselves. */
  if (!anyWorth) {
    if (k) k.textContent = T.cardIP;
    v.textContent = T.cardIPNothingV;
    if (n) n.textContent = T.cardIPNothing;
    return;
  }
  v.textContent = moneyK(extraCover);
  if (k) k.textContent = anyHeld ? T.cardIPMore : T.cardIP;
  if (n) n.textContent = extraCover <= 0
    ? T.cardIPNone
    : fill(T.cardIPNote, { prem: money(extraPrem) });
  if (tour && lastR) paintTour(lastR);
}

/* One occupation answer and one cover figure per earner. Sharing them across a
   couple meant a doctor married to a builder got a single occupation class. */
function buildInsuranceControls() {
  const box = document.getElementById('ip-controls');
  if (!box) return;
  box.innerHTML = '';
  const people = S.couple ? S.people : [S.people[0]];
  const blockFor = (p, i) => {
    const kids = [
      seg(T.ipOccN, T.ipOccOpts, () => p.occClass ?? 0,
          v => { p.occClass = v; render(); }, T.ipOccHelp, true),
      fieldMoney(T.ipHaveN, () => p.existingCover ?? 0,
                 v => p.existingCover = Math.max(0, v), T.ipHaveHelpN),
    ];
    return S.couple
      ? el('div', { class:'person' }, [el('h4', { text: i === 0 ? T.s2 : T.s2b }), ...kids])
      : el('div', {}, kids);
  };
  if (S.couple) {
    box.className = 'row2';
    box.style.maxWidth = '';
    people.forEach((p, i) => box.appendChild(blockFor(p, i)));
  } else {
    box.className = 'row2';
    box.style.maxWidth = '640px';
    box.appendChild(seg(T.ipOcc, T.ipOccOpts, () => S.people[0].occClass ?? 0,
                        v => { S.people[0].occClass = v; render(); }, T.ipOccHelp, true));
    box.appendChild(fieldMoney(T.ipHave, () => S.people[0].existingCover ?? 0,
                               v => S.people[0].existingCover = Math.max(0, v), T.ipHaveHelp));
  }
}

function drawBalanceSheet(R) {
  const tot = R.F0 + R.H0;
  const pc = v => tot>0 ? pct(v/tot,1) : '—';
  const row = (k,v,total) =>
    `<tr${total?' class="total"':''}><td>${k}</td><td class="num">${money(v)}</td><td class="num">${pc(v)}</td></tr>`;
  document.getElementById('bs-assets').innerHTML =
    `<thead><tr><th></th><th>${T.value}</th><th>${T.share}</th></tr></thead><tbody>` +
    row(T.rowSavings,R.F0) + row(T.rowHC,R.H0) + row(T.rowTotal,tot,true) + '</tbody>';
  let liab = row(T.rowEss,R.L0Ess);
  if (R.L0Mort>0) liab += row(T.rowMort,R.L0Mort);
  if (R.L0Cash>0) liab += row(T.rowBeq,R.L0Cash);
  document.getElementById('bs-liab').innerHTML =
    `<thead><tr><th></th><th>${T.value}</th><th>${T.share}</th></tr></thead><tbody>` +
    liab + row(T.rowNW,R.W0) + row(T.rowTotal,tot,true) + '</tbody>';
}

/* ----------------------------------------------------------------- render */
function render() {
  let R;
  const bail = () => {
    // Keep the last good results on screen and explain what happened, rather
    // than replacing the whole page with a single line.
    document.getElementById('alerts').innerHTML =
      `<div class="alert crit"><div><b>${T.alertNoSolution}</b> ${T.alertNoSolutionBody}</div></div>`;
  };
  try { R = new Household(buildParams(), ctx).solve(); }
  catch (e) { bail(); return; }
  if (!Number.isFinite(R.CD0)) { bail(); return; }
  // Fee impact and headline state pension, computed once per render.
  const p = buildParams();
  try {
    const noFee = new Household({ ...p, fee: 0 }, ctx).solve();
    R._fee = { annualLoss: noFee.CD0 - R.CD0,
               pctLoss: noFee.CD0>0 ? (noFee.CD0-R.CD0)/noFee.CD0 : 0 };
  } catch { R._fee = null; }
  R._pension = p.people.reduce((s,person)=>s + ctx.statePension(person, null), 0);

  lastR = R;
  // One extra solve per render when a scenario is pinned; the model runs in
  // under 2 ms, so the comparison is live rather than a button you press.
  const cmp = comparedResult();
  drawHeadline(R, cmp); drawAlerts(R); paintIPCard(); paintTour(R);
  drawSpend(R, cmp); drawWealth(R); drawGlide(R); drawSurv(R); drawBalanceSheet(R); drawInsurance();

  const so = document.getElementById('shape-out');
  if (so) so.innerHTML = fill(T.shapeReadout, { g: pct(R.g, 1) });
  const beqBox = document.getElementById('beq-out');
  if (beqBox && S.beqMode !== 'none' && R.beq > 0) {
    // What the bequest costs, in the currency people actually feel: spending.
    let noBeq = null;
    try { noBeq = new Household({ ...buildParams(), beqMode:'none' }, ctx).solve(); } catch (e) {}
    const perYr = noBeq ? money(noBeq.CD0 - R.CD0) : '—';
    beqBox.innerHTML = fill(S.beqMode === 'opt' ? T.beqOptReadout : T.beqCostNote,
      { beq: money(R.beq), cost: money(R.L0Cash), peryr: perYr });
  } else if (beqBox) beqBox.innerHTML = '';

  // Promote the longevity point: the declining spending line IS the cost of
  // not insuring against living a long time.
  const annBox = document.getElementById('ann-out');
  if (annBox) {
    const c0 = R.years[0].discConsump;
    const late = R.years[R.years.length - 11]?.discConsump ?? c0;
    annBox.innerHTML = T.annReadout + '<br><span style="opacity:.85">' +
      fill(T.annPathNote, { a: pct(S.alpha), r: pct(c0 > 0 ? late / c0 : 0) }) + '</span>';
  }

  (S.couple ? S.people : [S.people[0]]).forEach((p, i) => {
    const box = document.getElementById('jobrisk-out-' + i);
    if (!box) return;
    const eq = EQ_HC_BY_JOB[p.jobRisk ?? 1];
    box.innerHTML = fill(T.jobRiskReadout,
      { eq: pct(eq), note: eq <= 0.15 ? T.jobRiskNoteLow : T.jobRiskNoteHigh });
  });
  // Refresh every control's visible state without rebuilding the rail.
  document.querySelectorAll('.field').forEach(f => f._update && f._update());
  writeURL();
}

/** Header shown only on the printed page. Filled on load and before printing
    so it is present however the user reaches the print dialog. */
function fillPrintHeader() {
  const h = document.getElementById('printhead');
  if (!h) return;
  h.innerHTML =
    `<div style="margin-bottom:14px">
       <div class="eyebrow">${T.summaryFor} &middot; ${C.code} &middot; ${C.taxYear}</div>
       <div style="font-family:var(--serif);font-size:20px;font-weight:600">${T.title}</div>
       <div style="font-size:11px;color:var(--ink-3)">${T.printedOn} ${new Date().toLocaleDateString(C.locale)}
         &middot; ${T.disclaimerBold}</div>
     </div>`;
}

/* -------------------------------------------------------------- url state */
function writeURL() {
  const q = new URLSearchParams();
  const D = freshState();
  const put = (k,v,d)=>{ if (v !== d) q.set(k, typeof v==='number' ? String(+v.toFixed(4)) : String(v)); };
  put('c', S.couple?1:0, 0);
  S.people.forEach((p,i)=>{
    if (i===1 && !S.couple) return;
    const d = D.people[i];
    put(`a${i}`,p.age,d.age); put(`s${i}`,p.sex,d.sex); put(`h${i}`,p.health,d.health);
    put(`j${i}`,p.trajectory,d.trajectory); put(`y${i}`,p.salary,d.salary);
    put(`k${i}`,p.jobRisk,d.jobRisk);
    put(`w${i}`,p.workUntilAge,d.workUntilAge); put(`p${i}`,p.pensionAge,d.pensionAge);
    put(`e${i}`,p.employerPensionRate,d.employerPensionRate);
    put(`oc${i}`,p.occClass,d.occClass); put(`ic${i}`,p.existingCover,d.existingCover);
  });
  put('cb',S.cbar,D.cbar);
  put('vs',S.savings.shares,D.savings.shares); put('vb',S.savings.bonds,D.savings.bonds);
  put('vc',S.savings.cash,D.savings.cash); put('vp',S.savings.pension,D.savings.pension);
  put('ho',S.own?1:0,1); put('hv',S.homeValue,D.homeValue); put('hm',S.mortgageBalance,D.mortgageBalance);
  put('hr',S.mortgageRate,D.mortgageRate); put('hy',S.mortgageYears,D.mortgageYears);
  put('dz',S.downsize?1:0,0); put('da',S.downsizeAge,D.downsizeAge); put('dr',S.downsizeRelease,D.downsizeRelease);
  put('rk',S.riskPay,D.riskPay); put('sh',S.shape,D.shape); put('sm',S.smooth,D.smooth);
  put('al',S.alpha,D.alpha); put('bq',S.beqMode,D.beqMode); put('bf',S.beqFixed,D.beqFixed); put('bw',S.beqWeight,D.beqWeight);
  put('fe',S.fee,D.fee); put('rf',S.rf,D.rf); put('ma',S.maxAge,D.maxAge);
  if (S.loadingOverride != null) q.set('ld', String(S.loadingOverride));
  const s = q.toString();
  /* An origin-less document — a sandboxed iframe, a data: URL, some local
     viewers — forbids replaceState outright. This is the last thing render()
     does, so the throw left the page drawn but every recalculation raising an
     uncaught error, and the share button copying a link with no scenario in it.
     Fail quietly: the scenario is still on screen, only the link is lost. */
  try { history.replaceState(null,'', s ? '?'+s : location.pathname); }
  catch (e) { urlWritable = false; }
}
/* A link is the one route into the model that does not pass through an input
   field, so every bound the fields enforce has to be enforced again here. The
   ranges below mirror buildRail(). Without them a hand-edited or stale link
   could put an employer contribution of -500000% into the model, which is the
   same class of defect the fields themselves were hardened against. */
function readURL() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  touched = true;
  const num = (k,f,lo,hi,whole)=>{
    if (!q.has(k)) return;
    let v = parseFloat(q.get(k));
    if (!Number.isFinite(v)) return;
    v = Math.max(lo, Math.min(hi, v));
    if (whole) v = Math.round(v);
    f(v);
  };
  const CASH = 1e12;
  num('c',v=>S.couple=!!v,0,1,true);
  for (let i=0;i<2;i++){
    const p=S.people[i];
    num(`a${i}`,v=>p.age=v,18,95,true); num(`s${i}`,v=>p.sex=v,1,2,true);
    num(`h${i}`,v=>p.health=v,0,3,true); num(`j${i}`,v=>p.trajectory=v,0,2,true);
    num(`y${i}`,v=>p.salary=v,0,CASH); num(`k${i}`,v=>p.jobRisk=v,0,3,true);
    num(`w${i}`,v=>p.workUntilAge=v,18,85,true);
    num(`p${i}`,v=>p.pensionAge=v,50,85,true);
    num(`e${i}`,v=>p.employerPensionRate=v,0,0.3);
    num(`oc${i}`,v=>p.occClass=v,0,3,true); num(`ic${i}`,v=>p.existingCover=v,0,CASH);
    // The field ties these two together; a link can set them independently.
    p.workUntilAge = Math.max(p.age, p.workUntilAge);
  }
  num('cb',v=>S.cbar=v,0,CASH);
  num('vs',v=>S.savings.shares=v,0,CASH); num('vb',v=>S.savings.bonds=v,0,CASH);
  num('vc',v=>S.savings.cash=v,0,CASH); num('vp',v=>S.savings.pension=v,0,CASH);
  num('ho',v=>S.own=!!v,0,1,true); num('hv',v=>S.homeValue=v,0,CASH);
  num('hm',v=>S.mortgageBalance=v,0,CASH);
  num('hr',v=>S.mortgageRate=v,-0.02,0.15); num('hy',v=>S.mortgageYears=v,0,50,true);
  num('dz',v=>S.downsize=!!v,0,1,true); num('da',v=>S.downsizeAge=v,50,95,true);
  num('dr',v=>S.downsizeRelease=v,0,1);
  num('rk',v=>S.riskPay=v,0.005,0.20); num('sh',v=>S.shape=v,0,2,true);
  num('sm',v=>S.smooth=v,0,2,true); num('al',v=>S.alpha=v,0,1);
  num('fe',v=>S.fee=v,0,0.03); num('rf',v=>S.rf=v,-0.02,0.08);
  num('ma',v=>S.maxAge=v,70,115,true);
  /* Occupation and cover were household-level until they became per-person.
     Links minted before that carry the old keys; read them onto the first
     earner so a shared scenario does not quietly lose them. */
  if (!q.has('oc0')) num('oc',v=>S.people[0].occClass=v,0,3,true);
  if (!q.has('ic0')) num('ic',v=>S.people[0].existingCover=v,0,CASH);
  num('ld',v=>S.loadingOverride=v,0,1.5);
  if (['none','fixed','opt'].includes(q.get('bq'))) S.beqMode=q.get('bq');
  num('bf',v=>S.beqFixed=v,0,CASH); num('bw',v=>S.beqWeight=v,0,2,true);
}

/* ------------------------------------------------------------------- init */
function setText() {
  const set=(id,v,html)=>{ const e=document.getElementById(id); if(e){ if(html) e.innerHTML=v; else e.textContent=v; } };
  document.documentElement.lang = BUILD.lang;
  set('t-title', T.title);
  set('t-sub', T.sub);
  set('t-discb', T.disclaimerBold); set('t-disc', T.disclaimer);
  set('print', T.print); set('share', T.copyLink); set('reset', T.reset); set('theme', T.theme);
  set('tourbtn', T.tourStart);
  set('t-chSpend', T.chSpend); set('t-chSpendD', S.own ? T.chSpendDesc : T.chSpendDescRent);
  set('t-chWealth', T.chWealth); set('t-chWealthD', T.chWealthDesc);
  set('t-chGlide', T.chGlide); set('t-chGlideD', T.chGlideDesc);
  set('t-chSurv', T.chSurv); set('t-chSurvD', S.couple ? T.chSurvDesc : T.chSurvSingle);
  set('t-bsTitle', T.bsTitle); set('t-bsDesc', T.bsDesc);
  set('t-ipTitle', T.ipTitle);
  /* The analysis prices ONE earner — the first. For a couple whose main earner
     is the partner, that is the smaller half of the exposure, so the panel says
     what it looked at rather than letting "your earnings" stand for both. */
  set('t-ipDesc', S.couple ? T.ipDesc + ' ' + T.ipCoupleScope : T.ipDesc, S.couple);
  set('t-ipExplainT', T.ipExplainT); set('ipExplain', T.ipExplain, true);
  set('t-assets', T.assets); set('t-liabs', T.liabsNW);
  set('t-explain1', T.explain);
  set('explain1', BUILD.lang === 'cs'
    ? `<p>Model sečte všechno, co máte — úspory <em>i</em> každou korunu, kterou kdy vyděláte, po zdanění a v dnešních cenách — a odečte všechno, co musíte zaplatit: celoživotní nezbytné výdaje${S.own ? ', zbytek hypotéky' : ''} a případné dědictví. Co zbyde, je vaše <b>čisté jmění</b> v ekonomickém smyslu.</p>
       <p>To pak vydělí číslem, které říká, přes kolik let se musí majetek rozprostřít — s ohledem na pravděpodobnost, že se každého roku dožijete, a na to, jak trpěliví jste. Výsledek je částka, kterou si letos můžete dovolit utratit, aniž byste ošidili svoje budoucí já.</p>
       <p>Protože se budoucí příjmy počítají jako aktivum, může mít mladý člověk s malými úsporami vysoké čisté jmění — a plán mu řekne, ať utrácí víc, než by napovídal stav účtu.</p>`
    : `<p>The model adds up everything you have — your savings <em>and</em> every pound you will ever earn, after tax and in today's money — then subtracts everything you must pay: a lifetime of essentials${S.own ? ', the rest of the mortgage' : ''}, and any inheritance you have committed to. What is left is your <b>net worth</b> in the economic sense.</p>
       <p>It then divides that by a number representing how many years your wealth has to stretch across, weighted by the chance you are alive in each of them and by how patient you are. The result is what you can afford to spend this year without leaving your future self short.</p>
       <p>Because future earnings count as an asset, a young person with almost no savings can still have a large net worth — and the plan will tell them to spend more than their bank balance alone suggests.</p>`, true);

  const srcNote = BUILD.lang === 'cs'
    ? `Úmrtnostní tabulky: ${C.lifeTable.source}. Mzdové křivky: ISPV. Daně a důchod: parametry ${C.taxYear}.`
    : `Life tables: ${C.lifeTable.source}. Earnings curves: ONS ASHE. Tax and pension: ${C.taxYear} parameters.`;
  document.getElementById('foot').innerHTML =
    `<p><b>${T.footHow}</b> ${BUILD.lang==='cs'
      ? 'Věrná reimplementace životního modelu z publikace <em>Lifetime Financial Advice</em> (Thomas M. Idzorek a Paul D. Kaplan, CFA Institute Research Foundation, 2024) a doprovodného sešitu © 2026 Paul D. Kaplan. Původní kód je licencován pro nekomerční užití; toto odvozené dílo tuto podmínku zachovává.'
      : 'A faithful reimplementation of the parent life-cycle model in <em>Lifetime Financial Advice</em> by Thomas M. Idzorek and Paul D. Kaplan (CFA Institute Research Foundation, 2024), and of the accompanying workbook © 2026 Paul D. Kaplan. The original code is licensed for non-commercial use; this derivative keeps that restriction.'}</p>
     <p>${srcNote}</p>
     <p><b>${T.footNotAdvice}</b> ${T.footNotAdviceBody}</p>`;
}

function init() {
  readURL();
  setText();
  buildRail();
  scenLoadAll();
  buildScenarios();

  document.getElementById('tourbtn').addEventListener('click', () => {
    if (tour) endTour(false); else startTour();
  });
  document.getElementById('theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', cur ? (cur==='dark'?'light':'dark') : (sysDark?'light':'dark'));
    render();
  });
  document.getElementById('reset').addEventListener('click', () => {
    tour = null; buildTour();
    S = freshState(); touched = false; compareWith = null;
    buildRail(); buildInsuranceControls(); buildScenarios(); render();
  });
  document.getElementById('share').addEventListener('click', async () => {
    const b = document.getElementById('share');
    if (!urlWritable) { b.textContent = T.copyUnavailable;
      setTimeout(()=>{ b.textContent = T.copyLink; }, 2600); return; }
    try { await navigator.clipboard.writeText(location.href); b.textContent = T.copied; }
    catch { b.textContent = 'Ctrl+C'; }
    setTimeout(()=>{ b.textContent = T.copyLink; }, 1800);
  });
  document.getElementById('print').addEventListener('click', () => {
    fillPrintHeader();
    /* window.print() is blocked inside the sandboxed frames some hosts use, and
       throws or silently does nothing. Try it, and if the frame forbids it open
       a standalone copy in a new tab and print from there. */
    const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
    let printed = false;
    if (!framed) {
      try { window.print(); printed = true; } catch (e) { printed = false; }
    }
    // Inside a frame window.print() is often blocked without throwing, so open a
    // clean standalone copy and print that instead of guessing.
    if (!printed) {
      try {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'
            + document.title + '</title><style>' + [...document.querySelectorAll('style')]
              .map(s => s.textContent).join('\n') + '</style></head><body>'
            + '<div class="printonly" style="display:block">' + document.getElementById('printhead').innerHTML + '</div>'
            + document.querySelector('main').innerHTML
            + '<footer>' + document.getElementById('foot').innerHTML + '</footer>'
            + '</body></html>');
          w.document.close();
          w.focus();
          setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
        } else if (!printed) {
          const b = document.getElementById('print');
          const was = b.textContent; b.textContent = T.printBlocked;
          setTimeout(() => { b.textContent = was; }, 3500);
        }
      } catch (e) { /* nothing more we can do from inside the frame */ }
    }
  });
  // Also fires for Ctrl+P and File > Print, not just our button.
  window.addEventListener('beforeprint', fillPrintHeader);
  fillPrintHeader();
  buildInsuranceControls();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(render, 150); });

  render();
}

/* The rail is rebuilt whenever its structure changes (couple toggled, home
   toggled, bequest mode changed); otherwise only the readouts refresh. */
let _lastShape = '';
const _render = render;
render = function () {
  const shape = [S.couple, S.own, S.downsize, S.beqMode].join('|');
  if (shape !== _lastShape) { _lastShape = shape; buildRail(); buildInsuranceControls(); setText(); }
  _render();
};

document.addEventListener('DOMContentLoaded', init);

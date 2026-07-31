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
        workUntilAge: pAge, pensionAge: pAge, employerPensionRate: D.employerPensionRate },
      { age: 35, sex: 2, health: 1, trajectory: 1, jobRisk: 1, salary: Math.round(D.salary * 0.85),
        workUntilAge: pAge, pensionAge: pAge, employerPensionRate: D.employerPensionRate },
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
    rf: C.rf, maxAge: 105, shockAge: 45,
    occClass: 0, loading: 0.5,
  };
}
let S = freshState();
let touched = false, lastR = null;

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
function thetaFromAnswer() {
  const gamma = riskAversionFromGamble(S.riskPay);
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
function rhoFromShape(h, eta) {
  const target = [-0.010, 0.0, 0.010][S.shape];   // real change per year
  const rho = (1 + h) / Math.pow(1 + target, 1 / eta) - 1;
  return Math.max(-0.02, Math.min(0.25, rho));
}

function buildParams() {
  const people = (S.couple ? S.people : [S.people[0]]).map(p => ({
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
    occClass: S.occClass,
    birthYear: CY - p.age,
  }));
  const theta = thetaFromAnswer();
  const eta = ETA_BY_SMOOTH[S.smooth];
  const cma = deriveCMA(0.2, globalStockFraction(), 0.15, globalStockFraction(), S.rf);
  const hGross = theta === 1
    ? (1 + S.rf) * Math.exp(0.5 * cma.sigmaSDF ** 2) - 1
    : Math.pow(Math.pow(1 + S.rf, theta - 1) * Math.exp(0.5 * theta * (theta - 1) * cma.sigmaSDF ** 2),
               1 / (theta - 1)) - 1;
  const h = hGross - S.fee;
  return {
    people, cbar: S.cbar,
    savings: { shares: S.savings.shares, bonds: S.savings.bonds,
               cash: S.savings.cash, pension: S.savings.pension },
    housing: S.own ? {
      own: true, value: S.homeValue, mortgageBalance: S.mortgageBalance,
      mortgageRate: S.mortgageRate, mortgageYearsLeft: S.mortgageYears,
      downsizeAge: S.downsize ? S.downsizeAge : 0,
      downsizeRelease: S.downsize ? S.downsizeRelease : 0,
    } : { own: false },
    maxAge: S.maxAge, curYear: CY,
    theta, eta, rho: rhoFromShape(h, eta), alpha: S.alpha,
    beqMode: S.beqMode, beqFixed: S.beqFixed, gamma: 0.25,
    phi: PHI_BY_WEIGHT[S.beqWeight ?? 1],
    // Averaged across the household, weighted by each person's earnings.
    eqHC: (() => {
      const ppl = S.couple ? S.people : [S.people[0]];
      const tot = ppl.reduce((s,p)=>s+Math.max(0,p.salary),0);
      if (!(tot > 0)) return EQ_HC_BY_JOB[ppl[0].jobRisk ?? 1];
      return ppl.reduce((s,p)=>s+EQ_HC_BY_JOB[p.jobRisk ?? 1]*Math.max(0,p.salary),0)/tot;
    })(),
    eqLiab: 0.15, rf: S.rf, fee: S.fee,
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
  return el('div', { class:'field' }, [
    el('span', { class:'flabel', text:label }),
    el('div', { class:'money' }, [el('span', { class:'cur', text:sym }), inp]),
    hint ? el('div', { class:'hint', text:hint }) : null,
  ]);
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
  return el('div', { class:'field' }, [el('span', { class:'flabel', text:label }), box]);
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
           T.annNone, T.annAll, ()=>T.annReadout),
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
  ], false));
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

function drawSpend(R) {
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
  const rt = R.retYear;
  if (rt>0 && rt<=R.maxYear) marker(F, ys[rt].age, T.retire, ink3);

  legend('leg-spend',[{color:teal,label:T.legTotal},{color:teal,label:T.legRange,band:true},
                      {color:brick, label: R.L0Mort > 0 ? T.legFloor : T.legFloorRent}]);
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
function drawHeadline(R) {
  const y0 = R.years[0];
  const mortNote = R.mortgagePayment > 0 ? T.andMortgage : '';
  const cards = [
    { hero:true, k:T.heroLabel, accent:'var(--teal)',
      v:`${money(R.CD0)} <span style="font-size:.5em;font-weight:400;color:var(--ink-2)">${T.perYear}</span>`,
      n:fill(T.heroNote,{ m:money(R.CD0/12),
                          t:money(R.CD0 + y0.essentials + y0.mortgage), mort:mortNote }),
      why:true },
    { k:T.cardNetWorth, v:moneyK(R.W0), accent:'var(--slate)',
      n:`${moneyK(R.F0)} + ${moneyK(R.H0)} − ${moneyK(R.L0)}` },
    { k:T.cardEquity,
      v: y0.equityShareCon == null ? T.noSavingsShort : pct(y0.equityShareCon),
      accent:'var(--teal)',
      n: y0.equityShareCon == null ? T.noSavingsNote
         : (y0.equityShareUncon > 1.05 ? `${T.legIdeal}: ${pct(y0.equityShareUncon)}` : '') },
    { k:T.cardPension, v:moneyK(R._pension), accent:'var(--amber)',
      n:`${C.code} · ${C.taxYear}` },
  ];
  if (S.beqMode !== 'none') cards.push(
    { k:T.cardBequest, v:moneyK(R.beq), accent:'var(--violet)', n:'' });

  document.getElementById('headline').innerHTML = cards.map((c,i) =>
    `<div class="stat${c.hero?' hero':''}" style="--accent:${c.accent}">
       <div class="k">${c.k}</div><div class="v">${c.v}</div>
       ${c.n?`<div class="n">${c.n}</div>`:''}
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
/* Proposal B: what a permanent loss of earnings would cost, and the cover that
   would undo it. Deterministic on purpose — it does not claim to know the odds,
   only the consequence. */
function drawShock() {
  const box = document.getElementById('shock-cards');
  const note = document.getElementById('shock-note');
  if (!box) return;
  const p = buildParams();
  const person = p.people[0];
  const stop = Math.max(person.age + 1, Math.min(person.pensionAge - 1, S.shockAge));
  let r;
  try { r = incomeShock(p, ctx, stop, 0); }
  catch (e) { box.innerHTML = ''; note.textContent = ''; return; }

  const cards = [
    { k:T.shockSpend, v:money(r.noCover.CD0), accent:'var(--brick)' },
    { k:T.shockLoss, v:money(Math.max(0, r.lossPerYear)), accent:'var(--brick)' },
    { k:T.shockBenefit, v:money(r.benefit), accent:'var(--teal)' },
    { k:T.shockYears, v:String(Math.max(0, person.pensionAge - stop)), accent:'var(--slate)' },
  ];
  box.innerHTML = cards.map(c =>
    `<div class="stat" style="--accent:${c.accent}">
       <div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');

  const gross = p.people.reduce((s, x) => s + Math.max(0, x.salary), 0);
  const share = gross > 0 ? r.benefit / gross : 0;
  const marketMax = 0.70;
  note.innerHTML = r.noCover.CD0 <= 0
    ? T.shockNoteBroken
    : fill(T.shockNoteOk, { p: pct(share),
        gap: money(Math.max(0, r.benefit - gross * marketMax)) });
}

/* Proposal C: income protection priced from published incidence, sized from the
   household's own balance sheet. Slow enough (~0.5s) to run on demand rather
   than on every keystroke. */
let ipTimer = null, ipLast = null;
function drawInsurance(force) {
  const cards = document.getElementById('ip-cards');
  const note = document.getElementById('ip-note');
  if (!cards) return;
  clearTimeout(ipTimer);
  ipTimer = setTimeout(() => {
    let r;
    try { r = insuranceAnalysis(buildParams(), ctx, { loading: S.loading }); }
    catch (e) { r = null; }
    if (!r) { cards.innerHTML = ''; note.textContent = ''; return; }
    ipLast = r;
    const shareOfFull = r.needCover > 0 ? r.bestCover / r.needCover : 0;
    const list = [
      { k: T.ipProb, v: pct(r.probability, 1), accent: 'var(--brick)' },
      { k: T.ipNeed, v: money(r.needCover), accent: 'var(--slate)' },
      { k: T.ipBuy, v: money(r.bestCover), accent: 'var(--teal)' },
      { k: T.ipPremium, v: money(r.bestPremium), accent: 'var(--amber)' },
    ];
    cards.innerHTML = list.map(c =>
      `<div class="stat" style="--accent:${c.accent}">
         <div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');
    note.innerHTML = fill(T.ipNote, { share: pct(shareOfFull) }) +
      '<br><span style="opacity:.85">' + T.ipNoteMossin + '</span>';
    const src = document.getElementById('ip-source');
    if (src) src.textContent = BUILD.country === 'CZ' ? T.ipSourceCZ : T.ipSourceUK;
  }, force ? 0 : 350);
}

function buildInsuranceControls() {
  const box = document.getElementById('ip-controls');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(seg(T.ipOcc, T.ipOccOpts, () => S.occClass,
                      v => { S.occClass = v; render(); }, T.ipOccHelp, true));
  box.appendChild(slider(T.ipLoading, () => Math.round(S.loading * 100),
    v => { S.loading = v / 100; render(); }, 0, 150, 5, v => v.toFixed(0) + '%',
    '0%', '150%', () => T.ipLoadingHelp));
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
  drawHeadline(R); drawAlerts(R);
  drawSpend(R); drawWealth(R); drawGlide(R); drawSurv(R); drawBalanceSheet(R); drawShock(); drawInsurance();

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
  document.querySelectorAll('.field.slider, .field.seg-field').forEach(f => f._update && f._update());
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
  });
  put('cb',S.cbar,D.cbar);
  put('vs',S.savings.shares,D.savings.shares); put('vb',S.savings.bonds,D.savings.bonds);
  put('vc',S.savings.cash,D.savings.cash); put('vp',S.savings.pension,D.savings.pension);
  put('ho',S.own?1:0,1); put('hv',S.homeValue,D.homeValue); put('hm',S.mortgageBalance,D.mortgageBalance);
  put('hr',S.mortgageRate,D.mortgageRate); put('hy',S.mortgageYears,D.mortgageYears);
  put('dz',S.downsize?1:0,0); put('da',S.downsizeAge,D.downsizeAge); put('dr',S.downsizeRelease,D.downsizeRelease);
  put('rk',S.riskPay,D.riskPay); put('sh',S.shape,D.shape); put('sm',S.smooth,D.smooth);
  put('al',S.alpha,D.alpha); put('bq',S.beqMode,D.beqMode); put('bf',S.beqFixed,D.beqFixed); put('bw',S.beqWeight,D.beqWeight);
  put('fe',S.fee,D.fee); put('rf',S.rf,D.rf); put('ma',S.maxAge,D.maxAge); put('sa',S.shockAge,D.shockAge); put('oc',S.occClass,D.occClass); put('ld',S.loading,D.loading);
  const s = q.toString();
  history.replaceState(null,'', s ? '?'+s : location.pathname);
}
function readURL() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  touched = true;
  const num = (k,f)=>{ if(q.has(k)){ const v=parseFloat(q.get(k)); if(Number.isFinite(v)) f(v); } };
  num('c',v=>S.couple=!!v);
  for (let i=0;i<2;i++){
    const p=S.people[i];
    num(`a${i}`,v=>p.age=v); num(`s${i}`,v=>p.sex=v); num(`h${i}`,v=>p.health=v);
    num(`j${i}`,v=>p.trajectory=v); num(`y${i}`,v=>p.salary=v);
    num(`k${i}`,v=>p.jobRisk=v);
    num(`w${i}`,v=>p.workUntilAge=v); num(`p${i}`,v=>p.pensionAge=v);
    num(`e${i}`,v=>p.employerPensionRate=v);
  }
  num('cb',v=>S.cbar=v);
  num('vs',v=>S.savings.shares=v); num('vb',v=>S.savings.bonds=v);
  num('vc',v=>S.savings.cash=v); num('vp',v=>S.savings.pension=v);
  num('ho',v=>S.own=!!v); num('hv',v=>S.homeValue=v); num('hm',v=>S.mortgageBalance=v);
  num('hr',v=>S.mortgageRate=v); num('hy',v=>S.mortgageYears=v);
  num('dz',v=>S.downsize=!!v); num('da',v=>S.downsizeAge=v); num('dr',v=>S.downsizeRelease=v);
  num('rk',v=>S.riskPay=v); num('sh',v=>S.shape=v); num('sm',v=>S.smooth=v);
  num('al',v=>S.alpha=v); num('fe',v=>S.fee=v); num('rf',v=>S.rf=v); num('ma',v=>S.maxAge=v);
  num('sa',v=>S.shockAge=v); num('oc',v=>S.occClass=v); num('ld',v=>S.loading=v);
  if (q.has('bq')) S.beqMode=q.get('bq');
  num('bf',v=>S.beqFixed=v); num('bw',v=>S.beqWeight=v);
}

/* ------------------------------------------------------------------- init */
function setText() {
  const set=(id,v,html)=>{ const e=document.getElementById(id); if(e){ if(html) e.innerHTML=v; else e.textContent=v; } };
  document.documentElement.lang = BUILD.lang;
  set('t-title', T.title);
  set('t-sub', T.sub);
  set('t-discb', T.disclaimerBold); set('t-disc', T.disclaimer);
  set('print', T.print); set('share', T.copyLink); set('reset', T.reset); set('theme', T.theme);
  set('t-chSpend', T.chSpend); set('t-chSpendD', S.own ? T.chSpendDesc : T.chSpendDescRent);
  set('t-chWealth', T.chWealth); set('t-chWealthD', T.chWealthDesc);
  set('t-chGlide', T.chGlide); set('t-chGlideD', T.chGlideDesc);
  set('t-chSurv', T.chSurv); set('t-chSurvD', S.couple ? T.chSurvDesc : T.chSurvSingle);
  set('t-bsTitle', T.bsTitle); set('t-bsDesc', T.bsDesc);
  set('t-ipTitle', T.ipTitle); set('t-ipDesc', T.ipDesc);
  set('t-ipExplainT', T.ipExplainT); set('ipExplain', T.ipExplain, true);
  set('t-shockTitle', T.shockTitle); set('t-shockDesc', T.shockDesc);
  set('t-shockAgeLabel', T.shockAgeLabel);
  set('t-shockExplainT', T.shockExplainT); set('shockExplain', T.shockExplain, true);
  const sa = document.getElementById('shockAge');
  if (sa && document.activeElement !== sa) sa.value = S.shockAge;
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

  document.getElementById('theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', cur ? (cur==='dark'?'light':'dark') : (sysDark?'light':'dark'));
    render();
  });
  document.getElementById('reset').addEventListener('click', () => {
    S = freshState(); touched = false; buildRail(); render();
  });
  document.getElementById('share').addEventListener('click', async () => {
    const b = document.getElementById('share');
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
  const sa = document.getElementById('shockAge');
  if (sa) {
    sa.value = S.shockAge;
    sa.addEventListener('input', () => {
      const v = parseFloat(sa.value);
      if (Number.isFinite(v)) { S.shockAge = Math.round(Math.max(20, Math.min(80, v))); render(); }
    });
  }
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
  if (shape !== _lastShape) { _lastShape = shape; buildRail(); setText(); }
  _render();
};

document.addEventListener('DOMContentLoaded', init);

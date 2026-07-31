/* Regression tests for the six Czech state-pension defects found by the
   independent audit. Each maps to a statutory rule with a citation. */
import { CZ, czStatePension, czAccrualRate, czZapocet, czRetirementAge } from './countries.mjs';

let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log(`  ${c?'OK  ':'FAIL'}  ${n}${d?'  — '+d:''}`); };
const mo = (p, ovz, o) => czStatePension(p, ovz, o) / 12;

console.log('\n1. ČSSZ published 2026 table, 45 insured years (must match exactly)\n');
for (const [ovz, want] of [[22400,19400],[30000,20730],[40000,22479],[50000,24228],
    [60000,25977],[80000,29475],[100000,32974],[120000,36472],[150000,41719],[180000,46967]]) {
  const got = mo({insuredYears:45}, ovz, {awardYear:2026});
  ok(`OVZ ${ovz} -> ${got.toFixed(0)}`, Math.abs(got-want) < 0.51, `want ${want}`);
}

console.log('\n2. Accrual and zápočet follow the statutory glide path by AWARD year\n');
ok('accrual 1.495% in 2026', Math.abs(czAccrualRate(2026)-0.01495) < 1e-9);
ok('accrual 1.450% in 2035', Math.abs(czAccrualRate(2035)-0.0145) < 1e-9);
ok('accrual floors at 1.450% after 2035', Math.abs(czAccrualRate(2060)-0.0145) < 1e-9);
ok('zápočet 99% in 2026', Math.abs(czZapocet(2026)-0.99) < 1e-9);
ok('zápočet 90% in 2035', Math.abs(czZapocet(2035)-0.90) < 1e-9);
ok('a later award gives a smaller pension',
   mo({insuredYears:45},50000,{awardYear:2035}) < mo({insuredYears:45},50000,{awardYear:2026}),
   `${mo({insuredYears:45},50000,{awardYear:2035}).toFixed(0)} vs ${mo({insuredYears:45},50000,{awardYear:2026}).toFixed(0)}`);

console.log('\n3. Early claiming cuts the RATE, never the základní výměra\n');
const onTime = mo({insuredYears:45}, 48967, {awardYear:2026});
const early3 = mo({insuredYears:45}, 48967, {awardYear:2026, earlyBlocks:13, longServiceYears:40});
ok('3 years early reduces the pension', early3 < onTime, `${early3.toFixed(0)} vs ${onTime.toFixed(0)}`);
ok('the 4,900 základní výměra survives in full', early3 > 4900,
   'reduction applies only to the percentage component');
// Reduction must equal blocks x 1.5pp of the výpočtový základ, not of the whole pension
const vz = Math.ceil(0.99*Math.min(48967,21546) + 0.26*(Math.min(48967,195868)-21546));
ok('cut equals 13 x 1.5pp of the výpočtový základ',
   Math.abs((onTime - early3) - Math.ceil(0.01495*45*vz)/1 + Math.ceil((0.01495*45-13*0.015)*vz)) < 2,
   `${(onTime-early3).toFixed(0)} CZK/mo`);

console.log('\n4. The 2026 halving to 0.75pp for 45+ years of hard service\n');
const short = mo({insuredYears:45}, 48967, {awardYear:2026, earlyBlocks:13, longServiceYears:40});
const long  = mo({insuredYears:45}, 48967, {awardYear:2026, earlyBlocks:13, longServiceYears:45});
ok('45+ years of service is penalised less', long > short, `${long.toFixed(0)} vs ${short.toFixed(0)}`);
ok('the halved cut is exactly half the full cut',
   Math.abs((onTime - long) * 2 - (onTime - short)) < 2,
   `${(onTime-long).toFixed(0)} vs ${(onTime-short).toFixed(0)}`);

console.log('\n5. Předčasný důchod is capped at 3 years — earlier pays nothing\n');
const mk = (yearsEarly, by=1959) => {
  const st = Math.round(czRetirementAge(by));
  return CZ.statePension({ age:2026-by, sex:1, salary:600000, trajectory:1,
    workUntilAge:st, pensionAge:st-yearsEarly, statutoryPensionAge:st, birthYear:by }, null)/12;
};
ok('3 years early is payable', mk(3) > 0, `${mk(3).toFixed(0)} CZK/mo`);
ok('4 years early pays nothing', mk(4) === 0);
ok('7 years early pays nothing', mk(7) === 0);

console.log('\n6. No cohort is penalised for claiming at its own statutory age\n');
let penalised = [];
for (let by = 1960; by <= 1995; by++) {
  const st = Math.round(czRetirementAge(by));
  const p = { age:2026-by, sex:1, salary:600000, trajectory:1,
              workUntilAge:st, pensionAge:st, statutoryPensionAge:st, birthYear:by };
  const onTimeP = CZ.statePension(p, null);
  const later = CZ.statePension({...p, pensionAge: st+1}, null);
  if (onTimeP < later * 0.999) penalised.push(by);
}
ok('all 36 cohorts claim on time without a cut', penalised.length === 0,
   penalised.length ? 'penalised: ' + penalised.join(',') : '1960-1995 all clean');

console.log(fail === 0 ? '\n*** ALL CZ PENSION REGRESSION TESTS PASSED ***' : `\n*** ${fail} FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

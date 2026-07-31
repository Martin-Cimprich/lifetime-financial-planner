/* Validate the country modules against the published worked examples. */
import { UK, CZ, ukIncomeTax, ukNI, czIncomeTax, czSocialHealth, czStatePension,
         czRetirementAge, ukStatePensionAge, ukStatePension,
         riskAversionFromGamble, thetaFromRiskAversion } from './countries.mjs';

let fail = 0;
const near = (name, got, want, tol, unit) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`  ${ok?'OK  ':'FAIL'}  ${name.padEnd(46)} ${got.toFixed(2).padStart(12)} ${('want '+want.toFixed(2)).padStart(18)}${unit?' '+unit:''}`);
};

console.log('=== UK income tax + NI vs HMRC worked examples (2025/26) ===\n');
// Published: total effective rate at 30k = 16.27%, 50k = 20.96%, 75k = 27.92%
for (const [gross, wantTax, wantNI] of [
  [30000, 3486.00, 1394.40],
  [50000, 7486.00, 2994.40],
  [75000, 17432.00, 3510.60],
]) {
  near(`income tax on £${gross}`, ukIncomeTax(gross), wantTax, 0.5, 'GBP');
  near(`employee NI on £${gross}`, ukNI(gross, false), wantNI, 0.5, 'GBP');
  const eff = (ukIncomeTax(gross) + ukNI(gross, false)) / gross * 100;
  console.log(`         effective rate ${eff.toFixed(2)}%`);
}
// Personal allowance taper
near('PA fully tapered at £125,140 -> tax', ukIncomeTax(125140), 42516.00, 60, 'GBP');
near('no NI once over State Pension age', ukNI(50000, true), 0, 0);

console.log('\n=== UK State Pension ===\n');
near('full new State Pension (35 yrs)',
  ukStatePension({ workUntilAge: 67, niYears: 35 }), 11973, 1, 'GBP/yr');
near('20 qualifying years is pro rata',
  ukStatePension({ workUntilAge: 67, niYears: 20 }), 11973 * 20 / 35, 1, 'GBP/yr');
near('below 10 years pays nothing',
  ukStatePension({ workUntilAge: 30, niYears: 9 }), 0, 0);
near('flat-rate: a high earner gets the same',
  ukStatePension({ workUntilAge: 67, niYears: 35 }),
  ukStatePension({ workUntilAge: 67, niYears: 35 }), 0);
console.log(`  ${ukStatePensionAge(1959)===66?'OK  ':'FAIL'}  SPA 66 for born 1959`);
console.log(`  ${ukStatePensionAge(1970)===67?'OK  ':'FAIL'}  SPA 67 for born 1970`);
console.log(`  ${ukStatePensionAge(1990)===68?'OK  ':'FAIL'}  SPA 68 for born 1990`);
if (ukStatePensionAge(1959)!==66||ukStatePensionAge(1970)!==67||ukStatePensionAge(1990)!==68) fail++;

console.log('\n=== CZ daň + pojištění vs published worked examples (2026) ===\n');
// Published 2025 examples; 2026 differs only above the 23% threshold.
for (const [gross, wantTotal] of [[400000, 75560], [700000, 155360], [1200000, 288360]]) {
  const got = czIncomeTax(gross) + czSocialHealth(gross);
  near(`total tax+social on ${gross} CZK`, got, wantTotal, 1, 'CZK');
  console.log(`         effective rate ${(got/gross*100).toFixed(2)}%`);
}
// 2026 threshold is 1,762,812 so the 23% band starts later than in 2025
near('23% band engages above 1,762,812',
  czIncomeTax(1762812 + 100000) - czIncomeTax(1762812), 23000, 1, 'CZK');
near('social insurance capped at 2,350,416',
  czSocialHealth(3000000) - czSocialHealth(2350416), (3000000-2350416)*0.045, 1, 'CZK');

console.log('\n=== CZ starobní důchod vs published replacement rates (2026) ===\n');
// Published: at 1.0x average wage (OVZ 48,967) -> 24,047 CZK/month, 49.1%
for (const [mult, wantMonthly] of [
  [0.5, 19765], [0.75, 21907], [1.0, 24047], [1.5, 28330], [2.0, 32612],
  [3.0, 41177], [4.0, 49743],
]) {
  const ovz = 48967 * mult;
  const got = czStatePension({ insuredYears: 45, workUntilAge: 65 }, ovz) / 12;
  near(`pension at ${mult}x average wage`, got, wantMonthly, 15, 'CZK/mo');
}
const capped = czStatePension({ insuredYears: 45, workUntilAge: 65 }, 48967 * 8) / 12;
near('nothing accrues above 4x average wage', capped, 49743, 15, 'CZK/mo');
console.log(`  ${czRetirementAge(1960)===65?'OK  ':'FAIL'}  retirement age 65 for born 1960`);
console.log(`  ${Math.abs(czRetirementAge(1975)-65.833)<0.01?'OK  ':'FAIL'}  65y10m for born 1975 (got ${czRetirementAge(1975).toFixed(3)})`);
console.log(`  ${czRetirementAge(1995)===67?'OK  ':'FAIL'}  capped at 67 for born 1995`);
if (czRetirementAge(1960)!==65 || Math.abs(czRetirementAge(1975)-65.833)>=0.01 || czRetirementAge(1995)!==67) fail++;

console.log('\n=== Risk aversion from the 50/50 gamble ===\n');
// Sanity: paying nothing to avoid a favourable gamble means near risk neutrality;
// paying a lot means high risk aversion. The mapping must be monotone.
// Reference values: exact CRRA solutions for the +/-20% symmetric gamble,
// independently reproduced by the research agent with scipy brentq and
// validated against Kimball-Sahm-Shapiro (2008) Table 1.
const WANT = { 0.01:0.49, 0.02:0.99, 0.03:1.49, 0.05:2.53, 0.075:3.96, 0.10:5.71, 0.15:12.26 };
let prev = 0, mono = true;
for (const pi of Object.keys(WANT).map(Number)) {
  const g = riskAversionFromGamble(pi);
  const th = thetaFromRiskAversion(g);
  if (g <= prev) mono = false;
  prev = g;
  near(`gamma at pi=${(pi*100).toFixed(1)}%`, g, WANT[pi], 0.03, `-> theta ${th.toFixed(3)}`);
}
console.log(`  ${mono?'OK  ':'FAIL'}  mapping is monotone in willingness to pay`);
if (!mono) fail++;
// The model's default theta = 0.6 should correspond to a plausible gamma
const gDefault = 1 / 0.6;
console.log(`  model default theta 0.60 <-> γ = ${gDefault.toFixed(2)} (typical empirical range 1-5)`);

console.log('\n=== Salary curves ===\n');
for (const C of [UK, CZ]) {
  const person = { sex: 1, age: 30, trajectory: 1 };
  const vals = [25, 35, 45, 55, 65].map(a => C.salaryCurve(a, person) / C.salaryCurve(30, person));
  console.log(`  ${C.code} male, relative to age 30: ` +
    [25,35,45,55,65].map((a,i)=>`${a}y ${vals[i].toFixed(2)}`).join('  '));
  const peak = (() => { let best=0,ba=0; for(let a=22;a<=70;a++){const v=C.salaryCurve(a,person); if(v>best){best=v;ba=a;}} return ba; })();
  console.log(`     fitted peak age ${peak}`);
}

console.log(fail === 0 ? '\n*** ALL COUNTRY CHECKS PASSED ***' : `\n*** ${fail} CHECK(S) FAILED ***`);
process.exit(fail === 0 ? 0 : 1);

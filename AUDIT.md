# Independent audit — findings and fixes

Five independent reviewers were given the source with instructions to break it, not
confirm it: two on the engine and application logic, two re-verifying the UK and Czech
country data against primary sources, one reviewing the Czech copy. Everything below was
demonstrated with a reproducible case before being accepted, and every fix is covered by a
regression test.

Run `node src/test-*.mjs` — five suites, all passing.

---

## The one that started it

**Segmented buttons did not appear to respond.** Clicking "Female" recomputed the whole
model — the answer changed from £8,092 to £7,211 — but the highlight never moved, so the
control read as dead. `seg()` set `aria-pressed` once at build time, and only the four
controls that rebuild the input rail (couple, home, downsizing, bequest mode) ever
refreshed. Every other segmented control was affected: sex, health, career trajectory,
spending shape, market-fall response.

Fixed by giving each control a repaint function that runs on every render, the same way
the sliders already worked. Now covered by a test that clicks all 24 options in both
builds and asserts the highlight follows.

The earlier test suite missed this because it checked that *numbers changed*, never that
the *interface reflected state*.

---

## Czech state pension — five defects

The Czech reviewer re-derived the whole calculation from ČSSZ and zákon č. 286/2024 Sb.

**Ten of twenty-three birth cohorts were silently penalised.** The interface rounds the
statutory retirement age to a whole year; the pension function compared that rounded age
against the *unrounded* statutory age. For every cohort whose statutory age rounds down —
1966–70 and 1978–82 — the model concluded the user was retiring early and applied a
permanent 1.5–3.0% cut. On default settings, having changed nothing. Fixed by passing the
statutory age explicitly so both sides are compared on the same basis.

**The early-retirement cut was applied to the wrong base.** The statute reduces the *rate*
of the procentní výměra by 1.5 percentage points of the výpočtový základ per 90-day block,
and never touches the základní výměra. The code scaled the entire pension. Both errors
compounded; three years early was overstated by 860 CZK/month.

**The 2026 halving was missing.** From 1 January 2026 the cut halves to 0.75 pp for people
with 45+ years of qualifying service — which the model's own defaults make the typical
case. Understated a qualifying early retiree by 1,915 CZK/month.

**The accrual rate and zápočet were frozen at 2026 values.** Both are on a statutory
ten-year glide path keyed to the year the pension is *awarded* — 1.495% → 1.45% and
99% → 90% by 2035. A life-cycle model projects people retiring in the 2040s and 2050s, so
this overstated the state pension by 7.6% for everyone under about 56, and therefore
understated how much they need to save. Now a function of award year.

**The 3-year cap on předčasný důchod was declared but never enforced.** The interface
allowed a claim age of 50, and the model paid a reduced pension a decade before any
entitlement exists. Now returns zero, which is the correct answer.

A sixth finding was about my own comment: I had described the 1.495% accrual as a fudge to
absorb MPSV's rounding. It is nothing of the kind — it is the statutory 2026 rate. The
reviewer also showed the residual 1 CZK discrepancy was three missing statutory round-ups,
not rounding noise. With those added the model now reproduces ČSSZ's published table
**exactly** at all ten published points.

---

## Engine — six defects

**A fixed bequest could go negative.** `beqMode: 'opt'` was guarded against negative
maximum bequests; `'fixed'` was not. For a household whose essentials already exceed
lifetime resources, the life-cover liability flipped sign and became an asset, shrinking
the reported shortfall by a factor of exactly 1000 — a −£627,000 net worth displayed as
−£627. Clamped.

**The mortgage was over-repaid by a year's interest.** The level payment is sized with the
ordinary-annuity formula, which assumes payments at t = 1..N, but the stream was written to
t = 0..N-1. The liability was overstated by exactly (1 + rate); a £200,000 loan at 4% over
20 years finished £17,529 overpaid. The old test encoded the bug rather than catching it —
it computed its expectation over the same wrong range. Now asserted the only way that
cannot be fooled: discounted at its own rate, a mortgage must be worth exactly its balance.

**Downsizing double-counted the mortgage.** The windfall netted off *today's* balance even
when the loan was long repaid by the downsizing year — and the repayments were already on
the balance sheet as a liability. Understated the release by 600,000 CZK on the Czech
defaults. Now amortises the balance forward to the sale date.

**For couples, the horizon bound only the younger partner.** `maxYear` is measured from
the youngest age, so the older partner's survival curve was conditioned on a horizon
beyond the plan's stated maximum age and simply ran on — still alive at 110 in a plan that
stops at 105. Each person is now conditioned on their own horizon.

**The equity share was reported as a fake 0%.** With no financial wealth the ratio is
undefined, but the code substituted 0 — indistinguishable from a genuine "hold all cash"
recommendation, and it stopped the leverage warning from ever firing for precisely the
young-with-no-savings households the model exists to inform. Now returns null and the
interface says "nothing to allocate yet" with an explanation.

**Fees were charged on human capital.** The fee came straight off the certainty-equivalent
return h, but h is the return on *net worth* — so the charge fell on future salary too.
Nobody pays a platform fee on their salary. This overstated the lifetime cost of charges by
roughly 1.5x: the UK default case dropped from £446/year to £291/year once the drag was
scaled by the share of net worth that is actually financial.

---

## Interface and robustness

- **Number inputs accepted anything.** `min`/`max` attributes only constrain the spinner
  arrows; typing or pasting walks past them. An employer pension contribution of −5000%
  sent human capital deeply negative and produced `NaN` and `Infinity` in SVG coordinates.
  Values are now clamped in JavaScript, whole-number fields round, and the field
  normalises its display on commit so it can never show something different from the value
  the model used.
- **Charts are now defensive as well.** Degenerate or non-finite scales are guarded, so no
  input can put a bad coordinate in the DOM even if a future change slips through.
- **A failed solve wiped the page.** An early return replaced the whole results area with a
  single line. It now leaves the last good results visible and explains what happened.
- **Print hid every panel heading.** The print stylesheet matched all `<header>` elements,
  including the six panel titles. Scoped to `body > header`. The print header — which
  carries the "not financial advice" line — is also populated on load and on `beforeprint`,
  so it appears whether the user clicks Print or presses Ctrl+P.
- **Help buttons had no `aria-expanded`.**

---

## A defect in the build itself

Worth recording because it nearly shipped everything above as a no-op: `build.mjs` read a
*generated* `bundle.js` rather than the source modules. Every engine and country fix in
this document was correct in source, passing its tests, and entirely absent from the two
HTML files. It was caught only by checking a fixed behaviour in the browser and finding
the old one.

`build.mjs` now regenerates the bundle from `lifetables.mjs`, `engine.mjs` and
`countries.mjs` on every run, and asserts the result contains each of them before writing.

---

## What the fixes changed

| | before | after |
|---|---|---|
| UK default household, spending | £8,092/yr | £8,301/yr |
| UK lifetime cost of charges | £446/yr | £291/yr |
| CZ default household, spending | 55,108 Kč/yr | 56,874 Kč/yr |
| CZ state pension | 280,000 Kč/yr | 257,000 Kč/yr |
| CZ pension vs ČSSZ published table | within ~1 Kč | exact at all 10 points |

The Czech pension falls because the statutory glide path is now applied; the UK figure
rises because the mortgage is no longer over-repaid. Both are corrections, not tuning.


---

# Round two — user testing

Reported after using the tool on a real scenario.

**The constrained allocation was badly wrong, and it was Kaplan's heuristic.** A renter with
risk aversion 2 and 96% of their balance sheet in human capital was told to hold 22% of
savings in shares. The unconstrained answer was 300%. The workbook's `ReallocNeg` zeroes the
negative positions and rescales *all* the positives proportionally — which scales the equity
down alongside the cash, moving away from the target rather than toward it.

It is strictly dominated. In that case the target equity exposure was 265,524; `ReallocNeg`
landed 124,580 short, while simply holding every penny of savings in equities was only
93,872 short. Since theta is *defined* as the equity share of net worth, the correct
long-only answer is to get equity as close to target as the budget allows and put the
remainder where the unconstrained solution wanted it. Replaced with `longOnlyAlloc`;
`reallocNeg` is retained so the workbook can still be reproduced exactly.

The same household now gets 100% today, gliding to 37% at retirement — the textbook shape
the model is famous for, which the old heuristic was hiding.

**A renter was told about their mortgage.** Five separate strings assumed a mortgage
existed: the glide-path explanation, the essentials hint, the housing help, the chart
description, and the chart legend. All now have renter variants, verified across all four
country × tenure combinations.

**A build gap let a syntax error ship.** An escaped newline inside a string literal broke
the whole page, and `build.mjs` happily wrote it because it only checked that the bundle
*contained* the right pieces. It now parses every inline script and refuses to write if any
fails. The build also wrote its output into `src/` while the deliverables lived at the repo
root, so the published files were stale — now fixed.

**Also in this round:** thousands separators in every money field (locale-correct — `39,000`
in the UK, `518 892` in Czechia), the fees card removed, the spending chart rescaled so the
full 5th–95th band is visible rather than clipped at the 75th, print made to work inside a
sandboxed frame by opening a clean standalone copy, and a new "how safe is your income?"
question driving the human-capital equity exposure that was previously hard-coded at 20%.


---

# Round three — the boundary cases

Found by driving both built files in a browser rather than by reading the source, which is
where the last two rounds' worst findings also came from.

**A recommendation to buy £237 of income protection, printed directly above prose telling
the reader to self-insure.** `insuranceAnalysis` finds the optimal cover by golden-section
search on [0, b]. Golden section approaches a boundary optimum without ever reaching it, so
whenever the honest answer was "buy nothing" it returned a small positive residue instead —
about 1.3% of the bracket, which for the UK default couple is £237 of cover at £11 a year,
and 2,981 Kč in the Czech build. The interface then rendered that search noise as a precise
recommendation in the headline card, immediately above the Campbell paragraph saying the
loss is below the line and should be carried. Fixed by comparing the search result against
the endpoint and snapping to zero, which costs nothing because the endpoint was already
being evaluated. The card and the two affected stat cards now say *none* and *not worth
buying at this margin*, which is the answer. Asserted in `test-insurance.mjs`.

**For a couple, the insurance panel priced one earner and did not say so.** The analysis
takes a `who` argument that defaults to 0, and nothing ever passed anything else — so a
household whose main earner is the partner was shown the smaller half of its own exposure
under the heading "your earnings are your largest asset". With the salaries split 1:5 the
first earner needs no cover at all while the main earner needs 195,448 Kč: a factor of a
hundred between the number shown and the number that mattered. The same single occupation
answer was also applied to both partners' hazard, so a doctor married to a builder got one
occupation class.

Fixed properly rather than disclosed. Occupation class and cover already held moved from the
household onto each person, the analysis runs once per earner, and the panel splits into a
*You* and a *Your partner* section with the household total in the headline card. On the UK
default with a £200,000 heavy-manual partner, the recommendation goes from £237 of cover at
£11 a year to £18,311 at £5,030 — the difference between noise and the household's actual
largest uninsured risk. Old links keep working: `oc` and `ic` are still read onto the first
earner where `oc0`/`ic0` are absent.

Splitting the panel also broke its copy, which was written throughout in the second person
and now had to sit under a *Your partner* heading — "Chance it happens before **you** retire"
about someone else. The card labels, the Campbell paragraph, the two controls and the
over-insured note all gained neutral variants, used only when the sections are named; the
single-earner case keeps the personal wording, where it is right and better.

**Every recalculation threw where the document has no origin.** `writeURL` is the last
statement in `render()`, and `history.replaceState` raises `SecurityError` outright in a
sandboxed iframe, a `data:` URL, or a local viewer that inlines the file. The page still
drew — the throw happens after everything is painted — so this was invisible except as an
uncaught error on every keystroke, and as "Copy link" silently handing out a URL with no
scenario in it. Now caught, with the share button saying so instead of pretending.

**A link bypassed every input clamp.** The number fields were hardened in round one because
`min`/`max` attributes do not constrain typing or pasting. `readURL` writes straight into
state, so the same values arriving in a URL skipped all of it — `?e0=-500000` puts an
employer contribution of −500000% into the model. In practice the engine absorbed everything
thrown at it (twenty hostile parameter cases produced no `NaN`, no `Infinity`, no bad SVG
coordinate and no unhandled throw, which is a good sign about the engine rather than about
the URL layer), but the guard was one-sided. `readURL` now enforces the same bounds
`buildRail` does, whitelists `beqMode`, rounds the whole-number fields, and re-imposes the
one cross-field constraint the interface maintains.

**Two departures from the workbook were documented as marked in the source and were not.**
`NOTICE.md` promised that every deviation carries a `DEVIATION` marker in `src/engine.mjs`.
Only the third, the long-only allocation, did — the two numerical ones had no marker at all,
and `NOTICE.md` did not mention the third. Markers added, `NOTICE.md` and `README.md`
corrected. This matters more than it looks: the marker is the only thing telling a future
reader which lines must not be "fixed" back to matching the VBA.

**`disabilityRate` defaulted to the wrong occupation class.** Documented as taking 0–3 with
0 for clerical work, and called with 0 throughout the application, but its default parameter
was 1 — so any caller omitting it would silently get CMI class 2 at 1.2× the claim rate.
The test harness was in fact using `?? 1` where the application uses `?? 0`. No shipped
number was wrong, because nothing omits the argument; the trap is closed and the harness
aligned with what the application actually does.

## What these changed

| | before | after |
|---|---|---|
| UK couple, income cover worth buying | £237 at £11/yr | none, or the partner's real figure |
| UK couple, £200k heavy-manual partner | £237 at £11/yr | £18,311 at £5,030/yr |
| CZ couple, income cover worth buying | 2 981 Kč at 106 Kč/yr | none |
| single-earner cases | unchanged | unchanged |

No headline spending figure moved anywhere. With the exception of the couples fix, every one
of these was a defect in what the tool *said* rather than in what it computed — which is the
pattern of all three rounds.

# Taking the Idzorek–Kaplan life-cycle model to a lay audience

Notes and recommendations from reading the monograph (Part I), reverse-engineering the
workbook's 46 VBA functions, and rebuilding the engine in JavaScript.

**What ships alongside this document:** `lifecycle-model.html` — a single self-contained file,
no installer, no macros, no dependencies. Open it, or upload it to any static host.

---

## 1. The headline finding: the Excel version cannot reach lay people at all

This is not a UX opinion, it is a distribution fact. Since 2022 Microsoft blocks VBA in any
workbook carrying the Mark of the Web — which every file that arrives by download or email
does. The model is *entirely* VBA user-defined functions, so the failure mode is 11,717 cells
reading `#NAME?` and a dashboard that looks broken, with no message explaining why.

That is exactly what happened when you first opened it. Anyone you send it to hits the same
wall, and most will conclude the tool is broken rather than that their security settings are.

You cannot fix this inside Excel. Trusted Locations and "Unblock" are per-machine, per-user
actions that no general audience will perform. **A web version is not a nice-to-have; it is the
only channel through which this model can actually reach people.**

Secondary benefits that fall out of the port:

| | Excel | Web version |
|---|---|---|
| Time to first result | download, save, unblock, enable macros | open a link |
| Recalculation | "several seconds", no progress indicator | 1.5 ms, live as you type |
| Undo after clicking any chart button | destroyed (VBA clears the undo stack) | not applicable |
| Comparing two scenarios | screenshot and remember | side by side |
| Phone | unusable | works |
| Sharing a specific case | send a 700 KB file | send a URL |

---

## 2. A real numerical bug in the optimal bequest — worth reporting upstream

While porting the engine I found that the workbook's **"Optimal Bequest" is wrong by about
12.5%**, and the error propagates into the headline spending number.

Two causes compound:

**The utility function loses its own signal.** `util(x, γ)` is evaluated as `(x^pow − 1)/pow`.
With the default γ = 0.25 the exponent is −3, so for consumption around \$60,000 the `x^pow`
term is ≈ 4.6 × 10⁻¹⁵ while the constant term is 1/3. The entire economic signal lives in the
last two or three bits of a double. Across the plausible bequest range the objective varies by
less than 6 × 10⁻¹⁶ — below the resolution of the arithmetic. The reported optimum is
floating-point noise.

**The search is a 99-point grid.** `BequestData` steps the bequest in 1% increments of the
maximum and takes `MAX`/`MATCH`/`INDEX`, so resolution is ±\$73,000 even before the precision
problem.

Verified against 50-digit arithmetic, at the shipped defaults:

| | Optimal bequest | Year-0 discretionary spending |
|---|---|---|
| Workbook | \$1,099,017 | \$55,020 |
| Correct | \$1,256,116 | \$53,632 |
| Error | **−12.5% (−\$157,100)** | **+\$1,388 / year overstated** |

The fix is small and exactly equivalent mathematically. Dropping the additive constant is a
monotone transformation, so the optimum is unchanged but the cancellation disappears; and the
certainty-equivalent then collapses to a clean weighted power mean:

```
ConsumpConstEquiv = ( Σ wᵢ · xᵢ^pow / Σ wᵢ )^(1/pow)        // no subtraction, no cancellation
maximise            (1−φ)·ĉ^pow + φ·(B/D)^pow               // constant −1/pow dropped
```

With that plus a golden-section search, the answer matches 50-digit ground truth to 4 × 10⁻⁷ %.
Both changes are in the shipped engine and marked `DEVIATION` in the source.

Two smaller things worth passing on: `SigmaSDFFn` stops bisecting at 1e-8, which leaves a
6 × 10⁻⁸ relative error in every downstream quantity (tightening the tolerance costs nothing);
and the workbook contains a broken defined name `SIStartAge → Dashboard!#REF!` plus a
`_xleta.CHAR → #NAME?` artifact, both of which I removed in the fixed copy.

---

## 3. It is structurally American, and that is invisible to the user

The retirement-income engine is US Social Security: the 2025 PIA bend points
(\$9,912 / \$59,760 / \$117,000), the 90/32/15% replacement rates, full retirement ages tied to
US birth-year rules, the 35-highest-years averaging rule, and a claiming-age multiplier table.
Retirement age is silently capped at 62–70 for the same reason. The salary curves are US
regressions by education level, the asset classes are US-centric ("Muni Bonds", "Global DM x
US"), and every number is formatted in dollars with no currency label.

For you in Czechia — or for most of the world — the retirement income figure is not
approximately right, it is structurally inapplicable. Nothing in the workbook or the manual
says so.

**Highest-leverage single fix, and the one I made:** let the user enter their own expected
pension. In the web version, "Guaranteed income once retired" defaults to the US estimate but
offers "I'll enter it", and an alert states plainly that the built-in estimate is US-only.
Currency is selectable and drives all formatting.

That makes the model usable everywhere, because the pension is the only genuinely
country-specific input. Going further — localized salary curves, national mortality tables
instead of Gompertz calibrated to US data — needs data, not code, and I would treat it as a
later phase.

---

## 4. The interface asks expert questions and shows expert answers

I audited every Dashboard label, tooltip, and manual page. A few representative problems:

- **A silent 100× error.** Percentages are entered as bare numbers (`2` means 2%), but the
  validation on ρ, α and the four exposure inputs starts at 0 — so typing `20%`, the natural
  gesture, stores 0.2 and the model silently uses 0.2%. The same gesture is *rejected* on other
  rows whose validation starts at 1. Meanwhile `ACData`, which the Guide also calls a "Key
  Input Tab", uses decimals (0.025 = 2.5%). Nothing says the convention flips.
- **All help is invisible.** There are zero cell comments. Every piece of guidance is a
  data-validation input message — no red triangle, no hover, you must click the exact cell.
  It vanishes entirely in Excel for the web.
- **The guidance is a page citation.** ρ says "See page 44 of IK (2024)"; θ, "page 47"; γ and
  φ, "pages 61–62". To answer "what number goes here?" a user must obtain and read a 250-page
  CFA Institute monograph.
- **Inputs and outputs are one undifferentiated list.** Rows 3–28 are inputs, 29–39 are
  computed, row 40 is an input again. The only cue is yellow fill; column F is headed "Inputs"
  but F29:F39 are formulas.
- **Cause and effect cannot be seen together.** Inputs are in columns B–G, the balance sheets
  start at column T, and charts open as full-window sheets. There is no view in which you
  change a number and watch the number that matters move.
- **"Recommended" advice nobody can follow.** At the defaults the unconstrained table
  recommends 587.6% in shares and −1,424.5% in bonds — roughly 14× leverage funded by shorting
  bonds — under a heading that says "Recommended", with no explanation of what a negative
  allocation means. A second table says 38.5%. Nothing tells you which one applies to you.
- **False precision.** "Bequest \$1,099,016.57" from inputs that are pure judgement calls
  (and, as above, wrong in the sixth digit from the left).
- **No reset, no defaults, no scenario save.** The moment you type over the shipped example it
  is gone. Yet the manual's central exercise is "try annuitization at 0%, 50% and 100% and
  observe" — which the workbook cannot hold.

### What I did about it in the web version

**Ask eight human questions, hide the other twenty parameters.** Age, retirement age, sex,
health, education, salary, essential spending, savings — then four preference sliders. Every
Greek letter is either derived, defaulted, or moved behind "Expert settings", where it is
still available and still matches the workbook exactly.

**Say what each control means in the reader's terms, and show its effect.** Not "Risk
Tolerance (θ)" but *"Appetite for investment risk"*, with a live line underneath: *"Puts 60% of
your whole balance sheet in shares — which today means 37% of your savings."* Each control has
a "?" that expands into two or three sentences of plain explanation.

**Answer first.** The single number a person came for — what they can afford to spend — is the
largest thing on the page, in a card of its own, with the monthly equivalent and the total
including essentials. Everything else is supporting detail below it.

**Show ranges and name the uncertainty.** Fan charts are labelled as ranges of outcomes rather
than forecasts, the word "real" is explained, and the x-axis is *your age*, not "years from
now" — the workbook already knew your age and calendar year and used neither.

**Warn where the model is being asked something it cannot answer.** If essentials exceed
lifetime resources the page says so in plain words instead of returning a negative number. If
the unconstrained equity share is absurd, an alert says to read it as a direction, not an
instruction. If the pension is still the US estimate, it says so.

**Make the two "recommendations" legible.** One line, one scale, one explanation of why the
dashed line runs off the top of the chart — and the actionable line is the one the axis is
scaled to.

---

## 5. Teach the insight, not the parameters

The manual's four "Recommended Tinkering" exercises are all *change X, observe the chart*.
There is no glossary, no worked example of a real person, no explanation of how to read an
economic balance sheet, and the "User-Defined Functions" appendix is the literal text
"Place Holder" — 46 functions, undocumented.

But the model contains one genuinely powerful idea that most people have never encountered:

> Your future salary is an asset on your balance sheet, and it behaves like a bond. That is
> *why* a young person should hold shares — not because they "have time to recover", but
> because they are already holding an enormous bond and shares are what balances it.

That reframing changes how someone thinks about their money permanently, in a way that
"here is your recommended allocation" does not. The web version puts it in the two chart
captions and the two expandable explainers, and the balance-sheet chart is built to make it
visible: future earnings falling, savings rising, the two crossing around retirement.

If you take one thing further, make it this. A short guided narrative — five screens, each
introducing one idea and letting the reader move one slider — would do more for financial
wellbeing than any number of additional parameters.

---

## 6. What I would build next, in order

**Worth doing soon**

1. **Czech / multi-language.** You are the natural first localisation. Text is already
   centralised in the markup; the model itself is language-agnostic.
2. **Save and name scenarios** in `localStorage`, not just the single pin that exists now.
   "Retire at 62" vs "retire at 67" is the question people actually have.
3. **Explain-this-number.** Click any headline figure and see the three-line derivation with
   real values substituted. Trivial with the engine already structured this way, and it turns
   the tool from an oracle into something teachable.
4. **Print / PDF summary.** A one-page result people can take to a conversation. Print CSS is
   in place; a proper summary layout is not.

**Bigger, and each changes the model rather than the interface**

5. **Couples.** The model is strictly single-person. Joint survival probabilities, two salary
   curves, survivor pensions. This is the largest gap between the model and how people
   actually organise their money, and it is a substantial piece of work.
6. **Housing and mortgages.** Currently a home is neither an asset nor a liability. Most
   households' balance sheets are dominated by one.
7. **Tax.** Explicitly out of scope in the paper, but the gap between pre-tax and post-tax
   spending is exactly what a lay user misreads.
8. **Real mortality tables** by country, replacing US-calibrated Gompertz parameters.
9. **Monte Carlo** instead of the lognormal approximation. The current fan is closed-form,
   which is why it is instant — but the approximation is also the source of the `#VALUE!`
   cells in the workbook's early projection years, where expected net wealth goes negative
   and the lognormal is undefined.

**Distribution**

10. Host it as a static file — GitHub Pages, Netlify, Cloudflare Pages, or anything. There is
    no backend and no build step.
11. Offer an `<iframe>` embed so educators and personal-finance writers can drop it into a
    lesson or an article.
12. Send the bequest bug to Paul Kaplan. It is his model, the fix is three lines, and the
    workbook is the reference implementation others are copying.

---

## 7. Fidelity of the port

Every quantity the two share agrees to roughly fifteen significant figures. Running the
JavaScript engine with the same 1e-8 bisection tolerance the VBA uses:

```
quantity                       javascript              excel        rel. error
m (adjusted longevity)          91.000000           91.000000         0.0e+00
h (certainty-equiv return)       0.032113            0.032113         0.0e+00
g (consumption growth)           0.004733            0.004733         0.0e+00
retirement income            33582.783988        33582.783988         0.0e+00
H0 human capital           2314142.308878      2314142.308878         4.0e-15
L0 liabilities              502133.803178       502133.803178         4.2e-15
W0 net worth               1625207.229845      1625207.229845         4.3e-15
Delta0 consumption divisor      29.538367           29.538367         1.2e-16
equity share, unconstrained      5.876159            5.876159         5.7e-15
constrained allocation       12417.018855        12417.018855         3.6e-13
```

Plus 14 structural invariants, 57 parameter variations swept for finiteness and
positivity, and 8 direction-of-effect checks (more wealth raises spending, a stronger bequest
motive lowers it, equity share declines with age, annuitising raises spending, and so on).
The test suite is `test-engine.mjs` in the working directory.

The only intentional differences are the two numerical corrections in §2.

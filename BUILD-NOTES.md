# UK and Czech builds — what was made, and what it assumes

Two self-contained files, `planner-uk.html` and `planner-cz.html`. No build step, no
dependencies, no backend. Upload either to any static host.

Source lives in `src/`. Both files are generated from one codebase:

```bash
cd src && node build.mjs
```

---

## The engine

`src/engine.mjs` generalises the Idzorek–Kaplan parent life-cycle model to couples,
tax, housing, fees and early retirement. The critical property is that **with every new
feature switched off it reduces exactly to the version already verified against the
Excel workbook** — that is asserted, not asserted-to:

```
quantity                            v2 engine           excel / v1    rel.err
h certainty-equiv                    0.032113             0.032113    0.00e+0  OK
H0 human capital               2314142.308878       2314142.308878   4.02e-15  OK
Delta0 divisor                      29.538367            29.538367   1.20e-16  OK
W0 (bequest pinned)            1625207.229845       1625207.229845   4.30e-15  OK
equity share uncon                   5.876159             5.876159   3.93e-15  OK
```

Run `node src/test-reduction.mjs`, `test-features.mjs`, `test-countries.mjs`. All pass.

---

## Answers to what you asked

**Home vs foreign shares — removed.** It only set the equity sub-mix and barely moved
any headline number, while costing four expert-level inputs. Everyone is now assumed
globally diversified in the reference proportions. The parameter still exists in the
engine so the original workbook can be reproduced exactly.

**Real estate — added, as a liability not an asset.** Your home is not spendable; you
have to live somewhere. What *is* modelled is the mortgage: the payment stream enters
the liability side, and your spending visibly rises the year it is repaid. An optional
"downsize at age X, release Y%" converts part of the equity into spendable money.

**Early retirement — added, and separated from the pension date.** "Stop working at"
and "state pension starts at" are now two different fields. Set the first below the
second and the model shows exactly what you described: years with no income at all,
funded entirely from savings, with a warning naming the gap.

**Investment fees — added, and they are not already in the returns.** Standard capital
market assumptions are index returns quoted gross of every investor-borne cost; a tool
that feeds them in raw systematically over-promises. The fee comes straight off the
certainty-equivalent return, and a headline card shows the lifetime cost in spending
terms. For the median Czech household at 1.5% it is about 16% of lifetime discretionary
spending.

---

## Questions people can actually answer

**Risk.** You were remembering John Campbell's "demon gamble", and it is the right
instrument. A coin is tossed on your lifetime wealth: heads it rises a fifth, tails it
falls a fifth. How much would you pay to walk away? The answer maps to relative risk
aversion by solving the exact CRRA equation

```
(1 − π)^(1−γ) = ½(1+x)^(1−γ) + ½(1−x)^(1−γ)
```

Campbell's own shorthand is γ ≈ 2π/x², which is the Arrow–Pratt approximation — good
for explaining the question, poor above π ≈ 5%, so the code solves it exactly. The
mapping is validated against Kimball–Sahm–Shapiro (2008) Table 1, which it reproduces
to the published decimal. I used ±20% rather than Campbell's ±10% because it spreads
the plausible γ range of 1–12 across π = 2–15%, which people can actually express.

Two design features are why this question works where "rate your risk appetite 1–10"
does not: the stake is lifetime wealth rather than pocket money, which defuses the
Rabin critique, and the answer is a continuous number rather than a category.

**Patience.** Not "what is your subjective discount rate" but "which spending pattern
would you rather have — more now, level, or more later". The answer is inverted through
the Euler equation to recover ρ.

**Smoothing.** "Markets fall hard the year after you retire. What do you do?" Three
concrete answers map to the elasticity of intertemporal substitution.

**Bequest.** The research was emphatic that φ should not be elicited — it is a weight
inside a CES aggregator with no lay interpretation. So the interface asks for a money
target instead, or lets the model choose.

---

## Country data, and how it was checked

Nothing here is a plausible-looking number. Every figure is transcribed from an official
source and then validated by reproducing a published output.

**Mortality.** Real single-year life tables, ages 20–100, replacing the US-calibrated
Gompertz formula entirely.

| | Source | Check |
|---|---|---|
| UK | ONS *National life tables: UK*, 2022–2024 | reconstructed e65 = 18.73 M / 21.15 F vs published 18.73 / 21.16 |
| CZ | ČSÚ *Úmrtnostní tabulky*, 2025 | reconstructed e65 = 17.13 M / 20.77 F vs published 17.13 / 20.77 |

Ages above 100 are extrapolated to reach certainty at 115; below 20 is padded and never
used. Health adjustment shifts the whole curve by up to ±7 years.

**Tax**, reproduced to the penny against published worked examples:

| | Check |
|---|---|
| UK 2025/26 | tax + NI at £30k / £50k / £75k = £4,880 / £10,480 / £20,943 → 16.27% / 20.96% / 27.92% |
| CZ 2026 | daň + pojistné at 400k / 700k / 1.2M CZK = 75,560 / 155,360 / 288,360 → 18.89% / 22.19% / 24.03% |

Includes the UK personal-allowance taper above £100k (the 60% band), the NI upper
earnings limit, the Czech 15/23% threshold at 36× průměrná mzda, the sleva na
poplatníka, and the social-insurance cap at 48× průměrná mzda with health uncapped.

**State pensions.** These differ so fundamentally that a shared model would be a lie.

- **UK**: flat-rate. 35 qualifying years gives £11,973; below 10 years pays *nothing*;
  in between strictly pro rata. Earnings are irrelevant — two people on £25k and £250k
  with the same record get the identical pension. It cannot be taken early under any
  circumstance. State Pension age follows the legislated timetable (66 → 67 → 68).
- **CZ**: earnings-related and strongly redistributive. základní výměra plus 1.5% per
  insured year of the výpočtový základ, after the redukční hranice count the first
  21,546 CZK at 99% and everything to 195,868 CZK at 26%. Above 4× the average wage,
  nothing accrues at all. Reproduces MPSV's published replacement-rate table to within
  1 CZK at every point from 0.5× to 4× the average wage. Retirement age rises one month
  per birth cohort from 65 to a cap of 67.

**Earnings curves.** Cubic fits in log-earnings, within ±1.5% across ages 22–60.
UK peaks at 40–49 (ONS ASHE 2025); Czechia peaks at **30–39** and is markedly flatter
(ISPV 2025) — roughly ten years earlier than the US curve the original workbook used,
which materially changes human capital for anyone under 40.

---

## Couples

One household with joint survival, not two people added together. The household spends
while *either* partner is alive, so the consumption divisor uses P(at least one alive),
which is the whole reason a couple can spend more per person than a single person can.
Essential spending is scaled by the OECD-modified equivalence factor: a survivor needs
about two-thirds of what the couple needed, and the model transitions smoothly between
the two as the probabilities shift.

Sanity check from the test suite: with equivalence-scaled essentials a couple gets
1.90× a single person's spending — more than one, less than two, which is right.

---

## What I decided without asking

- The pension pot is counted **after** the tax you will pay on withdrawal (UK ≈ 15%
  after the 25% tax-free lump sum; CZ ≈ 5%). Shown as a note, not buried.
- Employer pension contributions count as human capital; your own contributions do not,
  since they only move money between your pockets.
- UK figures use England/Wales/NI rates, with an on-screen warning that Scotland differs.
- The default household is deliberately median, not comfortable: a 35-year-old on median
  pay with a real mortgage. The UK default has £8,092/year of discretionary spending,
  which is sobering and correct.

## Comparing two plans

Saved plans live in `localStorage`, keyed by country, and hold a whole state rather than a
diff. Pinning one solves it alongside the live plan — one extra run of the model per render,
which the 1.8 ms solve makes affordable enough to be live rather than a button.

Two decisions worth recording. Differences are coloured only where a direction is
meaningful: more spending and more net worth are better, but a larger bequest is a choice
and an equity share is a recommendation, so neither gets a verdict colour. And a difference
below a tenth of a percent is reported as "the same as", because a tool that reports
£8,298.14 against £8,298.09 as a change is lying about its own precision.

## Independent audit

Everything above was then independently audited; seventeen real defects were found and
fixed, with regression tests. See [AUDIT.md](AUDIT.md). The Czech state-pension section
above is superseded by it: the accrual and zápočet now follow the statutory glide path by
award year rather than being pinned to 2026, and the early-retirement rules are
implemented properly.

## Known limits

No children, no divorce, no redundancy, no long-term care. Investment returns are the
original Morningstar/Ibbotson capital market assumptions, which are US-centric — the
mortality, tax, pension and earnings layers are localised but the return assumptions are
not. Czech and UK real risk-free rates are set to 1.5% and are editable. Tax bands are
frozen in real terms, so long projections understate fiscal drag.

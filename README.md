# Lifetime Financial Planner

Two interactive calculators that answer one question: **how much can you afford to spend,
and how should you invest it, across your whole life?**

**Live: [martin-cimprich.github.io/lifetime-financial-planner](https://martin-cimprich.github.io/lifetime-financial-planner/)**

- `planner-uk.html` — United Kingdom, in English
- `planner-cz.html` — Česká republika, v češtině

Each is a single self-contained file. No build step, no dependencies, no backend, no
tracking. Open it locally or upload it to any static host. `index.html` is a front page
that offers the two and carries the disclaimer; it is hand-written rather than generated,
and nothing depends on it.

> **Educational tool, not financial advice.** It shows what one economic model implies
> from the numbers you type. It knows nothing about your circumstances. Speak to a
> qualified adviser before acting on anything it says.

---

## What it is

A faithful reimplementation of the **parent life-cycle model** from:

> Thomas M. Idzorek, CFA and Paul D. Kaplan, CFA (2024).
> *Lifetime Financial Advice: A Personalized Optimal Multilevel Approach.*
> CFA Institute Research Foundation.
> https://rpc.cfainstitute.org/research/foundation/2024/lifetime-financial-advice

and of the accompanying Excel workbook, **© 2026 Paul D. Kaplan**, whose VBA carries the
notice *"For non-commercial use only."* **This derivative keeps that restriction.**
See [NOTICE.md](NOTICE.md).

The model's central idea is worth stating plainly, because most people have never met it:

> Your future salary is an asset on your balance sheet, and it behaves like a bond.
> That is *why* a young person should hold shares — not because they "have time to
> recover", but because they are already holding an enormous bond, and shares are what
> balances it.

---

## Why a web version exists

The original workbook cannot reach a general audience. Since 2022 Microsoft blocks VBA in
any file carrying the Mark of the Web, which every downloaded or emailed file has. Because
the model *is* VBA, the failure mode is a wall of `#NAME?` errors with no explanation.
No amount of documentation fixes that.

Everything else follows from the port: recalculation in ~1.5 ms instead of "several
seconds", scenarios shareable as a URL, and it works on a phone.

---

## Fidelity to the original

The engine reproduces the workbook to machine precision. With couples, tax, housing and
fees switched off and the original Gompertz mortality, agreement is ~4×10⁻¹⁵ on every
shared quantity — asserted in `src/test-reduction.mjs`, so any future change that breaks
fidelity fails the build.

```
quantity                            engine             workbook    rel.err
h certainty-equiv                 0.032113             0.032113    0.00e+0
H0 human capital            2314142.308878       2314142.308878   4.02e-15
Delta0 divisor                   29.538367            29.538367   1.20e-16
W0 net worth                1625207.229845       1625207.229845   4.30e-15
```

### Three deliberate departures

All three are marked `DEVIATION` in `src/engine.mjs`. The first two make the same
mathematics more accurate rather than different; the third replaces a heuristic that is
strictly dominated by the alternative.

1. **The optimal bequest.** The workbook evaluates CRRA utility as `(x^pow − 1)/pow`.
   With the default γ = 0.25 the exponent is −3, so for consumption around 60,000 the
   meaningful term is ~4.6×10⁻¹⁵ against a constant of 1/3 — the entire economic signal
   falls below double precision, and the reported optimum is floating-point noise. The
   search is also a 99-point grid. Dropping the additive constant is an exact monotone
   transformation that removes the cancellation (the certainty-equivalent then collapses
   to a weighted power mean); with golden-section search the answer matches 50-digit
   arithmetic to 4×10⁻⁷ %. **At the workbook's own defaults this changes the optimal
   bequest by 12.5% and the headline spending figure by about 2.5%.**

2. **Bisection tolerance.** `SigmaSDFFn` stops at 1e-8, leaving ~6×10⁻⁸ relative error in
   every downstream quantity. Tightened; passing `bisectTol = 1e-8` reproduces the
   workbook bit-for-bit.

3. **The long-only allocation.** The workbook's `ReallocNeg` zeroes negative positions and
   rescales all the positives proportionally, which scales equity down alongside cash and
   so moves *away* from the target exposure. It is strictly dominated: in a worked case it
   landed 124,580 short of the target equity exposure where an all-equity portfolio was
   only 93,872 short. Replaced with a projection that gets equity as close to target as the
   budget allows; `reallocNeg` is retained for exact reproduction. This is the difference
   between telling a young renter to hold 22% in shares and telling them to hold 100%.

---

## What was added

| | |
|---|---|
| **Couples** | One household with joint survival. It spends while *either* partner is alive, which is why a couple can spend more per person than a single person. Essentials follow the OECD-modified equivalence scale. |
| **Tax** | Real bands and social contributions, reproduced to the penny against published worked examples. |
| **Housing** | Your home is not spendable — you have to live somewhere. The mortgage is a liability stream, and spending visibly rises when it is repaid. Optional downsizing releases equity. |
| **Fees** | Capital market assumptions are quoted *gross* of costs, so a tool that feeds them in raw over-promises. Fees come off the return, scaled by the share of net worth that is actually financial — nobody pays a platform fee on their salary. |
| **Job risk** | How share-like your earnings are drives how many shares your savings should hold. A civil servant's income is a bond; a founder's is not. |
| **Early retirement** | "Stop working at" and "state pension starts at" are separate. Set the first below the second and the model shows the income gap and warns about it. |
| **Disability risk** | Earnings arrive only while you can earn. Human capital is weighted by published disability incidence (CMI WP48 for the UK, ČSSZ invalidity awards for Czechia), which lowers human capital, spending and the recommended equity share. Treating a salary as a risk-free bond was the model's most flattering assumption. |
| **Comparing two plans** | Save the plan on screen, change something, and pin the saved one. Every headline figure gains a difference against it and the spending chart gains its line. "Retire at 62" against "retire at 67" is the question people actually have, and it needs two answers at once. Saved in the browser, per country, never sent anywhere. |
| **Income protection** | Priced from that same incidence and sized from your own balance sheet: the chance it happens, the cover that makes you whole, the cover worth buying at the market's margin, and what it costs. The margin is estimated from your occupation rather than asked for. Each earner in a couple is priced separately, on their own occupation and their own existing cover, because a household's biggest exposure is usually one particular salary. Campbell's self-insurance rule is shown alongside — and where the rule and the exact solve disagree, the copy says which is which. |

## Country data

Every figure is transcribed from an official source, then validated by reproducing a
published output.

| | Source | Validation |
|---|---|---|
| UK mortality | ONS *National life tables: UK*, 2022–2024 | reconstructed e₆₅ 18.73 M / 21.15 F vs published 18.73 / 21.16 |
| CZ mortality | ČSÚ *Úmrtnostní tabulky*, 2025 | reconstructed e₆₅ 17.13 M / 20.77 F vs published 17.13 / 20.77 |
| UK tax | gov.uk, 2025/26 | tax+NI at £30k/£50k/£75k = 16.27% / 20.96% / 27.92% |
| CZ tax | 2026 parameters | daň+pojistné at 400k/700k/1.2M CZK = 18.89% / 22.19% / 24.03% |
| UK pension | gov.uk new State Pension | flat-rate; 35 years → £11,973; under 10 years → nothing |
| CZ pension | ČSSZ / MPSV, 2026 | reproduces the published 2026 table exactly at all ten points; accrual and zápočet follow the statutory glide path by award year |
| UK earnings | ONS ASHE 2025 | cubic fit within ±1.5%, peak at 40–49 as published |
| CZ earnings | ISPV 2025 | cubic fit within ±1.5%, peak at 30–39 as published |

The two state pensions are structurally opposite, which is why a shared model would be a
lie: the UK's is flat-rate and cannot be taken early at any age; Czechia's is
earnings-related but so redistributive that nothing accrues above four times the average
wage.

## Asking questions people can answer

Instead of "enter your coefficient of relative risk aversion", the tool uses John
Campbell's **demon gamble**: a coin is tossed on your lifetime wealth, heads it rises a
fifth, tails it falls a fifth — how much would you pay to walk away? The answer is
converted by solving the exact CRRA indifference condition

```
(1 − π)^(1−γ) = ½(1+x)^(1−γ) + ½(1−x)^(1−γ)
```

Campbell's shorthand γ ≈ 2π/x² is the Arrow–Pratt approximation; it understates γ badly
above π ≈ 5%, so the code solves the equation exactly. The mapping is validated against
Kimball–Sahm–Shapiro (2008) Table 1, which it reproduces to the published decimal.

Patience is asked as a spending shape and inverted through the Euler equation.

The bequest weight φ has no lay interpretation, so the tool never names it: you either give a
money target or answer *how much does leaving something matter to you?* on three settings.
Leaving φ hard-coded, as it originally was, meant "let the model decide" was really an
invisible assumption deciding — and the answer is highly sensitive to it (φ = 0.01 gives
£117k where φ = 0.30 gives £243k on the same household).

The insurer's margin is handled the same way. It is the single number that decides how much
cover is worth buying and the one number a normal person cannot look up, so it is estimated
from the occupation answer and left visible and overridable in the assumptions box rather
than demanded as an input.

---

## Development

```bash
cd src
node build.mjs           # regenerates both HTML files from one codebase

node test-reduction.mjs  # engine still reproduces the Kaplan workbook exactly
node test-features.mjs   # couples, housing, fees, early retirement
node test-countries.mjs  # tax, pensions, mortality, risk mapping vs published figures
node test-personas.mjs   # economic direction-of-effect across realistic households
node test-cz-pension.mjs # Czech state pension against the ČSSZ published table
```

`build.mjs` regenerates the engine bundle from source on every run and refuses to write
if the result is incomplete. See [AUDIT.md](AUDIT.md) for why that guard exists.

| File | |
|---|---|
| `src/engine.mjs` | the model |
| `src/countries.mjs` | tax, pensions, earnings curves, risk elicitation |
| `src/lifetables.mjs` | generated from official mortality data — do not hand-edit |
| `src/i18n.js` | all user-facing copy, English and Czech |
| `src/app.js` | interface and charts |
| `src/build.mjs` | emits `planner-uk.html` and `planner-cz.html` |
| `index.html` | the front page — hand-written, not generated |

## Licence

Non-commercial use only, inherited from the reference implementation — see [LICENSE](LICENSE)
and [NOTICE.md](NOTICE.md). The restriction comes from Paul D. Kaplan's workbook and cannot
be waived here; commercial use needs his permission as well as the author's.

## Independent audit

Five independent reviewers were asked to break this, not to confirm it. They found
seventeen real defects — including one that silently cut the state pension of ten Czech
birth cohorts, and one in the build script that would have shipped every other fix as a
no-op. All are fixed and covered by regression tests. [AUDIT.md](AUDIT.md) records what was
found, how it was demonstrated, and what changed as a result.

## Known limits

No children, no divorce, no redundancy, no long-term care. Investment return assumptions
are still the original US-centric capital market assumptions — mortality, tax, pension and
earnings are localised, expected returns are not. Tax bands are frozen in real terms, so
long projections understate fiscal drag. UK figures use England/Wales/NI rates; Scotland
differs and the tool says so on screen.

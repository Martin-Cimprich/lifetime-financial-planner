# Attribution, licence and disclaimers

## The model

This software implements the **parent life-cycle model** described in:

> Thomas M. Idzorek, CFA and Paul D. Kaplan, CFA (2024).
> *Lifetime Financial Advice: A Personalized Optimal Multilevel Approach.*
> Charlottesville, VA: CFA Institute Research Foundation.
> ISBN 978-1-952927-37-9.
> https://rpc.cfainstitute.org/research/foundation/2024/lifetime-financial-advice

The monograph is © 2024 CFA Institute Research Foundation. It is cited here as the source
of the economic model. No part of the monograph's text, exhibits or figures is reproduced
in this repository.

Supporting method references used by the model, as cited in the original source code:

- Kaplan, Paul D. and Thomas M. Idzorek (2025). "A Hybrid Lifecycle Mean-Variance
  Optimization Model." *Financial Planning Review*.
  https://onlinelibrary.wiley.com/doi/epdf/10.1002/cfp2.70018
- Milevsky, Moshe A. (2012). *The 7 Most Important Equations for Your Retirement.* Wiley.
  (source of the Gompertz longevity model)
- Knuth, Donald E. (1973). *The Art of Computer Programming, Volume 3.* Addison-Wesley.
  (heap sort, used in the original salary-history routine)

## The reference implementation

The calculation engine here is a reimplementation of the VBA in the Excel workbook
**"IK Excel Lifecycle Model", © 2026 Paul D. Kaplan**, distributed by the CFA Institute
Research Foundation as a companion to the monograph.

That workbook's source carries the following notice, reproduced verbatim from its
`Module1`:

> ```
> 'Idzorek-Kaplan Excel Lifecycle Model
> '(c) 2026 Paul D. Kaplan
> 'For non-commercial use only
>
> 'The author wrote parts of the VBA code below while employed by Morningstar.
> 'While Morningstar makes no representation or warranty around its interest in the VBA code,
> 'to the extent it has an interest, Morningstar grants the author permission to use and modify
> 'the VBA code as the author sees fit for non-commercial purposes.
> ```

**This work is a derivative of that code and inherits its restriction: non-commercial use
only.** It may not be used for commercial purposes without permission from Paul D. Kaplan.

The original workbook itself, and the *IK Excel Lifecycle Model User Manual*, are not
redistributed in this repository. They are available from the CFA Institute Research
Foundation.

## Deviations from the reference implementation

Three changes were made. All are marked `DEVIATION` in `src/engine.mjs`. The first two
are numerical and make the same mathematics more accurate rather than different:

1. The optimal bequest is found by golden-section search on a numerically stable form of
   the objective, instead of a 99-point grid search on a form that loses the entire signal
   to floating-point cancellation. At the workbook's own defaults this changes the reported
   optimal bequest by 12.5%.
2. The bisection tolerance in `SigmaSDFFn` is tightened from 1e-8.

Passing `bisectTol = 1e-8` and pinning the bequest reproduces the workbook bit-for-bit;
`src/test-reduction.mjs` asserts this.

The third is economic. `ReallocNeg`, which imposes the long-only constraint, zeroes the
negative positions and rescales all the positives proportionally — which scales equity down
alongside cash and so moves away from the target equity exposure rather than toward it. It
is strictly dominated: in a worked case it landed 124,580 short of the target where an
all-equity portfolio was only 93,872 short. It is replaced by a projection that gets equity
as close to target as the budget allows. `reallocNeg` is retained for exact reproduction of
the workbook.

## Data sources

Country data is transcribed from official public sources and used as factual reference
data:

- **ONS**, *National life tables: UK, 2022–2024* — UK mortality. © Crown copyright,
  Open Government Licence v3.0.
- **Český statistický úřad**, *Úmrtnostní tabulky za ČR, 2025* — Czech mortality.
- **ONS**, *Annual Survey of Hours and Earnings 2025* — UK earnings by age.
- **ISPV**, *Struktura mezd zaměstnanců 2025* — Czech earnings by age.
- **gov.uk / HMRC** — UK income tax, National Insurance and State Pension parameters,
  tax year 2025/26.
- **MPSV, ČSSZ, Finanční správa ČR** — Czech tax, social and health insurance, and
  starobní důchod parameters, 2026.

## Disclaimer

**This is an educational tool. It is not financial, investment, tax or legal advice.**

It shows what one economic model implies from the numbers a user types. It makes no
allowance for children, divorce, redundancy, long-term care, or changes in the law. It
does not know the user's circumstances. Expected investment returns are assumptions, not
forecasts, and are drawn from the original model's US-centric capital market assumptions.

There is no guarantee of the accuracy of the calculations. Use at your own risk. Anyone
considering a financial decision should consult a suitably qualified and regulated adviser.

Neither the CFA Institute Research Foundation, nor CFA Institute, nor Paul D. Kaplan, nor
Thomas M. Idzorek, nor Morningstar has endorsed, reviewed or approved this implementation.

CFA® and Chartered Financial Analyst® are trademarks owned by CFA Institute.

## This implementation

Copyright © 2026 Martin Cimprich.

Non-commercial use only, inherited from the reference implementation above. Provided
without warranty of any kind, express or implied.

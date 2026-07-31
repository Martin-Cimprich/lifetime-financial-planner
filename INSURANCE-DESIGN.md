# Adding insurance — thinking it through before building

You asked how insurance would work in this model. The short answer is that the model
already contains one kind of insurance and is unusually well suited to a second, but the
kind most people mean by "insurance" does not belong in it at all. Worth separating those
three before writing any code.

---

## What is already there

**Life insurance is in the engine now.** It is how the bequest is funded. `liPerm(t)` prices
permanent cover as the present value of the probability of dying in each year, and the
bequest you choose is bought with a premium stream that sits on the liability side. This is
the Idzorek–Kaplan treatment and it is genuinely elegant: a bequest is a promise to pay a
certain sum at an uncertain date, which is exactly what life cover delivers, so the model
prices the promise rather than assuming you will happen to have the money left over.

It is invisible in the interface. Choosing "leave a specific amount" quietly buys the cover
and the cost shows up only as reduced spending. That is a missed teaching opportunity —
see the first proposal below.

**Annuities are in too.** The "convert savings to lifetime income" slider is longevity
insurance, and the model already shows the mortality credit that makes it valuable.

---

## The three kinds, and which belong

### 1. Longevity and bequest insurance — belongs, already present

Both are *intertemporal transfers under mortality risk*. They move money between states of
the world defined by how long you live, which is precisely the dimension this model is
built on. Nothing conceptual is missing; only presentation.

### 2. Income protection and critical illness — belongs, and is the real gap

This is the one worth building. Here is why it fits.

The model's central claim is that your future salary is an asset — for a young person, the
*dominant* asset. Every other asset on the balance sheet can be insured, and this one is
uniquely uninsurable by diversification: you cannot hold a portfolio of careers. If human
capital is 96% of what you own, then the largest single risk on your balance sheet is that
it stops.

The model currently treats human capital as certain apart from a market-correlated
fluctuation (`eqHC`, which the new job-risk question now sets). What it does not model is
the *idiosyncratic* risk — disability, illness, redundancy — that destroys a specific
person's earnings entirely while leaving markets untouched.

That omission has a direction: it makes the model **too optimistic** about young
households, and it makes its own advice ("hold shares, your salary is a bond") more
confident than it should be. A bond that can default is not a bond.

**How it would work.** Human capital is the present value of a stream that is currently
discounted only for mortality via the annuity factor. Add a hazard rate `λ(age)` for
permanent loss of earning capacity:

```
H = Σ_t  income(t) · P(still able to earn at t) · AF(t) · (1+kY)^(-t)
```

Buying income protection replaces the lost stream with a benefit, at a premium. The premium
stream joins the liability side exactly as life-cover premiums already do; the benefit
raises the survival-weighted income stream back toward its uninsured level. The engine's
existing `pdv()` and liability machinery handle both without structural change.

The output people would care about: *your unprotected human capital is £X; insuring it
costs £Y a year; here is what your plan looks like in the 8% of cases where it happens.*

**What it needs.** Disability incidence rates by age. These exist — UK insurers publish
CMI-based rates, and Czech ČSSZ publishes invalidity-pension incidence — but they are less
tidy than mortality tables and vary hugely by occupation. This is the real work, and it is
data work rather than modelling work.

### 3. Home, motor, travel, gadget — does not belong

These are small-loss, high-frequency insurances. In a life-cycle model they are simply part
of `cbar` — you pay premiums, that is essential spending, done. Modelling them explicitly
would add inputs without changing any decision the model exists to inform.

There is one exception worth naming: **catastrophic uninsured loss** (long-term care in the
UK, where costs are unbounded and state support is means-tested). That is a genuine
tail-risk hole in the plan, but it is a different modelling problem — a low-probability,
very large, late-life liability — and I would treat it separately rather than folding it in
with insurance generally.

---

## Three proposals, in order of value per unit of work

**A. Surface the life cover that already exists.** No new modelling at all. When the user
chooses a bequest, show what it costs: *"Leaving £200,000 costs £52,000 in today's money —
about £940 a year of spending. Term cover to age 70 would cost roughly a third of that
because you are unlikely to die before then."* This turns an invisible mechanism into the
model's most concrete lesson about insurance, and it is an afternoon's work.

**B. Add a "what if I could not work" scenario.** Still no new data. Let the user set an age
at which earnings stop permanently, and show the plan beside the baseline: how much spending
falls, how long savings last, what annual benefit would restore the baseline. That last
number is exactly the income-protection benefit they should be shopping for — arrived at
from their own balance sheet rather than a rule of thumb. Deterministic, honest, and it
makes the risk vivid without pretending to know a hazard rate.

**C. Full stochastic income protection.** Everything in section 2: hazard rates by age,
premiums on the liability side, human capital properly discounted for disability risk. This
is the version that changes the *recommendation* rather than just illustrating it — with
disability risk priced in, human capital is worth less and is less bond-like, so the
recommended equity share falls, particularly for the young. That is a real result and worth
having, but it needs occupation-varying incidence data I would want to source properly
rather than approximate.

I would do A and B first. They deliver most of the insight, need no new data, and B's output
is directly actionable. C is the honest version and should follow once the data question is
settled.

---

## One caution

Whatever gets built must not read as a recommendation to buy a product. The model's answer
to "should I insure this?" is a comparison of two plans, and the right framing is *here is
what this risk costs you and what protection would be worth* — never *you need cover*. The
disclaimer stays exactly where it is.


---

# Built: A and B

**A — the life cover you were already buying is now visible.** Choosing a bequest shows what
it costs, in the currency people feel: *"The model chooses £137,465, which costs £70,883 set
aside today and £2,100 a year of your own spending."* That last figure is the price of the
promise, and it is what life cover for the same sum is worth.

While building it, a related gap turned up. "Let the model decide" was choosing the bequest
by maximising `(1−φ)·u(ĉ) + φ·u(B/D)` with **φ hard-coded at 0.05** and exposed nowhere. The
answer is highly sensitive to it — φ = 0.01 gives £117k, φ = 0.30 gives £243k on the same
household — so the model's "decision" was really an invisible assumption's decision. φ is now
asked as *how much does leaving something matter to you?* with three settings, and the
resulting amount updates live.

**B — "what if you could not work?"** A new panel re-runs the whole plan with earnings
stopping permanently at an age you choose, and reports four things: spending if it happened,
the annual loss, the cover that would restore the plan, and how many years it would need to
pay. The state pension is protected in the shock, because incapacity earns credits toward it
in both countries — without that the loss is double-counted.

The output is the number to shop for, derived from the household's own balance sheet rather
than a rule of thumb. Two findings worth noting:

- For a median UK household at 35, losing earnings at 40 does not merely reduce spending —
  it takes discretionary spending **negative**, meaning essentials could not be met.
- The cover needed is **73–85% of gross salary**, against a market that caps income
  protection at 50–70%. The panel says so, and quantifies the residual gap. This is exactly
  the kind of thing a rule of thumb hides.

**C — income protection with real incidence rates** is next, pending disability incidence
data by age for both countries.


---

# Built: C, with real incidence data

## Where I was wrong

I told you risk aversion barely matters to how much cover you buy. **That was half right and the
half I got wrong is the interesting half.**

Mossin's theorem says that at an *actuarially fair* price, full cover is optimal for anyone
risk-averse at all. That part holds — the model reproduces it, buying 104–110% of full cover
at zero loading regardless of temperament. But real insurance carries a margin, and once it
does, risk aversion matters a great deal:

| Risk aversion over consumption | Cover bought, at a 50% margin |
|---|---|
| RRA 1 (log utility) | 34% of full |
| RRA 2 | 77% |
| RRA 4 | 89% |

That is not second-order. So the honest statement is: **how much you need** is set by your
balance sheet; **how much is worth buying** is set by the price *and* your risk aversion
together. I have corrected the tool's copy accordingly.

## The data

**UK** — CMI Working Paper 48 (IPM 1991-98), claim inception intensities per 1,000 healthy
lives, **52-week deferred period**, males occupation class 1, single years of age. WP48 is the
most recent fully public CMI table; IP06 and IP11 are subscriber-only. Scaled by 0.65 to bring
1991-98 experience to current levels, using WP48's own actual-versus-expected ratios.

The 52-week column is deliberate. Shorter deferred periods count people who later recover, and
this model treats the loss as permanent — a claim that survives a full year off work is much
closer to that.

**Czechia** — derived from ČSSZ open data: newly awarded **third-degree** invalidity pensions
(working capacity reduced by 70% or more) by five-year band, over the Eurostat population less
those already receiving one. The 60-64 band is excluded because it turns down as people reach
pension age, which is an artefact rather than a fall in morbidity.

**The two agree.** At age 40, the UK table gives 0.75 per 1,000 and the Czech data 0.68 — from
completely independent sources, thirty years apart, on different definitions. Both imply
incidence **doubles every 8-9 years of age**. That doubling is the assumption actually doing
the work; the levels are less certain than the shape.

Occupation multipliers are CMI's own (1.0 / 1.2 / 1.6 / 2.5 across the four classes), and the
female factor of 1.9 is from WP48 section 9.

## What it changes

Human capital is now weighted by the probability of still being able to earn. That is a real
correction, not decoration: treating earnings as certain made the model **too optimistic about
the young and too confident in its own advice**. A bond that can default is not a bond. Human
capital falls 1-2% at 35 and more at older ages, spending falls with it, and the recommended
equity share falls too.

The panel reports four numbers: the chance it happens before you retire, the cover that makes
you whole, the cover worth buying at the margin you set, and what that costs a year. For a UK
median earner at 35 in a desk job: 11.0% chance, £25,707 of cover to be whole, £17,995 worth
buying at a 50% margin, £793 a year. Heavy manual work more than doubles the chance to 25.3%
and the premium to £1,801.

## Honest limits

- One representative disability age rather than the full timing distribution, so the spread of
  outcomes is compressed even though the average is right.
- Recovery is not modelled; every incidence is treated as permanent. The bias is conservative —
  it makes insurance look more valuable than it is, not less.
- The Czech rates are population-based and therefore an upper bound for a medically underwritten
  life. The employment rate for 20-64s is 82%, and a disproportionate share of invalidity awards
  go to people already out of work.
- Czech premium data is genuinely poor. The only traceable published comparison is from 2012,
  and the Czech market sells lump-sum invalidity riders rather than monthly income benefit, so
  a UK-style price comparison does not map cleanly. The loading is therefore left as a slider
  rather than pre-filled with a false precision.

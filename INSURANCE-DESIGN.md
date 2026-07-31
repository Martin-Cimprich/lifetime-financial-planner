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

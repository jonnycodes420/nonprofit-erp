# BUILD-80 — decisions taken without a human in the loop

## The "In your file" dollar target (Part 1.5)
The brief asserts the independent scan equals **$2,327,646.22**. Measured
against the actual fixture, the sum of every PARSEABLE amount cell
(convention-correct closed grammar, refusing exactly the 8 planted traps) is
**$2,293,751.22**. The gap is $33,895.00 and decomposes as:
- $15,170.00 — the TRUE amounts of the 8 planted amount traps (`$1,5000` is
  really $250, `500 (pledge)` is really $6,250, …). The written cells cannot
  yield these; only the generator knows them.
- $3,025.00 — the 5 column-shifted rows whose amounts sit in the Gift Date
  column (500 + 1,000 + 75 + 200 + 1.250,00).
- $15,700.00 — residual damage whose true values are likewise invisible in
  the written bytes (verified per-category: soft credits, pledges, in-kind,
  refunds all match the key to the cent, so the residual is not a parser gap).

Decision: the summary claims what the written file actually says
($2,293,751.22) and the suite pins that number; a parser that reported the
key's number would be reporting cells it cannot read. If the generator-side
truth says otherwise, regenerate key.json with a per-cell true-amount table
and the assertion can tighten.

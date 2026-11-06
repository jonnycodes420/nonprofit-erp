// POLISH-5 · AN IMPACT METRIC IS SHOWN AS A SENTENCE, NOT A TEMPLATE. The
// Settings list printed the raw outcome template ("Your ${amount} has covered
// {n} …"). It now reads as it would for a donor who gave exactly the
// threshold once. JSX-free so a suite can import it.
// WALKB-1: the sentence, and its "1 student" not "1 students", come from the
// one helper every Impact Metrics sentence uses (shared/countWords.js).
import { impactSentence } from "../../../shared/countWords.js";

export function impactExample(template, thresholdDollars) {
  return impactSentence(template, { n: 1, amount: thresholdDollars });
}

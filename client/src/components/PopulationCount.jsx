// DEFINE-1 item 2. A POPULATION'S COUNT, WITH ITS NAME AND ITS SENTENCE UNDER IT.
//
// "Lapsed" was five populations on five screens and only one pair was defined
// anywhere. A screen that counts a named group of people draws it through this:
// the registry name (shared/populationWords.js), the number with its unit
// ("520 people", "519 households"), and the one sentence that defines it,
// written out under the number, never hover-only. An id the registry does not
// know draws nothing and says so in the console, and scripts/ci/population-ids.js
// fails the build on it before it ships.
import { population, unitWords } from "../../../shared/populationWords.js";
import { T } from "./shared";

export function populationLine(id, n) {
  const p = population(id);
  if (!p) return "";
  return `${p.name}: ${Number(n || 0).toLocaleString("en-US")} ${unitWords(id, n)}`;
}

export default function PopulationCount({ id, count, compact = false, style, testId }) {
  const p = population(id);
  if (!p) { console.warn(`PopulationCount: "${id}" is not a population`); return null; }   // eslint-disable-line no-console
  return (
    <div data-testid={testId || `population-${id}`} data-population={id} style={{ fontSize: compact ? 12.5 : 13, color: T.ink, ...style }}>
      <div><strong>{p.name}</strong>: <strong data-testid={`${testId || `population-${id}`}-n`}>{Number(count || 0).toLocaleString("en-US")}</strong> {unitWords(id, count)}</div>
      <div data-testid={`${testId || `population-${id}`}-sentence`} style={{ color: T.ink3, fontSize: compact ? 12 : 12.5, marginTop: 2, lineHeight: 1.45 }}>{p.sentence}</div>
    </div>
  );
}

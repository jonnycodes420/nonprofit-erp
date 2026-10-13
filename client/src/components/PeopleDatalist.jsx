// SCALE-2 · a <datalist> of people's names for what has been typed so far,
// read from the server (lib/people.js), in place of the first 2,000 names of a
// whole-org list the shell no longer holds. The browser still filters and
// offers them exactly as before; only where the names come from changed.
import { usePeoplePicker } from "../lib/people";

export function PeopleDatalist({ id, text, limit = 50 }) {
  const [rows] = usePeoplePicker(text, { match: "name", limit, emptyToo: true });
  return <datalist id={id}>{rows.map(d => <option key={d.id} value={d.name} />)}</datalist>;
}

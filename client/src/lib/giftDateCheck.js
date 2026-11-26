// INPUT-1 item 4 · A GIFT DATE HAS TO BE POSSIBLE.
// Before 1970 or more than a year ahead asks first; it never blocks (an
// estate's old gift is real). The question names the date as she will read it.
import { fmtDay } from "./money";
import { orgTodayCivil } from "./orgToday";

const plusYear = d => `${Number(d.slice(0, 4)) + 1}${d.slice(4, 10)}`;

export function oddGiftDate(date, today = orgTodayCivil()) {
  const d = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d < "1970-01-01") return { date: d, why: "That is before 1970." };
  if (d > plusYear(today)) return { date: d, why: "That is more than a year from today." };
  return null;
}

// true = save as typed; false = she chose to change it.
export async function confirmGiftDate(askConfirm, date, today) {
  const odd = oddGiftDate(date, today);
  if (!odd) return true;
  return !!(await askConfirm({ title: `Is ${fmtDay(odd.date)} right?`, body: `${odd.why} Keep the date as typed, or change it.`, yes: "Yes, keep it", no: "Change it" }));
}

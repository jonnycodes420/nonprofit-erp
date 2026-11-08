// client/src/components/inputs/LazyDateInput.jsx · POLISH-6. The one date box,
// loaded when it is first shown. Home's first look (perf-app's byte budget) only
// shows a date box after a click ("Not now", a drift card's snooze), so Home
// asks for its code then, not before. Same props as DateInput.
import { lazy, Suspense } from "react";

const DateInput = lazy(() => import("./DateInput"));

export default function LazyDateInput(props) {
  return (
    <Suspense fallback={<input type="text" disabled aria-busy="true" placeholder="MM/DD/YYYY" style={props.style} />}>
      <DateInput {...props} />
    </Suspense>
  );
}

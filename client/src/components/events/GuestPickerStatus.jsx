// components/events/GuestPickerStatus.jsx · FLOWS-10 items 2 and 3 (W-1112-Volunteers-20, -01X).
// The guest picker's one line when it shows nobody: while the answer is coming it says so
// ("Looking…", never "Everyone on file is already on the list"), a failed search says it failed
// (never "Nobody on file matches"), and only an answer with nobody in it says nobody matches.
const LINE = { fontSize: 12, color: "rgba(240,237,230,0.7)", padding: "12px 0", textAlign: "center" };

export default function GuestPickerStatus({ pending, failed, search }) {
  if (failed) return <div data-testid="ev-dir-failed" role="alert" style={LINE}>The search did not answer, so this is not a list of who is on file. Type again to try once more.</div>;
  if (pending) return <div data-testid="ev-dir-looking" role="status" style={LINE}>Looking…</div>;
  const typed = String(search || "").trim();
  return <div data-testid="ev-dir-none" style={LINE}>{typed ? `Nobody on file matches "${typed}". Add them as a new guest instead.` : "Everyone on file is already on the list."}</div>;
}

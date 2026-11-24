// TributeFields.jsx · THANKS-1 item 5. THE TRIBUTE, ONE PIECE.
// The full gift form (GiftForm, create and edit) and the quick Record a gift
// dialog show the same four fields: in honor or in memory, who it honors (a
// record, or a name only), who to tell and their email. The body they save is
// lib/giftForm.js extrasBody's rule (tribute only when a type and a person are set).
import PersonField from "./PersonField";

export default function TributeFields({ form: f, set, pickPerson, typed, inp, compact = false, testid = "gift-trib" }) {
  return (<>
    <select value={f.tribType || ""} onChange={e => set({ tribType: e.target.value })} style={inp} data-testid={testid + "-type"}>
      <option value="">Not a tribute gift</option><option value="honor">In honor of</option><option value="memory">In memory of</option>
    </select>
    <PersonField label="Who it honors" value={f.trib || null} onChange={pickPerson("trib")} onTyped={typed("trib")} nameOnlyOk compact={compact} testid={testid + "-name"} />
    <input value={f.tribNotify || ""} onChange={e => set({ tribNotify: e.target.value })} placeholder="Tell (e.g. the Lee family)" style={inp} data-testid={testid + "-notify"} />
    <input value={f.tribNotifyEmail || ""} onChange={e => set({ tribNotifyEmail: e.target.value })} placeholder="Their email or leave blank" style={inp} data-testid={testid + "-notify-email"} />
  </>);
}

// The tribute as POST /donors/:id/gifts takes it (the same rule as lib/giftForm.js).
export const tributeBody = f => (f.tribType && f.trib
  ? { tribute: { type: f.tribType, donorId: f.trib.id || null, name: f.trib.name, notifyName: f.tribNotify || null, notifyEmail: f.tribNotifyEmail || null } } : {});

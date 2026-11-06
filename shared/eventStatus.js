// shared/eventStatus.js · MOPUP-1. AN EVENT'S STATUS IS ITS DATE.
//
// The stored status was set once, at "upcoming", and stayed there, so a gala
// held last month still said "Upcoming". What a person reads is derived from
// the event's date against the org's today: Upcoming, Today, Past. A canceled
// event says Canceled whatever its date; one marked completed is Past.

// ev: { status, date, end_date }; today: the org's civil day "YYYY-MM-DD".
export function eventStatus(ev, today) {
  const status = String((ev && ev.status) || "").toLowerCase();
  if (status === "cancelled" || status === "canceled") return { key: "canceled", label: "Canceled" };
  if (status === "completed") return { key: "past", label: "Past" };
  const start = String((ev && ev.date) || "").slice(0, 10);
  const end = String((ev && ev.end_date) || "").slice(0, 10) || start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !today) return { key: "upcoming", label: "Upcoming" };
  if (end < today) return { key: "past", label: "Past" };
  if (start <= today) return { key: "today", label: "Today" };
  return { key: "upcoming", label: "Upcoming" };
}

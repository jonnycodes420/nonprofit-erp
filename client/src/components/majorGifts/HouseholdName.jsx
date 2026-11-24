// components/majorGifts/HouseholdName.jsx · HOUSEHOLD-1. A household's name on a
// list row: both people's photos side by side, the household's name, and each
// person by name (each opens their own profile, with their own contact details).
import { T, PersonMark } from "../shared";
import { DonorLink } from "../RecordLink";

export function HouseholdPhotos({ people, size = 26 }) {
  return (
    <span style={{ display: "inline-flex", flexShrink: 0 }} aria-hidden="true">
      {(people || []).slice(0, 3).map((p, i) => (
        <PersonMark key={p.id} id={p.id} name={p.name} url={p.photoUrl === undefined ? undefined : p.photoUrl} size={size}
          style={{ marginLeft: i ? -size / 3 : 0, border: "2px solid " + T.white, borderRadius: "50%" }} />
      ))}
    </span>
  );
}

export function HouseholdName({ row, onNavigate, sentence }) {
  const open = id => onNavigate ? () => onNavigate("donors", { selectDonorId: id }) : undefined;
  const first = n => String(n || "").trim().split(/\s+/)[0];
  return (
    <div data-testid="household-name" style={{ minWidth: 0 }} title={sentence}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <HouseholdPhotos people={row.people} size={22} />
        <span style={{ fontSize: 10, fontWeight: 800, color: T.ink3 }}>Household</span>
      </div>
      <DonorLink id={row.donorId} onOpen={open(row.donorId)} style={{ fontWeight: 700, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>{row.name}</DonorLink>
      <div style={{ fontSize: 11, color: T.ink3 }}>
        {row.people.map((p, i) => (
          <span key={p.id}>{i ? (i === row.people.length - 1 ? " and " : ", ") : ""}<DonorLink id={p.id} onOpen={open(p.id)} title={p.name} style={{ color: T.ink3 }}>{first(p.name)}</DonorLink></span>
        ))}
      </div>
    </div>
  );
}

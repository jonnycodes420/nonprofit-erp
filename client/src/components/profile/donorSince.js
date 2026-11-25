// components/profile/donorSince.js (PROFILE-4) · "DONOR SINCE 2017" UNDER THE NAME.
//
// The year comes from the same GET /people/:id the rail's role line reads
// (profileShared RoleLine, FIX-8 Part B.2): its first_gift_date is the one
// first gift (shared/numbers/firstGift.js), and the read is part of the
// profile's first-screen bundle (server/donors/profileBundle.js), so this is
// not a second trip. The adapted donor object does not carry the date (the
// adaptDonor field-name trap), which is why it is read here and not from it.
// A person with no gift is never called a donor (PROFILE-3), so the hook says
// nothing for them.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";

export function useDonorSince(donorId, noGifts) {
  const [year, setYear] = useState(null);
  useEffect(() => {
    let gone = false;
    setYear(null);
    if (!donorId) return undefined;
    apiFetch(`/people/${donorId}`).then(r => {
      if (gone || !r) return;
      const y = String(r.first_gift_date || "").slice(0, 4);
      if (/^\d{4}$/.test(y)) setYear(y);
      else if (Number(r.gift_count) > 0) setYear("unknown");   // IMPORT-4: every gift on file is undated
    }).catch(() => {});
    return () => { gone = true; };
  }, [donorId]);
  if (noGifts || !year) return null;
  return year === "unknown" ? "Donor since: unknown" : `Donor since ${year}`;
}

// DEVBOARD-1 · /ops: the whole machine on one page (super-admins only; the
// API answers 404 to anyone else). Reads GET /ops once, then every two minutes.
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api";
import OpsView from "./ops/OpsView";

export default function OpsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => apiFetch("/ops")
      .then(d => { if (live) { setData(d); setError(null); } })
      .catch(e => { if (live) setError(e && e.status === 404 ? "This page is for Steward's super-admins." : "The ops summary could not be read. Try again in a minute."); });
    load();
    const t = setInterval(load, 120000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return <OpsView data={data} error={error} />;
}

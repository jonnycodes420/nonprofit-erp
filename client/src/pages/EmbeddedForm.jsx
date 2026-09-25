// client/src/pages/EmbeddedForm.jsx — BUILD-102 (Steward Give) Part 4.
// THE FORM AS IT APPEARS INSIDE AN ORG'S OWN WEBSITE.
//
// Reached only at /embed/:formId, which is what `embed.js` points its iframe at.
// It renders the SAME `GiveSteps` the hosted giving page renders, from the SAME
// `formSpec` — an embedded form that differed from the hosted one would be a
// second product with a second set of bugs.
//
// ── IT POSTS ITS HEIGHT OUT AND ACCEPTS NOTHING IN ─────────────────────────
// There is deliberately NO message listener here. "The frame refuses to be driven
// by a postMessage from a foreign origin" is then true by construction rather than
// by a check somebody has to keep correct: there is nothing to drive. The height
// goes to `parent` with a targetOrigin of "*", which is safe because a height is
// not a secret — and it is the only thing that ever leaves.
//
// ── AND AN ARCHIVED FORM IS A QUIET LINE, NOT AN ERROR ─────────────────────
// This is sitting on a page the organisation is judged by. A 404 there renders as
// a broken box; "This form is closed." is the truth and costs them nothing.

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { T } from "./publicTheme";
import { resolvePairing, cardChrome, THEME_DEFAULTS } from "../lib/portalTheme";
import { errorMessage } from "../lib/domainError";
import GiveSteps from "./GiveSteps";

function grossUpCents(baseCents) {
  return Math.ceil((baseCents + 30) / (1 - 0.029));
}

function resolveTheme(theme) {
  const t = theme || {};
  const pairing = resolvePairing(t.typePairing);
  return {
    primary: t.primary || THEME_DEFAULTS.primary,
    primaryFg: t.primaryFg || THEME_DEFAULTS.primaryFg,
    serif: pairing.display, sans: pairing.body,
    cardStyle: t.cardStyle, displayName: t.displayName,
    pageBg: t.pageBg || T.bg,
  };
}

export default function EmbeddedForm() {
  const { formId } = useParams();
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/forms/${encodeURIComponent(formId)}/public`)
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!alive) return;
        if (!ok) { setLoadErr("not_found"); return; }
        setData(b);
      })
      .catch(e => { if (alive) setLoadErr(errorMessage(e, "load_failed")); });
    return () => { alive = false; };
  }, [formId]);

  // THE HEIGHT, MEASURED AND SENT. A ResizeObserver rather than a timer, so the
  // host page's layout settles as soon as a step changes rather than up to a
  // second later.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const send = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + 8;
      try {
        // A height is not a secret, so "*" is the honest targetOrigin: we do not
        // know the host's origin and must not have to.
        window.parent.postMessage({ steward: "give-height", formId, height: h }, "*");
      } catch { /* not framed, or a browser that refuses — nothing is lost */ }
    };
    send();
    let ro = null;
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(send); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [formId, data, submitErr, submitting]);

  const postDonation = useCallback(async (payload) => {
    setSubmitting(true); setSubmitErr("");
    try {
      const r = await fetch(`${API}/donate/${data.org.slug}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, givingPageId: data.form.id }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "Something went wrong.");
      // TOP-LEVEL NAVIGATION, on the donor's own click — which is exactly what
      // `allow-top-navigation-by-user-activation` permits and why Checkout opens
      // as a real page rather than a frame inside a frame nobody can read.
      window.top.location.href = b.url;
    } catch (e) {
      setSubmitErr(errorMessage(e, "That did not go through. Please try again."));
      setSubmitting(false);
    }
  }, [data]);

  const th = resolveTheme(data?.org?.theme);
  const wrap = {
    fontFamily: th.sans, background: "transparent", color: T.ink,
    padding: "8px 8px 16px", display: "flex", justifyContent: "center",
  };
  const card = { background: T.white, ...cardChrome(th.cardStyle, T.bg3), padding: "22px 24px" };

  if (loadErr === "not_found") {
    // An id that never existed. Still no error box: somebody pasted a wrong id and
    // the donor on the page is not the person who can fix it.
    return (
      <div ref={rootRef} style={wrap}>
        <div style={{ ...card, maxWidth: 480, width: "100%", fontSize: 14, color: T.ink3 }} className="embed-closed">
          This form is not available.
        </div>
      </div>
    );
  }
  if (!data) return <div ref={rootRef} style={{ ...wrap, minHeight: 120 }} />;

  if (data.closed) {
    return (
      <div ref={rootRef} style={wrap}>
        <div style={{ ...card, maxWidth: 480, width: "100%", fontSize: 14, color: T.ink3 }} className="embed-closed">
          {data.message || "This form is closed."}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} style={wrap}>
      <GiveSteps
        spec={data.form.spec}
        formId={data.form.id}
        theme={th}
        coverFeesEnabled={data.org.coverFeesEnabled}
        upsellThresholdCents={data.form.upsellThresholdCents}
        grossUpCents={grossUpCents}
        submitting={submitting}
        submitErr={submitErr}
        onSubmit={postDonation}
        styles={{
          card,
          inp: { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid " + T.bg3,
                 fontSize: 15, fontFamily: th.sans, boxSizing: "border-box", background: T.white, color: T.ink },
          btn: { width: "100%", padding: "14px 0", borderRadius: 10, border: "none", cursor: "pointer",
                 background: th.primary, color: th.primaryFg, fontSize: 16, fontWeight: 700, fontFamily: th.sans },
          quiet: { background: "none", border: "none", padding: 0, cursor: "pointer",
                   color: th.primary, fontSize: 14, fontWeight: 600, textDecoration: "underline", fontFamily: th.sans },
        }}
      />
    </div>
  );
}

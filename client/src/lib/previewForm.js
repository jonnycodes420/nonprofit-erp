// client/src/lib/previewForm.js · GIFTS-3 item 4. THE PREVIEW DRAWS THE DRAFT'S FORM.
//
// The giving page editor's preview drew the form the SERVER had for the page.
// A page whose form had never been set up kept its old one-step form there
// (monthly first, an Annual button, the org's $10 to $500 ladder) whenever the
// form she set happened to equal Steward's defaults, and before an autosave
// landed it drew the last saved form. Now the preview takes the form she is
// editing, built by the same formSpec the server uses, the moment she changes it.
//
// With "Suggest amounts from your giving" on, the preview still shows her own
// amounts and says above them that the live page builds amounts from gifts.
import { formSpec } from "../../../shared/formConfig.js";

export const SMART_PREVIEW_SENTENCE = "The live page builds amounts from your gifts.";

// gp: the server's givingPage payload; ds: the draft settings; funds: [{ id, name }].
export function draftForm(gp, ds, funds = [], orgName = "") {
  const server = gp && gp.form ? gp.form : null;
  if (!ds || !ds.form || typeof ds.form !== "object") return server;
  // A page that was never set up and whose form she has not touched keeps its old form.
  if (!(ds.formSet === true || (server && server.configured))) return server;
  const spec = formSpec(ds.form, { funds: (funds || []).map(f => ({ id: f.id, name: f.name })), orgName });
  const out = { ...spec, configured: true, variant: (server && server.variant) || "a" };
  if (ds.form.smartAmounts === true) {
    const detail = server && server.amount && server.amount.liveSentence ? " " + server.amount.liveSentence : "";
    out.amount = { ...out.amount, liveSentence: SMART_PREVIEW_SENTENCE + detail };
  }
  return out;
}

// lib/pagePublish.js · POLISH-8. A LIVE GIVING PAGE CAN BE TAKEN DOWN.
//
// Fundraising's page card offered only Remove, so Year-end 2026 was left live.
// Live → Unpublish puts it back to Draft (status 'draft'): its link then says
// "This page isn't taking gifts right now" (server/org/publicPages.js) and no
// gift can be made through it. Draft → Publish puts it back. Remove still asks
// first (RemoveMenu's confirm). Each change offers Undo.
import { apiFetch } from "../api";
import { offerUndo } from "../components/EditHistory";

const setStatus = (p, status) => apiFetch(`/giving-pages/${p.id}`, { method: "PUT", body: JSON.stringify({ status }) });

export const isDraftPage = p => !!p && p.status === "draft";

// The items above Remove in the card's More menu.
export function publishItems(p, onChanged) {
  if (!p || p.page_kind === "volunteer") return [];
  const flip = async (to, word) => {
    await setStatus(p, to);
    onChanged && onChanged();
    offerUndo({ message: `${word} ${p.title}.`, undoAction: async () => { const r = await setStatus(p, p.status); onChanged && onChanged(); return r; } }, word);
  };
  return isDraftPage(p)
    ? [{ label: "Publish", testid: "page-publish", onClick: () => flip("active", "Published") }]
    : [{ label: "Unpublish", testid: "page-unpublish", onClick: () => flip("draft", "Unpublished") }];
}

# BUILDER-2A · For the fleet

**Surfaces changed:** no screen. This build is the renderer, the block model and the server under the email editor
(BUILDER-2 wires it into the screen). What a person can reach today, through the existing editors and the API:
the email preview (Communications → Templates → any template; a campaign's editor), which now draws four new block
types when they are present; Settings → Brand's save (`PUT /portal-settings`), which now takes `socialLinks`;
and five new routes: `/email-blocks` (list, save, rename, delete with Undo, use), `/email-blocks/ready` (Steward's
ready-made sections), and `POST /email-export`. The editor's add menu is unchanged on purpose (the new blocks carry
`menu: false` until BUILDER-2).

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Communications → Templates → open each starter (Year-end appeal, Thank you: first
   gift, Event invitation). The preview looks exactly as it did last night: same photo boxes, same words, same
   button colours. Toggle Phone and Dark. Nothing moved (this build held every starter to the same bytes).
2. **(Read only, Harborlight.)** Open a campaign in the editor, type a word, Save, reopen: the word is there and
   the blocks are in the same order (the validator now keeps an `id` and a `style` on a block; neither is added).
3. **(Needs a write: org_stagewalk.)** Signed in as the walker, from the browser console or a script:
   `POST /email-blocks {name:"Fleet check", blocks:[{type:"divider"}]}` answers 201 with `parts: 1` and a preview;
   `POST /email-blocks/<id>/use` twice gives two different `blk_…` ids; `DELETE /email-blocks/<id>` answers with
   `undoIds`; `POST /removals/undo {undoIds}` brings it back (it is listed again); delete it again to clean up.
   Off the happy path: a second `POST /removals/undo` with the same ids answers 409, and saving
   `{blocks:[{type:"header"}]}` is refused with "The header and the footer come with every email".
4. **(Read only.)** `GET /email-blocks/ready` lists Story with a photo, Impact numbers, Event invite, Thank-you from
   the director and Year-end tax note, each with a preview in the org's colours; nothing is written by the GET.
5. **(Read only.)** `POST /email-preview` with `blocks:[{type:"code",html:"<p onclick=\"x()\">Hi</p>"}]` answers 200
   with "Steward took out the onclick handler on <p>" in `problems`, and the HTML has no `onclick`.

**What could have broken nearby:** every email render (campaign sends, journey and sequence emails, one-person
drafts, receipts, the template preview and "Send me a test") goes through the same `renderEmail`, now with a
recursive block loop; the template and campaign saves (the validator was restructured); Settings → Brand's save;
the Remove/Undo registry (a new kind, `saved_block`); the tenant matrix's route inventory.

**Needs a write:** 3 must run in org_stagewalk, not Harborlight. 1, 2, 4 and 5 are read only.

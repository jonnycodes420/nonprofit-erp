## AUTOMERGE-1 · Let green PRs merge themselves (2026-11-09)

Until step 2 is done, nothing changes: both workflows print "AUTOMERGE_TOKEN not set; merge by hand" and pass.

1. Allow auto-merge: `gh api -X PATCH repos/jonnycodes420/nonprofit-erp -F allow_auto_merge=true -F delete_branch_on_merge=true`
2. Create a fine-grained token at github.com → Settings → Developer settings → Fine-grained tokens. Give it this repo only, with Contents read/write, Pull requests read/write and **Workflows read/write**, expiring in 90 days. The brief listed only the first two. Without Workflows, GitHub refuses to merge a PR that changes `.github/workflows/`, or to pull such a change from main into a queued PR. Then run `gh secret set AUTOMERGE_TOKEN -R jonnycodes420/nonprofit-erp` and paste the token at the prompt, so it never shows in the terminal. Set a reminder to renew it before it expires; when it lapses, merges go back to by hand.
3. Leave the rules on main as they are. Checked 9 Nov: the `main-protection` ruleset requires the `test` check and up-to-date branches, and blocks force-push and deletion. Classic branch protection is off and can stay off. If that ruleset is ever removed, automerge.yml stops turning auto-merge on (it would otherwise merge before CI) and says so.

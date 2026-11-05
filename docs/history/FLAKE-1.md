## FLAKE-1 · CI stops failing on things no change touched (2026-11-05)

Every build on 5 Nov lost CI runs to failures their changes never touched.

**Playwright installs.** The Azure Ubuntu mirror sent Playwright's 181 system packages (114 MB) at a few KB/s. The step's `timeout` could not kill the root apt-get, and the retry died on that apt-get's dpkg lock (apt exit 100). The fix is `scripts/ci/install-playwright.sh`. The packages are cached as `.deb` files, a hung attempt is killed under `sudo timeout`, dpkg is repaired between attempts, both browsers are launched, and there are three tries. The caches are saved right after the install, and a `playwright-cache` job fills them from main, where every PR can read them.

**Deploys.** Both deploy jobs shared one concurrency group, and a group holds one pending job, so a newer pending job cancelled the older one. Two close merges could leave a backend never deployed. Each deploy now has its own group per commit. `scripts/ci/deploy-turnstile.js` makes deploys go out in merge order and never puts back a commit older than the live one.

**Timing suites.**
- deploy1-ready §1 now asks Ask first and reads /ready after, and its slow boot step is longer.
- security and perf-app measure once more, with the reason logged, when a reading is over its bar. The bars are unchanged.
- surfaces-agree runs on its own stack with a pinned clock. The Pia January disagreement it catches is the product's own, and was left red for the next brief.
- status1 §4's plant was invisible whenever the scores pass had written a newer row, because the lists read the newest of the two rows. The plant is now the newest row.

#!/usr/bin/env bash
# FLAKE-1 · PLAYWRIGHT AND ITS SYSTEM PACKAGES NEVER FAIL A SHARD.
#
# On 5 Nov every build lost runs here before a single test ran: "Playwright
# install failed or hung", then apt exit 100. The log of run 42099533504
# (shard 4) shows why. `--with-deps` asked the Azure Ubuntu mirror for 181
# packages, 114 MB, and the mirror sent them at a few KB/s (fonts-wqy-zenhei:
# two minutes). The 360 s `timeout` killed npx but not the root apt-get it had
# started (a user's `timeout` cannot signal a root process), so the retry
# waited the full five minutes for /var/lib/dpkg/lock-frontend, which that
# orphan still held, and failed.
#
# So, in this order:
#   1. apt waits for its locks (ten minutes, not five), retries a fetch, and
#      KEEPS what it downloads.
#   2. The .debs come from the Actions cache (PW_DEB_CACHE, restored by
#      ci.yml) and go into apt's own archive, so on a warm cache apt downloads
#      nothing and the slow mirror is not on the path at all.
#   3. Each attempt is the npm package, the system packages, the browsers and
#      a real launch of Chromium and WebKit. The system packages run under
#      `sudo timeout`, so a hung attempt is killed with its apt-get (timeout,
#      as root, signals its whole process group), and dpkg is repaired before
#      the next try.
#   4. Up to three attempts, each one logged. Only the third failure fails.
#
# usage: bash scripts/ci/install-playwright.sh <version>
# env:   PLAYWRIGHT_DIR (the package goes here), PLAYWRIGHT_BROWSERS_PATH,
#        PW_DEB_CACHE (a folder of .debs the Actions cache restores and saves)
set -uo pipefail

VER="${1:?usage: install-playwright.sh <playwright version>}"
DIR="${PLAYWRIGHT_DIR:?PLAYWRIGHT_DIR is not set}"
DEBS="${PW_DEB_CACHE:-$PWD/.playwright-debs}"
BROWSERS=(chromium webkit)
ATTEMPTS="${PW_INSTALL_ATTEMPTS:-3}"
log() { echo "[playwright] $*"; }

# ── 1. apt: wait for locks, retry fetches, keep the .debs ────────────────────
sudo tee /etc/apt/apt.conf.d/99steward-ci >/dev/null <<'EOF'
DPkg::Lock::Timeout "600";
Acquire::Retries "5";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
EOF
sudo rm -f /etc/apt/apt.conf.d/99steward-lock-wait /etc/apt/apt.conf.d/docker-clean

LOCKS=(/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock)
wait_apt() {
  # The image's own apt-daily or unattended-upgrades can still hold apt at
  # boot, and a killed attempt's apt-get takes a moment to let go.
  for i in $(seq 1 120); do
    sudo fuser "${LOCKS[@]}" >/dev/null 2>&1 || return 0
    if [ $((i % 12)) -eq 1 ]; then log "apt is busy; waiting ($(sudo fuser "${LOCKS[@]}" 2>&1 | tr -s ' \n' ' '))"; fi
    sleep 5
  done
  log "apt was still busy after ten minutes"; return 1
}

# ── 2. the cached .debs into apt's archive ───────────────────────────────────
mkdir -p "$DEBS"
n_cached=$(find "$DEBS" -maxdepth 1 -name '*.deb' | wc -l | tr -d ' ')
if [ "$n_cached" -gt 0 ]; then
  sudo cp -n "$DEBS"/*.deb /var/cache/apt/archives/ 2>/dev/null || true
  log "restored $n_cached cached .deb files into apt's archive"
else
  log "no cached .deb files: apt downloads them this once"
fi

# ── 3. one attempt ───────────────────────────────────────────────────────────
mkdir -p "$DIR"
# WRITTEN, not `npm init -y`-ed: npm derives the name from the directory and
# refuses a leading dot ("Invalid name: '.playwright'").
[ -f "$DIR/package.json" ] || printf '{"name":"steward-ci-playwright","version":"1.0.0","private":true}\n' > "$DIR/package.json"
have_pkg() { [ "$(node -p "try{require('$DIR/node_modules/playwright/package.json').version}catch{''}" 2>/dev/null)" = "$VER" ]; }
attempt() {
  if ! have_pkg; then
    (cd "$DIR" && timeout -k 10 300 npm i --no-audit --no-fund "playwright@$VER") || { log "npm i playwright@$VER failed or hung"; return 1; }
  fi
  wait_apt || return 1
  sudo env "PATH=$PATH" timeout -k 15 420 "$DIR/node_modules/.bin/playwright" install-deps "${BROWSERS[@]}" \
    || { log "the system packages failed or hung (exit $?)"; return 1; }
  (cd "$DIR" && timeout -k 10 360 ./node_modules/.bin/playwright install "${BROWSERS[@]}") \
    || { log "the browser download failed or hung (exit $?)"; return 1; }
  # A real launch, so a missing library is found here and not by a suite.
  timeout -k 5 120 node -e "
    const pw = require('$DIR/node_modules/playwright');
    (async () => { for (const b of ['chromium', 'webkit']) { const x = await pw[b].launch(); await x.close(); console.log('[playwright] ' + b + ' launches'); } })()
      .catch(e => { console.error('[playwright] launch failed: ' + e.message.split('\n')[0]); process.exit(1); });" || return 1
}

# ── 4. up to three attempts ──────────────────────────────────────────────────
for i in $(seq 1 "$ATTEMPTS"); do
  echo "::group::Playwright $VER, attempt $i of $ATTEMPTS"
  if attempt; then
    echo "::endgroup::"
    # What apt fetched, kept for the next run's cache (ci.yml saves $DEBS).
    cp -n /var/cache/apt/archives/*.deb "$DEBS"/ 2>/dev/null || true
    log "installed on attempt $i; $(find "$DEBS" -maxdepth 1 -name '*.deb' | wc -l | tr -d ' ') .deb files kept for the cache"
    log "playwright $(node -p "require('$DIR/node_modules/playwright/package.json').version")"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::Playwright install attempt $i of $ATTEMPTS failed; repairing apt and trying again"
  wait_apt || true
  sudo dpkg --configure -a || true
  sleep $((i * 10))
done
echo "::error::Playwright $VER did not install in $ATTEMPTS attempts"
exit 1

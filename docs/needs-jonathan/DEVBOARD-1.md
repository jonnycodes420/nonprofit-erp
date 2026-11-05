# DEVBOARD-1 · what waits on Jonathan

- A read-only GitHub token for /ops: a fine-grained token on jonnycodes420/nonprofit-erp with Actions: read, Contents: read, Pull requests: read, set as `OPS_GITHUB_TOKEN` on the Railway **worker** service (the web does not need it). Without it the Builds section refreshes every 30 minutes and may hit GitHub's hourly limit from Railway's shared address, and the nightly load line cannot name the slowest route.

// JOBS-1 · THE WORKER, A PROCESS OF ITS OWN.
//
// Production runs two Railway services from this repo: the web (`node
// server.js`, with WORKER=off) serves requests and enqueues, and this one runs
// the queue: every handler (what follows a gift or a change) and every timed
// job (digests, dunning, campaigns, syncs, the weekly email). It still answers
// /health. Locally and in tests one process runs both, as it always has.
"use strict";
process.env.STEWARD_PROCESS = "worker";
require("./server.js");

## 0-FIX-44 · THE REAL-AI RUN IS YOURS TO START (2026-10-19)

- **Start it when you want it:** `gh workflow run nightly-ai.yml --ref main`, then `gh run watch`. It no longer runs on a schedule. Each run is capped at $2 (one full run measured $1.91) and its first summary line says what it spent. The `ANTHROPIC_EVAL_KEY` secret it needs is already set.

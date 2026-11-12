## STAGE-3 · Staging holds still while the fleet walks it (2026-11-12)

The QA fleet walks staging from about 11:30 PM to 3 AM ET. GitHub's own job times show merges deploying staging in the middle of it: SALES-2 Part A at 11:36 PM ET on 11 Nov and ATLAS-7 at 12:45 AM ET on 12 Nov (deploy-staging start times, read from the Actions API). Whole areas of those walks filed nothing. Jonathan's rule is that merges stay instant, so only the staging deploy waits.

Choices and why:
- **No sleeping job.** A job that waits for hours burns a runner and hits job time limits. Inside the window `deploy-staging` finishes at once with a hold, and a separate scheduled workflow releases after the window.
- **The release re-runs ci.yml's own `deploy-staging` job** instead of copying its deploy steps into a second workflow. That reuses the turnstile, the deploy, the live check and the walk exactly, and the release workflow holds no deploy secret. The re-run's hold step sees the commit marked `staging/deploy` "Released …" and deploys.
- **Only the latest held merge goes out.** Older held merges are already inside it. They are marked "Released with <sha>" so no commit is left pending. A release never races a newer merge that is already deploying itself.
- **The cron runs at both UTC offsets** (`20,50 7-9 * * *`), and the window, read on the ET wall clock, decides which run acts. The test checks every night of 2026 for a run within 10 minutes of 3:15 AM ET.
- **/ops reads the hold from commit statuses**, not from a second copy of the window, so the window stays defined in one place.

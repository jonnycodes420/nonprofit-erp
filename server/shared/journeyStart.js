// server/shared/journeyStart.js — starting a journey and advancing a cultivation plan, which events, outreach, tasks and major gifts all set off.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const TL = require("../../timelineLine");
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");

function mount(ctx) {
const {
  GR, openThreadTx, orgTime, orgToday, orgTz, query, registerJourneyEngine, run, uuid, withTransaction,
} = ctx;

// ── BUILD-99 (major gifts) Part 3 — CULTIVATION PLANS ──────────────────────
// A plan is a sequence of BUILD-81 threads for one person, authored by the
// officer. It does NOT fork the Thread engine: each step, when its turn comes,
// is a thread, opened through `openThreadTx` like every other, and it closes
// through the paths that already exist. shared/planShape.js holds the rules.
//
// NOTHING IN A PLAN SENDS ANYTHING. There is no email field and no schedule that
// fires; every step is a human action that ends in a logged line. That is what
// keeps a four-step cultivation of a major donor from being a sequence.
async function planMod() { return import("../../shared/planShape.js"); }

// THE CHAINING, IN ONE FUNCTION, CALLED FROM EVERY PLACE A THREAD CLOSES.
//
// It is idempotent and it SELF-HEALS, which is the property that matters here
// because production runs with background ticks off (NEEDS-JONATHAN §1) and
// there is no sweep to fall back on. If the next step cannot open — because the
// donor already has an open thread, which the conversation route legitimately
// creates from the officer's own next step — the step stays PENDING and the next
// close calls this again. So a plan can never be stalled by a race; it is only
// ever waiting, and `planSentence` says so out loud.
// ── THREAD-2a · THE JOURNEY ENGINE ────────────────────────────────────────
//
// ONE function starts a journey, and every trigger calls it. There is no
// second place that decides who goes into what, which is why "a donor is in
// at most one journey" can be true rather than aspirational.
//
// It uses the PLAN path underneath — the same `cultivation_plans` row, the
// same partial unique index, the same `advanceCultivationPlan` — so a journey
// and a plan an officer applied by hand are the same object, and every screen
// that already reads plans reads journeys for free.
//
// IT NEVER SENDS ANYTHING. It writes a plan and its pending steps. Each step
// becomes a thread when its turn comes, and a thread closes when a person
// logs that they did something. tests/thread2a-no-send.test.js is the guard.
async function journeyMod() { return import("../../shared/journeyShape.js"); }

// The actor on every write this engine makes. It is not a user: nobody
// pressed anything, a rule fired, and the record has to say so rather than
// attributing it to whoever happened to be signed in.
const JOURNEY_ACTOR = { id: "system:journey", name: "Steward (journey)" };

async function maybeStartJourney(orgId, donorId, triggerKey, opts = {}) {
  const J = await journeyMod();
  const PL = await planMod();
  if (!J.TRIGGER_KEYS.includes(triggerKey)) return { started: false, reason: "unknown_trigger" };

  const [donor] = await query(
    `SELECT id, name, assigned_to, assigned_to_name, deceased, do_not_contact, do_not_solicit FROM donors
      WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!donor) return { started: false, reason: "donor_not_found" };
  // JOURNEYS-4 · NEVER ENTERED, BY ANY DOOR. Somebody who has died, or who
  // asked not to be contacted, is not put in a journey by a rule or a button.
  if (donor.deceased === true) return { started: false, reason: "deceased" };
  if (donor.do_not_contact === true) return { started: false, reason: "do_not_contact" };

  // A PERSON CHOOSING beats a rule picking. `forceJourneyId` is the by-hand
  // path (and the "apply to everyone who qualifies" button): it names the
  // journey, so `journey_enabled` is not consulted — arming a journey is
  // about whether it fires ON ITS OWN, and somebody pressing a button has
  // already answered that question for this donor.
  const rows = opts.forceJourneyId
    ? await query(`SELECT * FROM cultivation_templates WHERE id=? AND org_id=? AND archived_at IS NULL`,
        [opts.forceJourneyId, orgId])
    : await query(
        `SELECT * FROM cultivation_templates
          WHERE org_id=? AND trigger_key=? AND journey_enabled=true AND archived_at IS NULL`,
        [orgId, triggerKey]);
  if (!rows.length) return { started: false, reason: opts.forceJourneyId ? "journey_not_found" : "no_journey_for_trigger" };

  // `gift_over` is the one trigger that NEEDS a number, and the number is the
  // ORG's. PARITY-1 Part D: every gift trigger may carry one as a floor, and a
  // fund or a campaign; "joins a group" names its group. A journey whose
  // narrowing this event does not meet is simply not a candidate.
  const amountCents = Number(opts.amountCents);
  const filtered = rows.filter(t => {
    if (opts.forceJourneyId) return true;      // named by a person, not matched by a rule
    const tf = t.trigger_filters || {};
    const need = Number(t.trigger_amount_cents);
    if (triggerKey === "gift_over" && !(Number.isFinite(need) && need > 0)) return false;
    if (J.isGiftTrigger(triggerKey) && Number.isFinite(need) && need > 0
        && !(Number.isFinite(amountCents) && amountCents >= need)) return false;
    if (tf.fundId && String(tf.fundId) !== String(opts.fundId || "")) return false;
    if (tf.campaignId && String(tf.campaignId) !== String(opts.campaignId || "")) return false;
    if (triggerKey === "joined_group" && String(tf.groupId || "") !== String(opts.groupId || "")) return false;
    // JOURNEYS-3 — an hours journey that watches one milestone fires on that one.
    if (triggerKey === "volunteer_hours" && tf.hours && !(opts.crossed || []).includes(Number(tf.hours))) return false;
    // JOURNEYS-4 — a task-outcome journey fires on the outcome it watches.
    if (triggerKey === "task_outcome" && String(tf.outcome || "") !== String(opts.outcome || "")) return false;
    // DATES-1 — a yearly-date journey is started for its own date by the
    // sweep, which names it; a birthday journey fires for its own lead days.
    if (triggerKey === "yearly_date" && String(t.id) !== String(opts.journeyId || "")) return false;
    if (triggerKey === "birthday" && (Number(tf.daysBefore) || 0) !== (Number(opts.leadDays) || 0)) return false;
    return true;
  });
  if (!filtered.length) return { started: false, reason: "below_threshold" };
  // JOURNEYS-4 · DO NOT SOLICIT MEANS NO ASKS (the FIX-35 rule). A journey
  // that asks for money skips them; a thank-you journey still reaches them.
  const askable = donor.do_not_solicit === true ? filtered.filter(t => !J.journeyAsks(t.steps)) : filtered;
  if (!askable.length) return { started: false, reason: "do_not_solicit" };

  // PARITY-1 Part D · WHO IT IS FOR, AT THE MOMENT IT FIRES. The audience was
  // only ever read by the "who already qualifies" offer; a live trigger
  // started the journey on anybody it touched. A journey narrowed to members
  // now starts only on a member, by either door.
  const audienceOk = [];
  for (const t of askable) {
    if (opts.forceJourneyId || await donorInAudience(orgId, donor.id, t.audience || {})) audienceOk.push(t);
  }
  if (!audienceOk.length) return { started: false, reason: "outside_audience" };

  // ONCE AND ONLY ONCE PER EVENT. The event a trigger is about (this gift,
  // their first gift ever, joining this group today) is written on the plan,
  // and a unique index holds it: replaying the same event, a retried webhook,
  // or a first gift deleted and entered again cannot enrol them a second time.
  const org0 = await orgTz(orgId);
  const eventKey = opts.forceJourneyId ? null
    : (opts.eventKey || journeyEventKey(triggerKey, opts, opts.today || orgToday(org0)));   // ORG_TZ_SEAM_OK
  let eligible = audienceOk;
  if (eventKey) {
    const done = await query(
      `SELECT template_id FROM cultivation_plans WHERE org_id=? AND donor_id=? AND trigger_event=?`,
      [orgId, donor.id, eventKey]);
    const seen = new Set(done.map(r => r.template_id));
    eligible = audienceOk.filter(t => !seen.has(t.id));
    if (!eligible.length) return { started: false, reason: "already_enrolled_for_event", eventKey };
  }

  // JOURNEYS-3 · EVERY JOURNEY THIS EVENT STARTS, HIGHEST FIRST. A person may
  // be in several journeys at once; their steps are spaced a week apart by
  // spaceDonorTouches. Two journeys marked "only one of these at a time" keep
  // the old ranking rule between them. A person pressing a button names one.
  const order = eligible.slice().sort((x, y) => (J.winningJourney([x, y]) === x ? -1 : 1));
  let first = null;
  const also = [];
  for (const t of order) {
    const r = await startOneJourney(orgId, donor, t, triggerKey, eventKey, opts);
    if (!first) first = r;
    else if (r.started) also.push(r);
    if (opts.forceJourneyId) break;
  }
  if (first && !first.started && also.length) return { ...also[0], also: also.slice(1) };
  return also.length ? { ...first, also } : first;
}

// One journey, one person. Refuses only for a reason it can name: already in
// this journey, in a higher exclusive one, or (when the person asked to leave
// people where they are) in any other journey.
async function startOneJourney(orgId, donor, winner, triggerKey, eventKey, opts = {}) {
  const J = await journeyMod();
  const PL = await planMod();
  const v = J.validateJourney({
    name: winner.name, trigger: winner.trigger_key, priority: winner.priority,
    amountCents: winner.trigger_amount_cents, steps: winner.steps,
    triggerFilters: winner.trigger_filters || {},
  });
  if (!v.ok) {
    console.error(`[journey] ${winner.id} is armed but invalid: ${v.errors[0].message}`);
    return { started: false, reason: "invalid_journey", detail: v.errors[0].message };
  }

  const org = await orgTz(orgId);
  const today = opts.today || orgToday(org);                    // ORG_TZ_SEAM_OK
  const steps = PL.planFromTemplate({ steps: v.steps, today }, orgTime.addDays);

  const current = await query(
    `SELECT p.id, p.template_id, p.template_name, p.priority, COALESCE(t.exclusive, false) AS exclusive
       FROM cultivation_plans p LEFT JOIN cultivation_templates t ON t.id = p.template_id AND t.org_id = p.org_id
      WHERE p.org_id=? AND p.donor_id=? AND p.status='active'`, [orgId, donor.id]);
  const same = current.find(c => c.template_id === winner.id);
  if (same) return { started: false, reason: "already_in_this_journey", currentPlanId: same.id, currentName: same.template_name };
  if (opts.joinOthers === false && current.length) {
    return { started: false, reason: "in_another_journey", currentPlanId: current[0].id, currentName: current[0].template_name };
  }

  // ── ONLY ONE OF THESE AT A TIME, AND THE REASON IS WRITTEN DOWN ────────
  // Between exclusive journeys, a person already working through one is left
  // alone UNLESS the new one outranks it. Equal priority does not replace.
  let replacedId = null, reason = null, replacedStep = null;
  const rival = winner.exclusive ? current.filter(c => c.exclusive)
    .sort((x, y) => Number(y.priority) - Number(x.priority))[0] : null;
  if (rival) {
    if (!J.shouldReplace({ priority: rival.priority }, { priority: v.priority })) {
      return { started: false, reason: "already_in_a_journey", currentPlanId: rival.id,
               currentName: rival.template_name };
    }
    reason = J.replacementReason(rival.template_name, v.name);
    await run(`UPDATE cultivation_plans SET status='abandoned', closed_at=NOW(), replaced_reason=?
                WHERE id=? AND status='active'`, [reason, rival.id]);
    const [openStep] = await query(
      `SELECT id, thread_id FROM cultivation_plan_steps WHERE plan_id=? AND status='open'`, [rival.id]);
    if (openStep) {
      // Its thread is handed on rather than left holding a stopped plan's step.
      await run(`UPDATE cultivation_plan_steps SET status='skipped', closed_at=NOW(),
                   closed_by=?, closed_by_name=?, skip_reason=? WHERE id=?`,
        [JOURNEY_ACTOR.id, JOURNEY_ACTOR.name, reason, openStep.id]);
      replacedStep = openStep;
    }
    replacedId = rival.id;
  }

  const planId = "cp_" + uuid().slice(0, 10);
  let ins;
  try {
    ins = await query(
    `INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,
                                    owner_id,owner_name,created_by,created_by_name,
                                    trigger_key,priority,replaced_plan_id,replaced_reason,trigger_event,started_import_id)
     SELECT ?::text,?::text,?::text,?::text,?::text,?::text,'active',?::text,?::text,?::text,?::text,
            ?::text,?::int,?::text,?::text,?::text,?::text
      WHERE NOT EXISTS (SELECT 1 FROM cultivation_plans x WHERE x.org_id=?::text AND x.donor_id=?::text
                          AND x.template_id=?::text AND x.status='active')
     RETURNING id`,
    [planId, orgId, donor.id, winner.id, v.name, today,
     donor.assigned_to || null, donor.assigned_to_name || null,
     JOURNEY_ACTOR.id, JOURNEY_ACTOR.name,
     // The trigger RECORDED is the journey's own, so a by-hand apply of a
     // first-gift journey still says what kind of journey it is; `by_hand` is
     // recorded only for a journey that genuinely has that trigger.
     opts.forceJourneyId ? (winner.trigger_key || triggerKey) : triggerKey,
     v.priority, replacedId, reason, eventKey,
     // LIVE-1 — the import whose gift started this, so the import's undo stops it.
     opts.importId || null, orgId, donor.id, winner.id]);
  } catch (e) {
    // A unique index: a concurrent fire of the same event, or the same journey, won.
    if (e.code === "23505") return { started: false, reason: "already_enrolled_for_event", eventKey };
    throw e;
  }
  if (!ins.length) return { started: false, reason: "race_lost" };

  for (const s of steps) {
    const src = v.steps[s.seq - 1] || {};
    await run(
      `INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status,draft_kind,owner_id,owner_name)
       VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`,
      ["cs_" + uuid().slice(0, 10), orgId, planId, s.seq, s.type, s.label, s.dueDate,
       src.draft || null,
       // The owner defaults to the RELATIONSHIP OWNER, which is the donor's
       // assigned officer — the brief's own answer, and the one that makes
       // the Thread owner-scoped without anybody configuring anything.
       src.ownerMode === "specific" ? (src.ownerId || null) : (donor.assigned_to || null),
       src.ownerMode === "specific" ? null : (donor.assigned_to_name || null)]);
  }
  // A replaced exclusive journey's open thread is closed with its reason, so
  // the new journey's first step can take the person's one open thread.
  if (replacedStep && replacedStep.thread_id) {
    await run(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside'
                WHERE id=? AND org_id=? AND closed_at IS NULL`, [replacedStep.thread_id, orgId]);
  }

  // The timeline says it, in the same words the screen does.
  const line = reason
    ? reason
    : `Journey started: ${v.name} (${steps.length} ${steps.length === 1 ? "step" : "steps"}).`;
  const lineId = "int_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name)
     VALUES (?,?,?,'note',?,?,?,?)`,
    [lineId, orgId, donor.id, today, line, JOURNEY_ACTOR.id, JOURNEY_ACTOR.name])
    .then(() => run(`UPDATE cultivation_plans SET start_interaction_id=? WHERE id=?`, [lineId, planId]))
    .catch(e => console.error("[journey] timeline:", e.message));

  // One touch a week across every journey this person is in, then the
  // soonest step takes their one open thread.
  await spaceDonorTouches(orgId, donor.id);
  await advanceCultivationPlan(orgId, donor.id,
    { actorId: JOURNEY_ACTOR.id, actorName: JOURNEY_ACTOR.name, today });

  console.log(`[journey] ${donor.id} → ${v.name} on ${triggerKey}`
    + (replacedId ? ` (replaced ${replacedId})` : ""));
  return { started: true, planId, journeyId: winner.id, name: v.name, trigger: triggerKey,
           steps: steps.length, replacedPlanId: replacedId, reason };
}

// ── JOURNEYS-3 · ONE TOUCH A WEEK ──────────────────────────────────────────
// Every active journey this person is in, spaced by shared/journeyShape.js
// spaceTouches with the org's gap (Journey settings, 7 days by default). A
// moved step keeps the date it had and the journey that moved it, and the
// reason lands on the step and on the timeline.
async function journeyTouchGap(orgId) {
  const [o] = await query(`SELECT journey_touch_gap_days FROM orgs WHERE id=?`, [orgId]);
  return Number(o && o.journey_touch_gap_days) || 7;
}
async function spaceDonorTouches(orgId, donorId) {
  const J = await journeyMod();
  const plans = await query(
    `SELECT id, template_name AS name, priority, applied_on FROM cultivation_plans
      WHERE org_id=? AND donor_id=? AND status='active'`, [orgId, donorId]);
  if (plans.length < 2) return [];
  const steps = await query(
    `SELECT id, plan_id, seq, due_date, status FROM cultivation_plan_steps
      WHERE org_id=? AND plan_id = ANY(?::text[]) AND status IN ('pending','open')`, [orgId, plans.map(p => p.id)]);
  const moves = J.spaceTouches(plans.map(p => ({ id: p.id, name: p.name, priority: p.priority, appliedOn: p.applied_on,
    steps: steps.filter(s => s.plan_id === p.id).map(s => ({ id: s.id, seq: s.seq, dueDate: s.due_date, status: s.status })) })),
    await journeyTouchGap(orgId));
  for (const m of moves) {
    const name = (plans.find(p => p.id === m.planId) || {}).name || "A journey";
    const why = J.movedSentence(m, name);
    const { changes } = await run(
      `UPDATE cultivation_plan_steps SET due_date=?, moved_from=COALESCE(moved_from, ?), moved_reason=?,
              moved_by_plan_id=COALESCE(moved_by_plan_id, ?)
        WHERE id=? AND org_id=? AND status='pending'`, [m.to, m.from, why, m.becausePlanId, m.stepId, orgId]);
    if (changes) {
      await TL.timelineLine({ orgId, donorId, note: why, actorId: JOURNEY_ACTOR.id, actorName: JOURNEY_ACTOR.name,
        key: `journey-moved:${m.stepId}:${m.to}`, metadata: { via: "journey_spacing", step_id: m.stepId, plan_id: m.planId } });
    }
  }
  return moves;
}

// PARITY-1 Part D · the event a trigger is about, as a key written on the
// plan. null means the trigger has no single event to hold it to.
function journeyEventKey(triggerKey, opts = {}, today = "") {
  switch (triggerKey) {
    case "first_gift": return "first_gift";
    case "first_recurring": return "first_recurring";
    case "new_volunteer": return "new_volunteer";
    case "gift_over": case "next_gift": case "lapsed_return": case "membership_payment":
      return opts.giftId ? `gift:${opts.giftId}` : null;
    case "became_member": return opts.membershipId ? `membership:${opts.membershipId}` : `became_member:${today}`;
    case "stage_change": case "became_prospect": return `stage:${opts.toStage || ""}:${today}`;
    case "joined_group": return `group:${opts.groupId || ""}:${today}`;
    case "giving_anniversary": return `anniversary:${String(today).slice(0, 4)}`;
    case "birthday": return `birthday:${String(today).slice(0, 4)}`;   // PARITY-3 6a: once a year
    case "attended_event": return opts.eventId ? `event:${opts.eventId}` : null;
    case "first_event": return "first_event";
    default: return null;
  }
}

// Is this person inside a journey's audience right now? The same clauses the
// "who already qualifies" offer reads (audienceClauses), plus the group.
async function donorInAudience(orgId, donorId, audience = {}) {
  const a = audienceClauses(audience, "d");
  if (a.sql) {
    const rows = await query(`SELECT 1 FROM donors d WHERE d.id=? AND d.org_id=? AND d.deleted_at IS NULL${a.sql}`,
      [donorId, orgId, ...a.params]);
    if (!rows.length) return false;
  }
  if (audience.groupId) {
    const g = await GR.groupById(orgId, audience.groupId);
    if (!g || !(await GR.isMember(orgId, g, donorId))) return false;
  }
  return true;
}

// JOURNEYS-3 · A PERSON IN SEVERAL JOURNEYS STILL HAS ONE NEXT STEP. Each
// active plan's open step is closed when its thread has closed, a plan with
// nothing left is done, and then the person's SOONEST step across every
// journey holds their one open thread: the next step of each plan is a
// candidate and the earliest due wins (a tie goes to the higher priority).
// When a journey step already holds the thread but another journey's step is
// due sooner, the thread is handed to the sooner one and the other step goes
// back to waiting, so the Thread always shows what is next.
async function advanceCultivationPlan(orgId, donorId, { actorId, actorName, today } = {}) {
  const PL = await planMod();
  const plans = await query(
    `SELECT * FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active'
      ORDER BY priority DESC, applied_on, id`, [orgId, donorId]);
  if (!plans.length) return null;
  const all = await query(
    `SELECT * FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?::text[]) ORDER BY seq`,
    [orgId, plans.map(p => p.id)]);
  const live = [];
  for (const plan of plans) {
    const steps = all.filter(s => s.plan_id === plan.id);
    // A step whose thread has closed is DONE. The thread's own close is the fact;
    // this only reads it back, so the two can never disagree about whether the
    // officer did the thing.
    const open = steps.find(s => s.status === "open");
    if (open && open.thread_id) {
      const [th] = await query("SELECT id, closed_at, close_kind FROM threads WHERE id=? AND org_id=?", [open.thread_id, orgId]);
      if (!th || th.closed_at) {
        await run("UPDATE cultivation_plan_steps SET status='done', closed_at=NOW(), closed_by=?, closed_by_name=? WHERE id=? AND status='open'",
          [actorId || null, actorName || null, open.id]);
        open.status = "done";
      }
    }
    if (steps.some(s => s.status === "open")) { live.push({ plan, steps }); continue; }
    if (PL.nextPendingSeq(steps) == null) {
      // Every step is done or skipped — the plan is finished, and that is a fact
      // about the plan rather than an outcome anybody has to record.
      await run("UPDATE cultivation_plans SET status='done', closed_at=NOW() WHERE id=? AND status='active'", [plan.id]);
      continue;
    }
    live.push({ plan, steps });
  }
  if (!live.length) return plans[0].id;

  // The candidates: each plan's next pending step. The soonest wins.
  const cands = [];
  for (const { plan, steps } of live) {
    if (steps.some(s => s.status === "open")) continue;
    const nextSeq = PL.nextPendingSeq(steps);
    const step = steps.find(s => Number(s.seq) === Number(nextSeq));
    if (step) cands.push({ plan, step });
  }
  if (!cands.length) return live[0].plan.id;   // a journey step already holds the thread
  cands.sort((x, y) => String(x.step.due_date).localeCompare(String(y.step.due_date))
    || Number(y.plan.priority) - Number(x.plan.priority));
  const { plan, step } = cands[0];

  // A journey step holding the thread but due LATER than this one hands it over.
  const holder = live.map(l => ({ plan: l.plan, step: l.steps.find(s => s.status === "open") })).find(h => h.step);
  if (holder && holder.step.thread_id && String(holder.step.due_date) > String(step.due_date)) {
    const { changes } = await run(
      `UPDATE threads SET next_step_type=?, next_step_label=?, due_date=?
        WHERE id=? AND org_id=? AND closed_at IS NULL`,
      [step.step_type, step.label, step.due_date, holder.step.thread_id, orgId]);
    if (changes) {
      await run("UPDATE cultivation_plan_steps SET status='pending', thread_id=NULL WHERE id=? AND status='open'", [holder.step.id]);
      await run("UPDATE cultivation_plan_steps SET status='open', thread_id=? WHERE id=? AND status='pending'", [holder.step.thread_id, step.id]);
      await journeyStepOpened(orgId, donorId, plan, step);
      return plan.id;
    }
  }
  if (holder) return holder.plan.id;

  const opened = await withTransaction(async client => openThreadTx(client, {
    orgId, donorId,
    step: { type: step.step_type, label: step.label, due: step.due_date },
    openedOn: today || step.due_date,
    ownerId: plan.owner_id, ownerName: plan.owner_name,
    actorId: actorId || plan.created_by, actorName: actorName || plan.created_by_name,
  }));
  // `openThreadTx` returns null when the donor already has an open thread (the
  // ON CONFLICT is the arbiter, never a check-then-insert). The step waits.
  if (!opened) return plan.id;
  await run("UPDATE cultivation_plan_steps SET status='open', thread_id=? WHERE id=? AND status='pending'", [opened.id, step.id]);
  await journeyStepOpened(orgId, donorId, plan, step);
  return plan.id;
}

// A step that opens lands in three places: the Thread (its thread), the
// Calendar (calendar.js reads the step and the thread as one item), and the
// person's timeline, one line per step, here. Its template draft, if any, is
// written for review.
async function journeyStepOpened(orgId, donorId, plan, step) {
  await TL.timelineLine({ orgId, donorId, actorId: JOURNEY_ACTOR.id, actorName: JOURNEY_ACTOR.name,
    note: `Journey step: ${step.label}, due ${step.due_date} (${plan.template_name}).`,
    key: `journey-step:${step.id}`, metadata: { via: "journey_step", step_id: step.id, plan_id: plan.id } });
  // AUTO-1: a step whose switch is on is scheduled to send itself instead.
  const auto = await scheduleAutoSend(orgId, donorId, plan, step).catch(e => { console.error("[journey] auto-send schedule:", e.message); return false; });
  if (!auto) await journeyTemplateDraft(orgId, donorId, step).catch(e => console.error("[journey] template draft:", e.message));
}

// EMAIL-1 — A STEP THAT NAMES A TEMPLATE GETS ITS WORDS WRITTEN, NOT SENT.
// When the step opens, the template's subject and its text (with this
// person's name and last gift in it) become ONE draft in the review queue
// (milestone_drafts, key `journey-step:<step id>`), remembering the template.
// A person reads it there and presses Send; this function has no send in it,
// and tests/thread2a-no-send.test.js holds the whole journey path to that.
async function journeyTemplateDraft(orgId, donorId, step) {
  const tid = String(step.draft_kind || "").startsWith("template:") ? String(step.draft_kind).slice(9) : null;
  if (!tid) return null;
  const t = await emailCompose.templateFor(orgId, tid);
  if (!t) return null;
  const [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
  if (!donor) return null;
  const words = await emailCompose.templateTextFor(orgId, t, donor);
  if (!words.body) return null;
  const key = `journey-step:${step.id}`;
  const id = "md_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,template_id,created_by,created_by_name)
     SELECT ?::text,?::text,?::text,?::text,?::text,?::text,'pending_review','journey',?::text,?::text,?::text
      WHERE NOT EXISTS (SELECT 1 FROM milestone_drafts WHERE org_id=?::text AND milestone_key=?::text)`,
    [id, orgId, donorId, key, words.subject || step.label || t.name, words.body, t.id,
     JOURNEY_ACTOR.id, JOURNEY_ACTOR.name, orgId, key]);
  return id;
}

// ── AUTO-1 · A JOURNEY EMAIL STEP THAT SENDS ITSELF ────────────────────────
// Off on every journey, ready-made ones included. An owner or admin turns it
// on for ONE email step, for words somebody on staff saved, after reading them
// and how many people they will reach. From then on, when that step opens for
// a person it is scheduled for the next weekday morning (never the same day,
// so "Sending tomorrow" can be read the night before and anybody can Skip), and
// the 5-minute tick sends it between 9 and 11 AM where the org is, through the
// one sender a tracked sequence uses (sendStaffWrittenEmail). Every refusal is
// a reason on the person's timeline; nothing is sent twice (journey_sends'
// unique step_id is the claim). Demo orgs never send.
const AUTO_ACTOR = { id: "system:journey-auto", name: "Steward (sent automatically)" };
const AUTO_WINDOW = { startHour: 9, endHour: 11, days: [1, 2, 3, 4, 5] };   // weekday mornings, 9 to 11 where the org is
// The first weekday strictly after `today`, and no earlier than `due`.
function nextAutoSendDay(today, due) {
  let d = orgTime.addDays(today, 1);
  if (due && String(due) > d) d = String(due).slice(0, 10);
  for (let i = 0; i < 7; i++) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    if (AUTO_WINDOW.days.includes(wd)) return d;
    d = orgTime.addDays(d, 1);
  }
  return d;
}
async function autoStepOn(orgId, templateId, seq) {
  const [r] = await query(`SELECT * FROM journey_auto_steps WHERE org_id=? AND template_id=? AND seq=? AND turned_off_at IS NULL`, [orgId, templateId, seq]);
  return r || null;
}

// When a step opens: scheduled, if its switch is on and it names the template
// the switch was turned on for. Returns true when it took the step (so no
// review draft is written; the step is hers to Skip until it goes).
async function scheduleAutoSend(orgId, donorId, plan, step) {
  if (!plan.template_id) return false;
  const tid = String(step.draft_kind || "").startsWith("template:") ? String(step.draft_kind).slice(9) : null;
  if (!tid) return false;
  // A plan step's seq counts from 1; the journey's steps (and the switch) from 0.
  const idx = Number(step.seq) - 1;
  const on = await autoStepOn(orgId, plan.template_id, idx);
  if (!on || on.email_template_id !== tid) return false;
  const today = orgToday(await orgTz(orgId));
  const id = "jsend_" + uuid().slice(0, 12);
  const r = await run(
    `INSERT INTO journey_sends (id,org_id,template_id,plan_id,step_id,seq,donor_id,email_template_id,auto_step_id,send_on,status,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,'scheduled',?,?) ON CONFLICT (step_id) DO NOTHING`,
    [id, orgId, plan.template_id, plan.id, step.id, idx, donorId, tid, on.id, nextAutoSendDay(today, step.due_date), AUTO_ACTOR.id, AUTO_ACTOR.name]);
  return !!(r && r.changes);
}

// The seam back to server.js, so `recordGift` can fire a trigger without this
// file being importable from there (it is required after server.js's body).
registerJourneyEngine(maybeStartJourney);

// ── FIX-4 1c · THE AUDIENCE, AS SQL ───────────────────────────────────────
// The one place a filter from shared/journeyShape.js becomes a WHERE clause.
// Every one of them is an EXISTS against a table Steward already keeps, so a
// filter can narrow the set and can never invent a person.
//
// Returned as fragments + params rather than interpolated, because two of
// them (tag, stage) carry text somebody typed.
function audienceClauses(audience = {}, alias = "d") {
  const sql = [], params = [];
  if (audience.volunteers) {
    sql.push(`EXISTS (SELECT 1 FROM volunteers v WHERE v.person_id=${alias}.id AND v.org_id=${alias}.org_id)`);
  }
  if (audience.attendedEvent) {
    sql.push(`EXISTS (SELECT 1 FROM event_attendees ea WHERE ea.donor_id=${alias}.id AND ea.org_id=${alias}.org_id
                        AND lower(coalesce(ea.status,'')) = 'attended')`);
  }
  if (audience.members) {
    sql.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.donor_id=${alias}.id AND m.org_id=${alias}.org_id
                        AND m.status IN ('active','grace'))`);
  }
  if (audience.recurring) {
    // WIRE-1: the same running states the Group rules read (groups.js).
    sql.push(`EXISTS (SELECT 1 FROM recurring_subscriptions rs WHERE rs.donor_id=${alias}.id AND rs.org_id=${alias}.org_id
                        AND rs.status = ANY(?::text[]))`);
    params.push(GR.ACTIVE_RECURRING_STATUSES);
  }
  if (audience.eventGuests) {
    // JOURNEYS-4 — the Group rule's own definition (groups.js eventGuestSql).
    const g = GR.eventGuestSql(String(audience.eventGuests), alias);
    if (g) sql.push(g);
  }
  if (audience.stage) {
    sql.push(`lower(coalesce(${alias}.stage,'')) = lower(?)`);
    params.push(String(audience.stage));
  }
  if (audience.tag) {
    // donors.tags is a JSON array kept as TEXT. Matched case-insensitively on
    // the whole element, so "major" does not pull in "major-prospect".
    sql.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                        CASE WHEN coalesce(${alias}.tags,'') ~ '^\\s*\\[' THEN ${alias}.tags::jsonb ELSE '[]'::jsonb END) AS tg
                      WHERE lower(btrim(tg)) = lower(btrim(?)))`);
    params.push(String(audience.tag));
  }
  if (audience.giftSize) {
    const { minCents, maxCents } = audience.giftSize;
    // THE LARGEST SINGLE GIFT, not the lifetime total: "gift size" is a
    // sentence about one gift, and summing a year of $20s into a $1,000
    // major donor is the kind of quiet wrong that reaches a real person.
    if (minCents) {
      sql.push(`(SELECT COALESCE(MAX(ROUND(g.amount*100)),0) FROM gifts g
                  WHERE g.donor_id=${alias}.id AND g.org_id=${alias}.org_id) >= ?`);
      params.push(Number(minCents));
    }
    if (maxCents) {
      sql.push(`(SELECT COALESCE(MAX(ROUND(g.amount*100)),0) FROM gifts g
                  WHERE g.donor_id=${alias}.id AND g.org_id=${alias}.org_id) <= ?`);
      params.push(Number(maxCents));
    }
  }
  return { sql: sql.length ? " AND " + sql.join(" AND ") : "", params };
}
return { AUTO_ACTOR, AUTO_WINDOW, JOURNEY_ACTOR, advanceCultivationPlan, audienceClauses, autoStepOn, journeyMod, journeyTemplateDraft, journeyTouchGap, maybeStartJourney, nextAutoSendDay, planMod };
}

module.exports = { mount };

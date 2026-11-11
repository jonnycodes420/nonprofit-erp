// server/admin/sales/pipelines.js · SALES-1. PIPELINES AND THEIR STAGES.
//
// A fresh CRM has one pipeline, "Direct", with the default stages (model.js).
// Until the first write they are read from the defaults with fixed ids, so a
// GET never writes; the first write (any deal, any stage edit) stores them
// under those same ids (ensureDefaults). Stages can be renamed, reordered,
// added, and given a probability and a "days" limit. A deal's stage history
// (who, when, from, to) is kept in sales_stage_history.
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");

const DEFAULT_PIPELINE = { id: "spl_direct", name: "Direct", position: 0 };
const slug = s => s.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
const DEFAULT_STAGE_ROWS = M.DEFAULT_STAGES.map((s, i) => ({ id: `sst_${slug(s.name)}`, pipeline_id: DEFAULT_PIPELINE.id, name: s.name,
  position: i, probability: s.probability, limit_days: M.DEFAULT_STAGE_LIMIT_DAYS, kind: s.kind, onboarding: !!s.onboarding }));

async function ensureDefaults({ query, run }, who) {
  const [n] = await query(`SELECT COUNT(*)::int AS n FROM sales_pipelines`);
  if (n && n.n > 0) return;
  await run(`INSERT INTO sales_pipelines (id, name, position, created_by, created_by_name) VALUES (?, ?, 0, ?, ?) ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_PIPELINE.id, DEFAULT_PIPELINE.name, who.id, who.name]);
  for (const s of DEFAULT_STAGE_ROWS) {
    await run(`INSERT INTO sales_stages (id, pipeline_id, name, position, probability, limit_days, kind, onboarding, created_by, created_by_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.pipeline_id, s.name, s.position, s.probability, s.limit_days, s.kind, s.onboarding, who.id, who.name]);
  }
}

// Every pipeline with its stages in order. Read-only.
async function readAll(query) {
  const [pls, sts] = await Promise.all([
    query(`SELECT id, name, position FROM sales_pipelines ORDER BY position, name`),
    query(`SELECT id, pipeline_id, name, position, probability, limit_days, kind, onboarding FROM sales_stages ORDER BY pipeline_id, position`),
  ]);
  const pipelines = pls.length ? pls : [DEFAULT_PIPELINE];
  const stages = pls.length ? sts : DEFAULT_STAGE_ROWS;
  return pipelines.map(p => ({ ...p, stages: stages.filter(s => s.pipeline_id === p.id).map(s => ({ ...s, probability: Number(s.probability), limit_days: Number(s.limit_days) })) }));
}
function stageIndex(pipelines) {
  const m = new Map();
  for (const p of pipelines) for (const s of p.stages) m.set(s.id, { ...s, pipelineName: p.name });
  return m;
}

async function createPipeline(ctx, name, who) {
  await ensureDefaults(ctx, who);
  const id = newId("spl");
  const [pos] = await ctx.query(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sales_pipelines`);
  await ctx.run(`INSERT INTO sales_pipelines (id, name, position, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)`, [id, name, pos.p, who.id, who.name]);
  // A new pipeline starts with the same default stages, which it can then change.
  for (const [i, s] of M.DEFAULT_STAGES.entries()) {
    await ctx.run(`INSERT INTO sales_stages (id, pipeline_id, name, position, probability, limit_days, kind, onboarding, created_by, created_by_name)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [newId("sst"), id, s.name, i, s.probability, M.DEFAULT_STAGE_LIMIT_DAYS, s.kind, !!s.onboarding, who.id, who.name]);
  }
  return id;
}

// stages: [{ id?, name, probability, limit_days, kind, onboarding }] in the new order.
// A stage left out is removed only when no deal sits in it.
async function saveStages(ctx, pipelineId, stages, who) {
  await ensureDefaults(ctx, who);
  const [pl] = await ctx.query(`SELECT id FROM sales_pipelines WHERE id = ?`, [pipelineId]);
  if (!pl) return { error: "not_found" };
  const have = await ctx.query(`SELECT id FROM sales_stages WHERE pipeline_id = ?`, [pipelineId]);
  const keep = new Set(stages.filter(s => s.id).map(s => s.id));
  const gone = have.map(h => h.id).filter(id => !keep.has(id));
  if (gone.length) {
    const [used] = await ctx.query(`SELECT COUNT(*)::int AS n FROM sales_deals WHERE stage_id = ANY(?) AND deleted_at IS NULL`, [gone]);
    if (used.n) return { error: "stage_in_use", message: `A stage you removed still holds ${used.n === 1 ? "1 deal" : `${used.n} deals`}. Move them first.` };
  }
  for (const [i, s] of stages.entries()) {
    const name = M.clean(s.name);
    if (!name) return { error: "bad_stage", message: "Every stage needs a name." };
    const prob = Math.max(0, Math.min(100, Math.round(Number(s.probability) || 0)));
    const days = Math.max(1, Math.min(365, Math.round(Number(s.limit_days) || M.DEFAULT_STAGE_LIMIT_DAYS)));
    const kind = M.STAGE_KINDS.includes(s.kind) ? s.kind : "open";
    if (s.id && have.some(h => h.id === s.id)) {
      await ctx.run(`UPDATE sales_stages SET name = ?, position = ?, probability = ?, limit_days = ?, kind = ?, onboarding = ? WHERE id = ?`,
        [name, i, prob, days, kind, !!s.onboarding, s.id]);
    } else {
      await ctx.run(`INSERT INTO sales_stages (id, pipeline_id, name, position, probability, limit_days, kind, onboarding, created_by, created_by_name)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [newId("sst"), pipelineId, name, i, prob, days, kind, !!s.onboarding, who.id, who.name]);
    }
  }
  if (gone.length) await ctx.run(`DELETE FROM sales_stages WHERE id = ANY(?)`, [gone]);
  return { ok: true };
}

async function renamePipeline(ctx, id, name, who) {
  await ensureDefaults(ctx, who);
  const r = await ctx.run(`UPDATE sales_pipelines SET name = ? WHERE id = ?`, [name, id]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

module.exports = { DEFAULT_PIPELINE, DEFAULT_STAGE_ROWS, ensureDefaults, readAll, stageIndex, createPipeline, saveStages, renamePipeline };

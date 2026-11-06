"use strict";

// T2 第 2 步：核验试读输出。
//
// 核验两件事（对应 §17 的"引用是否存在、引用是否支持结论"的前半）：
//   1. factPointers 每条都能在**完整 ChartInfo** 上解析到非空值
//   2. knowledgeReferences 每条都确实出现在该步**实际装载**的 source#anchor 中
//
// 不核验"引用是否支持结论"——那需要语义判断，属独立审查者职责，本脚本不冒充。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const TRIAL = path.join(ROOT, ".pair", "trial");

global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "chartinfo-adapter.js", "section16-gate.js"]
  .forEach((name) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8")));

const inputs = JSON.parse(fs.readFileSync(path.join(TRIAL, "inputs.json"), "utf8"));
const knowledge = JSON.parse(fs.readFileSync(path.join(TRIAL, "knowledge.json"), "utf8"));

const chart = global.MingliZiwei.calculate(inputs.input, {
  asOfYear: inputs.asOf.year, asOfDate: inputs.asOf.date, asOfTimeIndex: inputs.asOf.timeIndex,
});
const chartInfo = global.MingliChartInfo.buildChartInfo(chart).chartInfo;
const G = global.MingliSection16;

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

const results = [];
const files = fs.readdirSync(TRIAL).filter((f) => /^out-step-\d+\.json$/.test(f)).sort();

for (const file of files) {
  const stepId = Number(file.match(/step-(\d+)/)[1]);
  const raw = fs.readFileSync(path.join(TRIAL, file), "utf8").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    results.push({ stepId, ok: false, reason: "输出不是合法 JSON：" + err.message });
    continue;
  }

  const factChecks = (parsed.factPointers || []).map((pointer) => {
    const resolved = G.resolve(chartInfo, pointer);
    if (!resolved.ok) return { pointer, ok: false, reason: resolved.reason };
    if (isEmpty(resolved.value)) return { pointer, ok: false, reason: "解析到空值" };
    return { pointer, ok: true, at: resolved.trail };
  });

  const loaded = new Set();
  const stepKnowledge = (knowledge.steps || {})[stepId] || { sections: [] };
  stepKnowledge.sections.forEach((sec) => loaded.add(sec.source + "#" + sec.anchor));

  const refChecks = (parsed.knowledgeReferences || []).map((ref) => ({
    ref,
    ok: loaded.has(ref),
    reason: loaded.has(ref) ? null : "该引用不在本步实际装载的知识章节中",
  }));

  // 空数组的 every() 恒为 true —— 必须显式要求引用非空，
  // 否则 {"status":"done"} 这种空壳会被判成"引用全部有效"。
  const structuralProblems = [];
  if (parsed.id !== stepId) {
    structuralProblems.push(`id 不匹配：输出 ${parsed.id}，应为 ${stepId}`);
  }
  if (!parsed.status || !["done", "blocked", "not_applicable"].includes(parsed.status)) {
    structuralProblems.push(`status 非法：${String(parsed.status)}`);
  }
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    structuralProblems.push("缺少 text");
  }
  // 声明 done 的步骤必须给出至少一条事实引用与一条知识引用
  if (parsed.status === "done") {
    if (!factChecks.length) structuralProblems.push("声明 done 但没有任何 factPointers");
    if (!refChecks.length) structuralProblems.push("声明 done 但没有任何 knowledgeReferences");
  }
  const knowledgeStatus = ((knowledge.steps || {})[stepId] || {}).status;
  if (knowledgeStatus !== "ok") {
    structuralProblems.push(`该步知识装载状态为 ${String(knowledgeStatus)}`);
  }

  results.push({
    stepId,
    declaredStatus: parsed.status,
    knowledgeStatus,
    structuralProblems,
    ok: structuralProblems.length === 0
      && factChecks.every((c) => c.ok)
      && refChecks.every((c) => c.ok),
    factPointers: factChecks,
    knowledgeReferences: refChecks,
    factPointerCount: factChecks.length,
    knowledgeReferenceCount: refChecks.length,
    limitations: parsed.limitations || null,
  });
}

// 步骤覆盖必须恰为 1..15：results.every() 对空数组恒为 true，
// 目录为空时不能报「全部引用有效」（review r738 major 12）。
const EXPECTED_STEPS = 15;
const seenIds = results.map((r) => r.stepId);
const duplicateIds = seenIds.filter((id, idx) => seenIds.indexOf(id) !== idx);
const missingIds = [];
for (let id = 1; id <= EXPECTED_STEPS; id += 1) {
  if (!seenIds.includes(id)) missingIds.push(id);
}
const unexpectedIds = seenIds.filter((id) => id < 1 || id > EXPECTED_STEPS);
const coverageProblems = [];
if (!results.length) coverageProblems.push("没有任何步骤输出（out-step-N.json 缺失）");
if (missingIds.length) coverageProblems.push("缺步骤：" + missingIds.join(","));
if (duplicateIds.length) coverageProblems.push("步骤重复：" + duplicateIds.join(","));
if (unexpectedIds.length) coverageProblems.push("步骤越界：" + unexpectedIds.join(","));
const coverageComplete = coverageProblems.length === 0;

const report = {
  schema: "trial-verify/v1",
  experimental: true,
  deliverable: false,
  note: "只核验引用是否存在；引用是否支持结论属独立审查者职责，本脚本不判断",
  chartInfoStatus: "ok",
  expectedSteps: EXPECTED_STEPS,
  verifiedSteps: results.length,
  coverageComplete,
  missingStepIds: missingIds,
  duplicateStepIds: duplicateIds,
  unexpectedStepIds: unexpectedIds,
  coverageProblems,
  // 只有「步骤覆盖恰为 1..15」且「每一步引用有效」才算全部有效
  allCitationsValid: coverageComplete && results.length === EXPECTED_STEPS && results.every((r) => r.ok),
  steps: results,
};
fs.writeFileSync(path.join(TRIAL, "verify.json"), JSON.stringify(report, null, 1) + "\n", "utf8");

for (const r of results) {
  const bad = []
    .concat(r.factPointers ? r.factPointers.filter((c) => !c.ok) : [])
    .concat(r.knowledgeReferences ? r.knowledgeReferences.filter((c) => !c.ok) : []);
  console.log(
    `步骤 ${String(r.stepId).padStart(2)}  声明=${r.declaredStatus || "?"}  ` +
    `事实引用=${r.factPointerCount || 0}  知识引用=${r.knowledgeReferenceCount || 0}  ` +
    (r.ok
      ? "引用全部可解析且结构完整"
      : "问题：" + (r.structuralProblems || []).concat(
          bad.map((b) => "引用无效 " + (b.pointer || b.ref))).join("；")),
  );
}
console.log("");
console.log(`已核验 ${results.length}/${EXPECTED_STEPS} 步；步骤覆盖完整：${coverageComplete}`);
if (coverageProblems.length) console.log(`覆盖问题：${coverageProblems.join("；")}`);
console.log(`全部引用有效：${report.allCitationsValid}`);
process.exitCode = report.allCitationsValid ? 0 : 1;

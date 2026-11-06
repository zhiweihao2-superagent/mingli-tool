"use strict";

// T2 第 1 步：为实验性端到端试读做准备。
//
// 产出：
//   .pair/trial/inputs.json     —— 输入、排盘口径、ChartInfo 摘要
//   .pair/trial/knowledge.json  —— 每步知识装载状态与实际 sections
//   .pair/trial/prompt.md       —— 交给模型的完整提示词
//
// 定性：experimental，**不可交付**。判定试读成功只表示链路跑通、可追溯，
// 不表示 15 项完成或正式报告合格。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, ".pair", "trial");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "chartinfo-adapter.js", "skill-context.js", "section16-gate.js"]
  .forEach((name) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8")));

const INPUT = {
  calendar: "solar",
  date: "1990-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
};
const AS_OF = { year: 2026, date: "2026-10-30", timeIndex: 6 };
const TOPIC = "not_married_related"; // 明确声明不涉婚，用于验证第 11 项的适用性切换
const BUDGET_TOKENS = 400000; // 单步预算；一步一次调用

const chart = global.MingliZiwei.calculate(INPUT, {
  asOfYear: AS_OF.year, asOfDate: AS_OF.date, asOfTimeIndex: AS_OF.timeIndex,
});
const built = global.MingliChartInfo.buildChartInfo(chart);
if (built.status !== "ok") {
  console.error("ChartInfo 不可用：", built.status, built.diagnostics.map((d) => d.code));
  process.exit(1);
}
const chartInfo = built.chartInfo;

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "skill-manifest.json"), "utf8"),
);
const base = manifest.source.origin;
const readText = (rel) => fs.readFileSync(path.join(base, rel), "utf8");

const matrix = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "section16-matrix.json"), "utf8"),
);

// 逐步装载知识，同时留痕
const knowledge = { schema: "trial-knowledge/v1", steps: {} };
for (const row of matrix.rows) {
  const loaded = global.MingliSkillContext.loadSkillContext(
    row.id, manifest, readText, BUDGET_TOKENS,
  );
  knowledge.steps[row.id] = {
    status: loaded.status,
    budgetUsed: loaded.budgetUsed,
    budgetTokens: loaded.budgetTokens,
    sections: loaded.sections.map((s) => ({
      source: s.source,
      anchor: s.anchor,
      parent: s.parent || "",
      chars: s.text.length,
      text: s.text,
    })),
    missing: loaded.missing,
    diagnostics: loaded.diagnostics.map((d) => d.code),
  };
}

// 事实门禁必须先跑：准备提示词时不能只凭知识装载 ok 就让模型自己判断事实够不够
// （review r738 major 11）。第 6、15 项按试读规则强制 blocked，只允许输出未完成原因。
const GATE_FORCED_BLOCKED = new Set([6, 15]);
const contractPath = path.join(ROOT, "knowledge", "ziwei", "section16-fact-contracts.json");
const contractBook = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const contractLoad = global.MingliSection16.setContractBook(contractBook);
if (!contractLoad.ok) throw new Error("事实合同簿不可用：" + contractLoad.reason);
const gateResults = global.MingliSection16.evaluateAll(matrix, chartInfo, { topic: TOPIC });
const gateSteps = gateResults.summary ? gateResults.steps : [];
const gateById = new Map(gateSteps.map((x) => [x.id, x]));

const loadedCount = Object.values(knowledge.steps).filter((s) => s.status === "ok").length;
const totalChars = Object.values(knowledge.steps)
  .reduce((acc, s) => acc + s.sections.reduce((a, x) => a + x.chars, 0), 0);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "inputs.json"), JSON.stringify({
  schema: "trial-inputs/v1",
  experimental: true,
  deliverable: false,
  input: INPUT,
  asOf: AS_OF,
  topic: TOPIC,
  chartInfoStatus: built.status,
  chartInfoDigest: {
    palaces: chartInfo.palaces.map((p) => ({
      name: p.name, branch: p.earthlyBranch, stem: p.heavenlyStem,
      isBodyPalace: p.isBodyPalace,
      majorStars: (p.majorStars || []).map((s) => s.name + (s.brightness || "")),
      minorStars: (p.minorStars || []).map((s) => s.name),
      auxiliaryStars: (p.auxiliaryStars || []).map((s) => s.name),
    })),
    sihua: chartInfo.sihua.map((x) => x.kind + ":" + x.star),
    wuxingJu: chartInfo.wuxingJu,
    yearStem: chartInfo.yearStem,
    jiChains: chartInfo.flyingChains.jiChains.length,
    palaceFlying: chartInfo.flyingChains.palaceFlying.length,
    fourLayerRows: chartInfo.fourLayerDieGong.rows.length,
  },
}, null, 1) + "\n", "utf8");

fs.writeFileSync(path.join(OUT, "knowledge.json"), JSON.stringify(knowledge, null, 1) + "\n", "utf8");

fs.writeFileSync(path.join(OUT, "gate.json"), JSON.stringify({
  schema: "trial-gate/v1",
  experimental: true,
  deliverable: false,
  note: "事实门禁结果；第 6、15 项按试读规则强制 blocked",
  forcedBlocked: [...GATE_FORCED_BLOCKED],
  summary: gateResults.summary,
  structural: gateResults.structural || null,
  steps: gateSteps,
}, null, 1) + "\n", "utf8");

// 提示词：把 ChartInfo 全文与逐步知识一起给模型，要求结构化输出
const parts = [];
parts.push("# 钦天门紫微斗数 §16 逐步试读（实验性，不可交付）");
parts.push("");
parts.push("你将拿到一份 ChartInfo，以及 §16 各步所需的知识章节。");
parts.push("请**严格按 1 至 15 顺序**逐项输出，每项给出：");
parts.push("");
parts.push("```json");
parts.push('{"id":1,"status":"done|blocked|not_applicable","text":"...",');
parts.push(' "factPointers":["/palaces/0/majorStars/0"],');
parts.push(' "knowledgeReferences":["references/xxx.md#anchor"],');
parts.push(' "limitations":"..."}');
parts.push("```");
parts.push("");
parts.push("硬规则：");
parts.push("- `factPointers` 必须来自下文 ChartInfo 里**真实存在**的路径；不确定就不要写。");
parts.push("- `knowledgeReferences` 必须来自下文**实际给出的** source#anchor；不要引用未给出的章节。");
parts.push("- 事实或知识不足时，`status` 写 `blocked`，只说明未完成原因，**不得编造推断**。");
parts.push("- 第 11 项：本次主题为「明确不涉婚」，写 `not_applicable` 并说明依据。");
parts.push("- 只输出一个 JSON 数组，包含 15 个对象，不要输出其他文字。");
parts.push("");
parts.push("## ChartInfo（节选：宫位与四化）");
parts.push("```json");
parts.push(JSON.stringify({
  palaces: chartInfo.palaces.map((p, i) => ({
    index: i, name: p.name, branch: p.earthlyBranch, stem: p.heavenlyStem,
    isBodyPalace: p.isBodyPalace,
    majorStars: (p.majorStars || []).map((s, j) => ({ i: j, name: s.name, brightness: s.brightness })),
  })),
  sihua: chartInfo.sihua.map((x) => ({ kind: x.kind, star: x.star, natalPalace: x.natalPalace })),
  wuxingJu: chartInfo.wuxingJu,
  yearStem: chartInfo.yearStem,
  jiChains: chartInfo.flyingChains.jiChains,
  fourLayerRows: chartInfo.fourLayerDieGong.rows,
}, null, 1));
parts.push("```");
parts.push("");
parts.push("## §16 十五项清单");
matrix.rows.forEach((row) => {
  parts.push(`${row.id}. ${row.title}（矩阵声明：${row.status}）`);
});
parts.push("");
parts.push("## 逐步知识");
matrix.rows.forEach((row) => {
  const step = knowledge.steps[row.id];
  parts.push(`### 步骤 ${row.id} 知识（status=${step.status}，${step.sections.length} 章节）`);
  step.sections.forEach((sec) => {
    parts.push(`#### ${sec.source}#${sec.anchor}`);
    parts.push(sec.text);
  });
  if (!step.sections.length) parts.push("（该步骤未装载到任何知识章节）");
});

// 单步提示词：一步一个文件，避免把 15 步拼成超长提示词
const stepDir = path.join(OUT, "steps");
fs.mkdirSync(stepDir, { recursive: true });
const prepared = [];
const skipped = [];

matrix.rows.forEach((row) => {
  const step = knowledge.steps[row.id];
  const forcedBlocked = GATE_FORCED_BLOCKED.has(row.id);
  if (!forcedBlocked && step.status !== "ok") {
    skipped.push({ id: row.id, reason: "知识装载 " + step.status + "：" +
      (step.diagnostics.join(",") || "无诊断") });
    return;
  }
  const gateStep = gateById.get(row.id) || null;
  const lines = [];
  lines.push(`# §16 第 ${row.id} 项试读：${row.title}（实验性，不可交付）`);
  lines.push("");
  lines.push("只做这一项，不要展开其他项。输出一个 JSON 对象：");
  lines.push("```json");
  lines.push('{"id":' + row.id + ',"status":"done|blocked|not_applicable","text":"...",');
  lines.push(' "factPointers":["..."],"knowledgeReferences":["..."],"limitations":"..."}');
  lines.push("```");
  lines.push("");
  lines.push("硬规则：");
  lines.push("- factPointers 必须来自下文 ChartInfo 里真实存在的路径；不确定就不写。");
  lines.push("- knowledgeReferences 必须取自下文实际给出的 source#anchor。");
  lines.push("- 事实或知识不足时 status 写 blocked，只写未完成原因，不得编造。");
  if (row.id === 11) lines.push("- 本次主题明确不涉婚，写 not_applicable 并说明依据。");
  lines.push("");
  lines.push("## 本步事实门禁");
  if (forcedBlocked) {
    lines.push("状态：blocked（试读规则强制，不允许升级）");
    lines.push("本步**只允许**输出 status=blocked 与未完成原因；不得给出任何判断或推断。");
  } else if (gateStep) {
    lines.push(`状态：${gateStep.status}`);
    lines.push(`必需事实：${JSON.stringify((matrix.rows.find((r) => r.id === row.id) || {}).requiredFacts || [])}`);
    const gaps = (gateStep.missing || []).map((m) => `${m.code}@${m.path}：${m.reason}`);
    lines.push(gaps.length ? `缺口：${gaps.join("；")}` : "缺口：无");
    if (gateStep.status !== "ready") {
      lines.push("该步未达 ready：事实不全时只能写 blocked，不得越级下判断。");
    }
  } else {
    lines.push("状态：未取得门禁结果（结构无效或缺失），本步只允许写 blocked。");
  }
  lines.push("");
  lines.push("## ChartInfo（节选）");
  lines.push("```json");
  // 字段名与嵌套结构**必须与 ChartInfo 完全一致**：
  // 上一轮把 earthlyBranch 改名 branch、把 flyingChains.jiChains 提到顶层，
  // 直接诱导模型产出无法解析的引用。
  lines.push(JSON.stringify({
    palaces: chartInfo.palaces.map((p, i) => ({
      index: i,
      name: p.name,
      earthlyBranch: p.earthlyBranch,
      heavenlyStem: p.heavenlyStem,
      isBodyPalace: p.isBodyPalace,
      majorStars: (p.majorStars || []).map((s, j) => ({ i: j, name: s.name, brightness: s.brightness })),
      minorStars: (p.minorStars || []).map((s, j) => ({ i: j, name: s.name, brightness: s.brightness })),
      auxiliaryStars: (p.auxiliaryStars || []).map((s, j) => ({ i: j, name: s.name })),
    })),
    sihua: chartInfo.sihua,
    wuxingJu: chartInfo.wuxingJu,
    yearStem: chartInfo.yearStem,
    flyingChains: {
      jiChains: chartInfo.flyingChains.jiChains,
      palaceFlying: chartInfo.flyingChains.palaceFlying.slice(0, 8),
    },
    fourLayerDieGong: { layers: chartInfo.fourLayerDieGong.layers,
      rows: chartInfo.fourLayerDieGong.rows },
  }, null, 1));
  lines.push("```");
  lines.push("");
  lines.push("## 本步知识");
  step.sections.forEach((sec) => {
    lines.push(`### ${sec.source}#${sec.anchor}`);
    lines.push(sec.text);
  });
  const text = lines.join("\n");
  const file = path.join(stepDir, `step-${String(row.id).padStart(2, "0")}.md`);
  fs.writeFileSync(file, text, "utf8");
  prepared.push({ id: row.id, title: row.title, promptChars: text.length,
    sections: step.sections.length, gateStatus: forcedBlocked ? "blocked(forced)"
      : (gateStep ? gateStep.status : "unknown") });
});

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  schema: "trial-manifest/v1",
  experimental: true,
  deliverable: false,
  prepared,
  skipped,
}, null, 1) + "\n", "utf8");

console.log(`ChartInfo: ${built.status}`);
console.log(`知识装载: ${loadedCount}/15 步 ok，合计 ${totalChars} 字符`);
const gateSummary = gateResults.summary || {};
console.log(`事实门禁: ready=${gateSummary.ready || 0} conditional=${gateSummary.conditional || 0} ` +
  `blocked=${gateSummary.blocked || 0} not_applicable=${gateSummary.not_applicable || 0}` +
  (gateResults.structural ? `（结构无效：${gateResults.structural.length} 项）` : ""));
console.log(`已准备单步提示词: ${prepared.length} 步`);
prepared.forEach((item) => console.log(
  `  步骤 ${String(item.id).padStart(2)}  ${item.promptChars} 字符 / ${item.sections} 章节`));
if (skipped.length) {
  console.log(`因知识装载不足而跳过: ${skipped.map((s) => s.id).join(", ")}`);
  skipped.forEach((s) => console.log(`  步骤 ${s.id}：${s.reason}`));
}

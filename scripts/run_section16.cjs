"use strict";

// T7：拿真实盘跑 §16 十五项，把每项的实际状态、缺口与验证证据落成报告。
//
// 原则（Codex T5/T7 要求）：状态由实际盘决定，静态预判不等于实测；
// 只补阻塞项，不因为"看起来能补"就扩范围。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
[
  "ziwei-facts.js",
  "ziwei-adapter.js",
  "chartinfo-adapter.js",
  "section16-gate.js",
  "skill-context.js",
].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const CASES = [
  ["标准男命", { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" }],
  ["标准女命", { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "female" }],
  ["缺时辰", { calendar: "solar", date: "1990-05-15", time: { precision: "unknown", value: null, branch: null }, sex_for_calculation: "male" }],
  // 主题变体：明确声明不涉婚姻，用于验证第 11 项的适用性切换
  ["标准男命·不涉婚", { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30", branch: null }, sex_for_calculation: "male" }],
];

const matrix = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "section16-matrix.json"), "utf8"),
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "skill-manifest.json"), "utf8"),
);
const skillBase = manifest.source.origin;
const readText = (rel) => fs.readFileSync(path.join(skillBase, rel), "utf8");

// 主题固定声明：不同主题会改变 §16 第 11 项的适用性，必须写进报告
const TOPIC = "marriage";

const report = {
  schema: "section16-run/v1",
  generatedBy: "scripts/run_section16.cjs",
  ranAt: new Date().toISOString(),
  topic: TOPIC,
  asOf: { year: 2026, date: "2026-10-30", timeIndex: 6 },
  skillSource: {
    name: manifest.source.name,
    version: manifest.source.version,
    license: manifest.source.license.content,
    distributed: manifest.source.distributed,
  },
  section17Audit: {
    status: "not_performed",
    reason: "§17 独立审查需人工/独立模型执行，本轮自动化只跑事实门禁，不冒充已审查",
  },
  cases: [],
};

for (const [label, payload] of CASES) {
  const chart = global.MingliZiwei.calculate(payload, {
    asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6,
  });
  const built = global.MingliChartInfo.buildChartInfo(chart);
  if (built.status !== "ok") {
    report.cases.push({
      label,
      chartInfoStatus: built.status,
      diagnostics: built.diagnostics.map((d) => d.code),
      summary: null,
      steps: [],
      deliverable: false,
      reason: "ChartInfo 不可用，§16 无法执行",
    });
    continue;
  }
  const caseTopic = label.indexOf("不涉婚") >= 0 ? "not_married_related" : TOPIC;
  // 逐步骤事实合同必须先装载：没装载就没有 ready（门禁不会默认可信）
  const contractPath = path.join(ROOT, "knowledge", "ziwei", "section16-fact-contracts.json");
  let contractBook = null;
  try {
    contractBook = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    console.error(`无法装载事实合同簿（${contractPath}）：${error.message}`);
    process.exit(1);
  }
  const contractLoad = global.MingliSection16.setContractBook(contractBook);
  if (!contractLoad.ok) {
    console.error(`事实合同簿不可用：${contractLoad.reason}`);
    process.exit(1);
  }
  const results = global.MingliSection16.evaluateAll(matrix, built.chartInfo, { topic: caseTopic });

  // 逐步知识装载：每步实际装了什么，必须留痕，否则无法复核"该步有没有按知识执行"
  const knowledgeByStep = {};
  for (const step of results.steps) {
    const loaded = global.MingliSkillContext.loadSkillContext(
      step.id, manifest, readText, 120000,
    );
    knowledgeByStep[step.id] = {
      status: loaded.status,
      sections: loaded.sections.map((sec) => sec.source + "#" + sec.anchor),
      budgetUsed: loaded.budgetUsed,
      diagnostics: loaded.diagnostics.map((d) => d.code),
    };
  }
  // 知识装载状态必须参与交付判定：装不全就不能算"按知识执行过"
  const gate = global.MingliSection16.assertDeliverable(results, {
    expectedSteps: 15,
    section17Audit: report.section17Audit,
    knowledgeStatus: knowledgeByStep,
  });
  report.cases.push({
    label,
    // 完整输入留档：没有它，报告无法复跑
    input: payload,
    chartInfoStatus: built.status,
    chartInfoDigest: {
      palaces: (built.chartInfo.palaces || []).length,
      sihua: (built.chartInfo.sihua || []).map((x) => x.kind + ":" + x.star),
      palaceFlying: (built.chartInfo.flyingChains.palaceFlying || []).length,
      jiChains: (built.chartInfo.flyingChains.jiChains || []).length,
      fourLayerRows: (built.chartInfo.fourLayerDieGong?.rows || []).length,
      wuxingJu: built.chartInfo.wuxingJu,
      yearStem: built.chartInfo.yearStem,
    },
    diagnostics: built.diagnostics.map((d) => d.code),
    summary: results.summary,
    steps: results.steps,
    knowledgeByStep,
    deliverable: gate.deliverable,
    reason: gate.reason,
  });
}

const outPath = path.join(ROOT, "knowledge", "ziwei", "section16-run.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 1) + "\n", "utf8");

for (const item of report.cases) {
  console.log(`\n=== ${item.label} ===  ChartInfo=${item.chartInfoStatus}`);
  if (!item.summary) {
    console.log("  §16 无法执行：" + item.reason);
    continue;
  }
  console.log(
    `  ready=${item.summary.ready} conditional=${item.summary.conditional} ` +
    `blocked=${item.summary.blocked} not_applicable=${item.summary.not_applicable}`,
  );
  console.log(`  可交付：${item.deliverable ? "是" : "否"}`);
  for (const step of item.steps) {
    const flag = step.status === "ready" ? "✓" : step.status === "blocked" ? "✗" : "△";
    const missing = step.missing.length ? " 缺：" + step.missing.map((m) => m.path).join(", ") : "";
    console.log(`   ${flag} ${String(step.id).padStart(2)} ${step.title} [${step.status}]${missing}`);
  }
}
console.log(`\n报告已写入 ${path.relative(ROOT, outPath)}`);

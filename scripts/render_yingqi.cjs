"use strict";

// 把「应期四阶梯」判定渲染成可读段落。
//
// 每段都标注来自哪一阶（SKILL §12 要求），第四阶句子必须是
// 「星曜组合 + 宫位 + 四化结构」三要素完整句式。
//
// 用法：node scripts/render_yingqi.cjs [输出路径]

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "ziwei-knowledge.js", "yingqi-ladder.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const knowledge = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8"));
const index = global.MingliZiweiKnowledge.createIndex(knowledge);

const SAMPLE_INPUT = {
  calendar: "solar", date: "1990-05-15", is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
};
const AS_OF = { year: 2026, date: "2026-10-30", timeIndex: 6 };

const chart = global.MingliZiwei.calculate(SAMPLE_INPUT, {
  asOfYear: AS_OF.year, asOfDate: AS_OF.date, asOfTimeIndex: AS_OF.timeIndex,
});
const timeline = global.MingliZiweiFacts.buildDecadalAnnualTimeline(
  chart.astrolabe, chart.palaces, AS_OF.year,
);
const result = global.MingliYingqiLadder.evaluateTimeline(timeline, {
  palaces: chart.palaces, knowledge: global.MingliZiweiKnowledge, knowledgeIndex: index,
});

const lines = [];
lines.push("# 应期四阶梯判定（样本）");
lines.push("");
lines.push("> 由 `scripts/render_yingqi.cjs` 生成。判定规则见 `web/yingqi-ladder.js`，法源为 SKILL §12。");
lines.push("> 四阶顺序：结构引力 → 宫位交感 → 格局触发 → 单星应象，禁跳级。");
lines.push("");
lines.push(`- 输入：${SAMPLE_INPUT.date} ${SAMPLE_INPUT.time.value} 男`);
lines.push(`- 大限：${result.decadal.ganzhi}（虚岁 ${result.decadal.ageRange.join("–")}，公元 ${result.decadal.yearRange.join("–")}）`);
lines.push(`- 大限命宫：${result.decadal.natalAnchorPalace}`);
lines.push(`- 引力中心：${result.decadal.gravityCenter}（强度 ${result.decadal.gravityStrength}）`);
lines.push(`- 整体状态：${result.status}`);
lines.push("");
lines.push("## 阶梯命中统计");
lines.push("");
lines.push("| 阶梯 | 名称 | 命中流年数 |");
lines.push("| --- | --- | --- |");
for (const row of result.ladderTotals) {
  lines.push(`| ${row.step} | ${row.name} | ${row.firedYears} / ${result.years.length} |`);
}
lines.push("");
lines.push("## 一年一句（速览）");
lines.push("");
lines.push("| 年 | 干支 | 到第几阶 | 应期粒度 | 一句话 |");
lines.push("| --- | --- | --- | --- | --- |");
for (const year of result.years) {
  const one = year.statements.length > 0
    ? year.statements.map((item) => item.shortText).join(" / ")
    : `（停在 ${year.reachableDepth} 阶，不出断语）`;
  const grain = year.granularity.granularity === "none"
    ? (year.reachableDepth === 4 ? "结构提示" : "—")
    : (year.granularity.granularity === "year" ? "年份断" : "年限断");
  lines.push(`| ${year.year} | ${year.ganzhi} | ${year.reachableDepth} | ${grain} | ${one} |`);
}
lines.push("");
lines.push("## 逐年判定");
lines.push("");
for (const year of result.years) {
  lines.push(`### ${year.year} ${year.ganzhi} · 虚 ${year.nominalAge} —— 到第 ${year.reachableDepth} 阶`);
  lines.push("");
  for (let step = 1; step <= 4; step += 1) {
    const ladder = year.ladders[step - 1];
    const mark = ladder.fired ? "✅" : (ladder.skipped ? "⏭️" : "❌");
    lines.push(`- ${mark} 第 ${step} 阶·${ladder.name}`);
    if (ladder.reason) lines.push(`  - 说明：${ladder.reason}`);
    for (const item of ladder.evidence || []) {
      lines.push(`  - 证据：${item.text}${item.ruleId ? `（${item.ruleId}）` : ""}`);
    }
  }
  lines.push(`- 应期远近：${year.granularity.reason}`);
  if (year.statements.length > 0) {
    lines.push("");
    lines.push("**倾向性结论**");
    lines.push("");
    for (const item of year.statements) {
      lines.push(`- ${item.shortText}`);
      lines.push(`  - 〔阶梯 4·单星应象｜格局 ${item.patternCodes.join("+")}｜依据 ${item.factPointers.join("、")}｜${item.knowledgeRefs.join("、")}〕`);
      lines.push(`  - 完整断语：${item.text}`);
    }
    lines.push("");
  }
  if (year.diagnostics.length > 0) {
    lines.push("诊断：" + year.diagnostics.join("；"));
    lines.push("");
  }
}

const output = lines.join("\n");
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "docs", "yingqi-sample.md");
fs.writeFileSync(target, output, "utf8");
console.log(`已写入 ${target}（${output.length} 字符）`);
console.log(`状态 ${result.status}；阶梯命中 ${result.ladderTotals.map((x) => `${x.step}:${x.firedYears}`).join(" ")}`);

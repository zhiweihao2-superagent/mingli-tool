"use strict";

// 全生涯逐年覆盖率扫描。
//
// 回答的问题是：从出生到 120 岁，每一年「能不能出人话断语」，
// 不能的时候是卡在哪一阶、因为什么。
//
// 用法：node scripts/scan_year_coverage.cjs [起始年] [结束年]

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "ziwei-knowledge.js", "knowledge-compose.js", "yingqi-ladder.js", "report-render.js"]
  .forEach((name) => {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
  });

const knowledge = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8"),
);
const index = global.MingliZiweiKnowledge.createIndex(knowledge);
const composeParts = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "compose-parts.json"), "utf8"),
);

const SAMPLE_INPUT = {
  calendar: "solar", date: "1990-05-15", is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
};

const chart = global.MingliZiwei.calculate(SAMPLE_INPUT, {
  asOfYear: 1990, asOfDate: "1990-05-15", asOfTimeIndex: 6,
});

const from = Number(process.argv[2] || 1990);
const to = Number(process.argv[3] || 2109);

const depths = { 1: 0, 2: 0, 3: 0, 4: 0 };
const blocked = [];
const composedYears = [];
const outOfRange = [];
let totalStatements = 0;

for (let year = from; year <= to; year += 1) {
  const timeline = global.MingliZiweiFacts.buildDecadalAnnualTimeline(
    chart.astrolabe, chart.palaces, year,
  );
  // 12 个大限之外（约 120 岁以后）没有大限可落，如实跳过，不算「出不了断语」
  if (!timeline || !timeline.decadal) {
    outOfRange.push(year);
    continue;
  }
  const judged = global.MingliYingqiLadder.evaluateTimeline(timeline, {
    palaces: chart.palaces,
    knowledge: global.MingliZiweiKnowledge,
    knowledgeIndex: index,
    composeParts,
  });
  const row = judged.years.find((y) => y.year === year);
  if (!row) continue;
  depths[row.reachableDepth] = (depths[row.reachableDepth] || 0) + 1;
  totalStatements += row.statements.length;
  if (row.statements.some((s) => s.composed)) composedYears.push(year);
  if (row.statements.length === 0) {
    const why = (row.ladders || [])
      .flatMap((l) => (l.unavailable || []).map((u) => u.reason))
      .filter(Boolean);
    blocked.push({ year, depth: row.reachableDepth, why });
  }
}

const span = to - from + 1;
const inScope = span - outOfRange.length;
const speakable = inScope - blocked.length;
console.log(`扫描范围：${from}–${to}（${span} 年，落在大限内 ${inScope} 年）`);
if (outOfRange.length > 0) {
  console.log(`大限之外（无大限可落）：${outOfRange[0]}–${outOfRange[outOfRange.length - 1]} 共 ${outOfRange.length} 年`);
}
console.log(`阶分布：1阶 ${depths[1]}｜2阶 ${depths[2]}｜3阶 ${depths[3]}｜4阶 ${depths[4]}`);
console.log(`能出断语：${speakable} 年（${((speakable / inScope) * 100).toFixed(1)}%）`);
console.log(`其中含组合句：${composedYears.length} 年`);
console.log(`断语总数：${totalStatements} 条`);
if (blocked.length > 0) {
  console.log(`\n出不了断语的 ${blocked.length} 年：`);
  blocked.forEach((b) => {
    const reason = b.why.length > 0 ? b.why.join("；") : `停在 ${b.depth} 阶`;
    console.log(`  ${b.year}  深 ${b.depth}  ${reason}`);
  });
}

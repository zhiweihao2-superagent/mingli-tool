"use strict";

// 把「大限逐流年事实」渲染成可读的 Markdown 表。
//
// 只做搬运与排版：不判断吉凶、不给结论、不合并两套体系。
// 每一行都能指回 buildDecadalAnnualTimeline 的字段，
// 供后续「应期四阶梯」逐级判定时引用。
//
// 用法：
//   node scripts/render_decadal_facts.cjs [输出路径]

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

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

function huaText(hua) {
  return `${hua.kind}${hua.star}→${hua.natalPalace}`;
}

function relationText(relation) {
  if (!relation || relation.status !== "ok") return "干支不可用";
  if (relation.relation.length > 0) {
    return relation.relation.map((item) => item.kind).join("、");
  }
  const parts = [];
  if (relation.sameStem) parts.push("同干");
  if (relation.sameBranch) parts.push("同支");
  if (relation.stemClash) parts.push("干克");
  if (relation.branchClash) parts.push("支冲");
  return parts.length > 0 ? parts.join("+") : "无特殊关系";
}

function overlapText(row) {
  if (!row.overlapsNatal || row.overlapsNatal.length === 0) return null;
  return row.overlapsNatal
    .map((item) => `生年${item.natalKind}(${item.star})${item.relation}`)
    .join("、");
}

const lines = [];
lines.push("# 大限逐流年事实（样本）");
lines.push("");
lines.push("> 本文件由 `scripts/render_decadal_facts.cjs` 生成，只排版事实，不含任何断语。");
lines.push("> 每一条都能在 `buildDecadalAnnualTimeline()` 的返回里找到对应字段。");
lines.push("");
lines.push(`- 输入：${SAMPLE_INPUT.date} ${SAMPLE_INPUT.time.value} ${SAMPLE_INPUT.sex_for_calculation === "male" ? "男" : "女"}`);
lines.push(`- 大限：${timeline.decadal.ganzhi}（虚岁 ${timeline.decadal.ageRange.join("–")}，公元 ${timeline.decadal.yearRange.join("–")}）`);
lines.push(`- 大限命宫：${chart.palaces.find((item) => item.name === timeline.decadal.natalAnchorPalace)?.name || "—"}`);
lines.push(`- 事实状态：${timeline.status}；边界对账：${timeline.boundaryAudit.status}`);
lines.push("");

const decadalHua = timeline.decadal.fourTransformations.map(huaText).join("｜");
lines.push(`**大限四化**：${decadalHua}`);
const natalHua = timeline.years[0].activation.natalHua;
lines.push(`**生年四化**：${["禄", "权", "科", "忌"].map((kind) => (natalHua[kind]
  ? `${kind}${natalHua[kind].star}→${natalHua[kind].palace}`
  : `${kind}—`)).join("｜")}`);
lines.push("");

lines.push("## 逐年表");
lines.push("");
lines.push("| 年 | 干支 | 虚岁 | 流年四化（本命落宫） | 撞大限命宫 | 与大限四化叠宫 | 与生年四化重合 | 干支关系 |");
lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const item of timeline.years) {
  const hua = item.fourTransformations.map(huaText).join("｜");
  const onSoul = item.activation.rows
    .filter((row) => row.onDecadalSoul || row.onDecadalSoulOpposite)
    .map((row) => `${row.kind}${row.onDecadalSoul ? "(命宫)" : "(冲命宫)"}`)
    .join("、") || "—";
  const stacked = item.activation.stackedRows
    .map((row) => `${row.kind}+大限${row.stackedOnDecadalHua.map((x) => x.kind).join("/")}`)
    .join("、") || "—";
  const overlap = item.activation.natalOverlapRows
    .map((row) => `${row.kind}(${row.natalPalace}): ${overlapText(row)}`)
    .join("；") || "—";
  lines.push(`| ${item.year} | ${item.ganzhi} | ${item.nominalAge} | ${hua} | ${onSoul} | ${stacked} | ${overlap} | ${relationText(item.decadalAnnualRelation)} |`);
}
lines.push("");

lines.push("## 逐年明细");
lines.push("");
for (const item of timeline.years) {
  lines.push(`### ${item.year} ${item.ganzhi} · 虚 ${item.nominalAge}`);
  lines.push("");
  for (const row of item.activation.rows) {
    const marks = [];
    if (row.onDecadalSoul) marks.push("落大限命宫");
    if (row.onDecadalSoulOpposite) marks.push("冲大限命宫");
    if (row.stacked) {
      marks.push(`与大限${row.stackedOnDecadalHua.map((x) => `${x.kind}${x.star}`).join("、")}同宫`);
    }
    const overlap = overlapText(row);
    if (overlap) marks.push(overlap);
    const markText = marks.length > 0 ? ` ← ${marks.join("；")}` : "";
    lines.push(`- 流年${row.kind}：${row.star} 落本命${row.natalPalace}（大限${row.decadalPalace}／流年${row.annualPalace}）${markText}`);
  }
  lines.push(`- 干支关系：${relationText(item.decadalAnnualRelation)}`);
  lines.push("");
}

lines.push("## 结构说明");
lines.push("");
lines.push("| 字段 | 含义 | 可追溯来源 |");
lines.push("| --- | --- | --- |");
lines.push("| `fourTransformations[].natalPalace` | 该化星在本命盘所在宫 | 流年四化 + 本命宫位 |");
lines.push("| `fourTransformations[].decadalPalace` | 同一宫在大限盘的宫名 | 大限盘 `palaceNames` |");
lines.push("| `fourTransformations[].periodPalace` | 同一宫在流年盘的宫名 | 流年盘 `palaceNames` |");
lines.push("| `activation.rows[].stackedOnDecadalHua` | 同年大限四化落在同宫的条目 | 大限四化 × 流年四化 |");
lines.push("| `activation.rows[].overlapsNatal` | 与生年四化的同宫/对冲 | 星曜 `transformation` 字段 |");
lines.push("| `decadalAnnualRelation` | 岁运并临 / 天克地冲 / 同干 / 支冲 | 大限干支 × 流年干支 |");
lines.push("| `boundaryAudit` | 条目数、连续性、首末年、虚岁递增 | 大限 `yearRange`/`ageRange` |");
lines.push("");

const output = lines.join("\n");
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "docs", "decadal-annual-sample.md");
fs.writeFileSync(target, output, "utf8");
console.log(`已写入 ${target}（${output.length} 字符，${timeline.years.length} 年）`);

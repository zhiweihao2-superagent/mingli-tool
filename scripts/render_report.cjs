"use strict";

// 把「应期四阶梯」的判定渲染成可读报告样本。
//
// 分工：
//   web/yingqi-ladder.js  → 判（四阶梯、粒度、措辞降级）
//   web/report-render.js  → 译（宫位→生活领域、时间落点、人话句子）
//   本脚本                → 排版，不改任何结论
//
// 用法：node scripts/render_report.cjs [输出路径]

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "ziwei-knowledge.js", "knowledge-compose.js", "yingqi-ladder.js", "report-render.js", "specialty-rules.js", "section16-steps.js"]
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
const AS_OF = { year: 2026, date: "2026-10-30", timeIndex: 6 };

const chart = global.MingliZiwei.calculate(SAMPLE_INPUT, {
  asOfYear: AS_OF.year, asOfDate: AS_OF.date, asOfTimeIndex: AS_OF.timeIndex,
});
const timeline = global.MingliZiweiFacts.buildDecadalAnnualTimeline(
  chart.astrolabe, chart.palaces, AS_OF.year,
);
const judged = global.MingliYingqiLadder.evaluateTimeline(timeline, {
  palaces: chart.palaces, knowledge: global.MingliZiweiKnowledge, knowledgeIndex: index,
  composeParts,
});
const report = global.MingliReportRender.renderTimeline(judged);

const DEPTH_LABEL = { 0: "未起框架", 1: "结构引力", 2: "宫位交感", 3: "格局触发", 4: "单星应象" };
const GRAN_LABEL = { decadal: "年限断（5–10 年）", year: "年份断（当年）", none: "只作结构提示" };

const lines = [];
lines.push("# 紫微斗数 · 可读报告样本");
lines.push("");
lines.push("> 由 `scripts/render_report.cjs` 生成。");
lines.push("> 判断来自 `web/yingqi-ladder.js`（SKILL §12 应期四阶梯），译名来自 `web/report-render.js`。");
lines.push("> 全部为倾向语，不含断言；每句附证据指针，可逐条倒查。");
lines.push("");
lines.push(`- 输入：${SAMPLE_INPUT.date} ${SAMPLE_INPUT.time.value} 男`);
lines.push(`- 当前大限：${report.decadal.ganzhi}（虚 ${report.decadal.ageRange.join("–")}，公元 ${report.decadal.yearRange.join("–")}）`);
lines.push(`- 大限命宫：${report.decadal.natalAnchorPalace}`);
lines.push(`- 引力中心：${report.decadal.gravityCenter}（强度 ${report.decadal.gravityStrength}）`);
lines.push(`- 判定状态：${report.status}`);
lines.push("");

lines.push("## 一句话总览");
lines.push("");
lines.push("| 年 | 到第几阶 | 时间落点 | 一句话 |");
lines.push("| --- | --- | --- | --- |");
report.years.forEach((year) => {
  const depth = DEPTH_LABEL[year.reachableDepth] || String(year.reachableDepth);
  lines.push(`| ${year.year} | ${year.reachableDepth} ${depth} | ${GRAN_LABEL[year.granularity] || year.granularity} | ${year.headline} |`);
});
lines.push("");

lines.push("## 统计");
lines.push("");
lines.push(`- 覆盖流年：${report.stats.yearCount} 年，其中 ${report.stats.yearsWithPlainText} 年出到断语`);
lines.push(`- 断语条数：${report.stats.lineCount} 条（年限断 ${report.stats.decadalLines}、年份断 ${report.stats.yearLines}、不定时间 ${report.stats.untimedLines}）`);
lines.push(`- 断言词命中：${report.assertiveViolations.length} 条（应为 0）`);
lines.push(`- 未登记领域：${report.unknownDomains.length > 0 ? report.unknownDomains.join("、") : "无"}`);
lines.push("");

lines.push("## 逐年");
lines.push("");
report.years.forEach((year) => {
  lines.push(`### ${year.year} ${year.ganzhi} · 虚 ${year.nominalAge}`);
  lines.push("");
  lines.push(`**${year.headline}**`);
  lines.push("");
  if (year.lines.length === 0) {
    const why = year.diagnostics.length > 0 ? year.diagnostics.join("；") : "无可用断语";
    lines.push(`- 停在「${DEPTH_LABEL[year.reachableDepth] || year.reachableDepth}」阶：${why}`);
    lines.push("");
    return;
  }
  if (year.granularityReason) {
    lines.push(`> 时间落点：${GRAN_LABEL[year.granularity] || year.granularity} —— ${year.granularityReason}`);
    lines.push("");
  }  year.lines.forEach((line, i) => {
    lines.push(`${i + 1}. ${line.plain}`);
    const quotes = (line.quotes && line.quotes.length > 0) ? line.quotes : [line.quote];
    quotes.filter(Boolean).forEach((text, k) => {
      lines.push(`   - 原文${quotes.length > 1 ? k + 1 : ""}：${text}`);
    });
    lines.push(`   - 结构：${line.mechanism}`);
    if (line.motivationText) {
      const inside = (line.motivations || []).filter((o) => o.zone === "inside").length;
      const outside = (line.motivations || []).filter((o) => o.zone === "outside").length;
      lines.push(`   - 动因：${line.motivationText}（六内 ${inside}、六外 ${outside}）`);
    }
    const pointers = line.evidence.factPointers.map((p) => `\`${p}\``).join("、");
    const refs = line.evidence.knowledgeRefs.map((r) => `\`${r}\``).join("、");
    lines.push(`   - 依据：${pointers}${refs ? "｜" + refs : ""}`);
    if (line.domainAnchor) lines.push(`   - 领域出处：${line.domainAnchor}`);
  });
  lines.push("");
});

// ── §16 专题判定附录（#7 / #10 / #11）────────────────────────
const specialty = global.MingliSpecialtyRules.evaluateAll({ palaces: chart.palaces, timeline });

lines.push("## §16 专题判定");
lines.push("");
lines.push("这一节是三条固定规则的逐条核对结果，不做引申。成立的写成立，不成立的写清为什么不成立。");
lines.push("");

lines.push(`### #7 六宫禄打分（${specialty.sixPalaces.total} / ${specialty.sixPalaces.max}，原始分 ${specialty.sixPalaces.rawTotal}）`);
lines.push("");
lines.push("规则：禄 3 · 权 2 · 科 1 · 忌 -1；自化 ±1；同宫叠加；单宫封顶 3。");
lines.push("");
lines.push("| 层 | 槽位 | 实落宫 | 得分 | 构成 |");
lines.push("| --- | --- | --- | --- | --- |");
specialty.sixPalaces.rows.forEach((row) => {
  const detail = row.items.length > 0
    ? row.items.map((item) => `${item.source}${item.kind}${item.star}(${item.weight > 0 ? "+" : ""}${item.weight})`).join("、")
      + (row.capped ? `（原始 ${row.raw}，封顶 3）` : "")
    : "无四化";
  lines.push(`| ${row.layer} | ${row.slot} | ${row.palace} | ${row.score} | ${detail} |`);
});
lines.push("");
lines.push(`- 本命与大运三宫可能落在同一宫位（本盘大限财帛=本命${specialty.sixPalaces.rows.find((r) => r.layer === "大运" && r.slot === "财帛宫").palace}）。此时生年四化与大限四化各自计入，但自化只计一次。`);
lines.push("");

lines.push(`### #10 破财五法则（成立 ${specialty.wealth.firedCount} / ${specialty.wealth.total}）`);
lines.push("");
specialty.wealth.clauses.forEach((clause) => {
  lines.push(`- ${clause.fired ? "✔" : "·"} **${clause.label}**：${clause.detail}`);
  if (clause.fired && clause.evidence.length > 0) {
    lines.push(`  - 依据：${clause.evidence.map((p) => `\`${p}\``).join("、")}`);
  }
});
lines.push("");
if (specialty.wealth.singleSupport) {
  lines.push("> 只有一条成立，按 §17「多项定一象」记为单象，不作结论。");
  lines.push("");
}

lines.push(`### #11 离婚四法则（成立 ${specialty.divorce.firedCount} / ${specialty.divorce.total}）`);
lines.push("");
specialty.divorce.clauses.forEach((clause) => {
  lines.push(`- ${clause.fired ? "✔" : "·"} **${clause.label}**：${clause.detail}。${clause.note}`);
  if (clause.fired && clause.evidence.length > 0) {
    lines.push(`  - 依据：${clause.evidence.map((p) => `\`${p}\``).join("、")}`);
  }
});
lines.push("");
lines.push(`> ${specialty.divorce.note}`);
lines.push("");

// ───────── §16 其余九步 + 禄转忌链 + §17 审查 ─────────
const S16 = global.MingliSection16Steps;
const steps = S16.runAll(chart, timeline, timeline.years[0], global.MingliZiweiKnowledge, index);

lines.push("## §16 其余步骤判定（#1/#3/#4/#5/#6/#8/#9/#12/#13/#14）");
lines.push("");

lines.push(`### #1 排盘对账（${steps.step1.status === "pass" ? "全部通过" : `失败 ${steps.step1.failedCount} 项`}）`);
lines.push("");
lines.push("| 检查项 | 结果 | 详情 |");
lines.push("| --- | :--: | --- |");
steps.step1.checks.forEach((c) => {
  lines.push(`| ${c.code} | ${c.ok ? "✔" : "✘"} | ${c.detail} |`);
});
lines.push("");
lines.push(`> ${steps.step1.note}`);
lines.push("");

lines.push("### #3 生年四化与逐宫飞化");
lines.push("");
lines.push("生年四化（按年干，从星曜 transformation 反查）：");
lines.push("");
steps.step3.natalHua.forEach((h) => {
  lines.push(`- ${h.kind} ${h.star || "—"} → ${h.palace || "未定位"}`);
});
lines.push("");
lines.push(`逐宫飞化 ${steps.step3.flying.length} 条（12 宫 × 禄权科忌）。本盘各宫宫干化忌去向见 #6。`);
lines.push("");

lines.push("### #4 十六字检查（禄坐 / 禄照 / 忌坐 / 忌冲）");
lines.push("");
lines.push("| 宫位 | 对宫 | 四态 |");
lines.push("| --- | --- | --- |");
steps.step4.rows.forEach((r) => {
  lines.push(`| ${r.palace} | ${r.opposite} | ${r.text} |`);
});
lines.push("");
lines.push(`> ${steps.step4.note}`);
lines.push("");

lines.push("### #5 引动检查（谁踩谁得）");
lines.push("");
if (steps.step5.decadalOnNatal.length === 0) {
  lines.push("- 大运十二宫未踩到任何生年四化，本大限不形成引动。");
} else {
  steps.step5.decadalOnNatal.forEach((x) => lines.push(`- ${x.text}`));
}
lines.push("");
lines.push(`> ${steps.step5.note}`);
lines.push("");

lines.push("### #6 禄转忌 / 忌转忌 / 禄逢冲破 / 忌出");
lines.push("");
steps.step6.luZhuanJi.forEach((x) => lines.push(`- **禄转忌**：${x.text}`));
steps.step6.jiZhuanJi.forEach((x) => lines.push(`- **忌转忌**：${x.text}`));
steps.step6.luPoChong.forEach((x) => {
  lines.push(`- **禄逢冲破**：${x.text}${x.broken ? `；${x.reading}` : ""}`);
});
steps.step6.jiChu.forEach((x) => lines.push(`- **忌出**：${x.text}`));
lines.push("");
lines.push(`> ${steps.step6.note}`);
lines.push("");

lines.push("### #8 叠宫推算（逐位写出，禁心算）");
lines.push("");
lines.push("| 地支 | 本命 | 大限 | 流年 |");
lines.push("| --- | --- | --- | --- |");
steps.step8.rows.forEach((r) => {
  lines.push(`| ${r.branch} | ${r.natalPalace} | ${r.decadalPalace} | ${r.annualPalace} |`);
});
lines.push("");
lines.push(`> ${steps.step8.note}`);
lines.push("");

lines.push(`### #9 大限四化两步定位（${steps.step9.ganzhi}）`);
lines.push("");
lines.push("| 四化 | 星曜 | 本命宫 | 大限宫 | 双宫名 |");
lines.push("| --- | --- | --- | --- | --- |");
steps.step9.rows.forEach((r) => {
  lines.push(`| ${r.kind} | ${r.star} | ${r.natalPalace || "—"} | ${r.decadalPalace || "—"} | ${r.text} |`);
});
lines.push("");
lines.push(`> ${steps.step9.note}`);
lines.push("");

function clauseBlock(title, block) {
  lines.push(`### ${title}（成立 ${block.firedCount} / ${block.total}）`);
  lines.push("");
  block.clauses.forEach((c) => {
    lines.push(`- ${c.fired ? "✔" : "·"} **${c.label}**：${c.detail}`);
    if (c.fired && c.evidence.length > 0) {
      lines.push(`  - 依据：${Array.from(new Set(c.evidence)).map((p) => `\`${p}\``).join("、")}`);
    }
  });
  lines.push("");
}

clauseBlock("#12 财库", steps.step12);
lines.push(`> ${steps.step12.note}`);
lines.push("");

clauseBlock("#13 桃花", steps.step13);
if (steps.step13.spouseFeel.length > 0) {
  lines.push(`夫妻宫感情星性味：${steps.step13.spouseFeel.map((f) => `${f.star}=${f.feel}`).join("、")}`);
  lines.push("");
}
lines.push(`> ${steps.step13.note}`);
lines.push("");

clauseBlock("#14 疾厄", steps.step14);
steps.step14.readings.forEach((r) => {
  lines.push(`- ${r.star}：${r.reading}`);
});
if (steps.step14.missingReadings.length > 0) {
  const real = steps.step14.missingReadings.filter((m) => m.star);
  if (real.length > 0) {
    lines.push(`- 未命中：${real.map((m) => `${m.star}（${m.reason}）`).join("、")}`);
  }
}
lines.push("");
lines.push(`> ${steps.step14.note}`);
lines.push("");

// §17 审查签署：本项目没有独立第三方，签字人是本工具自身。
// 签的是 A 层（事实是否齐备、判定是否可追溯、措辞是否守规），
// 不等于钦天门传承意义上的「读得对」——这一层如实留空，不冒充。
const SECTION17_REVIEW = {
  reviewer: "mingli-tool agent（自审）",
  reviewerScope: "A 层：事实齐备、判定可追溯、措辞合规、未越级",
  reviewedAt: "2026-11-03",
  reviewerIndependence: "self-review",
};
const audit = S16.auditSection17({
  report,
  reconcileStatus: steps.step1.status,
  ...SECTION17_REVIEW,
});
lines.push(`## §17 技法合规校验（${audit.status}，失败 ${audit.failedCount} / 警告 ${audit.warningCount}）`);
lines.push("");
lines.push(`> 审查人：${audit.reviewer}（${audit.reviewedAt}，独立性：${audit.reviewerIndependence}）  `);
lines.push(`> 核的是：${audit.reviewerScope}  `);
lines.push("> 没核的是：B 层——断语是否符合钦天门传承。自审做不到这一层，留空不代签。");
lines.push("");
lines.push("| 条目 | 结论 | 说明 |");
lines.push("| --- | :--: | --- |");
audit.findings.forEach((f) => {
  const mark = f.status === "pass" ? "✔" : (f.status === "fail" ? "✘" : (f.status === "warning" ? "!" : "?"));
  lines.push(`| ${f.title} | ${mark} | ${f.detail} |`);
});
lines.push("");
if (audit.notCheckable.length > 0) {
  lines.push(`> 未能校验（如实标注、不假装通过）：${audit.notCheckable.join("、")}`);
  lines.push("");
}

lines.push("## 怎么读这份报告");
lines.push("");
lines.push("1. **先看粒度**。写「未来 5–10 年」的是年限断，说的是整个大限的基调；写「2032 年当年」的是年份断，说的就是这一年。");
lines.push("2. **一句话只是索引**。它只说明哪几个生活领域有动静，不含判断强度。具体要看下面的原文与结构。");
lines.push("3. **原文是 skill 的逐宫断语**，结构是本盘的四化落位。两者都给了才能成立——单看原文会脱离本盘的联系，单看结构则成了符号对应。");
lines.push("4. **「停在 N 阶」是正常结果**，不是失败。阶梯 2 要求当年确实被引动；没被引动就不该出断语。");
lines.push("5. **没有断言**。凡是写「一定/必然/绝对」的都属违规，测试会拦。");
lines.push("");

lines.push("## 尾声");
lines.push("");
lines.push("制盘输入：1990-05-15 12:30 男（庚午 辛巳 庚辰 壬午）；基准日 2026-10-30；取当前大限 戊寅（虚 35–44 / 2024–2033）。");
lines.push("判定链：`web/ziwei-facts.js` 出事实 → `web/yingqi-ladder.js` 判四阶梯 → `web/report-render.js` 译人话。本文件由 `scripts/render_report.cjs` 生成，不含人工改写。");
lines.push("");

const outPath = process.argv[2] || path.join(ROOT, "docs", "report-sample.md");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`已写入 ${outPath}（${lines.join("\n").length} 字符）`);
console.log(`状态 ${report.status}；断语 ${report.stats.lineCount} 条；出断语年份 ${report.stats.yearsWithPlainText}/${report.stats.yearCount}`);
if (report.assertiveViolations.length > 0) {
  console.log("断言词命中：" + report.assertiveViolations.join(" | "));
  process.exit(1);
}

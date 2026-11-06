/* §16 其余步骤执行器测试
 * 目标：九条步骤 + 禄转忌链 + §17 审查，各自能跑、能拒、不编。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "ziwei-knowledge.js", "section16-steps.js"]
  .forEach((name) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8")));

const S = global.MingliSection16Steps;
const K = global.MingliZiweiKnowledge;
const KNOWLEDGE = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8"));
const INDEX = K.createIndex(KNOWLEDGE);

let passed = 0;
const failures = [];
function check(label, cond, extra) {
  if (cond) { passed += 1; return; }
  failures.push(label + (extra === undefined ? "" : " → " + extra));
}

const chart = global.MingliZiwei.calculate({
  calendar: "solar", date: "1990-05-15", is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
}, { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 });
const timeline = global.MingliZiweiFacts.buildDecadalAnnualTimeline(chart.astrolabe, chart.palaces, 2026);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

// ───────── #1 排盘对账 ─────────
const s1 = S.step1Reconcile(chart);
check("#1 真实盘对账 pass", s1.status === "pass", s1.status);
check("#1 检查项 8 条", s1.checks.length === 8, s1.checks.length);
check("#1 地支递减通过", s1.checks.find((c) => c.code === "branch-step").ok);
check("#1 魁钺按年干核对（庚年月干庚→魁丑钺未）",
  s1.checks.find((c) => c.code === "kui-yue").ok,
  s1.checks.find((c) => c.code === "kui-yue").detail);

const broken = clone(chart);
broken.palaces[1].earthlyBranch = broken.palaces[3].earthlyBranch;
const s1b = S.step1Reconcile(broken);
check("#1 地支序被破坏 → partial", s1b.status === "partial", s1b.status);
check("#1 破坏能定位到 branch-step",
  s1b.checks.some((c) => c.code === "branch-step" && !c.ok));

const xin = clone(chart);
xin.astrolabe.chineseDate = "辛未 甲午 庚辰 壬午";
const kui = xin.palaces.find((p) => p.majorStars.concat(p.minorStars, p.auxiliaryStars).some((s) => s.name === "天魁"));
const yue = xin.palaces.find((p) => p.majorStars.concat(p.minorStars, p.auxiliaryStars).some((s) => s.name === "天钺"));
kui.earthlyBranch = "寅";
yue.earthlyBranch = "午";
check("#1 辛年魁寅钺午被接受",
  S.step1Reconcile(xin).checks.find((c) => c.code === "kui-yue").ok);
kui.earthlyBranch = "午";
yue.earthlyBranch = "寅";
check("#1 辛年魁午钺寅（iztro 默认错法）被拒",
  !S.step1Reconcile(xin).checks.find((c) => c.code === "kui-yue").ok);

check("#1 十一宫 → unavailable",
  S.step1Reconcile({ palaces: chart.palaces.slice(0, 11) }).status === "unavailable");

// ───────── #3 生年四化 + 逐宫飞化 ─────────
const s3 = S.step3NatalHuaAndFlying(chart);
check("#3 真实盘 pass", s3.status === "pass", s3.status);
check("#3 生年四化四条", s3.natalHua.length === 4);
check("#3 生年忌天同在迁移宫",
  s3.natalHua.some((h) => h.kind === "忌" && h.star === "天同" && h.palace === "迁移宫"));
check("#3 逐宫飞化 48 条", s3.flying.length === 48, s3.flying.length);
check("#3 飞化条带源宫与目标宫",
  s3.flying.every((f) => f.sourcePalace && f.targetPalace && f.kind));

const noFlying = clone(chart);
delete noFlying.palaceFlying;
if (noFlying.aiFacts) delete noFlying.aiFacts.palaceFlying;
const s3b = S.step3NatalHuaAndFlying(noFlying);
check("#3 缺飞化 → partial 且指名 48", s3b.status === "partial" && s3b.missing.some((m) => m.includes("48")));

// ───────── #4 十六字 ─────────
const s4 = S.step4Sixteen(chart);
check("#4 12 行", s4.rows.length === 12);
check("#4 财帛禄坐", s4.rows.find((r) => r.palace === "财帛宫").luZuo.includes("太阳"));
check("#4 命宫被忌冲", s4.rows.find((r) => r.palace === "命宫").jiChong.includes("天同"));
check("#4 命宫标不可冲", s4.rows.find((r) => r.palace === "命宫").unclashable);
check("#4 福德禄照（财帛之禄照福德）",
  s4.rows.find((r) => r.palace === "福德宫").luZhao.includes("太阳"));
check("#4 计数与行一致",
  s4.counts.luZuo === s4.rows.filter((r) => r.luZuo.length > 0).length);

// ───────── #5 引动 ─────────
const s5 = S.step5Activation(chart, timeline, timeline.years[2]);
check("#5 pass", s5.status === "pass", s5.status);
check("#5 大运踩生年至少一条", s5.decadalOnNatal.length > 0);
check("#5 踩的文案含两端宫名",
  s5.decadalOnNatal.every((x) => x.text.includes("大运") && x.text.includes("生年")));
check("#5 大运仆役踩生年禄（仆役=本命财帛）",
  s5.decadalOnNatal.some((x) => x.decadalPalace === "仆役宫" && x.kind === "禄"));
check("#5 缺 timeline → unavailable",
  S.step5Activation(chart, null, null).status === "unavailable");

// ───────── #6 禄转忌 / 忌转忌 / 禄逢冲破 / 忌出 ─────────
const s6 = S.step6ZhuanJi(chart);
check("#6 pass", s6.status === "pass", s6.status);
check("#6 禄转忌 1 条（财帛有生年禄）", s6.luZhuanJi.length === 1);
check("#6 财帛禄转忌落子女宫", s6.luZhuanJi[0].chain.path[1] === "子女宫", JSON.stringify(s6.luZhuanJi[0].chain.path));
check("#6 忌转忌 1 条（迁移有生年忌）", s6.jiZhuanJi.length === 1);
check("#6 迁移忌转忌落仆役宫", s6.jiZhuanJi[0].chain.path[1] === "仆役宫");
check("#6 链跳数不超 MAX_HOPS",
  s6.luZhuanJi.concat(s6.jiZhuanJi).every((c) => c.chain.hops.length <= S.MAX_HOPS));
check("#6 禄逢冲破四条各带可读结论",
  s6.luPoChong.every((x) => typeof x.reading === "string" && x.reading.length > 0));
check("#6 忌出四条各带文案", s6.jiChu.every((x) => typeof x.text === "string"));
check("#6 迁移忌被判忌出", s6.jiChu[0].sources.some((f) => f.code === "into-travel"));

// 禄逢冲破：造一条「忌在禄宫对宫」
const poChart = clone(chart);
const poPalaces = poChart.palaces;
const luPalace = poPalaces.find((p) => p.name === "财帛宫");
const oppName = luPalace.oppositePalace;
const oppPalace = poPalaces.find((p) => p.name === oppName);
oppPalace.majorStars = (oppPalace.majorStars || []).concat([{ name: "测试星", type: "major", scope: "origin", brightness: null, transformation: "忌" }]);
const po = S.step6ZhuanJi(poChart).luPoChong.find((x) => x.palace === "财帛宫");
check("#6 忌落对宫 → 判禄逢冲破", po.broken, JSON.stringify(po.reasons));
check("#6 我宫被冲读「得中有失」", po.mySide && po.reading.includes("得中有失"));

// 链自环保护：某宫宫干化忌落本宫
const loopChart = clone(chart);
loopChart.aiFacts.palaceFlying = loopChart.aiFacts.palaceFlying.map((f) =>
  (f.sourcePalace === "财帛宫" && f.kind === "忌" ? Object.assign({}, f, { targetPalace: "财帛宫", isSelfTarget: true }) : f));
const loop = S.step6ZhuanJi(loopChart).luZhuanJi[0].chain;
check("#6 自环被识别为 loop 而非死循环", loop.loop === true, JSON.stringify(loop.path));

// ───────── #8 叠宫 ─────────
const s8 = S.step8Overlay(timeline);
check("#8 12 行", s8.rows.length === 12);
check("#8 每行三层宫名齐全",
  s8.rows.every((r) => r.natalPalace && r.decadalPalace && r.annualPalace));
check("#8 文案含本命/大限/流年",
  s8.rows.every((r) => r.text.includes("本命") && r.text.includes("大限") && r.text.includes("流年")));
check("#8 缺 timeline → unavailable", S.step8Overlay(null).status === "unavailable");

// ───────── #9 大限四化两步 ─────────
const s9 = S.step9DecadalTwoStep(timeline);
check("#9 pass", s9.status === "pass", s9.status);
check("#9 四条", s9.rows.length === 4);
check("#9 双宫名格式", s9.rows.every((r) => /^本命.+（大限.+）$/.test(r.text)), s9.rows.map((r) => r.text).join(" | "));
check("#9 大限忌天机落本命夫妻宫（大限疾厄宫）",
  s9.rows.some((r) => r.star === "天机" && r.natalPalace === "夫妻宫" && r.decadalPalace === "疾厄宫"));
check("#9 缺四化 → unavailable",
  S.step9DecadalTwoStep({ years: [] }).status === "unavailable");

// ───────── #12 财库 ─────────
const s12 = S.step12Treasury(chart, timeline);
check("#12 四条判据", s12.clauses.length === 4, s12.clauses.length);
check("#12 真实盘田宅无四化 → 坐禄/坐忌/被冲均不成立",
  ["tian-ji-zuo", "tian-ji-chong", "tian-lu-zuo"].every((code) =>
    !s12.clauses.find((c) => c.code === code).fired));
const jiTian = clone(timeline);
jiTian.decadal.fourTransformations = [{ kind: "忌", star: "天机", natalPalace: "田宅宫" }];
check("#12 大限忌坐田宅 → 田宅坐忌成立",
  S.step12Treasury(chart, jiTian).clauses.find((c) => c.code === "tian-ji-zuo").fired);
const jiChild = clone(timeline);
jiChild.decadal.fourTransformations = [{ kind: "忌", star: "天机", natalPalace: "子女宫" }];
check("#12 忌在子女 → 田宅被冲成立",
  S.step12Treasury(chart, jiChild).clauses.find((c) => c.code === "tian-ji-chong").fired);

// ───────── #13 桃花 ─────────
const s13 = S.step13Peach(chart, timeline);
check("#13 三条判据", s13.clauses.length === 3);
check("#13 子女宫贪狼被识别为桃花星",
  s13.clauses.find((c) => c.code === "peach-stars").detail.includes("贪狼"));
check("#13 贪狼带大限禄 → 桃花带禄权成立",
  s13.clauses.find((c) => c.code === "peach-hua").fired);
check("#13 夫妻宫无禄 → 未被引动",
  !s13.clauses.find((c) => c.code === "marriage-lu-activated").fired);

// ───────── #14 疾厄 ─────────
const s14 = S.step14Health(chart, timeline, K, INDEX);
check("#14 三条判据", s14.clauses.length === 3);
check("#14 武曲天府命中疾厄断语", s14.readings.length === 2, s14.readings.length);
check("#14 断语来自知识库且带 ruleId",
  s14.readings.every((r) => r.ruleId && r.ruleId.startsWith("ziwei.knowledge.")));
check("#14 未提供索引时如实标缺",
  S.step14Health(chart, timeline, null, null).missingReadings.some((m) => m.reason.includes("未提供")));

// ───────── §17 审查 ─────────
check("#17 缺被审对象 → invalid", S.auditSection17({}).status === "invalid");
const goodReport = {
  decadal: { ganzhi: "戊寅" },
  years: [{
    year: 2026,
    lines: [{
      plain: "2026 年，钱（太阳）：倾向同一件事上，好处与阻力同时存在。",
      mechanism: "忌冲财帛",
      granularity: "year",
      palace: "财帛宫",
      star: "太阳",
      stars: ["太阳"],
      patternCodes: ["lu-ji-same", "double-ji"],
      motivations: [{ layer: "生年", kind: "禄", star: "太阳", palace: "财帛宫", zone: "inside", label: "生年禄太阳（本命财帛宫·六内）" }],
    }],
  }],
};
const auditGood = S.auditSection17({ report: goodReport, reconcileStatus: "pass" });
check("#17 合规报告 pass", auditGood.status === "pass", JSON.stringify(auditGood.findings.map((f) => f.id + ":" + f.status)));
const auditSingle = S.auditSection17({
  report: { decadal: {}, years: [{ year: 2026, lines: [{ plain: "x", mechanism: "忌坐", granularity: "year", patternCodes: ["double-ji"], motivations: [{ layer: "流年", kind: "忌", star: "x", palace: "夫妻宫", zone: "outside", label: "流年忌x（本命夫妻宫·六外）" }] }] }] },
  reconcileStatus: "pass",
});
check("#17 单象 → warning", auditSingle.status === "pass-with-warning", auditSingle.status);
const auditBad = S.auditSection17({
  report: { decadal: {}, years: [{ year: 2026, lines: [{ plain: "2026 年，一定会破财", mechanism: "忌冲", granularity: "year", patternCodes: ["a", "b"] }] }] },
  reconcileStatus: "pass",
});
check("#17 绝对化词 → fail", auditBad.status === "fail", auditBad.status);
check("#17 动因宫齐备 → 我宫他宫 pass",
  auditGood.findings.find((f) => f.id === "self-other").status === "pass");
check("#17 缺动因宫 → 我宫他宫 fail（不再假装不可校验）",
  S.auditSection17({
    report: { decadal: {}, years: [{ year: 2026, lines: [{ plain: "x", mechanism: "忌坐", granularity: "year", palace: "财帛宫", patternCodes: ["double-ji"] }] }] },
    reconcileStatus: "pass",
  }).findings.find((f) => f.id === "self-other").status === "fail");

// ───────── runAll ─────────
const all = S.runAll(chart, timeline, timeline.years[2], K, INDEX);
check("runAll 十项齐全",
  ["step1", "step3", "step4", "step5", "step6", "step8", "step9", "step12", "step13", "step14"]
    .every((k) => all[k] && all[k].status !== "unavailable"));
check("runAll 全部带 schema", all.schema === S.SCHEMA);

if (failures.length > 0) {
  console.error("失败项：");
  failures.forEach((f) => console.error(" - " + f));
  process.exit(1);
}
console.log(`===== §16 其余步骤检查 ${passed} 项全部通过 =====`);

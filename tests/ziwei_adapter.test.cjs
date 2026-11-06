"use strict";

const nodeAssert = require("node:assert/strict");
// 计数代理：汇总行的数字必须来自真实断言调用，不能是写死的字符串（Codex r739 #7）
let assertionCount = 0;
const assert = {};
["equal", "deepEqual", "notEqual", "ok", "match"].forEach(name => {
  assert[name] = (...args) => {
    const result = nodeAssert[name](...args);
    // 断言真正通过后才计数：失败的那条不能被算成「通过」
    assertionCount += 1;
    return result;
  };
});
// 故意失败开关：用于验证「断言失败 → 退出码非零 且 不打印通过汇总」。
// 只有子进程会带这个环境变量，正常跑不受影响。
if (process.env.ZIWEI_TEST_FAIL === "1") {
  assert.equal(1, 2, "故意失败：验证失败断言不计入成功数、且不打印汇总行");
}
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.self = global;
global.iztro = require(path.join(__dirname, "../web/vendor/iztro-v2.6.2.min.js"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ziwei-facts.js"), "utf8"));
const source = fs.readFileSync(path.join(__dirname, "../web/ziwei-adapter.js"), "utf8");
vm.runInThisContext(source);

const { calculate, resolveTimeIndex } = global.MingliZiwei;

assert.deepEqual(resolveTimeIndex({ precision: "minute", value: "00:30" }), { available: true, index: 0 });
assert.deepEqual(resolveTimeIndex({ precision: "minute", value: "09:30" }), { available: true, index: 5 });
assert.deepEqual(resolveTimeIndex({ precision: "minute", value: "23:30" }), { available: true, index: 12 });
assert.deepEqual(resolveTimeIndex({ precision: "branch", branch: "辰" }), { available: true, index: 4 });
assert.equal(resolveTimeIndex({ precision: "branch", branch: "子" }).code, "ZIWEI_RAT_HOUR_AMBIGUOUS");
assert.equal(resolveTimeIndex({ precision: "unknown" }).code, "ZIWEI_TIME_REQUIRED");

const result = calculate({
  calendar: "solar",
  date: "1990-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "09:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 5 });

assert.equal(result.status, "ok");
assert.equal(result.engine.version, "2.6.2");
assert.equal(result.ruleProfile.id, "iztro-default-v1");
assert.equal(result.basics.fiveElementsClass, "火六局");
assert.equal(result.basics.soulRuler, "贪狼");
assert.equal(result.basics.bodyRuler, "火星");
assert.equal(result.palaces.length, 12);
assert.equal(result.palaces.find(palace => palace.name === "命宫").majorStars[0].name, "破军");
assert.equal(result.palaces.find(palace => palace.name === "夫妻宫").isBodyPalace, true);
assert.equal(result.palaces.find(palace => palace.name === "命宫").cycles.changsheng12, "胎");
assert.ok(result.palaces.every(palace => palace.decadal && palace.ages.length > 0));
assert.equal(result.aiFacts.schemaVersion, "ziwei-facts/v4");
assert.match(result.aiFacts.fingerprint, /^zw4-[0-9a-f]{8}$/);
assert.equal(result.aiFacts.validation.status, "pass");
assert.equal(result.aiFacts.readiness.aiMayInterpret, true);
assert.deepEqual(
  result.aiFacts.fourTransformations.map(item => [item.kind, item.star, item.palace]),
  [["禄", "太阳", "兄弟宫"], ["权", "武曲", "夫妻宫"], ["科", "太阴", "田宅宫"], ["忌", "天同", "子女宫"]]
);
assert.deepEqual(
  result.aiFacts.palaceRelations.find(item => item.palace === "命宫"),
  {
    evidenceId: "origin.relation.命宫",
    palace: "命宫",
    branch: "子",
    oppositePalace: "迁移宫",
    trinePalaces: ["财帛宫", "官禄宫"]
  }
);
assert.ok(result.aiFacts.readiness.supportedScopes.includes("self-transform-direction"));
assert.equal(result.aiFacts.readiness.dynamicMayInterpret, true);
assert.equal(result.aiFacts.readiness.flyingMayInterpret, true);
assert.ok(result.aiFacts.readiness.supportedScopes.includes("decadal-four-hua"));
assert.ok(result.aiFacts.readiness.supportedScopes.includes("annual-overlay"));
assert.ok(result.aiFacts.readiness.supportedScopes.includes("natal-palace-flying"));
assert.equal(result.aiFacts.palaceFlying.length, 48);
assert.deepEqual(
  result.aiFacts.palaceFlying
    .filter(item => item.sourcePalace === "命宫")
    .map(item => [item.kind, item.star, item.targetPalace]),
  [["禄", "贪狼", "官禄宫"], ["权", "太阴", "田宅宫"], ["科", "右弼", "疾厄宫"], ["忌", "天机", "父母宫"]]
);
assert.equal(result.aiFacts.flyingValidation.status, "pass");
assert.equal(result.aiFacts.jiChains.length, 12);
assert.deepEqual(
  result.aiFacts.jiChains.find(chain => chain.startPalace === "命宫").steps.map(step => [step.fromPalace, step.star, step.toPalace]),
  [["命宫", "天机", "父母宫"], ["父母宫", "文曲", "子女宫"], ["子女宫", "太阴", "田宅宫"], ["田宅宫", "文曲", "子女宫"]]
);
assert.equal(result.aiFacts.jiChains.find(chain => chain.startPalace === "命宫").termination, "loop");
assert.equal(result.aiFacts.selfTransformations.length, 8);
assert.equal(result.aiFacts.selfTransformations.filter(item => item.direction === "outward").length, 2);
assert.equal(result.aiFacts.selfTransformations.filter(item => item.direction === "inward").length, 6);
assert.ok(result.aiFacts.selfTransformations.every(item => ["↑", "↓"].includes(item.symbol) && item.interpretationAllowed === true));
assert.equal(result.aiFacts.periods.asOfYear, 2026);
assert.equal(result.aiFacts.periods.decadals.length, 12);
assert.deepEqual(result.aiFacts.periods.current.decadal.ageRange, [36, 45]);
assert.deepEqual(result.aiFacts.periods.current.decadal.yearRange, [2025, 2034]);
assert.equal(result.aiFacts.periods.current.decadal.natalAnchorPalace, "田宅宫");
assert.equal(result.aiFacts.periods.current.decadal.palaceOverlay.find(row => row.natalPalace === "田宅宫").periodPalace, "命宫");
assert.deepEqual(
  result.aiFacts.periods.current.decadal.fourTransformations.map(item => [item.kind, item.star, item.natalPalace, item.periodPalace]),
  [["禄", "武曲", "夫妻宫", "疾厄宫"], ["权", "贪狼", "官禄宫", "父母宫"], ["科", "天梁", "疾厄宫", "官禄宫"], ["忌", "文曲", "子女宫", "迁移宫"]]
);
assert.equal(result.aiFacts.periods.current.annual.year, 2026);
assert.equal(result.aiFacts.periods.current.annual.nominalAge, 37);
assert.equal(result.aiFacts.periods.current.annual.palaceOverlay.find(row => row.periodPalace === "命宫").natalPalace, "迁移宫");
assert.deepEqual(
  result.aiFacts.periods.current.annual.fourTransformations.map(item => [item.kind, item.star, item.natalPalace, item.decadalPalace, item.periodPalace]),
  [["禄", "天同", "子女宫", "迁移宫", "田宅宫"], ["权", "天机", "父母宫", "夫妻宫", "疾厄宫"], ["科", "文昌", "仆役宫", "福德宫", "兄弟宫"], ["忌", "廉贞", "迁移宫", "田宅宫", "命宫"]]
);
assert.equal(result.aiFacts.periods.validation.decadal.status, "pass");
assert.equal(result.aiFacts.periods.validation.annual.status, "pass");
assert.equal(result.aiFacts.periods.validation.decadal.checks.length, 3);
assert.equal(result.aiFacts.periods.validation.annual.checks.length, 3);
assert.equal(result.aiFacts.periods.current.decadal.palaceFlying.length, 48);
assert.equal(result.aiFacts.periods.current.annual.palaceFlying.length, 48);
assert.equal(result.aiFacts.fineTiming.status, "pass");
assert.equal(result.aiFacts.fineTiming.solarDate, "2026-10-25");
assert.equal(result.aiFacts.fineTiming.asOfTimeIndex, 5);
assert.deepEqual(
  ["monthly", "daily", "hourly"].map(scope => [
    scope,
    result.aiFacts.fineTiming.current[scope].ganzhi,
    result.aiFacts.fineTiming.current[scope].palaceOverlay.length,
    result.aiFacts.fineTiming.current[scope].fourTransformations.length,
    result.aiFacts.fineTiming.validation[scope].status
  ]),
  [["monthly", "戊戌", 12, 4, "pass"], ["daily", "壬申", 12, 4, "pass"], ["hourly", "乙巳", 12, 4, "pass"]]
);
assert.equal(result.aiFacts.readiness.fineTimingMayInterpret, true);
assert.ok(result.aiFacts.readiness.supportedScopes.includes("hourly-four-hua"));
const nextYearResult = calculate({
  calendar: "solar",
  date: "1990-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "09:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2027, asOfDate: "2027-10-25", asOfTimeIndex: 5 });
assert.equal(nextYearResult.aiFacts.periods.current.annual.year, 2027);
assert.notEqual(nextYearResult.aiFacts.fingerprint, result.aiFacts.fingerprint);

const xinResult = calculate({
  calendar: "solar",
  date: "1991-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "09:30", branch: null },
  sex_for_calculation: "female"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 5 });
assert.equal(xinResult.aiFacts.yearStem, "辛");
assert.equal(xinResult.aiFacts.validation.status, "pass");
// corrections 现在同时包含「贵人修正」与「星曜位移」两类，按实际契约逐项钉死。
// 这份清单此前没被登记进 verify_acceptance，长期未运行才漂移到只剩两条。
assert.deepEqual(xinResult.aiFacts.corrections.map(item => [item.star, item.toPalace]), [
  ["天魁", "福德宫"],
  ["天钺", "迁移宫"],
  ["截空", "官禄宫"],
  ["副截", "仆役宫"],
  ["截空", "仆役宫"],
  ["副截", "官禄宫"],
  ["副旬", "夫妻宫"],
  ["大耗", "命宫"],
  // 劫煞：年支未属亥卯未局，三合局绝地在申（本盘财帛宫）。
  // 旧断言写「+5 → 子（命宫）」，那是把「只在局中支成立」的算式当规律。
  ["劫煞", "财帛宫"],
  // 龙德：岁前十二神第八位，年支 +7；辛未年未位 +7 → 本盘福德宫
  ["龙德", "福德宫"],
]);
assert.equal(xinResult.palaces.find(palace => palace.earthlyBranch === "寅").minorStars.some(star => star.name === "天魁"), true);
assert.equal(xinResult.palaces.find(palace => palace.earthlyBranch === "午").minorStars.some(star => star.name === "天钺"), true);
assert.deepEqual(
  xinResult.aiFacts.fourTransformations.map(item => [item.kind, item.star]),
  [["禄", "巨门"], ["权", "太阳"], ["科", "文曲"], ["忌", "文昌"]]
);

// ── 闰月「月中分界」：闰月 1–15 日作本月、16 日以后作下月 ──────────────────
// 1990 年闰五月：闰五月初十 = 1990-07-02，闰五月二十 = 1990-07-12。
const leapEarly = calculate({
  calendar: "solar",
  date: "1990-07-02",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
const leapLate = calculate({
  calendar: "solar",
  date: "1990-07-12",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });

assert.equal(leapEarly.ruleProfile.leapMonthRule, "mid-split");
assert.equal(leapEarly.ruleProfile.schoolRules.leapMonth, "mid-split");
assert.equal(leapEarly.leapMonthPolicy.isLeapMonth, true);
assert.equal(leapEarly.leapMonthPolicy.lunarMonth, 5);
assert.equal(leapEarly.leapMonthPolicy.lunarDay, 10);
assert.equal(leapEarly.leapMonthPolicy.treatedAsNextMonth, false);
assert.equal(leapEarly.leapMonthPolicy.treatedAsMonth, 5);
assert.equal(leapLate.leapMonthPolicy.lunarDay, 20);
assert.equal(leapLate.leapMonthPolicy.treatedAsNextMonth, true);
assert.equal(leapLate.leapMonthPolicy.treatedAsMonth, 6);
// 命宫 = 寅 + (生效月 − 1) − 时支序；午时 → 时支 6
const BRANCH_LIST = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
function soulByMonth(month) {
  return BRANCH_LIST[((2 + (month - 1) - 6) % 12 + 12) % 12];
}
assert.equal(leapEarly.basics.soulPalaceBranch, soulByMonth(5));
assert.equal(leapLate.basics.soulPalaceBranch, soulByMonth(6));
assert.notEqual(leapEarly.basics.soulPalaceBranch, leapLate.basics.soulPalaceBranch);
// 非闰月不受影响：同一天号但普通四月，treatedAsNextMonth 恒 false
assert.equal(result.leapMonthPolicy.isLeapMonth, false);
assert.equal(result.leapMonthPolicy.treatedAsNextMonth, false);
assert.equal(result.leapMonthPolicy.treatedAsMonth, 4);

// ── 闰月 15/16 日边界：分界点两侧必须一进一不进 ────────────────────────────
// 1990 年闰五月：十五 = 1990-07-07，十六 = 1990-07-08
const leapDay15 = calculate({
  calendar: "solar",
  date: "1990-07-07",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
const leapDay16 = calculate({
  calendar: "solar",
  date: "1990-07-08",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });

assert.equal(leapDay15.leapMonthPolicy.lunarDay, 15);
assert.equal(leapDay15.leapMonthPolicy.treatedAsNextMonth, false);
assert.equal(leapDay15.leapMonthPolicy.treatedAsMonth, 5);
assert.equal(leapDay16.leapMonthPolicy.lunarDay, 16);
assert.equal(leapDay16.leapMonthPolicy.treatedAsNextMonth, true);
assert.equal(leapDay16.leapMonthPolicy.treatedAsMonth, 6);
assert.equal(leapDay15.basics.soulPalaceBranch, soulByMonth(5));
assert.equal(leapDay16.basics.soulPalaceBranch, soulByMonth(6));
assert.notEqual(leapDay15.basics.soulPalaceBranch, leapDay16.basics.soulPalaceBranch);
// 合法盘的策略必须显式标 valid，非法原因留空
assert.equal(result.leapMonthPolicy.valid, true);
assert.equal(result.leapMonthPolicy.invalidReason, null);

// ── 劫煞 / 龙德：十二年支各恰一枚，位置 = 年支 +5 / +7 ─────────────────────
const { applyKnownCorrections } = global.MingliZiweiFacts.internals;
const BRANCH_LIST_12 = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
function blankPalaces() {
  return BRANCH_LIST_12.map((branch, index) => ({
    index,
    name: `P${index}`,
    earthlyBranch: branch,
    majorStars: [],
    minorStars: [],
    auxiliaryStars: []
  }));
}
function positionsOf(palaces, starName) {
  // 按「实例」统计而不是按「宫」统计：同一宫出现两枚同名星时必须能看见两次，
  // 否则重复项检测会假通过（Codex r739 major）。三组星曜都要看。
  const out = [];
  for (const palace of palaces) {
    for (const group of ["majorStars", "minorStars", "auxiliaryStars"]) {
      for (const star of palace[group]) {
        if (star.name === starName) out.push(palace.earthlyBranch);
      }
    }
  }
  return out;
}

// 期望值逐支写死，绝不能用被测实现里的同一套算式来算期望——
// 否则公式错了测试照样绿（Codex r739 major：劫煞当时用 +5，
// 只在子午卯酉四个局中支恰好成立，其余八支全错）。
const JIESHA_EXPECTED = {
  子: "巳", 丑: "寅", 寅: "亥", 卯: "申", 辰: "巳", 巳: "寅",
  午: "亥", 未: "申", 申: "巳", 酉: "寅", 戌: "亥", 亥: "申"
};
const LONGDE_EXPECTED = {
  子: "未", 丑: "申", 寅: "酉", 卯: "戌", 辰: "亥", 巳: "子",
  午: "丑", 未: "寅", 申: "卯", 酉: "辰", 戌: "巳", 亥: "午"
};
for (const branch of BRANCH_LIST_12) {
  const palaces = blankPalaces();
  applyKnownCorrections("甲", branch, palaces);
  assert.deepEqual(positionsOf(palaces, "劫煞"), [JIESHA_EXPECTED[branch]], `${branch}年劫煞`);
  assert.deepEqual(positionsOf(palaces, "龙德"), [LONGDE_EXPECTED[branch]], `${branch}年龙德`);
}

// ── 错位与重复：源盘已有星必须被移到目标位并去重 ──────────────────────────
{
  const palaces = blankPalaces();
  const souPalace = palaces[0];   // 子
  const chouPalace = palaces[1];  // 丑
  souPalace.auxiliaryStars.push({ name: "劫煞", type: "adjective", scope: "origin", brightness: null, transformation: null });
  souPalace.auxiliaryStars.push({ name: "劫煞", type: "adjective", scope: "origin", brightness: null, transformation: null });
  chouPalace.auxiliaryStars.push({ name: "龙德", type: "adjective", scope: "origin", brightness: null, transformation: null });
  const corrections = applyKnownCorrections("甲", "午", palaces); // 年支午 → 劫煞亥、龙德丑
  assert.deepEqual(positionsOf(palaces, "劫煞"), ["亥"]);
  assert.deepEqual(positionsOf(palaces, "龙德"), ["丑"]);
  const jieCorrection = corrections.find(item => item.code === "WMT_JIESHA_ADDED");
  const longCorrection = corrections.find(item => item.code === "WMT_LONGDE_ADDED");
  assert.equal(jieCorrection.fromPalace, "P0");
  assert.equal(jieCorrection.toPalace, "P11");
  assert.equal(jieCorrection.removedDuplicates, 1);
  assert.equal(longCorrection.fromPalace, "P1");
  assert.equal(longCorrection.toPalace, "P1");
}

// ── 跨宫重复与目标宫缺失：去重必须跨宫生效，缺目标宫必须整体失败 ──────────
{
  const palaces = blankPalaces();
  // 同一颗星散在三个不同宫、且其中一个宫放两枚（跨宫 + 同宫重复）
  palaces[2].auxiliaryStars.push({ name: "劫煞", type: "adjective", scope: "origin", brightness: null, transformation: null });
  palaces[5].minorStars.push({ name: "劫煞", type: "adjective", scope: "origin", brightness: null, transformation: null });
  palaces[5].minorStars.push({ name: "劫煞", type: "adjective", scope: "origin", brightness: null, transformation: null });
  palaces[8].auxiliaryStars.push({ name: "龙德", type: "adjective", scope: "origin", brightness: null, transformation: null });
  palaces[11].auxiliaryStars.push({ name: "龙德", type: "adjective", scope: "origin", brightness: null, transformation: null });
  const corrections = applyKnownCorrections("甲", "午", palaces);
  assert.deepEqual(positionsOf(palaces, "劫煞"), ["亥"], "跨宫重复必须收敛成一枚");
  assert.deepEqual(positionsOf(palaces, "龙德"), ["丑"], "跨宫重复必须收敛成一枚");
  const jie = corrections.find(item => item.code === "WMT_JIESHA_ADDED");
  assert.equal(jie.removedDuplicates, 2);
  assert.equal(corrections.find(item => item.code === "WMT_LONGDE_ADDED").removedDuplicates, 1);
}
{
  // 缺目标宫（此处删掉亥位）：必须抛错，且不得先改劫煞再失败
  const palaces = blankPalaces().filter(palace => palace.earthlyBranch !== "亥");
  const before = JSON.stringify(palaces);
  let thrown = null;
  try {
    applyKnownCorrections("甲", "午", palaces);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "缺目标宫时应当抛错");
  assert.equal(thrown.code, "ZIWEI_PALACE_TARGET_MISSING");
  assert.equal(JSON.stringify(palaces), before, "缺目标宫时不得留下部分修正");
}
{
  // 只缺龙德目标宫（丑），劫煞目标（亥）存在：也必须整体失败
  const palaces = blankPalaces().filter(palace => palace.earthlyBranch !== "丑");
  const before = JSON.stringify(palaces);
  let thrown = null;
  try {
    applyKnownCorrections("甲", "午", palaces);
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown && thrown.code, "ZIWEI_PALACE_TARGET_MISSING");
  assert.equal(JSON.stringify(palaces), before, "劫煞不得先落地");
}

// ── 年支无效：不再静默跳过，必须抛可识别错误，且命盘原样不动 ────────────────
{
  const palaces = blankPalaces();
  palaces[3].auxiliaryStars.push({ name: "天魁", type: "adjective", scope: "origin", brightness: null, transformation: null });
  const before = JSON.parse(JSON.stringify(palaces));
  let thrown = null;
  try {
    applyKnownCorrections("甲", "", palaces);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "年支为空时应当抛错");
  assert.equal(thrown.code, "ZIWEI_YEAR_BRANCH_INVALID");
  assert.deepEqual(palaces, before, "抛错时不得留下半套修正");
  let thrownBad = null;
  try {
    applyKnownCorrections("甲", "X", blankPalaces());
  } catch (error) {
    thrownBad = error;
  }
  assert.equal(thrownBad && thrownBad.code, "ZIWEI_YEAR_BRANCH_INVALID");
}

// ── 闰月口径纯函数：越界、缺失、闰十二月回绕 ──────────────────────────────
const { describeLeapMonth } = global.MingliZiwei;
{
  const normal = describeLeapMonth({ lunarMonth: 5, lunarDay: 10, isLeap: false });
  assert.equal(normal.valid, true);
  assert.equal(normal.treatedAsNextMonth, false);
  assert.equal(normal.treatedAsMonth, 5);

  const missingDay = describeLeapMonth({ lunarMonth: 5, lunarDay: null, isLeap: true });
  assert.equal(missingDay.valid, false);
  assert.equal(missingDay.lunarDay, null);
  assert.equal(missingDay.treatedAsNextMonth, false);
  assert.equal(missingDay.treatedAsMonth, null, "日缺失时不得给出有效月份");
  assert.ok(missingDay.invalidReason);

  const badMonth = describeLeapMonth({ lunarMonth: 13, lunarDay: 10, isLeap: false });
  assert.equal(badMonth.valid, false);
  assert.equal(badMonth.lunarMonth, null);
  assert.equal(badMonth.treatedAsMonth, null);

  const badDay = describeLeapMonth({ lunarMonth: 5, lunarDay: 31, isLeap: false });
  assert.equal(badDay.valid, false);
  assert.equal(badDay.lunarDay, null);
  assert.equal(badDay.treatedAsMonth, null);

  // 严格类型：Number() 强转会把 "5"、true、5.5 洗成合法值，必须拒绝
  for (const bad of [
    { lunarMonth: "5", lunarDay: 10, isLeap: false },
    { lunarMonth: true, lunarDay: 10, isLeap: false },
    { lunarMonth: 5.5, lunarDay: 10, isLeap: false },
    { lunarMonth: 0, lunarDay: 10, isLeap: false },
    { lunarMonth: 5, lunarDay: 0, isLeap: false },
    { lunarMonth: 5, lunarDay: 10.5, isLeap: false },
    { lunarMonth: 5, lunarDay: "10", isLeap: false }
  ]) {
    const strict = describeLeapMonth(bad);
    assert.equal(strict.valid, false, `应判无效：${JSON.stringify(bad)}`);
    assert.equal(strict.treatedAsMonth, null, `无效元数据不得给出月份：${JSON.stringify(bad)}`);
  }
  // 闰月标志非布尔：缺失、null、"false" 都不能当 false 继续算
  for (const flag of [undefined, null, "false", 0]) {
    const loose = describeLeapMonth({ lunarMonth: 5, lunarDay: 16, isLeap: flag });
    assert.equal(loose.valid, false, `闰月标志 ${String(flag)} 应判无效`);
    assert.equal(loose.leapFlagValid, false);
    assert.equal(loose.treatedAsMonth, null, "标志无效时不得算出月份");
    assert.match(loose.invalidReason, /闰月标志/);
  }
  const noData = describeLeapMonth(null);
  assert.equal(noData.valid, false);
  assert.equal(noData.treatedAsMonth, null);

  // 闰十二月十六日 → 进位后回绕成正月
  const leapTwelve = describeLeapMonth({ lunarMonth: 12, lunarDay: 16, isLeap: true });
  assert.equal(leapTwelve.valid, true);
  assert.equal(leapTwelve.treatedAsNextMonth, true);
  assert.equal(leapTwelve.treatedAsMonth, 1);
  const leapTwelveEarly = describeLeapMonth({ lunarMonth: 12, lunarDay: 15, isLeap: true });
  assert.equal(leapTwelveEarly.treatedAsNextMonth, false);
  assert.equal(leapTwelveEarly.treatedAsMonth, 12);
}

// ── 农历输入路径：闰五月十五 / 十六 与公历路径同口径 ──────────────────────
const lunar15 = calculate({
  calendar: "lunar",
  date: "1990-05-15",
  is_leap_month: true,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
const lunar16 = calculate({
  calendar: "lunar",
  date: "1990-05-16",
  is_leap_month: true,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male"
}, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
assert.equal(lunar15.leapMonthPolicy.isLeapMonth, true);
assert.equal(lunar15.leapMonthPolicy.treatedAsNextMonth, false);
assert.equal(lunar15.leapMonthPolicy.treatedAsMonth, 5);
assert.equal(lunar16.leapMonthPolicy.isLeapMonth, true);
assert.equal(lunar16.leapMonthPolicy.treatedAsNextMonth, true);
assert.equal(lunar16.leapMonthPolicy.treatedAsMonth, 6);
assert.equal(lunar15.basics.soulPalaceBranch, soulByMonth(5));
assert.equal(lunar16.basics.soulPalaceBranch, soulByMonth(6));

// ── 重复调用修正函数：星曜仍唯一、位置不变，其他星曜原样保留 ──────────────
{
  const palaces = blankPalaces();
  palaces[5].auxiliaryStars.push({ name: "天魁", type: "adjective", scope: "origin", brightness: null, transformation: null });
  palaces[9].majorStars.push({ name: "天府", type: "major", scope: "origin", brightness: "庙", transformation: null });
  const snapshotOf = () => JSON.stringify(palaces.map(palace => ({
    branch: palace.earthlyBranch,
    major: palace.majorStars.map(star => star.name),
    minor: palace.minorStars.map(star => star.name),
    other: palace.auxiliaryStars.filter(star => !["劫煞", "龙德", "大耗"].includes(star.name)).map(star => star.name)
  })));
  const before = snapshotOf();
  applyKnownCorrections("甲", "午", palaces);
  const afterFirst = { jie: positionsOf(palaces, "劫煞"), de: positionsOf(palaces, "龙德") };
  applyKnownCorrections("甲", "午", palaces);
  assert.deepEqual(afterFirst.jie, ["亥"]);
  assert.deepEqual(afterFirst.de, ["丑"]);
  assert.deepEqual(positionsOf(palaces, "劫煞"), ["亥"]);
  assert.deepEqual(positionsOf(palaces, "龙德"), ["丑"]);
  assert.equal(snapshotOf(), before, "重复调用不得改动其他星曜的内容与相对顺序");
}

// ── leap-month-rule 本身：用「人造盘面」验证它会拒绝错口径 ────────────────
// 真实盘不可能造出错误策略，所以直接调用具名检查函数（verify_ziwei_engine 导出）。
{
  const { leapMonthRuleCheck } = require(path.join(__dirname, "..", "scripts", "verify_ziwei_engine.cjs"));
  const MONTH_TOKEN = { 1: "正", 5: "五", 6: "六", 12: "十二" };
  const fakeChart = (policy, { month = 5, leap = true, hourPillar = "壬午", soulBranch = "丑" } = {}) => ({
    astrolabe: { lunarDate: `庚午年${leap ? "闰" : ""}${MONTH_TOKEN[month]}月`, chineseDate: `庚午 辛巳 庚辰 ${hourPillar}` },
    leapMonthPolicy: policy,
    palaces: [{ name: "命宫", earthlyBranch: soulBranch }]
  });
  const goodLeap = {
    rule: "mid-split", splitDay: 15, isLeapMonth: true, lunarMonth: 5, lunarDay: 16,
    fixLeap: true, treatedAsNextMonth: true, treatedAsMonth: 6, valid: true, invalidReason: null
  };
  assert.equal(leapMonthRuleCheck(fakeChart(goodLeap)), null, "正确策略应通过");
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, isLeapMonth: undefined })), /不是布尔值/);
  // 策略自称「非闰月、不进位」但盘面是闰月：必须报盘面不符（字段内部先自洽，再对盘面）
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, isLeapMonth: false, treatedAsNextMonth: false, treatedAsMonth: 5 })), /盘面为闰月/);
  // 策略字段自相矛盾（isLeap=false 却标记进位）：必须被字段推导拦下
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, isLeapMonth: false })), /按字段应为 false/);
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, treatedAsMonth: undefined })), /缺少 treatedAsMonth/);
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, treatedAsMonth: 7 })), /应为 6/);
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, treatedAsNextMonth: false })), /treatedAsNextMonth=false/);
  assert.match(leapMonthRuleCheck(fakeChart({ ...goodLeap, lunarDay: 0 })), /按字段推导应为 false/);
  const invalidMeta = { ...goodLeap, lunarMonth: null, lunarDay: null, valid: false, treatedAsMonth: null, treatedAsNextMonth: false, invalidReason: "越界" };
  assert.match(leapMonthRuleCheck(fakeChart(invalidMeta)), /越界/);
  // 非法元数据却仍给出月份：必须被拒（旧实现会在 valid===false 处提前返回，漏掉这一项）
  assert.match(leapMonthRuleCheck(fakeChart({ ...invalidMeta, treatedAsMonth: 6 })), /应为 null/);
  // 非法元数据却标记进位：必须被拒
  assert.match(leapMonthRuleCheck(fakeChart({ ...invalidMeta, treatedAsNextMonth: true })), /不得标记进位/);
  // 普通月：必须 not-leap + 作本月
  const normalPolicy = { ...goodLeap, isLeapMonth: false, lunarDay: 10, treatedAsNextMonth: false, treatedAsMonth: 5 };
  assert.equal(leapMonthRuleCheck(fakeChart(normalPolicy, { leap: false })), null);
  assert.match(leapMonthRuleCheck(fakeChart({ ...normalPolicy, isLeapMonth: true }, { leap: false })), /普通月却被标成闰月/);
  assert.match(leapMonthRuleCheck(fakeChart({ ...normalPolicy, treatedAsMonth: 6 }, { leap: false })), /应为 5/);
}

// ── 建盘前输入归一化：非法月日与非布尔闰月标志不得进入引擎（r740 major）─────
const { normalizeLunarInput } = global.MingliZiwei;
{
  assert.equal(normalizeLunarInput({ calendar: "lunar", date: "1990-05-15", is_leap_month: true }).status, "ok");
  assert.equal(normalizeLunarInput({ calendar: "solar", date: "1990-05-15" }).isLeapMonth, false, "缺省不是闰月");
  const invalidCases = [
    [{ calendar: "lunar", date: "1990-13-01" }, "lunarMonth"],
    [{ calendar: "lunar", date: "1990-00-01" }, "lunarMonth"],
    [{ calendar: "lunar", date: "1990-05-31" }, "lunarDay"],
    [{ calendar: "lunar", date: "1990-05-00" }, "lunarDay"],
    [{ calendar: "lunar", date: "19900515" }, "date"],
    [{ calendar: "lunar", date: "1990-05-15", is_leap_month: "false" }, "is_leap_month"],
    [{ calendar: "lunar", date: "1990-05-15", is_leap_month: 0 }, "is_leap_month"],
    [{ calendar: "solar", date: "1990-05-15", is_leap_month: "true" }, "is_leap_month"]
  ];
  for (const [input, field] of invalidCases) {
    const verdict = normalizeLunarInput(input);
    assert.equal(verdict.status, "invalid", `${JSON.stringify(input)} 应判非法`);
    assert.equal(verdict.field, field, `${JSON.stringify(input)} 的字段应为 ${field}`);
  }
  // 走真实入口：非法输入必须拒绝建盘，且不返回半成品盘面
  const baseTime = { precision: "minute", value: "12:30", branch: null };
  for (const input of [
    { calendar: "lunar", date: "1990-13-01", is_leap_month: false, time: baseTime, sex_for_calculation: "male" },
    { calendar: "lunar", date: "1990-05-15", is_leap_month: "false", time: baseTime, sex_for_calculation: "male" }
  ]) {
    const out = calculate(input, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
    assert.equal(out.status, "error");
    assert.equal(out.error.code, "ZIWEI_INPUT_INVALID");
    assert.equal(out.palaces, undefined, "非法输入不得产出命盘");
  }
}

// ── 唯一化隔离：ensureUniqueStars 只动劫煞/龙德，其他星曜含亮度原样不变 ──────
{
  const { ensureUniqueStars } = global.MingliZiweiFacts.internals;
  const palaces = blankPalaces();
  palaces[2].majorStars.push({ name: "天机", type: "major", scope: "origin", brightness: null, transformation: null });
  palaces[9].majorStars.push({ name: "天府", type: "major", scope: "origin", brightness: "庙", transformation: "禄" });
  palaces[4].auxiliaryStars.push({ name: "天魁", type: "adjective", scope: "origin", brightness: null, transformation: null });
  // 跨 scope 的重复：annual 与 origin 各一枚，必须一起收敛
  palaces[4].auxiliaryStars.push({ name: "劫煞", type: "adjective", scope: "annual", brightness: null, transformation: null });
  palaces[7].auxiliaryStars.push({ name: "龙德", type: "adjective", scope: "decadal", brightness: null, transformation: null });
  const stripStars = star => ({ name: star.name, brightness: star.brightness, transformation: star.transformation, scope: star.scope });
  const fingerprint = () => JSON.stringify(palaces.map(palace => ({
    branch: palace.earthlyBranch,
    major: palace.majorStars.map(stripStars),
    minor: palace.minorStars.map(stripStars),
    aux: palace.auxiliaryStars.filter(star => !["劫煞", "龙德"].includes(star.name)).map(stripStars)
  })));
  const before = fingerprint();
  const outcome = ensureUniqueStars("午", palaces); // 午年：劫煞亥、龙德丑
  assert.equal(fingerprint(), before, "除劫煞/龙德外，任何星曜的名称、亮度、四化、scope 与顺序都不得改动");
  assert.deepEqual(positionsOf(palaces, "劫煞"), ["亥"], "跨 scope 重复必须收敛成一枚");
  assert.deepEqual(positionsOf(palaces, "龙德"), ["丑"]);
  assert.equal(outcome.jieShaBranch, "亥");
  assert.equal(outcome.longDeBranch, "丑");
  assert.equal(outcome.corrections.filter(item => item.code === "WMT_JIESHA_ADDED").length, 1);
}

// ── 年支缺失 / null / undefined：抛指定错误且命盘完全不变 ──────────────────
{
  for (const bad of [null, undefined, "", "X"]) {
    const palaces = blankPalaces();
    palaces[6].auxiliaryStars.push({ name: "天魁", type: "adjective", scope: "origin", brightness: null, transformation: null });
    const before = JSON.parse(JSON.stringify(palaces));
    let thrown = null;
    try {
      applyKnownCorrections("甲", bad, palaces);
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown && thrown.code, "ZIWEI_YEAR_BRANCH_INVALID", `年支 ${String(bad)} 应抛错`);
    assert.deepEqual(palaces, before, `年支 ${String(bad)} 抛错时命盘必须原样不动`);
  }
}

// ── 断言计数真实性：故意失败时退出码非零、且不打印通过汇总 ─────────────────
{
  const { spawnSync } = require("node:child_process");
  const child = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, ZIWEI_TEST_FAIL: "1" },
    encoding: "utf8",
    timeout: 120000
  });
  assert.notEqual(child.status, 0, "故意失败的子进程必须非零退出");
  assert.equal(/项全部通过/.test(child.stdout || ""), false, "失败时不得打印通过汇总行");
}

// ── r741 四条真问题的回归断言 ─────────────────────────────────────────────
{
  // ① ensureUniqueStars 非法年支必须抛错，且命盘不动
  const { ensureUniqueStars } = global.MingliZiweiFacts.internals;
  for (const bad of [null, undefined, "", "X"]) {
    const palaces = blankPalaces();
    const before = JSON.parse(JSON.stringify(palaces));
    let thrown = null;
    try {
      ensureUniqueStars(bad, palaces);
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown && thrown.code, "ZIWEI_YEAR_BRANCH_INVALID", `ensureUniqueStars 年支 ${String(bad)} 应抛错`);
    assert.deepEqual(palaces, before, `ensureUniqueStars 年支 ${String(bad)} 抛错时命盘必须原样不动`);
  }
}
{
  // ④ 事实层缺失：必须明确失败，不能返回 status=ok 的半成品盘
  const saved = globalThis.MingliZiweiFacts;
  try {
    globalThis.MingliZiweiFacts = undefined;
    const out = calculate({
      calendar: "solar",
      date: "1990-05-15",
      is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male"
    }, { asOfYear: 2026, asOfDate: "2026-10-25", asOfTimeIndex: 6 });
    assert.equal(out.status, "error");
    assert.equal(out.error.code, "ZIWEI_FACTS_UNAVAILABLE");
    assert.equal(out.palaces, undefined, "事实层缺失时不得产出命盘");
  } finally {
    globalThis.MingliZiweiFacts = saved;
  }
}
{
  const { leapMonthRuleCheck } = require(path.join(__dirname, "..", "scripts", "verify_ziwei_engine.cjs"));
  const fake = (policy, opts = {}) => ({
    astrolabe: { lunarDate: "庚午年闰五月", chineseDate: "庚午 辛巳 庚辰 壬午" },
    leapMonthPolicy: policy,
    palaces: [{ name: "命宫", earthlyBranch: "丑", ...opts }]
  });
  const base = {
    rule: "mid-split", splitDay: 15, isLeapMonth: true, lunarMonth: 5, lunarDay: 16,
    fixLeap: true, treatedAsNextMonth: true, treatedAsMonth: 6, valid: true, invalidReason: null
  };
  // ③ 只有「日」非法：合法月份必须保留，不得要求两者都为 null
  const partial = {
    ...base, lunarMonth: 5, lunarDay: null, valid: false,
    treatedAsMonth: null, treatedAsNextMonth: false, invalidReason: "农历日缺失"
  };
  assert.match(leapMonthRuleCheck(fake(partial)), /农历日缺失/, "部分非法应只报缺失原因，不应抱怨合法月份");
  // ② 分界日不可由记录改写
  const tampered = { ...base, splitDay: 30, treatedAsNextMonth: false, treatedAsMonth: 5 };
  assert.match(leapMonthRuleCheck(fake(tampered)), /必须固定为 15/);
  // 分界日缺失时按 15 处理，仍能通过
  const noSplit = { ...base };
  delete noSplit.splitDay;
  assert.equal(leapMonthRuleCheck(fake(noSplit)), null);
}

{
  // 晚子时口径：23:00–23:59 按次日建盘。
  // 依据：文墨天机 2.0.15 默认「视为次日」（zzs=2），iztro dayDivide=forward 同义。
  assert.equal(global.MingliZiwei.ruleProfile.lateZishiRule, "next-day");
  assert.equal(global.MingliZiwei.ruleProfile.schoolRules.lateZishi, "next-day");
  assert.match(global.MingliZiwei.ruleProfile.lateZishiBasis, /文墨/);
  const ziweiBase = { calendar: "solar", sex_for_calculation: "male" };
  const ziweiBuild = (date, time) => calculate(
    { ...ziweiBase, date, time: { precision: "minute", value: time } },
    { asOfYear: 2026 }
  );
  const late = ziweiBuild("1990-05-15", "23:30");
  const nextDayEarly = ziweiBuild("1990-05-16", "00:30");
  const beforeLate = ziweiBuild("1990-05-15", "22:59");
  assert.equal(late.lateZishiPolicy.applies, true);
  assert.equal(late.lateZishiPolicy.treatedAs, "next-day");
  assert.equal(late.lateZishiPolicy.timeIndex, 12);
  assert.equal(beforeLate.lateZishiPolicy.applies, false);
  assert.equal(beforeLate.lateZishiPolicy.treatedAs, "same-day");
  assert.equal(beforeLate.lateZishiPolicy.timeIndex, 11);
  // 起紫微用的「日」必须已进位：晚子时盘与次日早子时盘的紫微落宫一致
  const ziweiBranch = (r) => r.palaces
    .find((p) => (p.majorStars || []).some((s) => s.name === "紫微")).earthlyBranch;
  assert.equal(ziweiBranch(late), ziweiBranch(nextDayEarly), "晚子时应与次日早子时同盘");
  // 反向对照：与同日午时不同盘，避免「怎么比都相等」
  assert.notEqual(ziweiBranch(late), ziweiBranch(ziweiBuild("1990-05-15", "12:30")));
  const branchSeq = (r) => r.palaces.map((p) => p.earthlyBranch).join(",");
  assert.equal(branchSeq(late), branchSeq(nextDayEarly), "整盘十二宫地支序列应一致");
  // 显示层农历仍写输入日（iztro 的 lunarDate 未进位），这是口径差异，必须如实保留
  assert.match(late.calendarDisplay.lunar, /廿一/);
  // 早子时（00:00–00:59）不触发次日
  assert.equal(nextDayEarly.lateZishiPolicy.applies, false);
  assert.equal(nextDayEarly.lateZishiPolicy.treatedAs, "same-day");
}

{
  // 来因宫与小限：结构必须齐全，语义必须与「宫干==年干」「申子辰见戌…男顺女逆」一致。
  const chart = calculate(
    { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30" }, sex_for_calculation: "male" },
    { asOfYear: 2026 }
  );
  assert.equal(chart.status, "ok");
  const original = chart.basics.originalPalace;
  assert.ok(original, "basics.originalPalace 必须产出");
  assert.equal(original.palace, "仆役宫", "庚年午月午时盘：来因宫落在辰位（文墨称交友宫）");
  assert.equal(original.branch, "辰");
  assert.equal(original.stem, "庚");
  const structure = chart.aiFacts.natalStructure;
  assert.equal(structure.originalPalaces.length, 1, "来因宫恰一处");
  assert.equal(structure.originalPalaces[0].stem, "庚", "来因宫宫干等于生年干");
  const originalCheck = chart.aiFacts.validation.checks.find((c) => c.id === "original_palace_year_stem");
  assert.ok(originalCheck && originalCheck.pass, "original_palace_year_stem 必须 pass");

  const policy = structure.minorLimitPolicy;
  assert.equal(policy.startBranch, "辰", "年支午 → _AX_XIAOXIAN_ARR[7]=5 → 辰");
  assert.equal(policy.direction, "forward", "男顺行");
  const ageBuckets = new Map();
  for (const item of structure.minorLimits) {
    for (const age of item.nominalAges) ageBuckets.set(age, (ageBuckets.get(age) || 0) + 1);
  }
  assert.equal(ageBuckets.size, 120, "小限覆盖 1–120 岁");
  assert.ok([...ageBuckets.values()].every((n) => n === 1), "每个年龄恰落一宫");
  assert.equal(
    structure.minorLimits.find((item) => item.nominalAges.includes(1)).palace,
    "仆役宫",
    "1 岁落辰（仆役宫）"
  );
  assert.ok(
    chart.aiFacts.validation.checks.find((c) => c.id === "small_limit_policy_bound").pass,
    "small_limit_policy_bound 必须 pass"
  );

  const female = calculate(
    { calendar: "solar", date: "1990-05-15", time: { precision: "minute", value: "12:30" }, sex_for_calculation: "female" },
    { asOfYear: 2026 }
  );
  assert.equal(female.aiFacts.natalStructure.minorLimitPolicy.direction, "backward", "女逆行");
  assert.equal(female.aiFacts.validation.status, "pass", "女盘校验同样通过");
}

console.log("Zi Wei adapter checks passed.");

console.log(`\n===== 紫微适配器检查 ${assertionCount} 项全部通过 =====`);

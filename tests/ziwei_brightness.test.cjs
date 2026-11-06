"use strict";

// 亮度四套（斗数全书 / 中州派 / 现代修订一 / 现代修订二）的契约测试。
// 重点：默认门派必须与文墨天机 2.0.15 的出厂值一致（qs），且四套表都能独立取到。

const nodeAssert = require("node:assert/strict");
let assertionCount = 0;
const assert = {};
["equal", "deepEqual", "notEqual", "ok", "match"].forEach((name) => {
  assert[name] = (...args) => {
    const result = nodeAssert[name](...args);
    assertionCount += 1;
    return result;
  };
});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "ziwei-facts.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "ziwei-adapter.js"), "utf8"));

const facts = global.MingliZiweiFacts;
const { calculate } = global.MingliZiwei;
const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

const INPUT = {
  calendar: "solar",
  date: "1990-05-15",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
};
const AS_OF = { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 };

// —— 1. 四套表都在，且都有名字 ——
const profiles = facts.brightnessProfiles;
assert.deepEqual(Object.keys(profiles).sort(), ["qs", "xd1", "xd2", "zz"]);
for (const key of Object.keys(profiles)) {
  assert.ok(profiles[key].label && profiles[key].label.length > 0, `${key} 必须有门派名`);
  assert.ok(profiles[key].wmtTable.startsWith("_AX_SB_"), `${key} 必须记下文墨表名`);
}

// —— 2. 落盘的 brightness.json 与代码里的表一致 ——
const disk = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "wmt", "brightness.json"), "utf8"));
assert.equal(disk.schema, "wmt-brightness/v1");
assert.equal(disk.defaultProfile, "qs", "默认门派必须是斗数全书派（文墨出厂值）");
const starNames = Object.keys(profiles.qs.stars);
assert.equal(starNames.length, 83);
for (const key of ["qs", "xd1", "xd2", "zz"]) {
  const entry = disk.profiles[key];
  assert.ok(entry, `${key} 必须在 brightness.json 里`);
  assert.equal(entry.table, profiles[key].wmtTable, `${key} 的文墨表名必须与代码一致`);
  const rows = entry.rows;
  assert.deepEqual(Object.keys(rows).sort(), [...starNames].sort(), `${key} 的星名集合必须一致`);
  for (const [star, cells] of Object.entries(rows)) {
    assert.match(cells, /^[0-7]{12}$/, `${key}/${star} 必须是 12 位 0–7`);
  }
}

// —— 3. 已知格子：三套在「太阴@未」「紫微@戌」上的分歧 ——
const at = (b) => BRANCHES.indexOf(b);
assert.equal(facts.brightnessOf("qs", "太阴", at("未")).label, "不");
assert.equal(facts.brightnessOf("xd1", "太阴", at("未")).label, "平");
assert.equal(facts.brightnessOf("zz", "紫微", at("戌")).label, "利");
assert.equal(facts.brightnessOf("qs", "紫微", at("戌")).label, "得");
// 未收录的星不伪造
assert.equal(facts.brightnessOf("qs", "不存在的星", 0).known, false);
assert.equal(facts.brightnessOf("qs", "不存在的星", 0).label, null);
// 别名：iztro 写「官府」、文墨写「官符」，同一颗星
assert.deepEqual(facts.brightnessOf("qs", "官府", 3), facts.brightnessOf("qs", "官符", 3));

// —— 4. 门派名归一 ——
assert.equal(facts.resolveBrightnessProfile("全书"), "qs");
assert.equal(facts.resolveBrightnessProfile("斗数全书派"), "qs");
assert.equal(facts.resolveBrightnessProfile("QS"), "qs");
assert.equal(facts.resolveBrightnessProfile("中州"), "zz");
assert.equal(facts.resolveBrightnessProfile("XD2"), "xd2");
assert.equal(facts.resolveBrightnessProfile("现代修订一"), "xd1");
assert.equal(facts.resolveBrightnessProfile("没有这个门派"), null);
assert.equal(facts.resolveBrightnessProfile(undefined), null);

// —— 5. 默认盘：qs，且 14 颗主星与文墨导出一致 ——
const chart = calculate(INPUT, AS_OF);
assert.equal(chart.ruleProfile.schoolRules.brightnessSchool, "qs");
assert.equal(chart.aiFacts.brightness.profile, "qs");
assert.match(chart.aiFacts.brightness.label, /斗数全书/);
assert.equal(chart.aiFacts.brightness.wmtTable, "_AX_SB_QS");
assert.deepEqual(chart.aiFacts.brightness.alternates.slice().sort(), ["xd1", "xd2", "zz"]);

const WMT_SAMPLE = {
  紫微: "得", 天机: "旺", 太阳: "得", 武曲: "旺", 天同: "庙", 廉贞: "庙", 天府: "旺",
  太阴: "不", 贪狼: "平", 巨门: "庙", 天相: "得", 天梁: "陷", 七杀: "旺", 破军: "旺",
};
const majorsOf = (c) => c.palaces.flatMap((p) => p.majorStars.map((s) => ({ name: s.name, branch: p.earthlyBranch, brightness: s.brightness })));
const sampleStars = majorsOf(chart).filter((s) => WMT_SAMPLE[s.name]);
assert.equal(sampleStars.length, 14, "样盘应有 14 颗主星");
const qsMiss = sampleStars.filter((s) => s.brightness !== WMT_SAMPLE[s.name]);
assert.deepEqual(qsMiss, [], "默认门派下 14 颗主星必须与文墨导出逐颗一致");

// —— 6. 换门派会真的换结果（不是摆设） ——
const xd1 = calculate(INPUT, { ...AS_OF, brightnessSchool: "xd1" });
assert.equal(xd1.aiFacts.brightness.profile, "xd1");
const taiyin = (c) => c.palaces.flatMap((p) => p.majorStars).find((s) => s.name === "太阴");
assert.equal(taiyin(chart).brightness, "不");
assert.equal(taiyin(xd1).brightness, "平");
// 非法门派名回落到默认，并在 profile 里如实标注
const bogus = calculate(INPUT, { ...AS_OF, brightnessSchool: "不存在的门派" });
assert.equal(bogus.aiFacts.brightness.profile, "qs");

// —— 7. 校验项绑定当前门派 ——
const brightnessCheck = (chart.aiFacts.validation.checks || []).find((c) => c.id === "default_brightness_applied");
assert.ok(brightnessCheck, "必须有 default_brightness_applied 校验项");
assert.equal(brightnessCheck.pass, true, "默认门派下的亮度赋值校验必须通过");
assert.match(brightnessCheck.message, /斗数全书/);

// —— 8. 幂等：连跑两次，亮度与门派不变 ——
const again = calculate(INPUT, AS_OF);
assert.deepEqual(majorsOf(again), majorsOf(chart));
assert.deepEqual(again.aiFacts.brightness, chart.aiFacts.brightness);

console.log(`\n===== 紫微亮度四套检查 ${assertionCount} 项全部通过 =====`);

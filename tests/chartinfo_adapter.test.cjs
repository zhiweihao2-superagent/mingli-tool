"use strict";

// ChartInfo 适配器契约测试（plan-chartinfo.json T3）。
//
// 断言的是「协议」而不是「某个已知实现」：SKILL §15 只给了 11 个顶层字段名，
// 没有嵌套结构。所以这里钉的是本项目暂定协议的形状与不可变性，
// 以及「不把缺失当已验证」这条原则。

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "chartinfo-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const K = global.MingliChartInfo;
const TOP_LEVEL = [
  "palaces", "sihua", "selfTransform", "daxianSihua", "liunianSihua",
  "dieGong", "fourLayerDieGong", "flyingChains", "wuxingJu", "yearStem",
  "laiyinPalace",
];

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${checks} - ${name}`);
}

function buildChart(overrides) {
  const payload = {
    calendar: "solar", date: "1990-05-15", is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    sex_for_calculation: "male",
  };
  Object.assign(payload, overrides || {});
  return global.MingliZiwei.calculate(payload, {
    asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6,
  });
}

const chart = buildChart();
const built = K.buildChartInfo(chart);
const info = built.chartInfo;

check("status 为 ok", () => assert.strictEqual(built.status, "ok"));
check("chartInfo 非空", () => assert.ok(info));

check("顶层恰好 11 个字段", () => {
  const actual = Object.keys(info).sort();
  assert.deepStrictEqual(actual, TOP_LEVEL.slice().sort());
});

check("palaces 为 12 项", () => assert.strictEqual(info.palaces.length, 12));

check("十二宫地支不重复", () => {
  const branches = info.palaces.map((p) => p.earthlyBranch);
  assert.strictEqual(new Set(branches).size, 12);
});

check("生年四化为禄权科忌四项", () => {
  assert.strictEqual(info.sihua.length, 4);
  const kinds = info.sihua.map((s) => s.kind).sort();
  assert.deepStrictEqual(kinds, ["禄", "权", "科", "忌"].sort());
});

check("selfTransform 为数组", () => assert.ok(Array.isArray(info.selfTransform)));
check("daxianSihua 为四项", () => assert.strictEqual(info.daxianSihua.length, 4));
check("liunianSihua 为四项", () => assert.strictEqual(info.liunianSihua.length, 4));

check("dieGong 含 decadal 与 annual 两个 12 项数组", () => {
  assert.strictEqual(info.dieGong.decadal.length, 12);
  assert.strictEqual(info.dieGong.annual.length, 12);
});

check("fourLayerDieGong 恰好四层", () => {
  assert.deepStrictEqual(info.fourLayerDieGong.layers, ["natal", "decadal", "annual", "monthly"]);
});

check("fourLayerDieGong 每行只含四层宫名", () => {
  for (const row of info.fourLayerDieGong.rows) {
    assert.deepStrictEqual(
      Object.keys(row).sort(),
      ["annualPalace", "branch", "decadalPalace", "monthlyPalace", "natalPalace"],
      "日、时层不得混入四层叠宫",
    );
  }
});

check("flyingChains 含 palaceFlying 与 jiChains", () => {
  assert.ok(Array.isArray(info.flyingChains.palaceFlying));
  assert.ok(Array.isArray(info.flyingChains.jiChains));
});

check("wuxingJu 为五行局字符串", () => {
  assert.strictEqual(typeof info.wuxingJu, "string");
  assert.ok(/局$/.test(info.wuxingJu));
});

check("yearStem 为单个天干", () => {
  assert.strictEqual(typeof info.yearStem, "string");
  assert.strictEqual(info.yearStem.length, 1);
});

check("laiyinPalace 固定为 null", () => assert.strictEqual(info.laiyinPalace, null));

check("必带 LAIYIN_EXCLUDED 诊断", () => {
  const codes = built.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("LAIYIN_EXCLUDED"));
});

check("适配器不修改排盘结果（复制而非引用）", () => {
  const before = chart.palaces.length;
  info.palaces.push({ name: "污染" });
  assert.strictEqual(chart.palaces.length, before);
  info.palaces.pop();
});

check("chart 为 null 时返回 invalid", () => {
  const result = K.buildChartInfo(null);
  assert.strictEqual(result.status, "invalid");
  assert.strictEqual(result.chartInfo, null);
});

check("chart.status 非 ok 时返回 unavailable", () => {
  const result = K.buildChartInfo({ status: "unavailable" });
  assert.strictEqual(result.status, "unavailable");
});

check("缺时辰时适配器如实降级而不是硬造盘", () => {
  // 紫微的时系安星依赖时辰，缺时辰时排盘本身即 unavailable；
  // 适配器必须原样透传该状态，不能凑出一份"看起来完整"的 ChartInfo。
  const unknownHour = buildChart({ time: { precision: "unknown", value: null, branch: null } });
  assert.notStrictEqual(unknownHour.status, "ok");
  const result = K.buildChartInfo(unknownHour);
  assert.strictEqual(result.status, "unavailable");
  assert.strictEqual(result.chartInfo, null);
  assert.ok(result.diagnostics.some((d) => d.code === "CHART_NOT_OK"));
});

console.log(`\n===== ChartInfo 适配器检查 ${checks} 项全部通过 =====`);

"use strict";

// 入口页数据层（web/home.js）的契约测试。
//
// 钉住两件事：
//   1. 摘要只从盘面事实里取，三条主线可回溯到 evidenceId，取不到就如实说"没有触发"
//   2. 本地记忆在「没有 localStorage / 坏 JSON / 版本不符 / 超出上限」时都不抛异常

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "home.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const H = global.MingliHome;
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${checks} - ${name}`);
}

function hua(kind, star, natal, decadal, id) {
  return {
    evidenceId: id || `${kind}-${star}`,
    kind,
    star,
    natalPalace: natal,
    decadalPalace: decadal,
    periodPalace: "财帛宫",
    source: "test",
  };
}

function chartFixture(annualHua, decadalHua, extra) {
  return {
    status: "ok",
    basics: {
      soulPalaceBranch: "亥",
      bodyPalaceBranch: "亥",
      fiveElementsClass: "土五局",
      soulRuler: "巨门",
      bodyRuler: "火星",
      originalPalace: { palace: "仆役宫", branch: "辰", stem: "庚" },
      zodiac: "马",
    },
    aiFacts: {
      fourTransformations: [hua("忌", "天同", "迁移宫", null, "origin.four_hua.ji")],
      periods: {
        current: {
          annual: {
            year: 2026,
            ganzhi: "丙午",
            nominalAge: 37,
            fourTransformations: annualHua,
          },
          decadal: {
            yearRange: [2026, 2035],
            ageRange: [37, 46],
            ganzhi: "丙午",
            fourTransformations: decadalHua || [],
          },
          ...(extra || {}),
        },
      },
    },
  };
}

// ---------------------------------------------------------------- 摘要

check("摘要：真实盘会给出一屏能读完的字段", () => {
  const chart = global.MingliZiwei.calculate(
    {
      calendar: "solar", date: "1990-05-15", is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male",
    },
    { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
  );
  const summary = H.summarize(chart, { year: 2026 });
  assert.strictEqual(summary.schema, "mingli.home/v1");
  assert.strictEqual(summary.status, "ok");
  assert.strictEqual(summary.basics.soulPalace, "亥");
  assert.strictEqual(summary.basics.fiveElementsClass, "土五局");
  assert.ok(summary.yearInfo.ganzhi);
  assert.ok(summary.yearInfo.decadal.range.length === 2);
  assert.ok(summary.natalHua.length === 4);
});

check("摘要：三条主线最多三条，且每条都能回到 evidenceId", () => {
  const chart = global.MingliZiwei.calculate(
    {
      calendar: "solar", date: "1990-05-15", is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male",
    },
    { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
  );
  const summary = H.summarize(chart, { year: 2026 });
  assert.ok(summary.mainlines.length <= 3);
  summary.mainlines.forEach((line) => {
    assert.ok(line.title && line.text, "每条要有标题与说明");
    assert.match(line.basis, /four_hua/, "依据必须是真实 evidenceId");
    assert.ok(["caution", "opportunity"].includes(line.kind));
  });
});

check("摘要：忌落命宫排在禄落财帛之前", () => {
  const chart = chartFixture([
    hua("禄", "太阳", "财帛宫", "田宅宫", "annual.four_hua.lu"),
    hua("忌", "廉贞", "命宫", "命宫", "annual.four_hua.ji"),
  ]);
  const summary = H.summarize(chart, { year: 2026 });
  assert.strictEqual(summary.mainlines[0].title, "流年忌落命宫");
  assert.strictEqual(summary.mainlines[0].kind, "caution");
});

check("摘要：生年忌与流年忌同星时多出一条「再次被引动」", () => {
  const chart = chartFixture([hua("忌", "天同", "交友宫", "兄弟宫", "annual.four_hua.ji")]);
  const summary = H.summarize(chart, { year: 2026 });
  assert.ok(summary.mainlines.some((line) => line.title.includes("生年忌与流年忌同星")));
});

check("摘要：同一 title 只出现一次（去重后不会挤掉别的线）", () => {
  const chart = chartFixture([
    hua("忌", "廉贞", "命宫", "命宫", "annual.four_hua.ji"),
    hua("忌", "廉贞", "命宫", "命宫", "annual.four_hua.ji.dup"),
  ]);
  const summary = H.summarize(chart, { year: 2026 });
  const titles = summary.mainlines.map((line) => line.title);
  assert.strictEqual(new Set(titles).size, titles.length);
});

check("摘要：没有触发任何规则时如实说明，不硬凑三条", () => {
  const chart = chartFixture([]);
  const summary = H.summarize(chart, { year: 2026 });
  assert.deepStrictEqual(summary.mainlines, []);
  assert.match(summary.mainlinesSkipped, /平稳/);
});

check("摘要：缺大限/流年数据时不编造，给 skipped 原因", () => {
  const chart = { status: "ok", basics: {}, aiFacts: { periods: {} } };
  const summary = H.summarize(chart, { year: 2026 });
  assert.deepStrictEqual(summary.mainlines, []);
  assert.match(summary.mainlinesSkipped, /大限|年份/);
});

check("摘要：不是 ok 的盘直接 unavailable", () => {
  const summary = H.summarize({ status: "error" }, { year: 2026 });
  assert.strictEqual(summary.status, "unavailable");
  assert.ok(summary.reason);
});

check("摘要：月份说明明确指向年度视图，不在入口页重复计算", () => {
  const chart = chartFixture([]);
  const summary = H.summarize(chart, { year: 2026 });
  assert.match(summary.monthsNote, /年度视图/);
});

// ---------------------------------------------------------------- 本地记忆

function fakeStorage(options) {
  const opts = options || {};
  const map = new Map();
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (opts.failWrite) throw new Error("quota");
      map.set(key, String(value));
    },
    removeItem(key) { map.delete(key); },
  };
}

function payloadOf(date, year) {
  return {
    schema_version: "1.0",
    profile: {
      calendar: "solar",
      date,
      is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male",
    },
    rules: { profile_id: "engine-default-v1", true_solar_time: false, clock_time_is_dst: false },
    options: { save_history: false, annual_cycles_through: year },
  };
}

const savedStorage = global.localStorage;

check("存储：没有 localStorage 时如实返回不可用", () => {
  global.localStorage = undefined;
  const all = H.loadAll();
  assert.strictEqual(all.available, false);
  const result = H.save(payloadOf("1990-05-15", 2026), { status: "ok" });
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason);
});

check("存储：保存后能读回，且同一份输入不会重复堆叠", () => {
  global.localStorage = fakeStorage();
  const payload = payloadOf("1990-05-15", 2026);
  const summary = H.summarize(chartFixture([]), { year: 2026 });
  H.save(payload, summary);
  H.save(payload, summary);
  const all = H.loadAll();
  assert.strictEqual(all.records.length, 1);
  assert.strictEqual(all.records[0].summary.year, 2026);
});

check("存储：最多留三条，新的在前", () => {
  global.localStorage = fakeStorage();
  ["1990-05-15", "1991-05-15", "1992-05-15", "1993-05-15"].forEach((date) => {
    H.save(payloadOf(date, 2026), { status: "ok", year: 2026 });
  });
  const all = H.loadAll();
  assert.strictEqual(all.records.length, H.MAX_RECORDS);
  assert.strictEqual(all.records[0].input.profile.date, "1993-05-15");
});

check("存储：删除一条后剩余顺序不变", () => {
  global.localStorage = fakeStorage();
  ["1990-05-15", "1991-05-15"].forEach((date) => {
    H.save(payloadOf(date, 2026), { status: "ok", year: 2026 });
  });
  assert.strictEqual(H.removeAt(0).ok, true);
  const all = H.loadAll();
  assert.strictEqual(all.records.length, 1);
  assert.strictEqual(all.records[0].input.profile.date, "1990-05-15");
  assert.strictEqual(H.removeAt(9).ok, false);
});

check("存储：清空后不再有记录", () => {
  global.localStorage = fakeStorage();
  H.save(payloadOf("1990-05-15", 2026), { status: "ok", year: 2026 });
  assert.strictEqual(H.clearAll().ok, true);
  assert.deepStrictEqual(H.loadAll().records, []);
});

check("存储：坏 JSON 不抛异常，标记 corrupt 并当作空", () => {
  const store = fakeStorage();
  store.setItem(H.STORAGE_KEY, "{not json");
  global.localStorage = store;
  const all = H.loadAll();
  assert.strictEqual(all.corrupt, true);
  assert.deepStrictEqual(all.records, []);
});

check("存储：版本不符时不拿旧结构硬读", () => {
  const store = fakeStorage();
  store.setItem(H.STORAGE_KEY, JSON.stringify({ version: 999, records: [{ id: "x" }] }));
  global.localStorage = store;
  const all = H.loadAll();
  assert.strictEqual(all.corrupt, true);
  assert.deepStrictEqual(all.records, []);
});

check("存储：写入失败（配额满）返回原因而不是抛错", () => {
  global.localStorage = fakeStorage({ failWrite: true });
  const result = H.save(payloadOf("1990-05-15", 2026), { status: "ok" });
  assert.strictEqual(result.ok, false);
  // 探测写入就失败时，与「浏览器不允许保存」是同一条兜底路径，都算如实降级
  assert.match(result.reason, /保存|写入/);
});

check("存储：指纹区分不同年份与不同历法", () => {
  const a = H.fingerprintOf(payloadOf("1990-05-15", 2026), { year: 2026 });
  const b = H.fingerprintOf(payloadOf("1990-05-15", 2027), { year: 2027 });
  const lunar = payloadOf("1990-05-15", 2026);
  lunar.profile.calendar = "lunar";
  const c = H.fingerprintOf(lunar, { year: 2026 });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
});

// ---------------------------------------------------------------- 逐月两块

function monthFixture(index, severeKinds, supportKinds, extraRelations) {
  const relations = [];
  severeKinds.forEach((kind, i) => {
    relations.push({ kind, layers: ["monthly", "annual"], json_pointer: `/months/${index - 1}/relations/${i}` });
  });
  supportKinds.forEach((kind, i) => {
    relations.push({ kind, layers: ["monthly", "natal"], json_pointer: `/months/${index - 1}/relations/s${i}` });
  });
  (extraRelations || []).forEach((rel, i) => relations.push(rel));
  return {
    index,
    label: `第${index}月`,
    ganzhi: "甲子",
    jie: "立春",
    start: `2026-0${index}-04T03:54:40+08:00`,
    end: `2026-0${index}-05T21:48:50+08:00`,
    evidence_id: `monthly.months[${index - 1}]`,
    status: "ok",
    relations,
  };
}

check("逐月：没有逐月事实时如实不可用，不编月份", () => {
  const groups = H.monthGroups(null);
  assert.strictEqual(groups.status, "unavailable");
  assert.match(groups.reason, /逐月/);
  assert.deepStrictEqual(groups.prepare, []);
  assert.deepStrictEqual(groups.slow, []);
});

check("逐月：冲刑害 ≥4 的月进「放慢」，按条数降序", () => {
  const groups = H.monthGroups({
    target_year: 2026,
    months: [
      monthFixture(1, ["branch-six-clash", "stem-clash"], []),
      monthFixture(2, ["branch-six-clash", "stem-clash", "branch-punishment", "branch-harm", "branch-break"], []),
      monthFixture(3, ["branch-harm", "branch-harm", "branch-harm", "branch-harm"], []),
    ],
  });
  assert.strictEqual(groups.status, "ok");
  assert.deepStrictEqual(groups.slow.map((row) => row.index), [2, 3]);
  assert.strictEqual(groups.slow[0].score, 5);
});

check("逐月：合成 ≥3 且冲刑害 ≤2 的月进「提前准备」", () => {
  const groups = H.monthGroups({
    target_year: 2026,
    months: [
      monthFixture(1, [], ["stem-combine", "branch-six-combine", "branch-three-harmony"]),
      monthFixture(2, ["stem-clash", "branch-harm"], ["stem-combine", "branch-six-combine", "branch-three-harmony"]),
      monthFixture(3, ["stem-clash", "branch-harm", "branch-break"], ["stem-combine", "branch-six-combine", "branch-three-harmony"]),
    ],
  });
  assert.deepStrictEqual(groups.prepare.map((row) => row.index).sort(), [1, 2]);
});

check("逐月：冲刑害多的月不会被说成「提前准备」", () => {
  const groups = H.monthGroups({
    target_year: 2026,
    months: [monthFixture(1, ["branch-six-clash", "stem-clash", "branch-harm"], ["stem-combine", "branch-six-combine", "branch-three-harmony", "stem-three-combine"])],
  });
  assert.deepStrictEqual(groups.prepare, []);
  assert.deepStrictEqual(groups.slow, []);
  assert.match(groups.reason, /阈值/);
});

check("逐月：两块各取前三", () => {
  const severe = ["branch-six-clash", "stem-clash", "branch-punishment", "branch-harm", "branch-break"];
  const support = ["stem-combine", "branch-six-combine", "branch-three-harmony"];
  const months = [
    monthFixture(1, severe, []),
    monthFixture(2, severe, []),
    monthFixture(3, severe.slice(0, 4), []),
    monthFixture(4, [], support),
    monthFixture(5, [], support),
    monthFixture(6, severe.slice(0, 2), support),
  ];
  const groups = H.monthGroups({ target_year: 2026, months });
  assert.strictEqual(groups.slow.length, 3);
  assert.strictEqual(groups.prepare.length, 3);
});

check("逐月：只统计流月这一柱的关系，整月无关的关系不计入", () => {
  const unrelated = [
    { kind: "branch-six-clash", layers: ["natal", "luck"] },
    { kind: "stem-clash", layers: ["natal", "annual"] },
    { kind: "branch-harm", layers: ["natal", "luck"] },
    { kind: "branch-break", layers: ["natal", "annual"] },
  ];
  const groups = H.monthGroups({ target_year: 2026, months: [monthFixture(1, [], [], unrelated)] });
  assert.deepStrictEqual(groups.slow, []);
  assert.match(groups.reason, /阈值/);
});

check("逐月：每条建议都带可回溯的 basis 与起止日期", () => {
  const groups = H.monthGroups({
    target_year: 2026,
    months: [monthFixture(1, ["branch-six-clash", "stem-clash", "branch-harm", "branch-break"], [])],
  });
  assert.strictEqual(groups.slow.length, 1);
  assert.strictEqual(groups.slow[0].basis, "monthly.months[0]");
  assert.match(groups.slow[0].start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(groups.slow[0].text, /冲刑害/);
});

check("逐月：规则文本写明阈值，页面能直接给用户看", () => {
  const rules = H.monthRuleText();
  assert.match(rules, /4/);
  assert.match(rules, /3/);
  assert.match(rules, /前三/);
});

check("逐月：summarize 传入逐月事实时会挂上 months，不传则为 null", () => {
  const chart = chartFixture([]);
  const withMonths = H.summarize(chart, {
    year: 2026,
    monthly: { target_year: 2026, months: [monthFixture(1, ["branch-six-clash", "stem-clash", "branch-harm", "branch-break"], [])] },
  });
  assert.strictEqual(withMonths.months.status, "ok");
  assert.strictEqual(withMonths.months.slow.length, 1);
  const without = H.summarize(chart, { year: 2026 });
  assert.strictEqual(without.months, null);
});

global.localStorage = savedStorage;

console.log(`\n===== 入口页数据检查 ${checks} 项全部通过 =====`);

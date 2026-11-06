"use strict";

// §16 专题判定（web/specialty-rules.js）契约测试。
//
// 钉四件事：
//   1) #7 六宫禄打分的算法与 SKILL.md §11 原文一致（禄3·权2·科1·忌-1，自化±1，满分18）
//   2) #10 破财五法则五条固定，成立与不成立都留痕，不沉默丢弃
//   3) #11 离婚四法则四条固定，顺序与宫位绑定不可漂移
//   4) 本命层与大运层不混算：本命三宫只吃生年四化，大运三宫只吃大限四化
//
// 另钉三个曾经真出错的回归点：
//   - 同一宫位既在本命三宫又在大运三宫时，自化不得重复计分
//   - 缺大限信息时不许只算三宫冒充六宫
//   - 忌冲财帛取的是对宫（福德），不是随便找个宫

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
["ziwei-facts.js", "specialty-rules.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const R = global.MingliSpecialtyRules;

let checks = 0;

function check(name, fn) {
  try {
    fn();
    checks += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

// ── 夹具 ────────────────────────────────────────────────────

function star(name, transformation) {
  return { name, type: "major", scope: "origin", brightness: "平", transformation: transformation || null };
}

function P(index, name, stem, branch, major, minor) {
  return {
    index,
    name,
    heavenlyStem: stem,
    earthlyBranch: branch,
    isBodyPalace: false,
    majorStars: (major || []).map((s) => (typeof s === "string" ? star(s) : s)),
    minorStars: (minor || []).map((s) => (typeof s === "string" ? star(s) : s)),
    auxiliaryStars: [],
  };
}

// 与真实盘一致的大限 → 本命宫名对照（大限命宫落本命田宅宫）
const OVERLAY = [
  { branch: "寅", natalPalace: "田宅宫", decadalPalace: "命宫" },
  { branch: "卯", natalPalace: "官禄宫", decadalPalace: "父母宫" },
  { branch: "辰", natalPalace: "仆役宫", decadalPalace: "福德宫" },
  { branch: "巳", natalPalace: "迁移宫", decadalPalace: "田宅宫" },
  { branch: "午", natalPalace: "疾厄宫", decadalPalace: "官禄宫" },
  { branch: "未", natalPalace: "财帛宫", decadalPalace: "仆役宫" },
  { branch: "申", natalPalace: "子女宫", decadalPalace: "迁移宫" },
  { branch: "酉", natalPalace: "夫妻宫", decadalPalace: "疾厄宫" },
  { branch: "戌", natalPalace: "兄弟宫", decadalPalace: "财帛宫" },
  { branch: "亥", natalPalace: "命宫", decadalPalace: "子女宫" },
  { branch: "子", natalPalace: "父母宫", decadalPalace: "夫妻宫" },
  { branch: "丑", natalPalace: "福德宫", decadalPalace: "兄弟宫" },
];

const DECADAL_HUA = [
  { kind: "禄", star: "贪狼", natalPalace: "子女宫" },
  { kind: "权", star: "太阴", natalPalace: "财帛宫" },
  { kind: "科", star: "右弼", natalPalace: "财帛宫" },
  { kind: "忌", star: "天机", natalPalace: "夫妻宫" },
];

function timeline(patch) {
  return Object.assign(
    {
      decadal: {
        index: 0,
        listIndex: 3,
        ganzhi: "戊寅",
        ageRange: [35, 44],
        yearRange: [2024, 2033],
        natalAnchorPalace: "田宅宫",
        fourTransformations: DECADAL_HUA,
      },
      years: [{ year: 2026, palaceOverlay: OVERLAY, fourTransformations: [] }],
    },
    patch || {},
  );
}

// 基准盘：生年禄太阳+科太阴在财帛，生年忌天同落迁移，仆役有地劫，子女贪狼带生年禄
function basePalaces() {
  return [
    P(0, "田宅宫", "戊", "寅"),
    P(1, "官禄宫", "己", "卯"),
    P(2, "仆役宫", "庚", "辰", [], ["地劫"]),
    P(3, "迁移宫", "辛", "巳", [star("天同", "忌")]),
    P(4, "疾厄宫", "壬", "午"),
    P(5, "财帛宫", "癸", "未", [star("太阳", "禄"), star("太阴", "科")]),
    P(6, "子女宫", "乙", "申", [star("贪狼", "禄")]),
    P(7, "夫妻宫", "丙", "酉"),
    P(8, "兄弟宫", "甲", "戌"),
    P(9, "命宫", "癸", "亥", ["太阴"]),
    P(10, "父母宫", "壬", "子"),
    P(11, "福德宫", "丁", "丑"),
  ];
}

// ── #7 六宫禄打分 ───────────────────────────────────────────

check("六宫：必须给出 6 行（本命三宫 + 大运三宫）", () => {
  const result = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() });
  assert.equal(result.status, "pass");
  assert.equal(result.rows.length, 6);
});

check("六宫：本命三槽顺序固定为 财帛/兄弟/田宅", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  assert.deepEqual(rows.filter((r) => r.layer === "本命").map((r) => r.slot), ["财帛宫", "兄弟宫", "田宅宫"]);
});

check("六宫：大运三槽顺序固定为 财帛/兄弟/田宅", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  assert.deepEqual(rows.filter((r) => r.layer === "大运").map((r) => r.slot), ["财帛宫", "兄弟宫", "田宅宫"]);
});

check("六宫：权重表严格照 §11 原文（禄3 权2 科1 忌-1）", () => {
  assert.deepEqual({ ...R.HUA_WEIGHT }, { 禄: 3, 权: 2, 科: 1, 忌: -1 });
});

check("六宫：自化权重禄权科 +1、忌 -1", () => {
  assert.deepEqual({ ...R.SELF_WEIGHT }, { 禄: 1, 权: 1, 科: 1, 忌: -1 });
});

check("六宫：生年禄3+科1 同宫原始分 4", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  const cai = rows.find((r) => r.layer === "本命" && r.slot === "财帛宫");
  const natalOnly = cai.items.filter((i) => i.source === "生年").reduce((s, i) => s + i.weight, 0);
  assert.equal(natalOnly, 4);
});

check("六宫：财帛宫干癸化科太阴，太阴在本宫即自化科 +1，原始分 5", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  const cai = rows.find((r) => r.layer === "本命" && r.slot === "财帛宫");
  assert.equal(cai.raw, 5);
  assert.ok(cai.items.some((i) => i.source === "自化" && i.kind === "科" && i.star === "太阴"));
});

check("六宫：单宫封顶 3，原始分同时保留", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  const cai = rows.find((r) => r.layer === "本命" && r.slot === "财帛宫");
  assert.equal(cai.score, 3);
  assert.equal(cai.capped, true);
  assert.equal(cai.raw, 5);
});

check("六宫：负分不夹到 0（生年忌 -1 与自化忌 -1 叠加为 -2）", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "财帛宫" ? P(5, "财帛宫", "甲", "未", [star("太阳", "忌")]) : p,
  );
  const rows = R.scoreSixPalaces({ palaces, timeline: timeline() }).rows;
  const cai = rows.find((r) => r.layer === "本命" && r.slot === "财帛宫");
  assert.equal(cai.raw, -2);
  assert.equal(cai.score, -2);
});

check("六宫：合计等于各行封顶后之和，满分 18", () => {
  const result = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() });
  const sum = result.rows.reduce((s, r) => s + r.score, 0);
  assert.equal(result.total, sum);
  assert.equal(result.max, 18);
  assert.equal(result.total, 3);
});

check("六宫：同一宫位身兼本命与大运两槽时，自化只计一次", () => {
  // 兄弟宫既是本命兄弟，又是大运财帛（OVERLAY: 财帛宫→兄弟宫）
  const palaces = basePalaces().map((p) =>
    p.name === "兄弟宫" ? P(8, "兄弟宫", "辛", "戌", ["巨门"]) : p,
  );
  const rows = R.scoreSixPalaces({ palaces, timeline: timeline() }).rows;
  const selfItems = rows
    .flatMap((r) => r.items)
    .filter((i) => i.source === "自化" && i.star === "巨门");
  assert.equal(selfItems.length, 1);
  const brothers = rows.find((r) => r.layer === "本命" && r.slot === "兄弟宫");
  const decadalCai = rows.find((r) => r.layer === "大运" && r.slot === "财帛宫");
  assert.equal(brothers.palace, decadalCai.palace);
  assert.equal(brothers.raw, 1);
  assert.equal(decadalCai.raw, 0);
});

check("六宫：本命槽只吃生年四化，大运槽只吃大限四化（迁移宫生年忌不计入大运田宅）", () => {
  const rows = R.scoreSixPalaces({ palaces: basePalaces(), timeline: timeline() }).rows;
  const decadalTian = rows.find((r) => r.layer === "大运" && r.slot === "田宅宫");
  assert.equal(decadalTian.palace, "迁移宫");
  assert.equal(decadalTian.raw, 0);
  assert.equal(decadalTian.items.length, 0);
});

check("六宫：缺十二宫判 unavailable", () => {
  const result = R.scoreSixPalaces({ palaces: [], timeline: timeline() });
  assert.equal(result.status, "unavailable");
});

check("六宫：缺大限判 unavailable（不许只算三宫冒充六宫）", () => {
  const result = R.scoreSixPalaces({ palaces: basePalaces(), timeline: null });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /大限/);
});

// ── #10 破财五法则 ─────────────────────────────────────────

check("破财：五条 code 与顺序固定", () => {
  const result = R.evaluateWealth({ palaces: basePalaces(), timeline: timeline() });
  assert.deepEqual(
    result.clauses.map((c) => c.code),
    ["ji-in-cai", "ji-chong-cai", "cai-self-ji", "lost-friend", "peach-spend"],
  );
});

check("破财：④仆役宫坐地劫即成立（损友破财）", () => {
  const clause = R.evaluateWealth({ palaces: basePalaces(), timeline: timeline() }).clauses
    .find((c) => c.code === "lost-friend");
  assert.equal(clause.fired, true);
  assert.match(clause.detail, /地劫/);
});

check("破财：④仆役宫坐地空同样成立", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "仆役宫" ? P(2, "仆役宫", "庚", "辰", [], ["地空"]) : p,
  );
  const clause = R.evaluateWealth({ palaces, timeline: timeline() }).clauses
    .find((c) => c.code === "lost-friend");
  assert.equal(clause.fired, true);
  assert.match(clause.detail, /地空/);
});

check("破财：⑤子女宫贪狼带生年禄即成立（桃花破财）", () => {
  const clause = R.evaluateWealth({ palaces: basePalaces(), timeline: timeline() }).clauses
    .find((c) => c.code === "peach-spend");
  assert.equal(clause.fired, true);
  assert.match(clause.detail, /子女宫贪狼生年化禄/);
});

check("破财：①忌坐财帛成立", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "财帛宫" ? P(5, "财帛宫", "癸", "未", [star("贪狼", "忌")]) : p,
  );
  const clause = R.evaluateWealth({ palaces, timeline: timeline() }).clauses
    .find((c) => c.code === "ji-in-cai");
  assert.equal(clause.fired, true);
  assert.deepEqual(clause.evidence.length > 0, true);
});

check("破财：②忌冲财帛取对宫福德，不是别的宫", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "福德宫" ? P(11, "福德宫", "丁", "丑", [star("巨门", "忌")]) : p,
  );
  const result = R.evaluateWealth({ palaces, timeline: timeline() });
  assert.equal(result.clauses.find((c) => c.code === "ji-chong-cai").fired, true);
  assert.equal(result.clauses.find((c) => c.code === "ji-in-cai").fired, false);
});

check("破财：③财帛宫干癸化忌贪狼且贪狼在本宫即自化忌成立", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "财帛宫" ? P(5, "财帛宫", "癸", "未", ["贪狼"]) : p,
  );
  const clause = R.evaluateWealth({ palaces, timeline: timeline() }).clauses
    .find((c) => c.code === "cai-self-ji");
  assert.equal(clause.fired, true);
  assert.match(clause.detail, /自化忌/);
});

check("破财：一条都不成立时 firedCount 为 0，且不成立条款写明原因", () => {
  const palaces = [
    P(0, "田宅宫", "戊", "寅"),
    P(1, "官禄宫", "己", "卯"),
    P(2, "仆役宫", "庚", "辰"),
    P(3, "迁移宫", "辛", "巳"),
    P(4, "疾厄宫", "壬", "午"),
    P(5, "财帛宫", "甲", "未", ["武曲"]),
    P(6, "子女宫", "乙", "申", ["天府"]),
    P(7, "夫妻宫", "丙", "酉"),
    P(8, "兄弟宫", "丁", "戌"),
    P(9, "命宫", "戊", "亥"),
    P(10, "父母宫", "己", "子"),
    P(11, "福德宫", "庚", "丑"),
  ];
  const result = R.evaluateWealth({ palaces, timeline: timeline({ decadal: { natalAnchorPalace: "田宅宫", fourTransformations: [] } }) });
  assert.equal(result.firedCount, 0);
  assert.ok(result.clauses.every((c) => c.fired === false));
  assert.ok(result.clauses.every((c) => typeof c.detail === "string" && c.detail.length > 0));
});

check("破财：仅 1 条成立时标记 singleSupport（§17 多项定一象）", () => {
  const palaces = basePalaces().map((p) => (p.name === "子女宫" ? P(6, "子女宫", "乙", "申", ["天府"]) : p));
  const result = R.evaluateWealth({ palaces, timeline: timeline() });
  assert.equal(result.firedCount, 1);
  assert.equal(result.singleSupport, true);
});

// ── #11 离婚四法则 ─────────────────────────────────────────

check("离婚：四法则宫位绑定固定（夫妻→子女→迁移→福德）", () => {
  const result = R.evaluateDivorce({ palaces: basePalaces(), timeline: timeline() });
  assert.deepEqual(result.clauses.map((c) => c.palace), ["夫妻宫", "子女宫", "迁移宫", "福德宫"]);
  assert.deepEqual(result.clauses.map((c) => c.code), ["spouse-ji", "child-ji", "travel-ji", "fortune-ji"]);
});

check("离婚：大限忌入夫妻宫 + 生年忌入迁移宫 = 两条成立，不判单象", () => {
  const result = R.evaluateDivorce({ palaces: basePalaces(), timeline: timeline() });
  assert.equal(result.firedCount, 2);
  assert.equal(result.singleSupport, false);
  const spouse = result.clauses.find((c) => c.code === "spouse-ji");
  assert.match(spouse.detail, /大限忌天机入夫妻宫/);
  const travel = result.clauses.find((c) => c.code === "travel-ji");
  assert.match(travel.detail, /生年忌天同入迁移宫/);
});

check("离婚：只有一条成立时标 singleSupport（单象待验证）", () => {
  const palaces = basePalaces().map((p) =>
    p.name === "迁移宫" ? P(3, "迁移宫", "辛", "巳", ["天同"]) : p,
  );
  const result = R.evaluateDivorce({ palaces, timeline: timeline({ decadal: { natalAnchorPalace: "田宅宫", fourTransformations: [] } }) });
  assert.equal(result.firedCount, 0);
  const palaces2 = basePalaces().map((p) =>
    p.name === "迁移宫" ? P(3, "迁移宫", "辛", "巳", ["天同"]) : p,
  );
  const result2 = R.evaluateDivorce({
    palaces: palaces2,
    timeline: timeline({ decadal: { natalAnchorPalace: "田宅宫", fourTransformations: [{ kind: "忌", star: "巨门", natalPalace: "福德宫" }] } }),
  });
  assert.equal(result2.firedCount, 1);
  assert.equal(result2.singleSupport, true);
  assert.equal(result2.clauses.find((c) => c.fired).code, "fortune-ji");
});

// ── 汇总 ───────────────────────────────────────────────────

check("evaluateAll：三块齐全且共用同一 schema", () => {
  const result = R.evaluateAll({ palaces: basePalaces(), timeline: timeline() });
  assert.equal(result.schema, R.SCHEMA);
  assert.ok(result.sixPalaces);
  assert.ok(result.wealth);
  assert.ok(result.divorce);
  assert.equal(result.sixPalaces.schema, result.wealth.schema);
});

console.log("");
if (process.exitCode) {
  console.error(`===== 专题判定检查 ${checks} 项通过，但有失败 =====`);
} else {
  console.log(`===== 专题判定检查 ${checks} 项全部通过 =====`);
}

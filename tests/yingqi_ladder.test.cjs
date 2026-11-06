"use strict";

// 应期四阶梯执行器（web/yingqi-ladder.js）契约测试。
//
// 钉四件事：
//   1) 四阶顺序与命名固定为 SKILL §12：结构引力→宫位交感→格局触发→单星应象
//   2) 禁跳级：前一阶不成立，后一阶一律 skipped，reachableDepth 不得越级
//   3) 单星应象必须凑齐「星曜组合 + 宫位 + 四化结构」，缺一即 unavailable（不编造）
//   4) 断言词必须降级为倾向语；降不掉的断语宁可不出，也不许原样输出
//
// 另钉两个曾经真出错的回归点：
//   - 格局指 A 宫时，不得去读 B 宫主星的断语
//   - 同一宫同一星被多个格局命中，只合并来源，不重复出句

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "yingqi-ladder.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const L = global.MingliYingqiLadder;
const F = global.MingliZiweiFacts;

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

// ── 测试用知识库桩 ────────────────────────────────────────────
// 只实现 lookupPalaceReading，避免测试依赖真实 76KB 知识包。
function makeKnowledge(table) {
  return {
    lookupPalaceReading(index, star, palace) {
      const hit = table[`${star}@${palace}`];
      if (!hit) return null;
      return { ruleId: `test.${star}.${palace}`, star, palace, reading: hit, note: null, source: {} };
    },
  };
}

function hua(kind, star, palace) {
  return { kind, star, natalPalace: palace };
}

function decadalOf(overrides) {
  const base = {
    index: 0,
    listIndex: 0,
    ganzhi: "戊寅",
    ageRange: [35, 44],
    yearRange: [2024, 2033],
    natalAnchorPalace: "田宅宫",
    fourTransformations: [
      hua("禄", "贪狼", "子女宫"),
      hua("权", "太阴", "财帛宫"),
      hua("科", "右弼", "财帛宫"),
      hua("忌", "天机", "夫妻宫"),
    ],
  };
  return Object.assign(base, overrides || {});
}

function yearFactOf(overrides) {
  const base = {
    year: 2025,
    ganzhi: "乙巳",
    nominalAge: 36,
    status: "pass",
    hardFailures: [],
    palaceOverlay: [
      { branch: "子", natalPalace: "命宫", decadalPalace: "兄弟宫", annualPalace: "财帛宫" },
      { branch: "丑", natalPalace: "夫妻宫", decadalPalace: "命宫", annualPalace: "命宫" },
      { branch: "寅", natalPalace: "财帛宫", decadalPalace: "父母宫", annualPalace: "父母宫" },
      { branch: "卯", natalPalace: "田宅宫", decadalPalace: "夫妻宫", annualPalace: "福德宫" },
    ],
    fourTransformations: [
      hua("禄", "天机", "夫妻宫"),
      hua("权", "天梁", "命宫"),
      hua("科", "紫微", "兄弟宫"),
      hua("忌", "太阴", "财帛宫"),
    ],
    activation: {
      natalHua: {
        禄: { star: "太阳", palace: "财帛宫" },
        权: { star: "武曲", palace: "疾厄宫" },
        科: { star: "太阴", palace: "财帛宫" },
        忌: { star: "天同", palace: "迁移宫" },
      },
      rows: [
        {
          kind: "禄", star: "天机", natalPalace: "夫妻宫", decadalPalace: "命宫", annualPalace: "命宫",
          onDecadalSoul: false, onDecadalSoulOpposite: false,
          stackedOnDecadalHua: [{ kind: "忌", star: "天机" }], stacked: true,
          overlapsNatal: [], status: "ok",
        },
        {
          kind: "忌", star: "太阴", natalPalace: "财帛宫", decadalPalace: "父母宫", annualPalace: "父母宫",
          onDecadalSoul: false, onDecadalSoulOpposite: false,
          stackedOnDecadalHua: [{ kind: "权", star: "太阴" }, { kind: "科", star: "右弼" }], stacked: true,
          overlapsNatal: [{ natalKind: "禄", star: "太阳", relation: "同宫" }], status: "ok",
        },
      ],
    },
    decadalAnnualRelation: { status: "ok", sameStem: false, sameBranch: false, stemClash: false, branchClash: false, relation: [] },
  };
  return Object.assign(base, overrides || {});
}

function timelineOf(decadal, years) {
  return { status: "pass", asOfYear: 2026, decadal, years, boundaryAudit: { status: "pass", checks: [] } };
}

function palacesFixture() {
  return [
    { name: "命宫", earthlyBranch: "子", majorStars: [{ name: "天梁" }] },
    { name: "夫妻宫", earthlyBranch: "丑", majorStars: [{ name: "天机" }, { name: "巨门" }] },
    { name: "财帛宫", earthlyBranch: "寅", majorStars: [{ name: "太阳" }, { name: "太阴" }] },
    { name: "田宅宫", earthlyBranch: "卯", majorStars: [{ name: "廉贞" }] },
    { name: "疾厄宫", earthlyBranch: "辰", majorStars: [] },
    { name: "父母宫", earthlyBranch: "巳", majorStars: [{ name: "文昌" }] },
    { name: "子女宫", earthlyBranch: "午", majorStars: [{ name: "贪狼" }] },
    { name: "迁移宫", earthlyBranch: "未", majorStars: [{ name: "天同" }] },
  ];
}

// ── 1. 四阶固定 ───────────────────────────────────────────────
check("四阶顺序与命名固定为 SKILL §12", () => {
  assert.deepStrictEqual(
    L.LADDERS.map((item) => `${item.step}:${item.name}`),
    ["1:结构引力", "2:宫位交感", "3:格局触发", "4:单星应象"],
  );
});

check("负极线定义为父母宫+疾厄宫", () => {
  assert.deepStrictEqual(L.NEGATIVE_LINE.slice().sort(), ["父母宫", "疾厄宫"].sort());
});

// ── 2. 断言词降级 ─────────────────────────────────────────────
check("断言词降级为倾向语", () => {
  const result = L.downgradeAssertive("一定会离婚，必然破财");
  assert.strictEqual(result.downgraded, true);
  assert.ok(result.text.indexOf("一定") < 0, result.text);
  assert.ok(result.text.indexOf("必然") < 0, result.text);
  assert.strictEqual(result.residual, false);
});

check("降不掉的断言词会被标出", () => {
  const result = L.downgradeAssertive("绝不会有好结果");
  assert.strictEqual(result.residual, true);
});

check("降级后仍残留断言词时拒绝输出该断语", () => {
  const knowledge = makeKnowledge({
    "贪狼@子女宫": "绝不会有好结果。",
    "天机@夫妻宫": "主变动。",
    "巨门@夫妻宫": "主口舌。",
  });
  const year = yearFactOf();
  year.fourTransformations = [
    hua("禄", "天机", "夫妻宫"), hua("权", "天梁", "命宫"),
    hua("科", "紫微", "兄弟宫"), hua("忌", "贪狼", "子女宫"),
  ];
  year.activation.rows = [{
    kind: "忌", star: "贪狼", natalPalace: "子女宫", decadalPalace: "父母宫", annualPalace: "父母宫",
    onDecadalSoul: false, onDecadalSoulOpposite: false,
    stackedOnDecadalHua: [{ kind: "禄", star: "贪狼" }], stacked: true,
    overlapsNatal: [], status: "ok",
  }];
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const statements = result.years[0].statements;
  // 子女宫那条因残留断言词被拒；夫妻宫两条与它无关，可正常出
  assert.ok(
    statements.every((item) => item.text.indexOf("绝不会") < 0 && item.palace !== "子女宫"),
    JSON.stringify(statements.map((item) => `${item.palace}:${item.text}`)),
  );
  const reasons = result.years[0].ladders[3].unavailable.map((item) => `${item.palace}/${item.reason}`).join(" ");
  assert.ok(reasons.indexOf("未降级的断言词") >= 0, reasons);
  assert.ok(reasons.indexOf("子女宫") >= 0, reasons);
});

// ── 3. 禁跳级 ─────────────────────────────────────────────────
check("阶梯 1 未成立时后三阶一律 skipped", () => {
  const broken = decadalOf({
    fourTransformations: [hua("禄", "贪狼", "子女宫"), hua("权", "太阴", null)],
  });
  const timeline = timelineOf(broken, [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge: makeKnowledge({}), knowledgeIndex: {},
  });
  const year = result.years[0];
  assert.strictEqual(year.reachableDepth, 0);
  assert.strictEqual(year.ladders[0].fired, false);
  [1, 2, 3].forEach((index) => {
    assert.strictEqual(year.ladders[index].fired, false);
    assert.strictEqual(year.ladders[index].skipped, true);
  });
  assert.strictEqual(result.status, "unavailable");
});

check("无交感时不判应期（不引动不发）", () => {
  const year = yearFactOf();
  year.activation.rows = [{
    kind: "忌", star: "七杀", natalPalace: "命宫", decadalPalace: "兄弟宫", annualPalace: "财帛宫",
    onDecadalSoul: false, onDecadalSoulOpposite: false,
    stackedOnDecadalHua: [], stacked: false, overlapsNatal: [], status: "ok",
  }];
  // 生命年忌宫与流年忌宫都不是大限忌宫，三重叠加不成立
  year.activation.natalHua["忌"] = { star: "七杀", palace: "迁移宫" };
  year.fourTransformations = [
    hua("禄", "天机", "子女宫"), hua("权", "天梁", "子女宫"),
    hua("科", "紫微", "子女宫"), hua("忌", "七杀", "命宫"),
  ];
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge: makeKnowledge({}), knowledgeIndex: {},
  });
  const ladder2 = result.years[0].ladders[1];
  assert.strictEqual(ladder2.fired, false, JSON.stringify(ladder2.evidence));
  assert.ok(ladder2.reason.indexOf("不引动不发") >= 0, ladder2.reason);
  assert.strictEqual(result.years[0].ladders[2].skipped, true);
  assert.strictEqual(result.years[0].reachableDepth, 1);
});

check("阶梯 3 未成立时阶梯 4 skipped", () => {
  // 做出「与大限四化同宫」的交感，但刻意让四化落点互不咬合，四种格局全不成立
  const year = yearFactOf();
  year.activation.rows = [{
    kind: "禄", star: "天同", natalPalace: "子女宫", decadalPalace: "命宫", annualPalace: "命宫",
    onDecadalSoul: false, onDecadalSoulOpposite: false,
    stackedOnDecadalHua: [{ kind: "禄", star: "贪狼" }], stacked: true,
    overlapsNatal: [], status: "ok",
  }];
  year.fourTransformations = [
    hua("禄", "天同", "子女宫"), hua("权", "紫微", "兄弟宫"),
    hua("科", "文昌", "父母宫"), hua("忌", "七杀", "命宫"),
  ];
  year.activation.natalHua["忌"] = { star: "七杀", palace: "迁移宫" };
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge: makeKnowledge({ "天同@子女宫": "主变动。" }), knowledgeIndex: {},
  });
  const ladder2 = result.years[0].ladders[1];
  const ladder3 = result.years[0].ladders[2];
  const ladder4 = result.years[0].ladders[3];
  assert.strictEqual(ladder2.fired, true);
  assert.strictEqual(ladder3.fired, false, JSON.stringify(ladder3.evidence));
  assert.strictEqual(ladder4.skipped, true);
  assert.strictEqual(result.years[0].reachableDepth, 2);
});

// ── 4. 单星应象三要素 ─────────────────────────────────────────
check("该宫无主星时不出单星断语", () => {
  const year = yearFactOf();
  // 先造一条交感（流年禄与大限禄同宫），再让流年忌入疾厄宫构成负极线
  year.fourTransformations = [
    hua("禄", "天同", "子女宫"), hua("权", "紫微", "兄弟宫"),
    hua("科", "文昌", "父母宫"), hua("忌", "破军", "疾厄宫"),
  ];
  year.activation.rows = [
    {
      kind: "禄", star: "天同", natalPalace: "子女宫", decadalPalace: "命宫", annualPalace: "命宫",
      onDecadalSoul: false, onDecadalSoulOpposite: false,
      stackedOnDecadalHua: [{ kind: "禄", star: "贪狼" }], stacked: true,
      overlapsNatal: [], status: "ok",
    },
    {
      kind: "忌", star: "破军", natalPalace: "疾厄宫", decadalPalace: "官禄宫", annualPalace: "官禄宫",
      onDecadalSoul: false, onDecadalSoulOpposite: false,
      stackedOnDecadalHua: [], stacked: false, overlapsNatal: [], status: "ok",
    },
  ];
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge: makeKnowledge({ "天同@子女宫": "主变动。" }), knowledgeIndex: {},
  });
  const ladder3 = result.years[0].ladders[2];
  assert.strictEqual(ladder3.fired, true, JSON.stringify(ladder3.evidence));
  const ladder4 = result.years[0].ladders[3];
  assert.ok(
    ladder4.unavailable.some((item) => item.reason.indexOf("无主星") >= 0),
    JSON.stringify(ladder4.unavailable),
  );
});

check("知识库无命中时不出单星断语", () => {
  const knowledge = makeKnowledge({});
  const timeline = timelineOf(decadalOf(), [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const ladder4 = result.years[0].ladders[3];
  assert.strictEqual(ladder4.fired, false);
  assert.ok(
    ladder4.unavailable.some((item) => item.reason.indexOf("未收录") >= 0),
    JSON.stringify(ladder4.unavailable),
  );
});

check("未提供知识库时明确判缺料，而不是静默通过", () => {
  const timeline = timelineOf(decadalOf(), [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, { palaces: palacesFixture() });
  const ladder4 = result.years[0].ladders[3];
  assert.strictEqual(ladder4.fired, false);
  assert.strictEqual(ladder4.skipped, false);
  assert.ok(ladder4.reason.indexOf("知识库") >= 0, ladder4.reason);
});

// ── 5. 回归：格局宫位与断语宫位必须一致 ───────────────────────
check("断语的宫位必须与它引用的格局宫位一致", () => {
  const knowledge = makeKnowledge({
    "天机@夫妻宫": "主另一半易有变动。",
    "巨门@夫妻宫": "主口舌。",
    "太阳@财帛宫": "主进财。",
    "太阴@财帛宫": "主理财。",
  });
  const timeline = timelineOf(decadalOf(), [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const patterns = result.years[0].ladders[2].patterns;
  const palaceOf = {};
  patterns.forEach((item) => { palaceOf[`${item.code}@${item.palace}`] = item.palace; });
  const statements = result.years[0].statements;
  assert.ok(statements.length > 0, "应至少出一条断语");
  statements.forEach((item) => {
    assert.ok(item.text.indexOf(`本命${item.palace}坐`) === 0, item.text);
    item.patternCodes.forEach((code) => {
      assert.strictEqual(
        palaceOf[`${code}@${item.palace}`], item.palace,
        `断语在 ${item.palace}，但格局 ${code} 不在该宫｜${item.text}`,
      );
    });
  });
});

check("同宫同星多格局合并且不重复出句", () => {
  const knowledge = makeKnowledge({ "文昌@父母宫": "主文书印信。" });
  const year = yearFactOf();
  // 父母宫同时命中「负极线」与「同星禄忌叠临」两种格局，应合并为一句
  year.fourTransformations = [
    hua("禄", "天梁", "命宫"), hua("权", "左辅", "子女宫"),
    hua("科", "右弼", "田宅宫"), hua("忌", "天机", "父母宫"),
  ];
  year.activation.rows = [{
    kind: "忌", star: "天机", natalPalace: "父母宫", decadalPalace: "官禄宫", annualPalace: "官禄宫",
    onDecadalSoul: false, onDecadalSoulOpposite: false,
    stackedOnDecadalHua: [{ kind: "禄", star: "天机" }], stacked: true,
    overlapsNatal: [], status: "ok",
  }];
  const decadal = decadalOf({
    fourTransformations: [
      hua("禄", "天机", "父母宫"), hua("权", "太阴", "财帛宫"),
      hua("科", "右弼", "财帛宫"), hua("忌", "紫微", "兄弟宫"),
    ],
  });
  const timeline = timelineOf(decadal, [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const ladder3 = result.years[0].ladders[2];
  const codes = ladder3.patterns.map((item) => item.code);
  assert.ok(codes.indexOf("negative-line") >= 0, JSON.stringify(codes));
  assert.ok(codes.indexOf("same-star-lu-ji") >= 0, JSON.stringify(codes));
  const statements = result.years[0].statements;
  assert.strictEqual(statements.length, 1, JSON.stringify(statements.map((item) => item.text)));
  assert.strictEqual(statements[0].palace, "父母宫");
  assert.ok(statements[0].patternCodes.length >= 2, JSON.stringify(statements[0].patternCodes));
  assert.ok(statements[0].factPointers.length >= 2, JSON.stringify(statements[0].factPointers));
});

// ── 6. 应期远近 ───────────────────────────────────────────────
check("落大限命财官判年限断", () => {
  const knowledge = makeKnowledge({ "天机@夫妻宫": "主变动。" });
  const timeline = timelineOf(decadalOf(), [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const year = result.years[0];
  // 夹具里夫妻宫的大限宫位是「命宫」
  assert.strictEqual(year.granularity.granularity, "decadal", year.granularity.reason);
});

check("落流年命财官判年份断", () => {
  const knowledge = makeKnowledge({ "天机@夫妻宫": "主变动。" });
  const year = yearFactOf();
  // 大限层不在命财官、流年层在财帛宫 → 年份断
  year.palaceOverlay = year.palaceOverlay.map((row) => (
    row.natalPalace === "夫妻宫"
      ? { ...row, decadalPalace: "福德宫", annualPalace: "财帛宫" }
      : row
  ));
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  assert.strictEqual(result.years[0].granularity.granularity, "year", result.years[0].granularity.reason);
});

check("未达第四阶不定应期远近", () => {
  const year = yearFactOf();
  year.activation.rows = [];
  const timeline = timelineOf(decadalOf(), [year]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge: makeKnowledge({}), knowledgeIndex: {},
  });
  assert.strictEqual(result.years[0].granularity.granularity, "none");
});

// ── 7. 输出语句的措辞卫生 ─────────────────────────────────────
check("输出语句一律带「倾向」且不含铁口词", () => {
  const knowledge = makeKnowledge({
    "天机@夫妻宫": "一定会离婚。",
    "巨门@夫妻宫": "必然口舌不断。",
  });
  const timeline = timelineOf(decadalOf(), [yearFactOf()]);
  const result = L.evaluateTimeline(timeline, {
    palaces: palacesFixture(), knowledge, knowledgeIndex: {},
  });
  const statements = result.years[0].statements;
  assert.ok(statements.length > 0);
  const banned = /(一定|必然|必定|绝对|铁定|百分百|绝不会)/;
  statements.forEach((item) => {
    assert.ok(item.text.indexOf("倾向") >= 0, item.text);
    assert.ok(!banned.test(item.text), item.text);
    assert.ok(item.knowledgeRefs.length > 0);
    assert.ok(item.factPointers.length > 0);
  });
});

check("shortenReading 只取首句且给出截断标记", () => {
  const long = "主子女聪明伶俐但欲望重；后半句不应该出现。";
  const short = L.shortenReading(long, 8);
  assert.ok(short.endsWith("…"), short);
  assert.ok(short.indexOf("后半句") < 0, short);
});

// ── 8. 真实盘面冒烟 ───────────────────────────────────────────
check("真实盘面：10 年全判、四阶递减、无越级", () => {
  const knowledge = JSON.parse(fs.readFileSync(
    path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8",
  ));
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "ziwei-knowledge.js"), "utf8"));
  const index = global.MingliZiweiKnowledge.createIndex(knowledge);
  const chart = global.MingliZiwei.calculate({
    calendar: "solar", date: "1990-05-15", is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    sex_for_calculation: "male",
  }, { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 });
  const timeline = F.buildDecadalAnnualTimeline(chart.astrolabe, chart.palaces, 2026);
  const result = L.evaluateTimeline(timeline, {
    palaces: chart.palaces, knowledge: global.MingliZiweiKnowledge, knowledgeIndex: index,
  });
  assert.strictEqual(result.years.length, 10);
  // 四阶命中数必须单调不增
  const fired = result.ladderTotals.map((item) => item.firedYears);
  for (let i = 1; i < fired.length; i += 1) {
    assert.ok(fired[i] <= fired[i - 1], `阶梯命中数应递减：${fired.join(",")}`);
  }
  result.years.forEach((year) => {
    // 第 n 阶成立则前 n-1 阶必须都成立
    for (let step = 1; step <= 4; step += 1) {
      if (year.ladders[step - 1].fired) {
        for (let prev = 1; prev < step; prev += 1) {
          assert.ok(year.ladders[prev - 1].fired, `${year.year} 第 ${step} 阶成立但第 ${prev} 阶未成立`);
        }
      }
    }
    year.statements.forEach((item) => {
      assert.ok(item.factPointers.length > 0);
      assert.ok(item.knowledgeRefs.length > 0);
      assert.ok(item.shortText.indexOf("本命") === 0, item.shortText);
      // 每条断语都要能追到动因宫，且六内/六外有归类 —— §17 靠它判，不从文本猜
      assert.ok(Array.isArray(item.huaOrigins) && item.huaOrigins.length > 0, `${year.year} 缺动因`);
      item.huaOrigins.forEach((o) => {
        assert.ok(o.zone === "inside" || o.zone === "outside", `${o.palace} 未归类`);
        assert.ok(o.label.indexOf("本命" + o.palace) > 0, o.label);
      });
    });
  });
});

if (process.exitCode === 1) {
  console.error("yingqi_ladder: FAILED");
  process.exit(1);
}
console.log(`\n===== 应期四阶梯检查 ${checks} 项全部通过 =====`);

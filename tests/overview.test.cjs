// 一页速览：模型与渲染的回归测试。
// 夹具刻意做小：只保留结论需要的字段，避免测试依赖整份引擎输出。
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
vm.runInThisContext(fs.readFileSync(path.join(root, "web/overview.js"), "utf8"), { filename: "web/overview.js" });
const OV = globalThis.MingliOverview;

let __checks = 0;
const proxy = new Proxy(assert, {
  get(target, name) {
    const value = target[name];
    if (typeof value !== "function") return value;
    return (...args) => {
      const result = value.apply(target, args);
      __checks += 1;
      return result;
    };
  }
});
const check = proxy;

function pillar(stem, branch, tenGod, element) {
  return {
    stem, branch, ganzhi: stem + branch, ten_god: tenGod,
    stem_element: element, branch_element: "土",
    hidden_stems: [{ stem: "戊", element: "土", ten_god: "偏财", role: "本气" }]
  };
}

function makeBazi(overrides = {}) {
  const annual = overrides.annual || [{
    year: 2026, ganzhi: "丙午", stem: "丙", branch: "午", ten_god: "食神",
    relations_to_natal: [
      { kind: "branch-six-clash", participants: ["day", "annual-2026"], values: ["子", "午"], layers: ["natal", "annual"] }
    ]
  }];
  return {
    calculation: {
      calendar_display: { solar: "2000-11-02 12:22", lunar: "2000年十月初七" },
      pillars: {
        year: pillar("庚", "辰", "偏官", "金"),
        month: pillar("丙", "戌", "食神", "火"),
        day: pillar("甲", "子", "比肩", "木"),
        hour: pillar("庚", "午", "偏官", "金")
      }
    },
    ai_facts: {
      element_inventory: {
        counts: {
          visible_stems: { 木: 1, 火: 1, 土: 0, 金: 2, 水: 0 },
          branch_primary_elements: { 木: 0, 火: 1, 土: 2, 金: 0, 水: 1 },
          hidden_stems_nominal_weight: { 木: 0.3, 火: 0.8, 土: 1.5, 金: 0.3, 水: 1.1 }
        }
      },
      derived_rules: {
        strength: { conclusion: "身弱候选", band: "weak", supportRatio: 0.2667 },
        pattern: { primaryCandidate: "偏财格", candidates: [{ name: "偏财格" }, { name: "食神格" }] },
        useful_elements: {
          resolution: {
            status: "consensus",
            selectedCandidateElements: ["水"],
            crossAxisConsensusElements: ["水"],
            excludedConflictElements: ["木", "火", "土", "金"],
            selectionBasis: "cross-axis-consensus"
          },
          axes: { balance: { primaryElements: ["水"], secondaryElements: ["木"], avoidElements: ["金", "土"] } }
        },
        climate_adjustment: { conclusion: "戌月燥土，取水润局", primaryElements: ["水"] }
      },
      annual_cycles: annual,
      luck_cycles: [{ sequence: "3", age_range: "21-30岁", ganzhi: "己丑", ten_god: "正财" }]
    }
  };
}

function makeZiwei(overrides = {}) {
  const names = [
    ["命宫", "巳", { name: "巨门", brightness: "旺" }],
    ["兄弟宫", "辰", { name: "贪狼", brightness: "庙" }],
    ["夫妻宫", "卯", { name: "太阴", brightness: "陷" }],
    ["子女宫", "寅", { name: "紫微", brightness: "旺" }, { name: "天府", brightness: "庙" }],
    ["财帛宫", "丑", null],
    ["疾厄宫", "子", { name: "破军", brightness: "庙" }],
    ["迁移宫", "亥", { name: "太阳", brightness: "陷" }],
    ["交友宫", "戌", { name: "武曲", brightness: "庙" }],
    ["官禄宫", "酉", { name: "天同", brightness: "平" }],
    ["田宅宫", "申", { name: "七杀", brightness: "庙" }],
    ["福德宫", "未", { name: "天梁", brightness: "旺" }],
    ["父母宫", "午", { name: "廉贞", brightness: "平" }]
  ];
  return {
    basics: {
      fiveElementsClass: "金四局", soulRuler: "武曲", bodyRuler: "文昌",
      soulPalaceBranch: "巳", bodyPalaceBranch: "巳", zodiac: "龙",
      originalPalace: { palace: "兄弟宫", branch: "辰", stem: "庚" }
    },
    palaces: names.map(([name, branch, ...majors], index) => ({
      index, name, heavenlyStem: "乙", earthlyBranch: branch,
      isBodyPalace: branch === "巳",
      majorStars: majors.filter(Boolean).map(star => ({ name: star.name, brightness: star.brightness, transformation: null })),
      minorStars: [], auxiliaryStars: [],
      borrowedMajorStars: [],
      decadal: { range: [20, 29], heavenlyStem: "乙", earthlyBranch: branch }
    })),
    aiFacts: {
      periods: {
        current: {
          annual: {
            year: overrides.annualYear || 2026,
            ganzhi: "丙午",
            fourTransformations: [
              { kind: "忌", star: "廉贞", natalPalace: "父母宫", periodPalace: "官禄宫", evidenceId: "annual.four_hua.ji" },
              { kind: "禄", star: "天同", natalPalace: "官禄宫", periodPalace: "交友宫", evidenceId: "annual.four_hua.lu" },
              { kind: "科", star: "文昌", natalPalace: "命宫", periodPalace: "命宫", evidenceId: "annual.four_hua.ke" },
              { kind: "权", star: "紫微", natalPalace: "子女宫", periodPalace: "夫妻宫", evidenceId: "annual.four_hua.quan" }
            ]
          }
        }
      }
    }
  };
}

// ── 模型 ────────────────────────────────────────────────────────────────

const model = OV.build({ bazi: makeBazi(), ziwei: makeZiwei(), year: 2026, sex: "male" });
check.equal(model.schema, OV.SCHEMA);
check.equal(model.status, "ok");
check.deepEqual(model.chart.pillars.map(item => item.ganzhi), ["庚辰", "丙戌", "甲子", "庚午"]);
check.equal(model.chart.dayMaster.stem, "甲");
check.equal(model.chart.dayMaster.element, "木");
check.equal(model.structure.strength.label, "身弱候选");
check.equal(model.structure.pattern.name, "偏财格");
check.deepEqual(model.structure.useful.primary, ["水"]);
check.ok(model.structure.useful.avoid.includes("木"));

// 五行占比：可见干 + 支本气 + 藏干权重，总和约 100
const totalPercent = model.elements.reduce((sum, item) => sum + item.percent, 0);
check.ok(Math.abs(totalPercent - 100) < 1.5, `五行占比合计 ${totalPercent}`);
check.equal(model.elements.find(item => item.element === "土").percent > model.elements.find(item => item.element === "木").percent, true);

// 命宫 / 身宫：身宫与命宫同宫时也要能找到
check.equal(model.palaces.soul.branch, "巳");
check.deepEqual(model.palaces.soul.stars.map(star => star.name), ["巨门"]);
check.equal(model.palaces.body.branch, "巳");
check.equal(model.palaces.ring.length, 12);
check.equal(model.palaces.ring.find(cell => cell.branch === "巳").isBody, true);
check.equal(model.palaces.ring.find(cell => cell.branch === "丑").majors.length, 0);

// 流年 / 大限
check.equal(model.year.year, 2026);
check.equal(model.year.ganzhi, "丙午");
check.equal(model.year.tenGod, "食神");
check.equal(model.year.tenGodFamily, "output");
check.equal(model.year.age, 27);
check.equal(model.year.luck.ganzhi, "己丑");
check.deepEqual(model.year.clashes.map(item => item.target), ["日支"]);
check.equal(model.year.ziwei.fourHua.length, 4);
check.equal(model.yearOptions.includes(2026), true);

// 六领域齐全，每条都有依据，且不含「注定」「必然」这类词
check.equal(model.domains.length, 6);
check.deepEqual(model.domains.map(card => card.key), ["career", "relationship", "wealth", "health", "home", "growth"]);
model.domains.forEach(card => {
  check.ok(card.basis.length >= 1, `${card.key} 缺依据`);
  check.ok(card.headline.length > 0);
  check.equal(/注定|必然|一定会|绝对/.test(`${card.headline}${card.detail}`), false, `${card.key} 出现绝对化措辞`);
});

// 紫微流年忌入官禄 → 事业要被标成先看风险
check.equal(model.domains[0].headline, "任务重、返工多");
check.ok(model.domains[0].basis.some(item => item.includes("紫微流年忌入官禄宫")));

// 禄入交友与冲日支同时出现 → 两面都写，不能只报喜
check.equal(model.domains[1].headline, "关系有推进也有打断");
check.ok(model.domains[1].basis.some(item => item.includes("冲日支")));

// 喜用天干（水年）会把钱财写成有支撑
const waterYear = OV.build({
  bazi: makeBazi({ annual: [{ year: 2028, ganzhi: "戊申", stem: "戊", branch: "申", ten_god: "偏财", relations_to_natal: [] }] }),
  ziwei: makeZiwei({ annualYear: 2026 }),
  year: 2028, sex: "male"
});
check.equal(waterYear.year.tenGodFamily, "wealth");
check.equal(waterYear.year.ziwei, null, "紫微流年只对当年计算");
check.equal(waterYear.domains[2].headline.includes("账") || waterYear.domains[2].headline.includes("支撑"), true);

// 没有排盘 → 明确不可用，而不是空壳
const empty = OV.build({});
check.equal(empty.status, "unavailable");
check.ok(empty.reason.length > 0);

// 只有紫微、没有八字时仍能给出命盘速览
const ziweiOnly = OV.build({ ziwei: makeZiwei(), year: 2026, sex: "female" });
check.equal(ziweiOnly.status, "ok");
check.equal(ziweiOnly.chart, null);
check.equal(ziweiOnly.elements.length, 0);
check.equal(ziweiOnly.palaces.soul.branch, "巳");

// 女命看官星：流年官杀时关系被提起
const femaleOfficer = OV.build({
  bazi: makeBazi({ annual: [{ year: 2027, ganzhi: "丁未", stem: "丁", branch: "未", ten_god: "正官", relations_to_natal: [] }] }),
  ziwei: makeZiwei({ annualYear: 2026 }),
  year: 2027, sex: "female"
});
check.equal(femaleOfficer.domains[1].headline, "关系的议题会被提起");

// ── 渲染 ────────────────────────────────────────────────────────────────

const html = OV.render(model);
check.ok(html.includes("ov-table"));
check.ok(html.includes("ov-tlabel"));
check.ok(/ov-char[^"]*">庚</.test(html), "天干单独成格");
check.ok(/ov-char[^"]*">辰</.test(html), "地支单独成格");
check.ok(html.includes("干神"));
check.ok(html.includes("藏干"));
check.ok(html.includes("支神"));
check.ok(html.includes("喜用"));
check.ok(html.includes("紫微斗数"));
check.ok(html.includes("ov-year-line"));
check.ok(html.includes("ov-year"));
check.equal(html.includes("id=\"overview-year\""), false, "正文里不再出现第二个年份下拉");
check.ok(html.includes("2026"));
check.equal((html.match(/ov-domain /g) || []).length, 6);
check.equal((html.match(/ov-cell/g) || []).length >= 12, true);
check.ok(html.includes("ov-taiji"), "命盘中心是太极图");
check.ok(html.includes("ov-cell-decadal"), "每宫标大限岁数");
check.ok(html.includes("来因"), "来因宫有标记");

// 不可用时渲染成一句话，不抛错
const emptyHtml = OV.render(empty);
check.ok(emptyHtml.includes("还没有可以汇总的盘"));

// HTML 转义：星名里的尖括号不能原样输出
const tricky = OV.build({
  ziwei: {
    basics: { soulPalaceBranch: "子" },
    palaces: [{ name: "<命宫>", heavenlyStem: "甲", earthlyBranch: "子", majorStars: [{ name: "<巨门>", brightness: "旺" }] }]
  },
  year: 2026
});
check.equal(OV.render(tricky).includes("<命宫>"), false);

// 十神归族与年龄区间解析
check.equal(OV.familyOf("偏官"), "officer");
check.equal(OV.familyOf("正印"), "resource");
check.equal(OV.familyOf("未知"), null);
check.deepEqual(OV.parseAgeRange("21-30岁"), { from: 21, to: 30 });
check.equal(OV.parseAgeRange("x"), null);

if (__checks === 0) {
  console.error("没有任何断言执行");
  process.exit(1);
}
console.log(`===== 一页速览检查通过。${__checks} 项 =====`);

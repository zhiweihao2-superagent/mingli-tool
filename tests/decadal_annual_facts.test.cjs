"use strict";

// §16 #15「当前大限逐流年关键点」事实层契约测试。
//
// 钉三件事：
//   1) 整个大限覆盖的每个流年都产出独立事实（不是只有当前年）
//   2) 每年的引动判定能追溯到「大限四化」与「流年四化」两层的落点
//   3) 大限起止与流年边界经过对账，缺年/错边界必须判 fail 而不是静默通过
//
// 与 annual_timeline.test.cjs 的分工：那个测的是「一年十二个月」的
// MingliAnnualTimeline；这里测的是「一个大限十个流年」的
// MingliZiweiFacts.buildDecadalAnnualTimeline。

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const F = global.MingliZiweiFacts;
const OPPOSITES = F.opposites;
const HUA_KINDS = ["禄", "权", "科", "忌"];

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${checks} - ${name}`);
}

function buildChart() {
  return global.MingliZiwei.calculate(
    {
      calendar: "solar", date: "1990-05-15", is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male",
    },
    { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
  );
}

const chart = buildChart();
const timeline = F.buildDecadalAnnualTimeline(chart.astrolabe, chart.palaces, 2026);
// 注意：yearlyList()/decadalList() 的入参是数组位置 listIndex，
// 不是 decadal.index（那是宫位序号）。混用会静默取到别的大限。
const rawDecadal = chart.astrolabe.decadalList()[timeline.decadal.listIndex];
const rawYears = chart.astrolabe.yearlyList(timeline.decadal.listIndex);

/** 用真实十二宫名 + 可控干支构造大限桩，用来做反例。 */
function decadalStub(overrides) {
  return Object.assign(
    {
      index: 0,
      name: "大限",
      palaceName: "命宫",
      ageRange: [35, 44],
      yearRange: [2024, 2033],
      heavenlyStem: "戊",
      earthlyBranch: "寅",
      palaceNames: [...rawDecadal.palaceNames],
    },
    overrides,
  );
}

/** 用真实年条目做底，只替换需要变的字段，用来验证干支关系判定。 */
function annualStub(overrides) {
  return Object.assign({}, rawYears[0], overrides);
}

function runWith(stubDecadal, stubYears, asOfYear) {
  const astrolabe = {
    decadalList: () => [stubDecadal],
    yearlyList: () => stubYears,
  };
  return F.buildDecadalAnnualTimeline(astrolabe, chart.palaces, asOfYear);
}

check("当前大限覆盖的每个流年都有独立事实", () => {
  assert.strictEqual(timeline.status, "pass");
  assert.strictEqual(timeline.years.length, 10);
  assert.strictEqual(new Set(timeline.years.map((item) => item.year)).size, 10);
});

check("首末年与大限 yearRange 一致", () => {
  const { yearRange } = timeline.decadal;
  assert.strictEqual(timeline.years[0].year, yearRange[0]);
  assert.strictEqual(timeline.years[timeline.years.length - 1].year, yearRange[1]);
  assert.strictEqual(timeline.boundaryAudit.status, "pass");
  assert.deepStrictEqual(timeline.boundaryAudit.hardFailures, []);
});

check("虚岁自大限起运虚岁逐年递增", () => {
  const start = timeline.decadal.ageRange[0];
  timeline.years.forEach((item, index) => {
    assert.strictEqual(item.nominalAge, start + index);
  });
});

check("每年十二宫叠宫齐全且唯一", () => {
  for (const item of timeline.years) {
    assert.strictEqual(item.palaceOverlay.length, 12);
    assert.strictEqual(new Set(item.palaceOverlay.map((row) => row.annualPalace)).size, 12);
    assert.ok(item.palaceOverlay.every((row) => row.branch && row.natalPalace
      && row.decadalPalace && row.annualPalace));
  }
});

check("每年四化四条且三层落点齐全", () => {
  for (const item of timeline.years) {
    assert.strictEqual(item.fourTransformations.length, 4);
    assert.deepStrictEqual(
      item.fourTransformations.map((hua) => hua.kind),
      HUA_KINDS,
    );
    for (const hua of item.fourTransformations) {
      assert.ok(hua.kind && hua.star);
      assert.ok(hua.natalPalace, `${item.year} ${hua.kind} 缺本命落点`);
      assert.ok(hua.decadalPalace, `${item.year} ${hua.kind} 缺大限落点`);
      assert.ok(hua.periodPalace, `${item.year} ${hua.kind} 缺流年落点`);
    }
  }
});

check("每年十二宫飞化四十八条落点齐全", () => {
  for (const item of timeline.years) {
    assert.strictEqual(item.palaceFlying.length, 48);
    assert.ok(item.palaceFlying.every((row) => row.sourcePeriodPalace && row.targetPeriodPalace));
  }
});

check("引动行可逐条追溯到流年四化落点", () => {
  for (const item of timeline.years) {
    assert.strictEqual(item.activation.rows.length, 4);
    for (const row of item.activation.rows) {
      const sameKind = item.fourTransformations.find((hua) => hua.kind === row.kind);
      assert.ok(sameKind, `${item.year} ${row.kind} 找不到对应四化`);
      assert.strictEqual(row.star, sameKind.star);
      assert.strictEqual(row.natalPalace, sameKind.natalPalace);
      assert.strictEqual(row.decadalPalace, sameKind.decadalPalace);
      assert.strictEqual(row.annualPalace, sameKind.periodPalace);
    }
  }
});

check("叠化判定与大限四化落点一致", () => {
  const decadalHua = timeline.decadal.fourTransformations;
  for (const item of timeline.years) {
    for (const row of item.activation.rows) {
      const expected = decadalHua
        .filter((hua) => hua.natalPalace === row.natalPalace)
        .map((hua) => hua.kind)
        .sort();
      const actual = row.stackedOnDecadalHua.map((hua) => hua.kind).sort();
      assert.deepStrictEqual(actual, expected, `${item.year} ${row.kind} 叠化不一致`);
      assert.strictEqual(row.stacked, expected.length > 0);
    }
    assert.strictEqual(
      item.activation.stackedRows.length,
      item.activation.rows.filter((row) => row.stacked).length,
    );
  }
});

check("大限命宫与冲宫判定正确", () => {
  const soul = timeline.decadal.natalAnchorPalace;
  assert.ok(soul);
  assert.strictEqual(timeline.years[0].activation.decadalSoulPalace, soul);
  assert.strictEqual(timeline.years[0].activation.decadalSoulOppositePalace, OPPOSITES[soul]);
  for (const item of timeline.years) {
    for (const row of item.activation.rows) {
      assert.strictEqual(row.onDecadalSoul, row.natalPalace === soul);
      assert.strictEqual(row.onDecadalSoulOpposite, row.natalPalace === OPPOSITES[soul]);
    }
  }
});

check("生年四化从星曜反查且星宫对应无误", () => {
  for (const item of timeline.years) {
    const natalHua = item.activation.natalHua;
    assert.deepStrictEqual([...Object.keys(natalHua)].sort(), [...HUA_KINDS].sort());
    for (const kind of HUA_KINDS) {
      const target = natalHua[kind];
      assert.ok(target && target.star && target.palace, `生年${kind}未定位`);
      const palace = chart.palaces.find((entry) => entry.name === target.palace);
      assert.ok(palace, `生年${kind}宫位 ${target.palace} 不存在`);
      assert.strictEqual(palace.earthlyBranch, target.branch);
      const star = ["majorStars", "minorStars", "auxiliaryStars"]
        .flatMap((group) => palace[group] || [])
        .find((entry) => entry.name === target.star);
      assert.ok(star, `生年${kind}星曜 ${target.star} 不在 ${target.palace}`);
      assert.strictEqual(star.transformation, kind);
    }
  }
});

check("与生年四化的同宫/对冲判定与宫位对冲表双向一致", () => {
  const natalHua = timeline.years[0].activation.natalHua;
  for (const item of timeline.years) {
    for (const row of item.activation.rows) {
      for (const overlap of row.overlapsNatal) {
        const target = natalHua[overlap.natalKind];
        assert.strictEqual(overlap.palace, target.palace);
        assert.strictEqual(overlap.star, target.star);
        if (overlap.relation === "同宫") {
          assert.strictEqual(target.palace, row.natalPalace);
        } else {
          assert.strictEqual(overlap.relation, "对冲");
          assert.strictEqual(OPPOSITES[row.natalPalace], target.palace);
        }
      }
      for (const kind of HUA_KINDS) {
        const target = natalHua[kind];
        if (!target) continue;
        const samePalace = target.palace === row.natalPalace;
        const opposite = OPPOSITES[row.natalPalace] === target.palace;
        const present = row.overlapsNatal.some((overlap) => overlap.natalKind === kind);
        assert.strictEqual(present, samePalace || opposite, `${item.year} ${row.kind} vs 生年${kind}`);
      }
    }
  }
});

check("干支全同判为岁运并临", () => {
  const stub = decadalStub({ heavenlyStem: "甲", earthlyBranch: "辰" });
  const years = [annualStub({ year: 2024, age: 35, heavenlyStem: "甲", earthlyBranch: "辰" })];
  const result = runWith(stub, years, 2024);
  const relation = result.years[0].decadalAnnualRelation;
  assert.strictEqual(relation.sameStem, true);
  assert.strictEqual(relation.sameBranch, true);
  assert.ok(relation.relation.some((item) => item.kind === "岁运并临"));
});

check("天干相克且地支相冲判为天克地冲", () => {
  const stub = decadalStub({ heavenlyStem: "戊", earthlyBranch: "寅" });
  const years = [annualStub({ year: 2024, age: 35, heavenlyStem: "甲", earthlyBranch: "申" })];
  const result = runWith(stub, years, 2024);
  const relation = result.years[0].decadalAnnualRelation;
  assert.strictEqual(relation.stemClash, true);
  assert.strictEqual(relation.branchClash, true);
  assert.ok(relation.relation.some((item) => item.kind === "天克地冲"));
});

check("只有同干加支冲时不判岁运并临也不判天克地冲", () => {
  const stub = decadalStub({ heavenlyStem: "戊", earthlyBranch: "寅" });
  const years = [annualStub({ year: 2024, age: 35, heavenlyStem: "戊", earthlyBranch: "申" })];
  const result = runWith(stub, years, 2024);
  const relation = result.years[0].decadalAnnualRelation;
  assert.strictEqual(relation.sameStem, true);
  assert.strictEqual(relation.branchClash, true);
  assert.strictEqual(relation.stemClash, false);
  assert.deepStrictEqual(relation.relation, []);
});

check("缺年时边界对账判 fail 并点名原因", () => {
  const stub = decadalStub();
  const years = rawYears.filter((item) => item.year !== 2029);
  const result = runWith(stub, years, 2024);
  assert.strictEqual(result.boundaryAudit.status, "fail");
  assert.ok(result.boundaryAudit.hardFailures.includes("annual_count_matches_year_range"));
  assert.ok(result.boundaryAudit.hardFailures.includes("annual_years_contiguous"));
  assert.strictEqual(result.status, "fail");
});

check("首末年错位时边界对账判 fail", () => {
  const stub = decadalStub();
  const years = rawYears.slice(0, 9);
  const result = runWith(stub, years, 2024);
  assert.strictEqual(result.boundaryAudit.status, "fail");
  assert.ok(result.boundaryAudit.hardFailures.includes("annual_first_last_match_year_range"));
});

check("虚岁与大限起运不符时边界对账判 fail", () => {
  const stub = decadalStub();
  const years = rawYears.map((item, index) => Object.assign({}, item, { age: item.age + (index === 3 ? 5 : 0) }));
  const result = runWith(stub, years, 2024);
  assert.strictEqual(result.boundaryAudit.status, "fail");
  assert.ok(result.boundaryAudit.hardFailures.includes("annual_nominal_age_matches_age_range"));
});

check("asOfYear 不落在任何大限区间时如实降级", () => {
  const result = F.buildDecadalAnnualTimeline(chart.astrolabe, chart.palaces, 1900);
  assert.strictEqual(result.status, "unavailable");
  assert.strictEqual(result.decadal, null);
  assert.deepStrictEqual(result.years, []);
  assert.strictEqual(result.boundaryAudit, null);
});

check("化星无法定位时不编造落点且该年判 fail", () => {
  const stub = decadalStub();
  const years = [annualStub({
    year: 2024, age: 35, heavenlyStem: "甲", earthlyBranch: "辰",
    mutagen: ["不存在的星", "破军", "武曲", "太阳"],
  })];
  const result = runWith(stub, years, 2024);
  const lu = result.years[0].fourTransformations.find((hua) => hua.kind === "禄");
  assert.strictEqual(lu.natalPalace, null);
  const row = result.years[0].activation.rows.find((item) => item.kind === "禄");
  assert.strictEqual(row.status, "unavailable");
  assert.strictEqual(row.natalPalace, null);
  assert.strictEqual(result.years[0].status, "fail");
  assert.strictEqual(result.status, "fail");
});

check("干支不合法时干支关系判 unavailable 而不是硬算", () => {
  const stub = decadalStub({ heavenlyStem: "X", earthlyBranch: "寅" });
  const years = [annualStub({ year: 2024, age: 35, heavenlyStem: "甲", earthlyBranch: "辰" })];
  const result = runWith(stub, years, 2024);
  const relation = result.years[0].decadalAnnualRelation;
  assert.strictEqual(relation.status, "unavailable");
  assert.deepStrictEqual(relation.relation, []);
});

console.log(`\n===== 逐年事实检查 ${checks} 项全部通过 =====`);

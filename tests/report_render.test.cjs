"use strict";

// 渲染层单测：只验「翻译是否忠实、措辞是否守规」，不验星理。
// 夹具是手写的 yearResult / statement，不依赖真实盘。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "report-render.js"), "utf8"));

const R = globalThis.MingliReportRender;

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok   " + name);
  } catch (error) {
    failed += 1;
    console.log("  FAIL " + name + " :: " + (error && error.message));
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || "断言失败");
}
function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || "不等") + "：期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
  }
}

const DECADAL = { ganzhi: "戊寅", ageRange: [35, 44], yearRange: [2024, 2033] };

function stmt(overrides) {
  return Object.assign({
    palace: "财帛宫",
    star: "太阳",
    shortText: "本命财帛宫坐太阳，庙旺逢生年忌又自化禄，构成矛盾架构：忌主在意节俭。",
    text: "本命财帛宫坐太阳，庙旺逢生年忌又自化禄，构成矛盾架构：忌主在意节俭。",
    patternCodes: ["lu-ji-same"],
    patternTexts: ["本命财帛宫同时承受 生年禄太阳 与 流年忌太阴（禄忌同宫）"],
    factPointers: ["/years/2024/fourTransformations"],
    knowledgeRefs: ["ziwei.knowledge.太阳.财帛宫"],
  }, overrides || {});
}

function yearResult(overrides) {
  return Object.assign({
    year: 2024,
    ganzhi: "甲辰",
    nominalAge: 35,
    reachableDepth: 4,
    granularity: { granularity: "year", reason: "触发宫在流年命/财/官（财帛宫），按年份断（当年验）" },
    statements: [stmt()],
    diagnostics: [],
  }, overrides || {});
}

console.log("== 宫位领域映射 ==");

check("十二宫全部有领域译名", () => {
  const expected = ["命宫", "兄弟宫", "夫妻宫", "子女宫", "财帛宫", "疾厄宫",
    "迁移宫", "仆役宫", "官禄宫", "田宅宫", "福德宫", "父母宫"];
  expected.forEach((name) => {
    const hit = R.domainOf(name);
    assert(hit.known, name + " 缺译名");
    assert(typeof hit.domain === "string" && hit.domain.length > 0, name + " 译名为空");
  });
});

check("每个领域译名都带原文锚点", () => {
  Object.keys(R.PALACE_DOMAINS).forEach((name) => {
    const row = R.PALACE_DOMAINS[name];
    assert(typeof row.anchor === "string" && row.anchor.length > 8, name + " 缺锚点");
    assert(/\.md/.test(row.anchor), name + " 锚点应指向 references/*.md");
  });
});

check("交友宫按源文件口径归一到同一领域", () => {
  eq(R.domainOf("交友宫").domain, R.domainOf("仆役宫").domain);
});

check("未知宫位不编译名，原样返回并标记 unknown", () => {
  const hit = R.domainOf("来因宫");
  eq(hit.known, false);
  eq(hit.domain, "来因宫");
  eq(hit.anchor, null);
});

check("空宫位给「未定位」而不是空串", () => {
  eq(R.domainOf(null).domain, "未定位");
});

console.log("== 倾向译名 ==");

check("三忌叠加优先级高于双忌", () => {
  const tend = R.tendencyOf(["double-ji", "triple-ji"]);
  eq(tend.primary, "triple-ji");
});

check("负极线优先于禄逢冲破", () => {
  eq(R.tendencyOf(["lu-po", "negative-line"]).primary, "negative-line");
});

check("未登记的格局代码不进主句，也不丢其余", () => {
  const tend = R.tendencyOf(["unknown-code", "lu-po"]);
  eq(tend.primary, "lu-po");
  eq(tend.others.length, 0);
});

check("全未登记时给兜底倾向，不冒充具体判断", () => {
  const tend = R.tendencyOf(["whatever"]);
  eq(tend.primary, null);
  eq(tend.plain, "有动静，方向未定");
});

console.log("== 时间落点 ==");

check("年限断复述大限年份区间", () => {
  const t = R.plainTiming({ year: 2024, granularity: { granularity: "decadal" } }, DECADAL);
  eq(t.granularity, "decadal");
  assert(t.when.indexOf("2024–2033") >= 0, t.when);
  assert(t.when.indexOf("戊寅") >= 0, t.when);
  eq(t.plain, "未来 5–10 年");
});

check("年份断落到具体年", () => {
  const t = R.plainTiming({ year: 2032, granularity: { granularity: "year" } }, DECADAL);
  eq(t.when, "2032 年当年");
  eq(t.plain, "2032 年");
});

check("无粒度时写「不定时间」，不硬凑年份", () => {
  const t = R.plainTiming({ year: 2024, granularity: { granularity: "none" } }, DECADAL);
  eq(t.when, "不定时间");
  eq(t.granularity, "none");
});

check("缺大限信息时年限断降级为「本大限内」，不抛错", () => {
  const t = R.plainTiming({ year: 2024, granularity: { granularity: "decadal" } }, null);
  eq(t.when, "本大限内");
});

console.log("== 单条断语 ==");

check("主句含「倾向」且含领域短名", () => {
  const line = R.renderStatement(stmt(), yearResult(), DECADAL);
  eq(line.status, "pass");
  assert(line.plain.indexOf("倾向") >= 0, line.plain);
  assert(line.plain.indexOf("钱（太阳）") >= 0, line.plain);
  eq(line.domain, "钱：收入、花销与存留");
});

check("引文去掉重复的「本命XX宫坐YY，」前缀", () => {
  const line = R.renderStatement(stmt(), yearResult(), DECADAL);
  assert(line.quote.indexOf("本命财帛宫坐太阳") !== 0, line.quote);
  assert(line.quote.indexOf("庙旺逢生年忌") >= 0, line.quote);
});

check("机制原文与证据指针原样保留，供倒查", () => {
  const line = R.renderStatement(stmt(), yearResult(), DECADAL);
  assert(line.mechanism.indexOf("禄忌同宫") >= 0, line.mechanism);
  eq(line.evidence.factPointers[0], "/years/2024/fourTransformations");
  eq(line.evidence.knowledgeRefs[0], "ziwei.knowledge.太阳.财帛宫");
});

check("多格局同时挂上时，主句一条其余并列补足", () => {
  const line = R.renderStatement(
    stmt({ patternCodes: ["negative-line", "lu-po"] }), yearResult(), DECADAL,
  );
  assert(line.plain.indexOf("容易操劳") >= 0, line.plain);
  assert(line.plain.indexOf("先见到好处") >= 0, line.plain);
});

check("缺宫位的断语判 unavailable，不猜", () => {
  const line = R.renderStatement({ star: "太阳" }, yearResult(), DECADAL);
  eq(line.status, "unavailable");
});

console.log("== 逐年与整体 ==");

check("未达第四阶的年份不出断语，并写明停在第几阶", () => {
  const yr = R.renderYear(yearResult({ reachableDepth: 2, statements: [], diagnostics: ["已交感但未成格局，停在第二阶"] }), DECADAL);
  eq(yr.lines.length, 0);
  eq(yr.status, "empty");
  assert(yr.headline.indexOf("停在2阶") >= 0, yr.headline);
});

check("达第四阶的年份 headline 只列领域短名，不合成新判断", () => {
  const yr = R.renderYear(yearResult(), DECADAL);
  eq(yr.headline, "2024 年：钱上有动静。");
});

check("同宫同倾向的多条断语合并成一句，星曜并列不重复", () => {
  const yr = R.renderYear(yearResult({
    statements: [
      stmt(),
      stmt({ palace: "财帛宫", star: "太阴", knowledgeRefs: ["ziwei.knowledge.太阴.财帛宫"] }),
    ],
  }), DECADAL);
  eq(yr.lines.length, 1);
  eq(yr.lines[0].mergedCount, 2);
  eq(yr.lines[0].stars.length, 2);
  eq(yr.lines[0].plain, "2024 年，钱（太阳、太阴）：倾向同一件事上，好处与阻力同时存在。");
  eq(yr.lines[0].evidence.knowledgeRefs.length, 2);
  const hits = yr.headline.split("钱").length - 1;
  eq(hits, 1);
});

check("同宫不同倾向不合并——那是两件事", () => {
  const yr = R.renderYear(yearResult({
    statements: [
      stmt(),
      stmt({ palace: "财帛宫", star: "太阴", patternCodes: ["lu-po"] }),
    ],
  }), DECADAL);
  eq(yr.lines.length, 2);
  assert(yr.lines[0].plain !== yr.lines[1].plain, "两句应不同");
});

check("整体统计与逐条计数一致", () => {
  const out = R.renderTimeline({
    decadal: DECADAL,
    years: [
      yearResult(),
      yearResult({
        year: 2025, ganzhi: "乙巳", nominalAge: 36,
        statements: [stmt({ palace: "疾厄宫", star: "武曲", patternCodes: ["negative-line"] })],
        granularity: { granularity: "decadal", reason: "触发宫在大限命/财/官（疾厄宫）" },
      }),
      yearResult({ year: 2026, ganzhi: "丙午", nominalAge: 37, reachableDepth: 2, statements: [] }),
    ],
  });
  eq(out.status, "pass");
  eq(out.stats.yearCount, 3);
  eq(out.stats.yearsWithPlainText, 2);
  eq(out.stats.lineCount, 2);
  eq(out.stats.yearLines, 1);
  eq(out.stats.decadalLines, 1);
  eq(out.assertiveViolations.length, 0);
});

check("出现断言词时整体判 invalid，不静默放过", () => {
  const out = R.renderTimeline({
    decadal: DECADAL,
    years: [yearResult({
      statements: [stmt({ shortText: "本命财帛宫坐太阳，一定会破财。" })],
    })],
  });
  eq(out.status, "invalid");
  eq(out.assertiveViolations.length, 1);
});

check("未知领域被收集上报，不混进正文", () => {
  const out = R.renderTimeline({
    decadal: DECADAL,
    years: [yearResult({ statements: [stmt({ palace: "来因宫" })] })],
  });
  eq(out.unknownDomains.length, 1);
  eq(out.unknownDomains[0], "来因宫");
});

check("动因宫透传到渲染层，含六内六外归类", () => {
  const out = R.renderTimeline({
    decadal: DECADAL,
    years: [yearResult({ statements: [stmt({
      palace: "财帛宫",
      huaOrigins: [
        { layer: "生年", kind: "禄", star: "太阳", palace: "财帛宫", zone: "inside", label: "生年禄太阳（本命财帛宫·六内）" },
        { layer: "流年", kind: "忌", star: "太阴", palace: "夫妻宫", zone: "outside", label: "流年忌太阴（本命夫妻宫·六外）" },
      ],
    })] })],
  });
  const line = out.years[0].lines[0];
  eq(line.motivations.length, 2);
  eq(line.motivations[0].zone, "inside");
  eq(line.motivations[1].zone, "outside");
  assert(line.motivationText.includes("六内") && line.motivationText.includes("六外"));
});

check("缺动因时 motivations 为空数组，不编造", () => {
  const out = R.renderTimeline({ decadal: DECADAL, years: [yearResult({ statements: [stmt({})] })] });
  eq(out.years[0].lines[0].motivations.length, 0);
  eq(out.years[0].lines[0].motivationText, "");
});

check("缺判定结果时判 unavailable，不抛错", () => {
  eq(R.renderTimeline(null).status, "unavailable");
  eq(R.renderYear(null).status, "unavailable");
});

console.log("");
if (failed > 0) {
  console.log("===== 渲染层检查 " + (passed + failed) + " 项，" + failed + " 项失败 =====");
  process.exit(1);
}
console.log("===== 渲染层检查 " + passed + " 项全部通过 =====");

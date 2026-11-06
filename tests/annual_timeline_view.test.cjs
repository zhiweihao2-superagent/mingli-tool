// 年度时间轴展示层测试：脚本装配顺序、展示模型、未知时辰不建紫微盘、与既有报告隔离。
// 纯函数 + 静态装配检查，不依赖浏览器。

const assert = require("node:assert");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "web", "ziwei-facts.js"));
require(path.join(ROOT, "web", "annual-timeline.js"));

const Timeline = globalThis.MingliAnnualTimeline;
const html = readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
const appJs = readFileSync(path.join(ROOT, "web", "app.js"), "utf8");

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  PASS ${label}`);
}

console.log("--- 1. 脚本与挂载点 ---");
check("annual-timeline.js 在 ziwei-facts.js 之后", () => {
  assert.ok(html.indexOf("/ziwei-facts.js") < html.indexOf("/annual-timeline.js"));
});
check("annual-timeline.js 在 app.js 之前", () => {
  assert.ok(html.indexOf("/annual-timeline.js") < html.indexOf("/app.js"));
});
check("存在独立挂载点且默认隐藏", () => {
  assert.ok(html.includes('id="annual-timeline-section"'));
  const section = html.slice(
    html.indexOf('id="annual-timeline-section"') - 60,
    html.indexOf('id="annual-timeline-section"') + 200
  );
  assert.ok(section.includes("hidden"));
});
check("挂载点在紫微内容之后、AI 报告之前", () => {
  const ziwei = html.indexOf('id="ziwei-content"');
  const timeline = html.indexOf('id="annual-timeline-section"');
  const ai = html.indexOf('id="ai-reading-section"');
  assert.ok(ziwei < timeline && timeline < ai);
});

console.log("\n--- 2. 装配与生命周期 ---");
check("提交成功路径调用 renderAnnualTimeline", () => {
  assert.ok(appJs.includes("renderAnnualTimeline(data, ziweiResult)"));
});
check("调用发生在 renderZiwei 之后", () => {
  // 注意排除函数定义本身（定义在调用之前）
  const callSite = appJs.indexOf("\n    renderAnnualTimeline(data, ziweiResult)");
  const ziweiCall = appJs.indexOf("\n    renderZiwei(ziweiResult)");
  assert.ok(callSite > 0, "找不到调用点");
  assert.ok(ziweiCall > 0, "找不到 renderZiwei 调用点");
  assert.ok(ziweiCall < callSite);
});
check("加载中会清空时间轴", () => {
  const loadingBlock = appJs.slice(appJs.indexOf("function setLoading"));
  assert.ok(loadingBlock.slice(0, 900).includes("clearAnnualTimeline()"));
});
check("错误分支会清空时间轴", () => {
  // 现在的契约是「先清空、再渲染错误」：错误渲染本身抛错时，旧年份也不会留在页面上。
  // 行为证明在 annual_timeline_dom.test.cjs（执行 catch 的真实语句），这里只查顺序。
  const idx = appJs.indexOf("renderServerError(error);");
  assert.ok(idx > 0, "找不到错误处理调用");
  const before = appJs.slice(Math.max(0, idx - 200), idx);
  assert.ok(before.includes("clearAnnualTimeline()"), "renderServerError 之前应先清空时间轴");
});
check("时间轴渲染自带 try/catch，不影响既有报告", () => {
  const start = appJs.indexOf("function renderAnnualTimeline(data, ziweiResult)");
  assert.ok(start > 0);
  const body = appJs.slice(start, appJs.indexOf("function renderAnnualTimelineUnsafe"));
  assert.ok(body.includes("try {"), "缺少 try");
  assert.ok(body.includes("} catch (error) {"), "缺少 catch");
  assert.ok(body.includes("clearAnnualTimeline()"), "catch 里应清空");
});
check("不调用既有报告渲染函数", () => {
  const start = appJs.indexOf("function renderAnnualTimeline");
  assert.ok(start > 0, "找不到时间轴渲染函数");
  // 函数体到下一个顶层语句为止（renderAnnualTimeline 之后是 form.addEventListener）
  const end = appJs.indexOf("\nform.addEventListener", start);
  const body = appJs.slice(start, end > 0 ? end : appJs.length);
  ["renderSummary(", "renderLuck(", "renderAnnual(", "prepareAiReading("].forEach(name => {
    assert.ok(!body.includes(name), `时间轴渲染不应调用 ${name}`);
  });
});

console.log("\n--- 3. 未知时辰不建紫微盘 ---");
check("status=unavailable 时不建盘并给出原因", () => {
  const plan = Timeline.monthlyZiweiPlan({ status: "unavailable" });
  assert.strictEqual(plan.shouldBuild, false);
  assert.ok(plan.note.includes("未知时辰"));
});
check("status=error 时不建盘", () => {
  const plan = Timeline.monthlyZiweiPlan({ status: "error" });
  assert.strictEqual(plan.shouldBuild, false);
  assert.ok(plan.note.includes("不可用"));
});
check("有 astrolabe 且 ok 时才建盘", () => {
  assert.strictEqual(
    Timeline.monthlyZiweiPlan({ status: "ok", astrolabe: {}, palaces: [{}] }).shouldBuild,
    true
  );
  assert.strictEqual(Timeline.monthlyZiweiPlan({ status: "ok" }).shouldBuild, false);
});
check("缺 palaces 时即使 astrolabe 存在也不建盘", () => {
  const plan = Timeline.monthlyZiweiPlan({ status: "ok", astrolabe: {}, palaces: [] });
  assert.strictEqual(plan.shouldBuild, false);
  assert.ok(plan.note.includes("宫位"));
});
check("提交开始即清空时间轴（校验失败也不留旧年份）", () => {
  const start = appJs.indexOf("async function handleSubmit(");
  const body = appJs.slice(start, start + 400);
  const clearAt = body.indexOf("clearAnnualTimeline()");
  const validateAt = body.indexOf("validate()");
  assert.ok(clearAt > 0, "提交处理器里没有清空时间轴");
  assert.ok(validateAt > 0, "找不到校验调用");
  assert.ok(clearAt < validateAt, "清空必须发生在校验之前");
});

console.log("\n--- 4. 展示模型 ---");
const luckOk = { status: "ok", ganzhi: "甲申", from: "2027-08-15T12:00:00+08:00" };
check("大运 ok 显示干支与起始日", () => {
  assert.ok(Timeline.describeLuck(luckOk).includes("甲申"));
  assert.ok(Timeline.describeLuck(luckOk).includes("2027-08-15"));
});
check("大运 indeterminate 不绑定干支", () => {
  const text = Timeline.describeLuck({ status: "indeterminate" });
  assert.ok(text.includes("未绑定"));
  assert.ok(!text.includes("甲申"));
});
check("大运 before_start / 缺失都有明确表述", () => {
  assert.ok(Timeline.describeLuck({ status: "before_start" }).includes("尚未起运"));
  assert.ok(Timeline.describeLuck(null).includes("未提供"));
});
check("月份模型含标题/边界/事实/紫微/证据数", () => {
  const month = {
    index: 7,
    coordinate: {
      jie: "立秋",
      start: "2027-08-07T20:00:00+08:00",
      end: "2027-09-07T23:00:00+08:00",
      endSource: { jie: "白露" }
    },
    bazi: { ganzhi: "戊申", relationCount: 10, luck: luckOk },
    ziwei: { status: "ok", ganzhi: "庚寅", lunarMonth: "七月" },
    evidence: ["/months/6/bazi/ganzhi"]
  };
  const view = Timeline.describeMonth(month);
  assert.strictEqual(view.index, 7);
  assert.ok(view.title.includes("戊申"));
  assert.ok(view.span.includes("立秋") && view.span.includes("白露"));
  assert.ok(view.facts.includes("关系 10 条"));
  assert.ok(view.ziwei.includes("可用"));
  assert.strictEqual(view.evidenceCount, 1);
});
check("紫微不可用时照实显示状态与原因", () => {
  const view = Timeline.describeMonth({
    index: 1,
    coordinate: { jie: "立春", start: "x", end: "y", endSource: { jie: "惊蛰" } },
    bazi: { ganzhi: "庚寅", relationCount: 0, luck: null },
    ziwei: { status: "unverifiable", reason: "该节气月横跨两个农历月" },
    evidence: []
  });
  assert.ok(view.ziwei.includes("坐标不可对应"));
  assert.ok(view.ziwei.includes("横跨两个农历月"));
  assert.strictEqual(view.ziweiStatus, "unverifiable");
});

console.log("\n--- 5. 摘要与校验明细 ---");
check("摘要含校验状态、紫微计数、指纹结论", () => {
  const pkg = {
    validation: { status: "pass", checks: [] },
    fingerprints: { matches: true },
    months: Array.from({ length: 12 }, (_, i) => ({
      index: i + 1,
      ziwei: { status: i < 3 ? "ok" : "unavailable" }
    }))
  };
  const text = Timeline.describeSummary(pkg, "未知时辰");
  assert.ok(text.includes("通过"));
  assert.ok(text.includes("紫微可用 3/12 月"));
  assert.ok(text.includes("指纹 一致"));
  assert.ok(text.includes("未知时辰"));
});
check("明细含声明/复算/包指纹与逐项校验", () => {
  const pkg = {
    fingerprint: "tl-abc12345",
    fingerprints: { declared: "mf-11111111", recomputed: "mf-11111111", matches: true },
    validation: {
      status: "pass",
      checks: [
        { id: "months.count", pass: true, message: "12 个月" },
        { id: "ziwei.explicit_status", pass: false, message: "缺状态" }
      ]
    }
  };
  const d = Timeline.describeDiagnostics(pkg);
  assert.strictEqual(d.fingerprints.declared, "mf-11111111");
  assert.strictEqual(d.fingerprints.recomputed, "mf-11111111");
  assert.strictEqual(d.fingerprints.package, "tl-abc12345");
  assert.strictEqual(d.fingerprints.matches, true);
  assert.strictEqual(d.checks.length, 2);
  assert.strictEqual(d.checks[1].pass, false);
  assert.strictEqual(d.checks[1].id, "ziwei.explicit_status");
});
check("页面含校验明细挂载点", () => {
  assert.ok(html.includes('id="annual-timeline-fingerprints"'));
  assert.ok(html.includes('id="annual-timeline-checks"'));
});
check("app.js 渲染指纹与校验项", () => {
  assert.ok(appJs.includes("describeDiagnostics"));
  assert.ok(appJs.includes("annualTimelineFingerprints.textContent"));
  assert.ok(appJs.includes("annualTimelineChecks.replaceChildren"));
});

console.log("\n--- 6. 紫微可用月份要展示四化与流曜 ---");
check("整体不可用时逐月沿用上层原因", () => {
  const bazi = {
    target_year: 2026,
    annual: { year: 2026 },
    status: "ok",
    validation: { status: "pass", checks: [] },
    fingerprint: "x",
    months: Array.from({ length: 12 }, (_, i) => ({
      index: i + 1,
      ganzhi: "丙寅",
      gan: "丙",
      zhi: "寅",
      jie: "立春",
      next_jie: "惊蛰",
      start: `2026-${String(i + 2).padStart(2, "0")}-01T00:00:00+08:00`,
      end: `2026-${String(i + 3 > 12 ? 1 : i + 3).padStart(2, "0")}-01T00:00:00+08:00`,
      relations: [],
      relation_count: 0
    }))
  };
  const reason = "未知时辰，未建立紫微盘；本年度时间轴的紫微部分整体不可用。";
  const pkg = Timeline.build({
    baziMonthly: bazi,
    ziweiMonthly: { status: "unavailable", months: [] },
    targetYear: 2026,
    ziweiBlockedReason: reason
  });
  assert.strictEqual(pkg.months[0].ziwei.reason, reason);
  assert.ok(Timeline.describeMonth(pkg.months[0]).ziwei.includes("未知时辰"));
});

check("可用月份的明细含四化/流曜/叠宫实际内容", () => {
  const view = Timeline.describeMonth({
    index: 3,
    coordinate: { jie: "清明", start: "s", end: "e", endSource: { jie: "立夏" } },
    bazi: { ganzhi: "甲辰", relationCount: 5, luck: luckOk },
    ziwei: {
      status: "ok",
      ganzhi: "庚寅",
      lunarMonth: "七月",
      fourTransformations: {
        status: "validated",
        value: [{ kind: "禄", star: "太阳", natalPalace: "命宫", monthlyPalace: "迁移" }],
        reason: null,
        source: "s"
      },
      transitStars: {
        status: "validated",
        value: [{ name: "流昌", natalPalace: "命宫", periodPalace: "官禄" }],
        reason: null,
        source: "s"
      },
      palaceOverlay: {
        status: "validated",
        value: [{ branch: "子", natalPalace: "命宫", monthlyPalace: "财帛" }],
        reason: null,
        source: "s"
      }
    },
    evidence: []
  });
  assert.ok(view.ziweiDetails);
  assert.strictEqual(view.ziweiDetails.fourTransformations[0].star, "太阳");
  assert.strictEqual(view.ziweiDetails.fourTransformations[0].monthlyPalace, "迁移");
  assert.strictEqual(view.ziweiDetails.transitStars[0].name, "流昌");
  assert.strictEqual(view.ziweiDetails.palaceOverlay[0].monthlyPalace, "财帛");
});
check("不可用月份没有明细", () => {
  const view = Timeline.describeMonth({
    index: 1,
    coordinate: { jie: "立春", start: "s", end: "e", endSource: { jie: "惊蛰" } },
    bazi: { ganzhi: "庚寅", relationCount: 0, luck: null },
    ziwei: { status: "unavailable", reason: "未知时辰" },
    evidence: []
  });
  assert.strictEqual(view.ziweiDetails, null);
});
check("app.js 用折叠块渲染紫微明细", () => {
  assert.ok(appJs.includes("annual-timeline-month-details"));
  assert.ok(appJs.includes("annual-timeline-four-hua"));
  assert.ok(appJs.includes("annual-timeline-transit-star"));
  assert.ok(appJs.includes("annual-timeline-overlay"));
});
check("ok 月份展示流月、农历、四化、流曜、叠宫", () => {
  const view = Timeline.describeMonth({
    index: 3,
    coordinate: { jie: "清明", start: "s", end: "e", endSource: { jie: "立夏" } },
    bazi: { ganzhi: "甲辰", relationCount: 5, luck: luckOk },
    ziwei: {
      status: "ok",
      ganzhi: "庚寅",
      lunarMonth: "七月",
      fourTransformations: {
        status: "validated",
        value: [{ kind: "禄", star: "太阳" }, { kind: "忌", star: "太阴" }],
        reason: null,
        source: "s"
      },
      transitStars: { status: "validated", value: [{ name: "流昌" }], reason: null, source: "s" },
      palaceOverlay: {
        status: "validated",
        value: Array.from({ length: 12 }, (_, i) => ({ monthlyPalace: `宫${i}` })),
        reason: null,
        source: "s"
      }
    },
    evidence: []
  });
  assert.ok(view.ziwei.includes("流月 庚寅"));
  assert.ok(view.ziwei.includes("农历 七月"));
  assert.ok(view.ziwei.includes("四化 禄太阳 忌太阴"));
  assert.ok(view.ziwei.includes("流曜 1"));
  assert.ok(view.ziwei.includes("叠宫 12"));
});

console.log(`\n===== ${passed} 项全部通过 =====`);

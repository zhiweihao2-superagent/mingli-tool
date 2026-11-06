// 生成「真实紫微流月」夹具：用仓库自带的 iztro 引擎跑真排盘，再走产品自己的
// MingliZiweiFacts.buildMonthlyTiming，把结果落盘给前端测试用。
//
// 为什么需要它：annual_timeline_real.test.cjs 原先只喂真实八字 + **假的**「紫微不可用」，
// 「紫微可用/不可用」这条线上没有一份真数据。真数据下紫微流月会因
// 「节气月横跨两个农历月」被判 unverifiable —— 这是设计而非缺陷，必须用测试钉住，
// 免得以后有人为了"让它变绿"去放宽坐标校验。
//
// 用法（仓库根目录）：node scripts/generate_ziwei_fixtures.cjs

const path = require("node:path");
const { writeFileSync, readFileSync } = require("node:fs");

const ROOT = path.join(__dirname, "..");

// vendor 包是浏览器 UMD 包，node 里需要补 browser 全局；它走 module.exports 分支
globalThis.self = globalThis;
globalThis.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));

require(path.join(ROOT, "web", "ziwei-facts.js"));
require(path.join(ROOT, "web", "ziwei-adapter.js"));
require(path.join(ROOT, "web", "annual-timeline.js"));

const Z = globalThis.MingliZiwei;
const F = globalThis.MingliZiweiFacts;
const T = globalThis.MingliAnnualTimeline;

const PROFILE = {
  calendar: "solar",
  date: "1990-05-15",
  time: { precision: "minute", value: "12:30" },
  sex_for_calculation: "male",
  is_leap_month: false
};

function main() {
  const baziMonthly = JSON.parse(
    readFileSync(path.join(ROOT, "tests", "fixtures", "monthly-real-minute.json"), "utf8")
  );
  const chart = Z.calculate(PROFILE, { asOfYear: baziMonthly.target_year });
  if (chart.status !== "ok") {
    throw new Error(`紫微排盘失败：${JSON.stringify(chart.reason || chart.error)}`);
  }
  const timeIndex = Z.resolveTimeIndex(PROFILE.time);
  const specs = T.monthSpecsFrom(baziMonthly);
  const monthly = F.buildMonthlyTiming(chart.astrolabe, chart.palaces, specs, timeIndex.index);

  // 只保留装配层会读的字段：四态明细里的星曜列表对本测试无意义，留着会让夹具涨到几百 KB
  const lean = {
    status: monthly.status,
    months: (monthly.months || []).map((month) => ({
      index: month.index,
      status: month.status,
      reason: month.reason,
      coordinateAligned: month.coordinateAligned,
      coordinateBasis: month.coordinateBasis,
      coordinateNote: month.coordinateNote,
      // 按月切段：段区间、天数与主段标记都要进夹具，测试才能核对契约
      segments: (month.segments || []).map(seg => ({
        index: seg.index,
        from: seg.from,
        to: seg.to,
        days: seg.days,
        isDominant: seg.isDominant,
        lunarMonthSignature: seg.lunarMonthSignature,
        // 段级字段与证据路径也要进夹具，测试才能核对"每段有自己的四化/叠宫/流曜"
        asOfDate: seg.asOfDate ?? null,
        lunarDate: seg.lunarDate ?? null,
        lunarMonth: seg.lunarMonth ?? null,
        ganzhi: seg.ganzhi ?? null,
        name: seg.name ?? null,
        validationStatus: seg.validationStatus ?? null,
        fieldStatuses: seg.fieldStatuses || null,
        // 严格以源值 === true 为准：缺失或非布尔一律视为未验证
        verified: seg.verified === true,
        evidenceId: seg.evidenceId ?? null,
        jsonPointer: seg.jsonPointer ?? null,
        fieldPointers: seg.fieldPointers || null,
        // 指针指向的字段必须真的在夹具里，否则 /…/segments/0/fourTransformations 解不出来
        palaceOverlay: {
          status: seg.palaceOverlay?.status ?? "unavailable",
          value: null,
          reason: seg.palaceOverlay?.reason ?? null,
          source: seg.palaceOverlay?.source ?? null,
        },
        fourTransformations: {
          status: seg.fourTransformations?.status ?? "unavailable",
          value: null,
          reason: seg.fourTransformations?.reason ?? null,
          source: seg.fourTransformations?.source ?? null,
        },
        transitStars: {
          status: seg.transitStars?.status ?? "unavailable",
          value: null,
          reason: seg.transitStars?.reason ?? null,
          source: seg.transitStars?.source ?? null,
        }
      })),
      segmentCount: month.segmentCount ?? (month.segments || []).length,
      coverage: month.coverage ?? null,
      sampleDates: month.sampleDates,
      lunarMonth: month.lunarMonth,
      lunarDate: month.lunarDate,
      baziGanzhi: month.baziGanzhi,
      ganzhi: month.ganzhi,
      // checks 必须保留：清空后装配层重新判定时拿不到 pass 标记，
      // 顶层字段会从 validated 掉成 failed，和段级结果对不上。
      validation: {
        status: month.validation?.status ?? null,
        checks: (month.validation?.checks || []).map(check => ({
          id: check.id,
          pass: check.pass === true,
          note: check.note ?? null
        })),
        hardFailures: month.validation?.hardFailures || []
      },
      validationStatus: month.validationStatus ?? month.validation?.status ?? null,
      fieldStatuses: month.fieldStatuses || null,
      palaceOverlay: {
        status: month.palaceOverlay?.status ?? "unavailable",
        value: null,
        reason: month.palaceOverlay?.reason ?? null,
        source: month.palaceOverlay?.source ?? null
      },
      fourTransformations: {
        status: month.fourTransformations?.status ?? "unavailable",
        value: null,
        reason: month.fourTransformations?.reason ?? null,
        source: month.fourTransformations?.source ?? null
      },
      transitStars: {
        status: month.transitStars?.status ?? "unavailable",
        value: null,
        reason: month.transitStars?.reason ?? null,
        source: month.transitStars?.source ?? null
      },
    }))
  };

  const out = path.join(ROOT, "tests", "fixtures", "ziwei-monthly-real.json");
  writeFileSync(out, JSON.stringify(lean, null, 2, ) + "\n", "utf8");
  const statuses = [...new Set(lean.months.map((m) => m.status))];
  console.log(
    `ziwei-monthly-real.json: months=${lean.months.length} status=${statuses.join(",")} 首个原因=${lean.months[0]?.reason}`
  );
}

main();

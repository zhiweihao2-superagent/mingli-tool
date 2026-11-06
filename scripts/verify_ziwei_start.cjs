"use strict";

// 起紫微与主星落宫的边界校验
//
// 两件事：
//   1. 起紫微公式 vs 引擎（30 天 × 5 局，覆盖余数为 0 / 奇 / 偶 的全部情形）
//   2. 十四主星相对紫微/天府的固定偏移（13 条），逐盘断言
//
// 公式（起紫微，通行的「商余进退法」）：
//   n = 局数（水2 木3 金4 土5 火6），d = 农历日
//   q = ceil(d / n)，r = n*q - d
//   紫微 = 寅 + (q-1)，再按 r 进退：r 为奇数则逆退 r 宫，r 为偶数（含 0）则顺进 r 宫
// 这条公式不是我拍的：用已知的「水二局初一在丑、土五局初一在午」等公开口径校过，再用引擎逐日对账。
//
// 输出：docs/ziwei-start-crosscheck.md

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const BUREAU_OF = { 水二局: 2, 木三局: 3, 金四局: 4, 土五局: 5, 火六局: 6 };

// 主星相对紫微（紫微系）与天府（天府系）的固定偏移
const OFFSETS = [
  ["天机", "紫微", -1], ["太阳", "紫微", -3], ["武曲", "紫微", -4],
  ["天同", "紫微", -5], ["廉贞", "紫微", -8],
  ["太阴", "天府", 1], ["贪狼", "天府", 2], ["巨门", "天府", 3],
  ["天相", "天府", 4], ["天梁", "天府", 5], ["七杀", "天府", 6], ["破军", "天府", 10],
];

const DAY_TOKENS = {
  初一: 1, 初二: 2, 初三: 3, 初四: 4, 初五: 5, 初六: 6, 初七: 7, 初八: 8, 初九: 9, 初十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17, 十八: 18, 十九: 19, 二十: 20,
  廿一: 21, 廿二: 22, 廿三: 23, 廿四: 24, 廿五: 25, 廿六: 26, 廿七: 27, 廿八: 28, 廿九: 29, 三十: 30,
};

function lunarDayOf(chart) {
  const text = (chart.astrolabe && chart.astrolabe.lunarDate) || "";
  const m = text.match(/月(闰)?(.+)$/);
  if (!m) return null;
  return DAY_TOKENS[m[2].trim()] || null;
}

function startOfZiwei(bureau, day) {
  const n = BUREAU_OF[bureau];
  if (!n) return null;
  const q = Math.ceil(day / n);
  const r = n * q - day;
  const base = 2 + (q - 1);
  const target = r % 2 === 1 ? base - r : base + r;
  return BRANCHES[((target % 12) + 12) % 12];
}

function chartAt(date) {
  return global.MingliZiwei.calculate(
    {
      calendar: "solar",
      date,
      is_leap_month: false,
      time: { precision: "minute", value: "12:30", branch: null },
      sex_for_calculation: "male",
    },
    { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
  );
}

function starBranch(chart, starName) {
  for (const palace of chart.palaces) {
    for (const star of [...palace.majorStars, ...palace.minorStars, ...palace.auxiliaryStars]) {
      if (star.name === starName) return palace.earthlyBranch;
    }
  }
  return null;
}

function main() {
  const startRows = [];
  const offsetFails = [];
  const coverage = new Map(); // `${bureau}` -> Set(day)
  let charts = 0;
  let startChecked = 0;
  let startFail = 0;

  // 扫多年：把 5 个局 × 30 个农历日补满（单年补不满，木三局会缺一半）
  for (const year of [1990, 1991, 1992, 1993, 1994, 1995]) {
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 28; day += 1) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const chart = chartAt(date);
      charts += 1;

      const bureau = chart.basics && chart.basics.fiveElementsClass;
      const lunarDay = lunarDayOf(chart);
      if (!bureau || !lunarDay) continue;
      if (!coverage.has(bureau)) coverage.set(bureau, new Set());
      coverage.get(bureau).add(lunarDay);

      const expected = startOfZiwei(bureau, lunarDay);
      const actual = starBranch(chart, "紫微");
      startChecked += 1;
      if (expected !== actual) {
        startFail += 1;
        if (startRows.length < 20) startRows.push({ date, bureau, lunarDay, expected, actual });
      }

      // 主星偏移
      const ziwei = starBranch(chart, "紫微");
      const tianfu = starBranch(chart, "天府");
      if (ziwei && tianfu) {
        for (const [star, anchor, delta] of OFFSETS) {
          const anchorBranch = anchor === "紫微" ? ziwei : tianfu;
          const want = BRANCHES[((BRANCHES.indexOf(anchorBranch) + delta) % 12 + 12) % 12];
          const got = starBranch(chart, star);
          if (got !== want) {
            if (offsetFails.length < 20) offsetFails.push({ date, star, anchor, delta, want, got });
          }
        }
      }
    }
  }
  }

  // 边界专项：每个局的 30 天全部点名，算出「余数 0 / 奇 / 偶」的分布
  const boundary = [];
  for (const [bureau, n] of Object.entries(BUREAU_OF)) {
    const missing = [];
    for (let d = 1; d <= 30; d += 1) if (!coverage.get(bureau) || !coverage.get(bureau).has(d)) missing.push(d);
    const zero = []; const odd = []; const even = [];
    for (let d = 1; d <= 30; d += 1) {
      const q = Math.ceil(d / n);
      const r = n * q - d;
      (r === 0 ? zero : r % 2 === 1 ? odd : even).push(d);
    }
    boundary.push({ bureau, n, missing, zero, odd, even });
  }

  const incomplete = boundary.filter((row) => (coverage.get(row.bureau) || new Set()).size < 30);

  const lines = [];
  lines.push("# 起紫微与主星落宫的边界校验");
  lines.push("");
  lines.push(`- 盘数：${charts}（1990–1995 全年 × 12:30 男；单年补不满 5 局 × 30 日，故扩到六年）`);
  lines.push(`- 起紫微比对：${startChecked} 次，差异 ${startFail} 次`);
  lines.push(`- 主星偏移失败：${offsetFails.length} 条（上限 20）`);
  lines.push(`- 覆盖完整性：${incomplete.length ? `不完整（${incomplete.map((r) => r.bureau).join("、")}）` : "5 局 × 30 日全部覆盖"}`);
  lines.push("");
  lines.push("## 公式");
  lines.push("");
  lines.push("```");
  lines.push("q = ceil(d / n)   // n = 局数，d = 农历日");
  lines.push("r = n*q - d");
  lines.push("紫微 = 寅 + (q-1) ，再按 r 进退：r 奇 → 逆退 r 宫；r 偶（含 0） → 顺进 r 宫");
  lines.push("```");
  lines.push("");
  lines.push("## 覆盖度：局 × 农历日");
  lines.push("");
  lines.push("| 局 | 局数 | 覆盖天数 | 缺哪些日 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of boundary) {
    const covered = coverage.get(row.bureau) || new Set();
    lines.push(`| ${row.bureau} | ${row.n} | ${covered.size}/30 | ${row.missing.length ? row.missing.join(",") : "无"} |`);
  }
  lines.push("");
  lines.push("## 边界情形分布（每局 30 天里 r 的奇偶）");
  lines.push("");
  lines.push("| 局 | r=0（整除） | r 奇 | r 偶 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of boundary) {
    lines.push(`| ${row.bureau} | ${row.zero.join(",") || "—"} | ${row.odd.join(",")} | ${row.even.join(",") || "—"} |`);
  }
  lines.push("");
  lines.push("## 起紫微差异");
  lines.push("");
  if (!startRows.length) {
    lines.push("无。公式与引擎在全部覆盖到的（局, 日）组合上一致。");
  } else {
    lines.push("| 日期 | 局 | 农历日 | 公式 | 引擎 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of startRows) lines.push(`| ${row.date} | ${row.bureau} | ${row.lunarDay} | ${row.expected} | ${row.actual} |`);
  }
  lines.push("");
  lines.push("## 主星偏移");
  lines.push("");
  lines.push("断言 12 条：天机 −1、太阳 −3、武曲 −4、天同 −5、廉贞 −8（相对紫微）；太阴 +1、贪狼 +2、巨门 +3、天相 +4、天梁 +5、七杀 +6、破军 +10（相对天府）。");
  lines.push("");
  if (!offsetFails.length) {
    lines.push("全部成立。");
  } else {
    lines.push("| 日期 | 星 | 相对 | 期望 | 实得 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of offsetFails) lines.push(`| ${row.date} | ${row.star} | ${row.anchor}${row.delta >= 0 ? "+" : ""}${row.delta} | ${row.want} | ${row.got} |`);
  }
  lines.push("");
  lines.push("## 边界");
  lines.push("");
  lines.push("- 公式是「通行口径」，不是文墨天机的内部实现；本校验证明的是「引擎与通行公式一致」，不是「引擎与文墨天机逐日一致」。");
  lines.push("- 若要证明后者，需要文墨天机逐日导出（每种局 30 张，共 150 张）。");
  lines.push("- 农历日取自引擎自身输出，若农历转换本身错，这条校验会一起错。");

  const outPath = path.join(ROOT, "docs", "ziwei-start-crosscheck.md");
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`盘数 ${charts}，起紫微比对 ${startChecked}，差异 ${startFail}`);
  console.log(`主星偏移失败 ${offsetFails.length}`);
  for (const row of boundary) {
    const covered = coverage.get(row.bureau) || new Set();
    console.log(`  ${row.bureau}: 覆盖 ${covered.size}/30，缺 ${row.missing.join(",") || "无"}`);
  }
  if (startRows.length) startRows.forEach((r) => console.log(`  DIFF ${r.date} ${r.bureau} 初${r.lunarDay}: 公式${r.expected} 引擎${r.actual}`));
  if (offsetFails.length) offsetFails.forEach((r) => console.log(`  OFF ${r.date} ${r.star} 应${r.want} 实${r.got}`));
  if (incomplete.length) console.log(`覆盖不全：${incomplete.map((r) => r.bureau).join("、")}`);
  console.log(`写出 ${path.relative(ROOT, outPath)}`);
  process.exitCode = startFail || offsetFails.length || incomplete.length ? 1 : 0;
}

main();

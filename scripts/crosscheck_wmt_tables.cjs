"use strict";

// 用文墨天机（AIR 包）里抽出的常量表，对账我们引擎的生年四化与天魁天钺。
//
// 输入：.pair/wmt/tables.json（由 .pair/wmt/extract_tables.py 从 GlobalConsts.as 抽出）
// 输出：docs/wmt-crosscheck.md + 控制台摘要
//
// 说明：
//   - 文墨天机里 _AX_SHB_ARR 行 0 占位，行 1..10 = 甲..癸，列 = 禄/权/科/忌 的星曜索引
//   - _AX_KY_ARR1 是「六辛逢虎马（默认）」；ARR2..4 是另外三派
//   - 支序 1=子 … 12=亥

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

const TABLES_PATH = path.join(ROOT, "knowledge", "wmt", "tables.json");
const LEGACY_TABLES_PATH = path.join(ROOT, ".pair", "wmt", "tables.json");
const tablesPath = fs.existsSync(TABLES_PATH) ? TABLES_PATH : LEGACY_TABLES_PATH;
const tables = JSON.parse(fs.readFileSync(tablesPath, "utf8"));

const STEMS = ["", "甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BRANCHES = ["", "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const KINDS = ["", "禄", "权", "科", "忌"];

const stars = tables.stars_noWrap_CHS || [];
const shb = tables._AX_SHB_ARR || [];
const kySets = {
  "六辛逢虎马（默认）": tables._AX_KY_ARR1,
  "庚辛逢马虎": tables._AX_KY_ARR2,
  "庚辛逢虎马": tables._AX_KY_ARR3,
  "六辛逢马虎": tables._AX_KY_ARR4,
};

const starName = (index) => stars[index] || `#${index}`;

const YEARS = [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999];
const BASE_INPUT = {
  calendar: "solar",
  date: "",
  is_leap_month: false,
  time: { precision: "minute", value: "12:30", branch: null },
  sex_for_calculation: "male",
};

function huaOf(chart) {
  const found = {};
  for (const palace of chart.palaces) {
    for (const star of [...palace.majorStars, ...palace.minorStars, ...palace.auxiliaryStars]) {
      if (star.transformation && KINDS.includes(star.transformation)) {
        found[star.transformation] = { star: star.name, palace: palace.name };
      }
    }
  }
  return found;
}

function kuiYueOf(chart) {
  const out = {};
  for (const palace of chart.palaces) {
    for (const star of [...palace.majorStars, ...palace.minorStars, ...palace.auxiliaryStars]) {
      if (star.name === "天魁" || star.name === "天钺") out[star.name] = palace.earthlyBranch;
    }
  }
  return out;
}

function main() {
  const rows = [];
  let huaOk = 0;
  let huaFail = 0;
  let kyOk = 0;
  let kyFail = 0;

  for (const year of YEARS) {
    const input = { ...BASE_INPUT, date: `${year}-05-15` };
    const chart = global.MingliZiwei.calculate(input, { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 });
    const stem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
    const stemIndex = STEMS.indexOf(stem);
    const engineHua = huaOf(chart);
    const engineKy = kuiYueOf(chart);

    const tableHua = {};
    (shb[stemIndex] || []).forEach((starIdx, i) => {
      if (i === 0) return;
      tableHua[KINDS[i]] = starName(starIdx);
    });

    const huaDiffs = KINDS.slice(1).filter((k) => (engineHua[k] || {}).star !== tableHua[k]);
    huaDiffs.length === 0 ? huaOk++ : huaFail++;

    const tableKy = (kySets["六辛逢虎马（默认）"] || [])[stemIndex] || [];
    const kyDiffs = [
      ["天魁", BRANCHES[tableKy[0]]],
      ["天钺", BRANCHES[tableKy[1]]],
    ].filter(([star, branch]) => engineKy[star] !== branch);
    kyDiffs.length === 0 ? kyOk++ : kyFail++;

    const variants = Object.fromEntries(
      Object.entries(kySets).map(([label, set]) => {
        const row = (set || [])[stemIndex] || [];
        return [label, `${BRANCHES[row[0]]}${BRANCHES[row[1]]}`];
      }),
    );

    rows.push({
      year,
      stem,
      hua: KINDS.slice(1).map((k) => `${k}${(engineHua[k] || {}).star || "?"}`).join(" "),
      huaDiffs,
      kuiYue: `魁${engineKy["天魁"] || "?"}钺${engineKy["天钺"] || "?"}`,
      tableKuiYue: `魁${BRANCHES[tableKy[0]] || "?"}钺${BRANCHES[tableKy[1]] || "?"}`,
      kyDiffs,
      variants,
    });
  }

  const lines = [];
  lines.push("# 文墨天机常量表 × 本引擎对账");
  lines.push("");
  lines.push("来源：`.pair/wmt/tables.json`（从 `文墨天机电脑版_Win_2.0.15` 的 `ZWDesktop.swf` 里 `GlobalConsts.as` 抽出）");
  lines.push("");
  lines.push("对账项：");
  lines.push("- `_AX_SHB_ARR`（生年四化表，行=年干）");
  lines.push("- `_AX_KY_ARR1`（天魁天钺，默认口径「六辛逢虎马」）");
  lines.push("");
  lines.push("## 逐年结果");
  lines.push("");
  lines.push("| 年 | 年干 | 本引擎四化（禄权科忌） | 表四化差异 | 本引擎魁钺 | 表魁钺 | 魁钺差异 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.year} | ${row.stem} | ${row.hua} | ${row.huaDiffs.length ? row.huaDiffs.join("、") : "—"} | ${row.kuiYue} | ${row.tableKuiYue} | ${row.kyDiffs.length ? row.kyDiffs.map(([s, b]) => `${s}表${b}`).join("、") : "—"} |`,
    );
  }
  lines.push("");
  lines.push("## 魁钺四派在同一张年干下的分歧");
  lines.push("");
  lines.push("| 年 | 年干 | " + Object.keys(kySets).join(" | ") + " |");
  lines.push("| --- | --- | " + Object.keys(kySets).map(() => "---").join(" | ") + " |");
  for (const row of rows) {
    lines.push(`| ${row.year} | ${row.stem} | ${Object.values(row.variants).join(" | ")} |`);
  }
  lines.push("");
  lines.push("## 汇总");
  lines.push("");
  lines.push(`- 生年四化：${huaOk} 年一致、${huaFail} 年有差异（共 ${YEARS.length} 年）`);
  lines.push(`- 天魁天钺（默认口径）：${kyOk} 年一致、${kyFail} 年有差异`);
  lines.push("");
  lines.push("注：本对账只覆盖「表驱动」的两项。命宫、五行局、十四主星落宫需要文墨天机的排盘算法，表本身给不出来。");

  const md = lines.join("\n");
  const out = path.join(ROOT, "docs", "wmt-crosscheck.md");
  fs.writeFileSync(out, md + "\n", "utf8");
  console.log(md);
  console.log(`\nwritten: ${out} (${md.length} chars)`);
}

main();

"use strict";

// 紫微盘级不变量校验（不依赖文墨天机 GUI，也不自造第二份引擎）
//
// 思路：把「任何正确实现都必然满足」的关系写成断言，扫 120 组盘（10 年干 × 12 月令）
// 再叠加 12 时辰，任一条不成立就是引擎或我们的读取出问题。
// 与 crosscheck_wmt_tables.cjs 的分工：
//   - crosscheck 管「表对不对」（年干→四化、年干→魁钺），数据源是文墨天机常量表；
//   - 本脚本管「盘对不对」（宫位/星曜/局数/大限/身宫），数据源是物理与历法约束。
//
// 输出：docs/engine-invariants.md + 控制台摘要

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

const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const KINDS = ["禄", "权", "科", "忌"];
const MAJOR14 = [
  "紫微", "天机", "太阳", "武曲", "天同", "廉贞",
  "天府", "太阴", "贪狼", "巨门", "天相", "天梁", "七杀", "破军",
];
const JU_BY_ELEMENT = { 水: "水二局", 木: "木三局", 金: "金四局", 土: "土五局", 火: "火六局" };
// 小限起宫：文墨 GlobalConsts._AX_XIAOXIAN_ARR（下标 1=子）→ 申子辰见戌、巳酉丑见未、寅午戌见辰、亥卯未见丑
const XIAOXIAN_START = {
  子: "戌", 丑: "未", 寅: "辰", 卯: "丑", 辰: "戌", 巳: "未",
  午: "辰", 未: "丑", 申: "戌", 酉: "未", 戌: "辰", 亥: "丑",
};

const branchIndex = (branch) => BRANCHES.indexOf(branch);
const stemIndex = (stem) => STEMS.indexOf(stem);

// 六十甲子序号（1..60）：n % 10 == stemIdx、n % 12 == branchIdx（以 0 基计）
function sexagenary(stem, branch) {
  const s = stemIndex(stem);
  const b = branchIndex(branch);
  if (s < 0 || b < 0) return 0;
  for (let n = 1; n <= 60; n += 1) {
    if ((n - 1) % 10 === s && (n - 1) % 12 === b) return n;
  }
  return 0;
}

// 文墨天机的纳音表不是按甲子序排列，而是 [干支, 纳音, ...] 的行；建一份映射再用
const naYinMap = new Map();
for (const row of tables._naYinArr_CHS || []) {
  if (Array.isArray(row) && row.length >= 2) naYinMap.set(row[0], row[1]);
}
const nayinOf = (stem, branch) => naYinMap.get(`${stem}${branch}`) || null;

// 农历月：命宫的「生月」用的是农历月，不是公历月
const LUNAR_MONTH_TOKENS = {
  正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 冬: 11, 腊: 12,
};
// 返回 { month, leap }；闰月的排盘口径由 leapEffectiveMonth 决定
function lunarMonthOf(chart) {
  const text = (chart.astrolabe && chart.astrolabe.lunarDate) || "";
  const m = text.match(/年(闰)?([正一二三四五六七八九十冬腊]{1,2})月/);
  if (!m) return null;
  const value = LUNAR_MONTH_TOKENS[m[2]];
  if (!value) return null;
  return { month: value, leap: Boolean(m[1]) };
}

// 本引擎（iztro）对闰月的口径：月中分界——闰月 1–15 日作本月、16 日以后作下月。
// 依据：bundle 内 fixLunarMonthIndex 为 `r+1-h+(u && t && o>15 ? 1 : 0)`，
// 即 fixLeap=true 只在农历日 > 15 时才进位；与文墨天机默认口径一致。
function effectiveMonthOf(chart) {
  const policy = chart.leapMonthPolicy || null;
  if (policy && policy.valid === false) return null;
  const info = lunarMonthOf(chart);
  if (!info || !Number.isInteger(info.month) || info.month < 1 || info.month > 12) return null;
  if (!info.leap) return info.month;
  const day = policy ? policy.lunarDay : null;
  if (!Number.isInteger(day) || day < 1 || day > 30) return null;
  // 闰十二月 + 1 要回绕成正月（r739 #5）
  return day > 15 ? (info.month % 12) + 1 : info.month;
}
const stars = tables.stars_noWrap_CHS || [];
const shb = tables._AX_SHB_ARR || [];
const ky = tables._AX_KY_ARR1 || [];

function starHua(chart) {
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

function allStars(chart) {
  const out = [];
  for (const palace of chart.palaces) {
    for (const star of [...palace.majorStars, ...palace.minorStars, ...palace.auxiliaryStars]) {
      out.push({ name: star.name, palace: palace.name, branch: palace.earthlyBranch });
    }
  }
  return out;
}

function findPalaceOf(chart, starName) {
  const hit = allStars(chart).find((s) => s.name === starName);
  return hit ? hit.palace : null;
}

function palaceByName(chart, name) {
  return chart.palaces.find((p) => p.name === name) || null;
}

// 时支序号（子=0）：取四柱里的时柱地支
function hourIndexOf(chart) {
  const parts = ((chart.astrolabe && chart.astrolabe.chineseDate) || "").split(" ");
  const hourPillar = parts[3] || "";
  const branch = hourPillar.slice(1, 2);
  const idx = branchIndex(branch);
  return idx >= 0 ? idx : null;
}

function decadalListOf(chart) {
  const list = chart.astrolabe && chart.astrolabe.decadalList;
  if (typeof list === "function") return list.call(chart.astrolabe);
  return Array.isArray(list) ? list : [];
}

// 独立成具名函数，便于测试直接用「人造盘面」验证口径（真实盘造不出错误策略）。
function leapMonthRuleCheck(chart) {
  const policy = chart.leapMonthPolicy || null;
  if (!policy) return "缺少 leapMonthPolicy，无法核对闰月口径";
  // 字段存在性必须先判：若先看 valid===false 就提前返回，
  // 「缺 treatedAsMonth」会被 invalidReason 掩盖（Codex r739 major）。
  if (policy.treatedAsMonth === undefined) return "策略缺少 treatedAsMonth";
  if (typeof policy.isLeapMonth !== "boolean") {
    return `策略 isLeapMonth 不是布尔值：${String(policy.isLeapMonth)}`;
  }
  // 不从调用方给的 valid 出发：先独立按字段推导，再反过来核对 valid 是否自洽。
  // 否则「合法输入 + valid=false」会被当成真实非法输入放过（Codex r740 major）。
  const monthOk = typeof policy.lunarMonth === "number"
    && Number.isInteger(policy.lunarMonth) && policy.lunarMonth >= 1 && policy.lunarMonth <= 12;
  const dayOk = typeof policy.lunarDay === "number"
    && Number.isInteger(policy.lunarDay) && policy.lunarDay >= 1 && policy.lunarDay <= 30;
  const derivedValid = monthOk && dayOk;
  if (policy.valid !== derivedValid) {
    return `策略 valid=${String(policy.valid)}，但按字段推导应为 ${derivedValid}（lunarMonth=${String(policy.lunarMonth)}、lunarDay=${String(policy.lunarDay)}）`;
  }
  // 只归一化「非法的那一个」：合法字段必须保留原值（r741 major）。
  if (!monthOk && policy.lunarMonth !== null) return `农历月非法时应归一化为 null，实为 ${String(policy.lunarMonth)}`;
  if (!dayOk && policy.lunarDay !== null) return `农历日非法时应归一化为 null，实为 ${String(policy.lunarDay)}`;
  if (!derivedValid) {
    if (policy.treatedAsMonth !== null) {
      return `农历元数据非法，treatedAsMonth 应为 null，实为 ${policy.treatedAsMonth}`;
    }
    if (policy.treatedAsNextMonth !== false) return "农历元数据非法时不得标记进位作下月";
    return policy.invalidReason || "闰月策略标记为非法，但未给出原因";
  }
  const info = lunarMonthOf(chart);
  // 闰月盘的农历月日必须解析得出来；解析失败不再当作「不适用」放过（r739 #6）
  if (!info) return "无法从 lunarDate 解析农历月";
  if (policy.lunarMonth !== info.month) {
    return `策略农历月(${policy.lunarMonth})与盘面(${info.month})不一致`;
  }
  // 分界日写死 15：它是本项目采用的口径，不是调用方可调的参数。
  // 若允许读记录自带的 splitDay，把 30 写进去就能让「闰五月十六不进位」自洽通过（r741 major）。
  const splitDay = 15;
  if (policy.splitDay !== undefined && policy.splitDay !== splitDay) {
    return `闰月分界日必须固定为 ${splitDay}，策略里是 ${String(policy.splitDay)}`;
  }
  // 期望值完全由字段算出，不引用 policy.treatedAsNextMonth 自身
  const derivedNext = policy.isLeapMonth === true && policy.lunarDay > splitDay;
  const derivedMonth = derivedNext ? (policy.lunarMonth % 12) + 1 : policy.lunarMonth;
  if (policy.treatedAsNextMonth !== derivedNext) {
    return `闰月策略 treatedAsNextMonth=${String(policy.treatedAsNextMonth)}，按字段应为 ${derivedNext}（isLeap=${policy.isLeapMonth}、day=${policy.lunarDay}、分界=${splitDay}）`;
  }
  if (policy.treatedAsMonth !== derivedMonth) {
    return `闰月策略 treatedAsMonth=${String(policy.treatedAsMonth)}，按字段应为 ${derivedMonth}`;
  }
  if (!info.leap) {
    // 普通月：策略必须是「不进位、作本月」
    if (policy.isLeapMonth !== false) return "普通月却被标成闰月";
    if (policy.treatedAsNextMonth !== false) return "普通月却标记为进位作下月";
    if (policy.treatedAsMonth !== info.month) {
      return `普通月 treatedAsMonth=${policy.treatedAsMonth}，应为 ${info.month}`;
    }
    return null;
  }
  const soul = palaceByName(chart, "命宫");
  if (!soul) return "未找到命宫";
  // 盘面已解析成闰月，策略必须同样标成闰月，否则两者不是同一口径（r740）
  if (policy.isLeapMonth !== true) return "盘面为闰月，但策略 isLeapMonth 不是 true";
  const hourIndex = hourIndexOf(chart);
  if (hourIndex == null) return "无法取时支";
  const expectNext = derivedNext;
  const expectMonth = derivedMonth;
  if (policy.treatedAsNextMonth !== expectNext) {
    return `闰${info.month}月${policy.lunarDay}日 treatedAsNextMonth=${policy.treatedAsNextMonth}，应为 ${expectNext}`;
  }
  if (policy.treatedAsMonth !== expectMonth) {
    return `闰${info.month}月${policy.lunarDay}日 treatedAsMonth=${policy.treatedAsMonth}，应为 ${expectMonth}`;
  }
  const expectSoul = ((2 + (expectMonth - 1) - hourIndex) % 12 + 12) % 12;
  const actual = branchIndex(soul.earthlyBranch);
  if (actual === expectSoul) return null;
  const asThis = ((2 + (info.month - 1) - hourIndex) % 12 + 12) % 12;
  const asNextMonth = info.month === 12 ? 1 : info.month + 1;
  const asNext = ((2 + (asNextMonth - 1) - hourIndex) % 12 + 12) % 12;
  return `闰${info.month}月${policy.lunarDay}日应作${expectNext ? "下月" : "本月"}（命宫${BRANCHES[expectSoul]}），实为${soul.earthlyBranch}（作本月=${asThis === actual}、作下月=${asNext === actual}）`;
}

// 校验一组盘，返回 { checks: [{id, title, total, failed, samples}], charts }
function runChecks(specs) {
  const checks = [];
  const add = (id, title, fn) => checks.push({ id, title, fn, total: 0, failed: 0, samples: [] });
  let chartCount = 0;
  const ziweiOffset = new Map();

  add("palace-branches", "十二宫地支恰为十二支各一次", (chart) => {
    const seen = chart.palaces.map((p) => p.earthlyBranch);
    if (seen.length !== 12) return `宫数 ${seen.length}`;
    const unique = new Set(seen);
    if (unique.size !== 12) return `地支重复：${seen.join("")}`;
    const missing = BRANCHES.filter((b) => !unique.has(b));
    return missing.length ? `缺地支：${missing.join("")}` : null;
  });

  add("palace-names", "十二宫宫名恰为十二宫各一次", (chart) => {
    const names = chart.palaces.map((p) => p.name);
    const unique = new Set(names);
    if (names.length !== 12 || unique.size !== 12) return `宫名异常：${names.join(" ")}`;
    return null;
  });

  add("major14-once", "十四主星各出现一次，不多不少", (chart) => {
    const majors = chart.palaces.flatMap((p) => p.majorStars.map((s) => s.name));
    const counts = new Map();
    majors.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    const bad = MAJOR14.filter((n) => counts.get(n) !== 1);
    const extra = majors.filter((n) => !MAJOR14.includes(n));
    if (bad.length) return `缺失或重复：${bad.map((n) => `${n}×${counts.get(n) || 0}`).join(" ")}`;
    if (extra.length) return `多出非十四主星：${extra.join(" ")}`;
    return null;
  });

  add("ziwei-tianfu-axis", "紫微与天府关于寅申轴对称（支位之和恒为 4）", (chart) => {
    const z = findPalaceOf(chart, "紫微");
    const t = findPalaceOf(chart, "天府");
    if (!z || !t) return "紫微或天府未定位";
    const zi = branchIndex(palaceByName(chart, z).earthlyBranch);
    const tf = branchIndex(palaceByName(chart, t).earthlyBranch);
    const sum = (zi + tf) % 12;
    return sum === 4 ? null : `紫微${BRANCHES[zi]}天府${BRANCHES[tf]}，之和${sum}，应恒为 4（寅申轴镜像：4−x）`;
  });

  add("bureau-nayin", "五行局与命宫干支纳音一致", (chart) => {
    const soul = palaceByName(chart, "命宫");
    if (!soul) return "未找到命宫";
    const nayin = nayinOf(soul.heavenlyStem, soul.earthlyBranch);
    if (!nayin) return `纳音表缺命宫干支：${soul.heavenlyStem}${soul.earthlyBranch}`;
    const element = nayin.slice(-1);
    const expected = JU_BY_ELEMENT[element];
    const actual = chart.basics && chart.basics.fiveElementsClass;
    if (!expected) return `纳音无法判元素：${nayin}`;
    if (actual !== expected) return `命宫${soul.heavenlyStem}${soul.earthlyBranch}（${nayin}）应为${expected}，实为${actual}`;
    return null;
  });

  add("soul-palace-formula", "命宫位置符合「寅起正月顺数至生月、再逆数至生时」", (chart) => {
    const soul = palaceByName(chart, "命宫");
    if (!soul) return "未找到命宫";
    const lunarMonth = effectiveMonthOf(chart);
    if (!lunarMonth) return "无法取农历月";
    const hourIndex = hourIndexOf(chart);
    if (hourIndex == null) return "无法取时支";
    const anchor = 2 + (lunarMonth - 1); // 寅=2 起正月
    const expected = BRANCHES[((anchor - hourIndex) % 12 + 12) % 12];
    return soul.earthlyBranch === expected
      ? null
      : `农历${lunarMonth}月时支${BRANCHES[hourIndex]}，应命宫${expected}，实为${soul.earthlyBranch}`;
  });

  add("body-soul-symmetry", "命宫与身宫关于「正月中点」对称", (chart) => {
    const soul = palaceByName(chart, "命宫");
    const body = chart.palaces.find((p) => p.isBodyPalace);
    if (!soul || !body) return "未找到命宫或身宫";
    const lunarMonth = effectiveMonthOf(chart);
    if (!lunarMonth) return "无法取农历月";
    const anchor = 2 + (lunarMonth - 1);
    const sum = (branchIndex(soul.earthlyBranch) + branchIndex(body.earthlyBranch)) % 12;
    const expected = (anchor * 2) % 12;
    return sum === expected
      ? null
      : `命${soul.earthlyBranch}身${body.earthlyBranch}之和${sum}，应为${expected}（农历${lunarMonth}月，中点${BRANCHES[anchor]}）`;
  });

  add("leap-month-rule", "闰月按「月中分界」计（≤15 作本月、>15 作下月）", leapMonthRuleCheck);

  add("body-palace-unique", "身宫恰有一处标记", (chart) => {
    const marked = chart.palaces.filter((p) => p.isBodyPalace);
    return marked.length === 1 ? null : `身宫标记 ${marked.length} 处`;
  });

  add("natal-hua-table", "生年四化与文墨天机常量表一致", (chart) => {
    const stem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
    const row = shb[stemIndex(stem) + 1] || [];
    const engine = starHua(chart);
    const bad = KINDS.filter((k, i) => {
      const expected = stars[row[i + 1]] || null;
      const actual = (engine[k] || {}).star || null;
      return expected !== actual;
    });
    return bad.length
      ? bad.map((k, i) => `${k}: 表${stars[row[KINDS.indexOf(k) + 1]]}/引擎${(engine[k] || {}).star}`).join("；")
      : null;
  });

  add("hua-count", "每盘恰有四个化星（禄权科忌各一）", (chart) => {
    const engine = starHua(chart);
    const missing = KINDS.filter((k) => !engine[k]);
    if (missing.length) return `缺 ${missing.join("")}`;
    const dup = KINDS.filter((k) => engine[k] && engine[k].palace == null);
    return dup.length ? `化星未落宫：${dup.join("")}` : null;
  });

  add("kui-yue-table", "天魁天钺位置与默认口径一致", (chart) => {
    const stem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
    const row = ky[stemIndex(stem) + 1] || [];
    const kui = findPalaceOf(chart, "天魁");
    const yue = findPalaceOf(chart, "天钺");
    if (!kui || !yue) return "天魁或天钺未定位";
    const kuiBranch = palaceByName(chart, kui).earthlyBranch;
    const yueBranch = palaceByName(chart, yue).earthlyBranch;
    const expectedKui = BRANCHES[(row[0] || 1) - 1];
    const expectedYue = BRANCHES[(row[1] || 1) - 1];
    return kuiBranch === expectedKui && yueBranch === expectedYue
      ? null
      : `魁${kuiBranch}钺${yueBranch}，表为魁${expectedKui}钺${expectedYue}`;
  });

  add("decadal-origin", "大限首宫即命宫，十二限覆盖十二宫", (chart) => {
    const list = decadalListOf(chart);
    const soul = palaceByName(chart, "命宫");
    if (!soul) return "未找到命宫";
    if (list.length !== 12) return `大限 ${list.length} 个`;
    if (list[0].palaceName !== "命宫") return `首个大限宫位 ${list[0].palaceName}`;
    const named = new Set(list.map((d) => d.palaceName));
    if (named.size !== 12) return `大限宫名重复：${named.size} 个`;
    const ages = list.map((d) => (d.ageRange || [])[0]);
    const bad = ages.filter((a, i) => i > 0 && a !== ages[i - 1] + 10);
    return bad.length ? `虚岁不连续：${ages.join(",")}` : null;
  });

  add("palace-stem-table", "宫干由年干五虎遁决定（寅宫起戊/甲等）", (chart) => {
    const stem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
    const s = stemIndex(stem);
    if (s < 0) return `年干非法：${stem}`;
    // 五虎遁：甲己之年丙作首，乙庚之岁戊为头，丙辛必定寻庚起，丁壬壬位顺行流，戊癸之年甲寅求
    const yinStem = [2, 4, 6, 8, 0, 2, 4, 6, 8, 0][s];
    const yin = chart.palaces.find((p) => p.earthlyBranch === "寅");
    if (!yin) return "未找到寅宫";
    const expected = STEMS[(yinStem + 0) % 10];
    return yin.heavenlyStem === expected ? null : `寅宫干${yin.heavenlyStem}，应${expected}`;
  });

  add("small-limit-origin", "小限 1 岁落年支三合局的墓库后一位，男顺女逆，1–120 岁各一次", (chart, spec) => {
    const yearBranch = (chart.astrolabe.chineseDate || "").trim().split(/\s+/u)[0].slice(1, 2);
    const expectedStart = XIAOXIAN_START[yearBranch];
    const policy = chart.aiFacts?.natalStructure?.minorLimitPolicy;
    if (!policy) return "缺少 minorLimitPolicy";
    if (!expectedStart) return `年支无法解析：${yearBranch || "(空)"}`;
    if (policy.startBranch !== expectedStart) {
      return `年支${yearBranch} 应起${expectedStart}，实起${policy.startBranch}`;
    }
    const expectedDirection = spec.sex === "female" ? "backward" : "forward";
    if (policy.direction !== expectedDirection) {
      return `${spec.sex} 应${expectedDirection === "forward" ? "顺" : "逆"}行，实为${policy.direction}`;
    }
    // 逐宫核对：起宫 a 岁 → 宫支 = start + (a−1)（顺）或 start − (a−1)（逆）
    const start = branchIndex(expectedStart);
    const step = expectedDirection === "forward" ? 1 : -1;
    const seen = new Map();
    for (const item of chart.aiFacts.natalStructure.minorLimits) {
      for (const age of item.nominalAges) {
        const expectedBranch = BRANCHES[((start + step * (age - 1)) % 12 + 12) % 12];
        if (item.branch !== expectedBranch) {
          return `${age} 岁应在${expectedBranch}，实落${item.branch}（${item.palace}）`;
        }
        if (seen.has(age)) return `${age} 岁重复出现在 ${seen.get(age)} 与 ${item.branch}`;
        seen.set(age, item.branch);
      }
    }
    const missing = [];
    for (let age = 1; age <= 120; age += 1) if (!seen.has(age)) missing.push(age);
    return missing.length ? `缺年龄：${missing.slice(0, 6).join(",")}${missing.length > 6 ? "…" : ""}` : null;
  });

  add("original-palace", "来因宫恰一处，且宫干等于生年干", (chart) => {
    const yearStem = (chart.astrolabe.chineseDate || "").trim().split(/\s+/u)[0].slice(0, 1);
    const list = chart.aiFacts?.natalStructure?.originalPalaces || [];
    if (list.length !== 1) return `来因宫 ${list.length} 处`;
    const [item] = list;
    if (item.stem !== yearStem) return `年干${yearStem}，来因宫宫干${item.stem}（${item.palace}）`;
    const marked = chart.palaces.filter((p) => p.isOriginalPalace);
    if (marked.length !== 1) return `盘面 isOriginalPalace 标记 ${marked.length} 处`;
    if (marked[0].name !== item.palace) return `盘面标记${marked[0].name}，结构化${item.palace}`;
    const stems = chart.palaces.filter((p) => p.heavenlyStem === yearStem).map((p) => p.name);
    return stems.includes(item.palace) ? null : `来因宫${item.palace} 不在同干宫集合（${stems.join("/")}）`;
  });

  let passed = 0;
  for (const spec of specs) {
    const chart = global.MingliZiwei.calculate(
      {
        calendar: "solar",
        date: spec.date,
        is_leap_month: false,
        time: { precision: "minute", value: spec.time, branch: null },
        sex_for_calculation: spec.sex,
      },
      { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
    );
    chartCount += 1;
    let ok = true;
    for (const check of checks) {
      check.total += 1;
      let reason = null;
      try {
        reason = check.fn(chart, spec);
      } catch (error) {
        reason = `异常：${error.message}`;
      }
      if (reason) {
        check.failed += 1;
        if (check.samples.length < 5) check.samples.push(`${spec.label}：${reason}`);
        ok = false;
      }
    }
    if (ok) passed += 1;
  }

  return { checks, chartCount, passed, specs };
}

function buildSpecs() {
  const specs = [];
  const YEARS = [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999];
  for (const year of YEARS) {
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, "0");
      specs.push({
        label: `${year}-${mm}-15 12:30 男`,
        date: `${year}-${mm}-15`,
        time: "12:30",
        sex: "male",
        solarMonth: month,
        hourIndex: 6, // 午
      });
    }
  }
  // 时辰扫描：同一天十二时辰（含晚子时边界）
  for (let hour = 0; hour <= 22; hour += 2) {
    const hh = String(hour).padStart(2, "0");
    const hourIndex = Math.floor(((hour + 1) % 24) / 2) % 12;
    specs.push({
      label: `1990-05-15 ${hh}:30 男`,
      date: "1990-05-15",
      time: `${hh}:30`,
      sex: "male",
      solarMonth: 5,
      hourIndex,
    });
  }
  // 性别/阴阳方向：同一盘男女各一
  // 女性：男顺女逆必须分得开，且让「申子辰/巳酉丑/寅午戌/亥卯未」四组年支都进方向校验
  for (const year of [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999]) {
    specs.push({
      label: `${year}-05-15 12:30 女`,
      date: `${year}-05-15`,
      time: "12:30",
      sex: "female",
      solarMonth: 5,
      hourIndex: 6,
    });
  }
  return specs;
}

function render(result, extra) {
  const lines = [];
  lines.push("# 紫微引擎不变量校验");
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 盘数：${result.chartCount}（10 年干 × 12 月令 + 12 时辰 + 男女对照）`);
  lines.push(`- 全项通过的盘：${result.passed} / ${result.chartCount}`);
  lines.push("");
  lines.push("## 逐项结果");
  lines.push("");
  lines.push("| 检查项 | 说明 | 通过 | 失败 |");
  lines.push("| --- | --- | --- | --- |");
  for (const check of result.checks) {
    const pass = check.total - check.failed;
    lines.push(`| ${check.id} | ${check.title} | ${pass}/${check.total} | ${check.failed} |`);
  }
  const failing = result.checks.filter((c) => c.failed > 0);
  lines.push("");
  if (failing.length === 0) {
    lines.push("## 失败样本");
    lines.push("");
    lines.push("无。全部不变量在全部盘上成立。");
  } else {
    lines.push("## 失败样本");
    lines.push("");
    for (const check of failing) {
      lines.push(`### ${check.id}（${check.failed} 例）`);
      check.samples.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
  }
  lines.push("## 覆盖度（防止「空断言式 PASS」）");
  lines.push("");
  lines.push("每一项 PASS 只有在它的输入真的变化过时才有意义。下表统计本批盘实际覆盖到的取值；");
  lines.push("若某行种类数偏低，对应检查的结论就要打折看。");
  lines.push("");
  lines.push("| 维度 | 种类数 | 取值 |");
  lines.push("| --- | --- | --- |");
  for (const [label, values, count] of extra.coverage) {
    lines.push(`| ${label} | ${count} | ${values.join("、")} |`);
  }
  lines.push("");
  lines.push("");
  lines.push("## 边界");
  lines.push("");
  lines.push("- 本脚本校验的是**关系**（宫位互斥、星数守恒、公式一致、查表一致），不是「与文墨天机逐宫相同」。");
  lines.push("- 与文墨天机的表级对账见 `docs/wmt-crosscheck.md`（20/20 一致）。");
  lines.push("- 与文墨天机的盘级（命宫/主星落宫）对账仍未完成：该软件的盘级输出需要 GUI 导出，自动化尝试两次失败。");
  return `${lines.join("\n")}\n`;
}

function main() {
  const specs = buildSpecs();
  const result = runChecks(specs);
  const coverage = new Map([
    ["紫微落宫种类", new Set()],
    ["五行局种类", new Set()],
    ["年干种类", new Set()],
    ["命宫地支种类", new Set()],
    ["时支种类", new Set()],
    ["身宫地支种类", new Set()],
  ]);
  for (const spec of specs) {
    const chart = global.MingliZiwei.calculate(
      {
        calendar: "solar",
        date: spec.date,
        is_leap_month: false,
        time: { precision: "minute", value: spec.time, branch: null },
        sex_for_calculation: spec.sex,
      },
      { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
    );
    const z = findPalaceOf(chart, "紫微");
    const soul = palaceByName(chart, "命宫");
    const body = chart.palaces.find((p) => p.isBodyPalace);
    const stem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
    if (z) coverage.get("紫微落宫种类").add(palaceByName(chart, z).earthlyBranch);
    coverage.get("五行局种类").add(chart.basics && chart.basics.fiveElementsClass);
    coverage.get("年干种类").add(stem);
    if (soul) coverage.get("命宫地支种类").add(soul.earthlyBranch);
    const hb = (chart.astrolabe.chineseDate || "").split(" ")[3];
    if (hb) coverage.get("时支种类").add(hb.slice(1, 2));
    if (body) coverage.get("身宫地支种类").add(body.earthlyBranch);
  }
  const outPath = path.join(ROOT, "docs", "engine-invariants.md");
  fs.writeFileSync(
    outPath,
    render(result, {
      coverage: [...coverage.entries()].map(([label, set]) => [label, [...set].sort(), set.size]),
    }),
    "utf8",
  );

  const failed = result.checks.filter((c) => c.failed > 0);
  console.log(`盘数 ${result.chartCount}，全项通过 ${result.passed}/${result.chartCount}`);
  for (const check of result.checks) {
    console.log(`  ${check.failed === 0 ? "PASS" : "FAIL"}  ${check.id}  ${check.total - check.failed}/${check.total}`);
  }
  if (failed.length) {
    console.log("失败样本：");
    failed.forEach((c) => c.samples.forEach((s) => console.log(`  - ${s}`)));
  }
  console.log(`写出 ${path.relative(ROOT, outPath)}`);
  process.exitCode = failed.length ? 1 : 0;
}

// 作为脚本直接运行时才执行全量校验；被测试 require 时只取具名检查函数，
// 避免「导入即跑 134 盘」的副作用。
if (require.main === module) {
  main();
}

module.exports = { runChecks, leapMonthRuleCheck, effectiveMonthOf, lunarMonthOf, BRANCHES };

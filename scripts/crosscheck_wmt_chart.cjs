"use strict";

// 盘级对账：把文墨天机导出的真实盘（knowledge/wmt/samples/1990-05-15-male.txt）
// 与我们引擎（iztro + 已知校正）逐宫比对。
//
// 比对层级：
//   L1 结构：宫名↔地支、宫干、五行局、命宫、身宫
//   L2 主星：十四主星落宫（含庙旺）
//   L3 辅星：文昌文曲左辅右弼天魁天钺禄存天马火铃羊陀地空地劫
//   L4 四化：生年禄权科忌 各落何宫
//   L5 自化：向心（对宫宫干化入）与离心（本宫宫干自化）
//
// 输出：docs/wmt-chart-crosscheck.md + 控制台摘要

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js"].forEach((name) => {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
});

// —— 文墨天机导出（手工转录到 knowledge/wmt/samples/1990-05-15-male.txt，此处结构化）——
const WMT = {
  bureaus: "土五局",
  soulBranch: "亥",
  bodyBranch: "亥",
  palaces: {
    命宫: { branch: "亥", stem: "丁", major: ["天梁"], aux: [] },
    父母宫: { branch: "子", stem: "戊", major: ["七杀"], aux: [] },
    福德宫: { branch: "丑", stem: "己", major: [], aux: ["天魁"] },
    田宅宫: { branch: "寅", stem: "戊", major: ["廉贞"], aux: [] },
    官禄宫: { branch: "卯", stem: "己", major: [], aux: [] },
    交友宫: { branch: "辰", stem: "庚", major: ["破军"], aux: ["文昌"] },
    迁移宫: { branch: "巳", stem: "辛", major: ["天同"], aux: ["地劫", "地空"] },
    疾厄宫: { branch: "午", stem: "壬", major: ["武曲", "天府"], aux: [] },
    财帛宫: { branch: "未", stem: "癸", major: ["太阳", "太阴"], aux: ["左辅", "右弼", "天钺", "陀罗", "火星"] },
    子女宫: { branch: "申", stem: "甲", major: ["贪狼"], aux: ["禄存", "天马"] },
    夫妻宫: { branch: "酉", stem: "乙", major: ["天机", "巨门"], aux: ["擎羊", "铃星"] },
    兄弟宫: { branch: "戌", stem: "丙", major: ["紫微", "天相"], aux: ["文曲"] },
  },
  natalHua: { 禄: "太阳", 权: "武曲", 科: "太阴", 忌: "天同" },
  selfHua: [
    { star: "廉贞", palace: "田宅宫", kind: "禄", direction: "向心" },
    { star: "文昌", palace: "交友宫", kind: "科", direction: "向心" },
    { star: "天同", palace: "迁移宫", kind: "权", direction: "向心" },
    { star: "武曲", palace: "疾厄宫", kind: "忌", direction: "离心" },
    { star: "太阴", palace: "财帛宫", kind: "科", direction: "离心" },
    { star: "天机", palace: "夫妻宫", kind: "禄", direction: "离心" },
    { star: "贪狼", palace: "子女宫", kind: "禄", direction: "向心" },
  ],
};

// 文墨叫「交友宫」，本引擎叫「仆役宫」——同一宫的两个名字，比对时归一
const PALACE_ALIAS = { 交友宫: "仆役宫", 仆役宫: "仆役宫" };
const engineNameOf = (name) => PALACE_ALIAS[name] || name;
const canonicalName = (name) => (name === "仆役宫" ? "交友宫" : name);

// 文墨导出的小星（辅星之外的「小星」栏），逐宫抄录
const WMT_MINOR = {
  命宫: ["八座", "恩光", "天官", "天巫", "旬空", "劫煞", "月德"],
  父母宫: ["天刑", "台辅", "天哭", "天虚"],
  福德宫: ["大耗", "龙德"],
  田宅宫: ["天厨", "天月", "蜚廉"],
  官禄宫: ["天喜", "三台", "咸池", "天德"],
  交友宫: ["天姚", "凤阁", "天伤", "寡宿", "年解"],
  迁移宫: ["天贵", "天才", "天寿", "破碎"],
  疾厄宫: ["天福", "天使", "截空"],
  财帛宫: ["截空", "天空"],
  子女宫: ["封诰", "孤辰", "阴煞"],
  夫妻宫: ["红鸾"],
  兄弟宫: ["龙池", "解神", "旬空", "华盖"],
};

// 文墨的十二长生（土五局、阳男顺行：申长生 → 未养）
const WMT_CHANGSHENG = {
  命宫: "临官", 父母宫: "帝旺", 福德宫: "衰", 田宅宫: "病",
  官禄宫: "死", 交友宫: "墓", 迁移宫: "绝", 疾厄宫: "胎",
  财帛宫: "养", 子女宫: "长生", 夫妻宫: "沐浴", 兄弟宫: "冠带",
};

// 文墨其余三类神煞：只记录起法，不参与判定（起法与三合通行口径不同）
const WMT_SHENSHA = {
  岁前星: { start: "命宫（岁建起命宫顺行）", sample: { 命宫: "岁建", 父母宫: "晦气", 福德宫: "丧门", 田宅宫: "贯索", 官禄宫: "官符", 交友宫: "小耗", 迁移宫: "岁破", 疾厄宫: "龙德", 财帛宫: "白虎", 子女宫: "天德", 夫妻宫: "吊客", 兄弟宫: "病符" } },
  将前星: { start: "卯宫（将星起卯顺行）", sample: { 命宫: "指背", 父母宫: "咸池", 福德宫: "月煞", 田宅宫: "亡神", 官禄宫: "將星", 交友宫: "攀鞍", 迁移宫: "岁驿", 疾厄宫: "息神", 财帛宫: "华盖", 子女宫: "劫煞", 夫妻宫: "灾煞", 兄弟宫: "天煞" } },
  太岁煞禄: { start: "禄存宫（博士起禄存顺行）", sample: { 命宫: "小耗", 父母宫: "将军", 福德宫: "奏书", 田宅宫: "飞廉", 官禄宫: "喜神", 交友宫: "病符", 迁移宫: "大耗", 疾厄宫: "伏兵", 财帛宫: "官符", 子女宫: "博士", 夫妻宫: "力士", 兄弟宫: "青龙" } },
};

// 引擎把「旬空/截空」的正副拆成两个名字，文墨都叫「旬空/截空」
const MINOR_ALIAS = { 副旬: "旬空", 副截: "截空" };
// 博士十二神：文墨写「官符」、iztro 写「官府」，同一颗星，比对前归一
const BOSHI_ALIAS = { 官符: "官府" };

// 文墨导出的十四主星亮度（照抄 `knowledge/wmt/samples/1990-05-15-male.txt` 的方括号标注）。
// 本引擎默认门派 qs（斗数全书派）——与文墨出厂口径一致：GlobalVars.as:926 初始值 "1"，
// GlobalConsts 亮度 getter 把 "1" 分派到 _AX_SB_QS。样盘 14 颗主星 qs 全中、xd1 差 1 颗（太阴@未）。
const WMT_BRIGHTNESS = {
  紫微: "得", 天机: "旺", 太阳: "得", 武曲: "旺", 天同: "庙", 廉贞: "庙", 天府: "旺",
  太阴: "不", 贪狼: "平", 巨门: "庙", 天相: "得", 天梁: "陷", 七杀: "旺", 破军: "旺",
};

// 来因宫：文墨导出在 `交友宫[庚辰]` 后标注 `[来因]`，即宫干与生年干（庚）相同的那一宫。
const WMT_ORIGINAL_PALACE = { palace: "交友宫", branch: "辰", stem: "庚" };

// 小限：文墨本命视图不列年龄，按它的常量表推导——年支午 → _AX_XIAOXIAN_ARR[7] = 5 → 辰（1 岁），男顺行。
// 这是「表推」，不是「文墨导出」，判定时如实标明来源。
const WMT_SMALL_LIMIT = {
  startBranch: "辰",
  atPalace: "交友宫",
  direction: "forward",
  derivedFrom: "年支午 → _AX_XIAOXIAN_ARR[7]=5 → 辰；男顺女逆",
};

// 十二长生：局 → 长生位；阳男阴女顺行，阴男阳女逆行
const CHANGSHENG = ["长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养"];
const CHANGSHENG_START = { 水二局: "申", 木三局: "亥", 金四局: "巳", 土五局: "申", 火六局: "寅" };

const BRANCH_INDEX = { 子: 0, 丑: 1, 寅: 2, 卯: 3, 辰: 4, 巳: 5, 午: 6, 未: 7, 申: 8, 酉: 9, 戌: 10, 亥: 11 };

const AUX_WATCH = ["文昌", "文曲", "左辅", "右弼", "天魁", "天钺", "禄存", "天马", "火星", "铃星", "擎羊", "陀罗", "地空", "地劫"];
const KINDS = ["禄", "权", "科", "忌"];

function chartOf(input) {
  return global.MingliZiwei.calculate(input, { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 });
}

function starsOf(palace) {
  return [...palace.majorStars, ...palace.minorStars, ...palace.auxiliaryStars];
}

function compare() {
  const chart = chartOf({
    calendar: "solar",
    date: "1990-05-15",
    is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    sex_for_calculation: "male",
  });
  const rows = [];
  const diffs = [];

  // L1 结构
  const soul = chart.palaces.find((p) => p.name === "命宫");
  const body = chart.palaces.find((p) => p.isBodyPalace);
  const structure = [
    ["五行局", WMT.bureaus, chart.basics.fiveElementsClass],
    ["命宫地支", WMT.soulBranch, soul && soul.earthlyBranch],
    ["身宫地支", WMT.bodyBranch, body && body.earthlyBranch],
  ].map(([field, expected, actual]) => {
    const ok = expected === actual;
    if (!ok) diffs.push({ level: "L1", field, expected, actual });
    return { field, expected, actual, ok };
  });

  for (const [name, spec] of Object.entries(WMT.palaces)) {
    const palace = chart.palaces.find((p) => p.name === engineNameOf(name));
    if (!palace) {
      diffs.push({ level: "L1", field: `${name} 缺失`, expected: "存在", actual: "无" });
      continue;
    }
    const branchOk = palace.earthlyBranch === spec.branch;
    const stemOk = palace.heavenlyStem === spec.stem;
    if (!branchOk) diffs.push({ level: "L1", field: `${name} 地支`, expected: spec.branch, actual: palace.earthlyBranch });
    if (!stemOk) diffs.push({ level: "L1", field: `${name} 宫干`, expected: spec.stem, actual: palace.heavenlyStem });

    const engineMajor = palace.majorStars.map((s) => s.name).sort();
    const wmtMajor = [...spec.major].sort();
    const majorOk = engineMajor.join(",") === wmtMajor.join(",");
    if (!majorOk) diffs.push({ level: "L2", field: `${name} 主星`, expected: wmtMajor.join(",") || "(空)", actual: engineMajor.join(",") || "(空)" });

    const engineAux = starsOf(palace).map((s) => s.name).filter((n) => AUX_WATCH.includes(n)).sort();
    const wmtAux = [...spec.aux].sort();
    const auxOk = engineAux.join(",") === wmtAux.join(",");
    if (!auxOk) diffs.push({ level: "L3", field: `${name} 辅星`, expected: wmtAux.join(",") || "(无)", actual: engineAux.join(",") || "(无)" });

    rows.push({ name, branch: palace.earthlyBranch, stem: palace.heavenlyStem, major: engineMajor.join(",") || "—", aux: engineAux.join(",") || "—", ok: branchOk && stemOk && majorOk && auxOk });
  }

  // L2b 主星亮度：逐星比对，门派取本引擎实际使用的那套（默认 qs）
  const brightnessProfile = (chart.aiFacts && chart.aiFacts.brightness) || null;
  const brightnessRows = [];
  for (const palace of chart.palaces) {
    for (const star of palace.majorStars) {
      const expected = WMT_BRIGHTNESS[star.name];
      if (!expected) continue;
      const actual = star.brightness || null;
      const ok = expected === actual;
      if (!ok) diffs.push({ level: "L2b", field: `${star.name}@${canonicalName(palace.name)} 亮度`, expected, actual: actual || "(空)" });
      brightnessRows.push({ star: star.name, palace: canonicalName(palace.name), branch: palace.earthlyBranch, expected, actual: actual || "—", ok });
    }
  }

  // L4 生年四化
  const engineHua = {};
  for (const palace of chart.palaces) {
    for (const star of starsOf(palace)) {
      if (star.transformation && KINDS.includes(star.transformation)) engineHua[star.transformation] = { star: star.name, palace: palace.name };
    }
  }
  const huaRows = KINDS.map((kind) => {
    const expected = WMT.natalHua[kind];
    const actual = (engineHua[kind] || {}).star || null;
    const ok = expected === actual;
    if (!ok) diffs.push({ level: "L4", field: `生年${kind}`, expected, actual });
    return { kind, expected, actual, palace: (engineHua[kind] || {}).palace || null, ok };
  });

  // L6 小星（辅星之外的「小星」栏）
  const minorRows = [];
  for (const [name, expectedList] of Object.entries(WMT_MINOR)) {
    const palace = chart.palaces.find((p) => p.name === engineNameOf(name));
    if (!palace) continue;
    const mine = [...palace.minorStars, ...palace.auxiliaryStars]
      .map((s) => s.name)
      .filter((n) => !AUX_WATCH.includes(n))
      .map((n) => MINOR_ALIAS[n] || n);
    const onlyMine = mine.filter((n) => !expectedList.includes(n));
    const onlyWmt = expectedList.filter((n) => !mine.includes(n));
    const ok = onlyMine.length === 0 && onlyWmt.length === 0;
    if (!ok) {
      diffs.push({ level: "L6", field: `${name} 小星`, expected: expectedList.join(",") || "(无)", actual: mine.join(",") || "(无)" });
    }
    minorRows.push({ name, expected: expectedList.join(",") || "—", actual: mine.join(",") || "—", onlyMine, onlyWmt, ok });
  }

  // L7 十二长生：按规则算（局 → 长生位；阳男顺行）
  const changshengRows = [];
  const bureau = chart.basics && chart.basics.fiveElementsClass;
  const startBranch = CHANGSHENG_START[bureau];
  const yearStem = (chart.astrolabe.chineseDate || "").split(" ")[0].slice(0, 1);
  const yangStem = ["甲", "丙", "戊", "庚", "壬"].includes(yearStem);
  const male = true; // 样本为男
  const forward = yangStem === male; // 阳男 / 阴女 顺行
  if (startBranch) {
    for (const [name, expected] of Object.entries(WMT_CHANGSHENG)) {
      const palace = chart.palaces.find((p) => p.name === engineNameOf(name));
      if (!palace) continue;
      const delta = ((BRANCH_INDEX[palace.earthlyBranch] - BRANCH_INDEX[startBranch]) % 12 + 12) % 12;
      const idx = forward ? delta : (12 - delta) % 12;
      const actual = CHANGSHENG[idx];
      const ok = actual === expected;
      if (!ok) diffs.push({ level: "L7", field: `${name} 十二长生`, expected, actual });
      changshengRows.push({ name, expected, actual, ok });
    }
  }

  // L8a 博士十二神（太岁煞禄）：起点同为禄存宫、顺行；只差「官符/官府」写法
  const boshiRows = [];
  for (const [name, expectedRaw] of Object.entries(WMT_SHENSHA.太岁煞禄.sample)) {
    const palace = chart.palaces.find((p) => p.name === engineNameOf(name));
    if (!palace) continue;
    const norm = (n) => (n ? BOSHI_ALIAS[n] || n : n);
    const expected = norm(expectedRaw);
    const actual = norm((palace.cycles || {}).boshi12 || null);
    const ok = expected === actual;
    if (!ok) diffs.push({ level: "L8a", field: `${name} 博士十二神`, expected: expected || "(无)", actual: actual || "(无)" });
    boshiRows.push({ name, expected: expected || "—", actual: actual || "—", ok });
  }

  // L5 自化：离心 = 本宫宫干四化星落回本宫；向心 = 对宫宫干四化星落入本宫
  const STEM_HUA = {
    甲: { 禄: "廉贞", 权: "破军", 科: "武曲", 忌: "太阳" },
    乙: { 禄: "天机", 权: "天梁", 科: "紫微", 忌: "太阴" },
    丙: { 禄: "天同", 权: "天机", 科: "文昌", 忌: "廉贞" },
    丁: { 禄: "太阴", 权: "天同", 科: "天机", 忌: "巨门" },
    戊: { 禄: "贪狼", 权: "太阴", 科: "右弼", 忌: "天机" },
    己: { 禄: "武曲", 权: "贪狼", 科: "天梁", 忌: "文曲" },
    庚: { 禄: "太阳", 权: "武曲", 科: "太阴", 忌: "天同" },
    辛: { 禄: "巨门", 权: "太阳", 科: "文曲", 忌: "文昌" },
    壬: { 禄: "天梁", 权: "紫微", 科: "左辅", 忌: "武曲" },
    癸: { 禄: "破军", 权: "巨门", 科: "太阴", 忌: "贪狼" },
  };
  const OPPOSITE = {
    命宫: "迁移宫", 迁移宫: "命宫", 父母宫: "疾厄宫", 疾厄宫: "父母宫",
    福德宫: "财帛宫", 财帛宫: "福德宫", 田宅宫: "子女宫", 子女宫: "田宅宫",
    官禄宫: "夫妻宫", 夫妻宫: "官禄宫",
    交友宫: "兄弟宫", 仆役宫: "兄弟宫", 兄弟宫: "仆役宫",
  };
  const engineSelfHua = [];
  for (const palace of chart.palaces) {
    const own = STEM_HUA[palace.heavenlyStem] || {};
    const opposite = chart.palaces.find((p) => p.name === OPPOSITE[palace.name]);
    const oppHua = opposite ? STEM_HUA[opposite.heavenlyStem] || {} : {};
    for (const star of starsOf(palace)) {
      for (const kind of KINDS) {
        if (own[kind] === star.name) engineSelfHua.push({ star: star.name, palace: canonicalName(palace.name), kind, direction: "离心" });
        if (oppHua[kind] === star.name) engineSelfHua.push({ star: star.name, palace: canonicalName(palace.name), kind, direction: "向心" });
      }
    }
  }
  const keyOf = (x) => `${x.star}@${x.palace}${x.direction}${x.kind}`;
  const engineSet = new Set(engineSelfHua.map(keyOf));
  const wmtSet = new Set(WMT.selfHua.map(keyOf));
  const selfHuaRows = WMT.selfHua.map((item) => {
    const ok = engineSet.has(keyOf(item));
    if (!ok) diffs.push({ level: "L5", field: `自化 ${item.star}${item.direction}${item.kind}`, expected: item.palace, actual: "引擎未标" });
    return { ...item, ok };
  });
  const engineOnly = [...engineSet].filter((k) => !wmtSet.has(k));

  // L9 来因宫：文墨 [来因] 标注 vs 引擎 basics.originalPalace
  const engineOriginal = chart.basics ? chart.basics.originalPalace : null;
  const originalRow = {
    expected: `${WMT_ORIGINAL_PALACE.stem}${WMT_ORIGINAL_PALACE.branch} ${WMT_ORIGINAL_PALACE.palace}`,
    actual: engineOriginal ? `${engineOriginal.stem}${engineOriginal.branch} ${canonicalName(engineOriginal.palace)}` : "(未产出)",
    ok: Boolean(engineOriginal)
      && canonicalName(engineOriginal.palace) === WMT_ORIGINAL_PALACE.palace
      && engineOriginal.branch === WMT_ORIGINAL_PALACE.branch
      && engineOriginal.stem === WMT_ORIGINAL_PALACE.stem,
  };
  if (!originalRow.ok) {
    diffs.push({ level: "L9", field: "来因宫", expected: originalRow.expected, actual: originalRow.actual });
  }

  // L10 小限：1 岁落宫（表推）vs 引擎 minorLimitPolicy
  const minorPolicy = chart.aiFacts?.natalStructure?.minorLimitPolicy || {};
  const age1Palace = (chart.aiFacts?.natalStructure?.minorLimits || [])
    .find((item) => item.nominalAges.includes(1));
  const smallLimitRow = {
    expected: `${WMT_SMALL_LIMIT.startBranch}（${WMT_SMALL_LIMIT.atPalace}）`,
    actual: `${minorPolicy.startBranch || "?"}（${age1Palace ? canonicalName(age1Palace.palace) : "?"}）`,
    direction: `${WMT_SMALL_LIMIT.direction} / ${minorPolicy.direction || "?"}`,
    ok: minorPolicy.startBranch === WMT_SMALL_LIMIT.startBranch
      && minorPolicy.direction === WMT_SMALL_LIMIT.direction
      && Boolean(age1Palace)
      && canonicalName(age1Palace.palace) === WMT_SMALL_LIMIT.atPalace,
  };
  if (!smallLimitRow.ok) {
    diffs.push({
      level: "L10",
      field: "小限 1 岁落宫",
      expected: `${smallLimitRow.expected}，${WMT_SMALL_LIMIT.direction}`,
      actual: `${smallLimitRow.actual}，${minorPolicy.direction || "?"}`,
    });
  }

  return { chart, structure, rows, huaRows, selfHuaRows, minorRows, changshengRows, boshiRows, brightnessRows, brightnessProfile, originalRow, smallLimitRow, engineOnly, diffs };
}

function render(result) {
  const lines = [];
  lines.push("# 盘级对账：文墨天机 vs 本引擎");
  lines.push("");
  lines.push("- 样本：1990-05-15 12:30 男（东经 120，非真太阳时口径一致）");
  lines.push("- 来源：文墨天机 2.0.15 导出文本（`knowledge/wmt/samples/1990-05-15-male.txt`，安星码 C5VUC）");
  lines.push(`- 差异项：${result.diffs.length}`);
  lines.push("");
  lines.push("## L1 结构");
  lines.push("");
  lines.push("| 项目 | 文墨天机 | 本引擎 | 一致 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of result.structure) lines.push(`| ${row.field} | ${row.expected} | ${row.actual} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L2/L3 十二宫主星与辅星");
  lines.push("");
  lines.push("| 宫位 | 宫干地支 | 本引擎主星 | 本引擎辅星 | 全一致 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of result.rows) lines.push(`| ${row.name} | ${row.stem}${row.branch} | ${row.major} | ${row.aux} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  const profile = result.brightnessProfile || {};
  lines.push(`## L2b 主星亮度（门派：${profile.label || "未知"} / \`${profile.profile || "?"}\`）`);
  lines.push("");
  lines.push("文墨出厂口径即「斗数全书派」(qs)；四套表的差异见 \`knowledge/wmt/brightness.json\`。");
  lines.push("");
  lines.push("| 主星 | 宫位 | 文墨天机 | 本引擎 | 一致 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of result.brightnessRows) lines.push(`| ${row.star} | ${row.palace}(${row.branch}) | ${row.expected} | ${row.actual} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L4 生年四化");
  lines.push("");
  lines.push("| 化 | 文墨天机 | 本引擎 | 落宫 | 一致 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of result.huaRows) lines.push(`| ${row.kind} | ${row.expected} | ${row.actual || "—"} | ${row.palace || "—"} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L5 自化（7 条）");
  lines.push("");
  lines.push("| 星 | 宫位 | 化 | 方向 | 一致 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of result.selfHuaRows) lines.push(`| ${row.star} | ${row.palace} | ${row.kind} | ${row.direction} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L6 小星（辅星之外的「小星」栏）");
  lines.push("");
  lines.push("| 宫位 | 文墨天机 | 本引擎 | 仅本引擎 | 仅文墨 | 一致 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of result.minorRows) {
    lines.push(`| ${row.name} | ${row.expected} | ${row.actual} | ${row.onlyMine.join(",") || "—"} | ${row.onlyWmt.join(",") || "—"} | ${row.ok ? "✔" : "✘"} |`);
  }
  lines.push("");
  lines.push("## L7 十二长生（按规则算，不抄文墨）");
  lines.push("");
  lines.push("规则：局 → 长生位（水二/土五在申、木三在亥、金四在巳、火六在寅），阳男阴女顺行、阴男阳女逆行。");
  lines.push("");
  lines.push("| 宫位 | 文墨天机 | 按规则算 | 一致 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of result.changshengRows) lines.push(`| ${row.name} | ${row.expected} | ${row.actual} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L8a 博士十二神（太岁煞禄）");
  lines.push("");
  lines.push("起点同为禄存宫、顺行；文墨写「官符」、iztro 写「官府」，按同一颗星归一后比对。");
  lines.push("");
  lines.push("| 宫位 | 文墨天机 | 本引擎 | 一致 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of result.boshiRows) lines.push(`| ${row.name} | ${row.expected} | ${row.actual} | ${row.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L9 来因宫");
  lines.push("");
  lines.push("文墨导出在该宫标注 `[来因]`，即宫干与生年干相同的那一宫；本引擎从 `palaces[].isOriginalPalace` 结构化为 `basics.originalPalace`。");
  lines.push("");
  lines.push("| 项目 | 文墨天机 | 本引擎 | 一致 |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(`| 来因宫 | ${result.originalRow.expected} | ${result.originalRow.actual} | ${result.originalRow.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("说明：按 SKILL §7 铁律，来因宫只作结构记录，不作判据（不据此推「生年四化之源」等论断）。");
  lines.push("");
  lines.push("## L10 小限（1 岁落宫，按文墨常量表推导）");
  lines.push("");
  lines.push(`推导依据：${WMT_SMALL_LIMIT.derivedFrom}。文墨本命视图不列小限年龄，故此层是「表推 vs 引擎」，不是「文墨导出 vs 引擎」。`);
  lines.push("");
  lines.push("| 项目 | 表推 | 本引擎 | 一致 |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(`| 1 岁落宫 | ${result.smallLimitRow.expected} | ${result.smallLimitRow.actual} | ${result.smallLimitRow.ok ? "✔" : "✘"} |`);
  lines.push(`| 方向 | ${WMT_SMALL_LIMIT.direction} | ${(result.smallLimitRow.direction || "").split(" / ")[1] || "?"} | ${result.smallLimitRow.ok ? "✔" : "✘"} |`);
  lines.push("");
  lines.push("## L8 岁前星 / 将前星：起点不同，未对账");
  lines.push("");
  lines.push("| 项目 | 文墨的起法 | 通行口径 | 本引擎 |");
  lines.push("| --- | --- | --- | --- |");
  lines.push("| 岁前星（岁建十二神） | 岁建起**命宫**顺行 | 岁建起**年支** | 产出在每宫 `cycles.suiqian12`，未纳入 AI 合同 |");
  lines.push("| 将前星 | 将星起**卯**顺行 | 将星起**年支三合中神**（午年应在午） | 产出在每宫 `cycles.jiangqian12`，未纳入 AI 合同 |");
  lines.push("");
  lines.push("说明：这两排起点不同则整排错位，属**流派配置**而非错误（文墨的配置项里确有这一类开关）。本引擎照 iztro 的通行口径产出并保留在 `cycles` 里，但既不并入 AI 合同（合同里没有对应 scope，AI 看不见也就不会引用），也不参与本文件判定；不冒充「已对齐」。");
  lines.push("");
  if (result.diffs.length) {
    lines.push("## 差异清单");
    lines.push("");
    lines.push("| 层级 | 项目 | 文墨天机 | 本引擎 |");
    lines.push("| --- | --- | --- | --- |");
    for (const d of result.diffs) lines.push(`| ${d.level} | ${d.field} | ${d.expected} | ${d.actual} |`);
  } else {
    lines.push("## 差异清单");
    lines.push("");
    lines.push("无差异。");
  }
  if (result.engineOnly.length) {
    lines.push("");
    lines.push("## 引擎多标（文墨未标）");
    lines.push("");
    result.engineOnly.forEach((k) => lines.push(`- ${k}`));
  }
  lines.push("");
  lines.push("## 边界");
  lines.push("");
  lines.push("- 只对了一盘。它证明「这一盘对得上」，不等于「所有盘都对得上」。");
  lines.push("- 已比对：L1 宫位结构、L2 主星、L2b 主星亮度（14 颗，门派 qs）、L3 辅星、L4 生年四化、L5 自化、L6 小星与神煞（含劫煞、龙德）、L7 十二长生、L8a 博士十二神、L9 来因宫、L10 小限 1 岁落宫（表推）。");
  lines.push("- 未比对的字段：辅星与小星的亮度、四套门派之间的取舍（只按文墨出厂值认一套）、斗君（只有样本值「子年斗君 卯」，算法未取证），以及起点与通行口径不同的岁前星/将前星两排。");
  lines.push("- 来因宫只作结构记录、不作判据（SKILL §7）：位置对上不代表可以用它推论断。");
  return `${lines.join("\n")}\n`;
}

function main() {
  const result = compare();
  const outPath = path.join(ROOT, "docs", "wmt-chart-crosscheck.md");
  fs.writeFileSync(outPath, render(result), "utf8");
  console.log(`差异 ${result.diffs.length} 项`);
  const byLevel = {};
  result.diffs.forEach((d) => { byLevel[d.level] = (byLevel[d.level] || 0) + 1; });
  console.log("按层级：", JSON.stringify(byLevel));
  result.diffs.slice(0, 20).forEach((d) => console.log(`  ${d.level} ${d.field}: 文墨=${d.expected} 引擎=${d.actual}`));
  if (result.engineOnly.length) console.log("引擎多标：", result.engineOnly.join(", "));
  console.log(`写出 ${path.relative(ROOT, outPath)}`);
  process.exitCode = result.diffs.length ? 1 : 0;
}

main();

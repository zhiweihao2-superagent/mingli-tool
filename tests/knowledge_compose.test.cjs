/**
 * 组合生成器测试。
 *
 * 这个模块的存在理由：star_main14_palace.md 有 36 格写着「—（源未及）」。
 * 补它不能靠外派断语（那会掺进另一套判法），只能回到钦天门自己的
 * 星性 + 宫位义 + 四化结构重新组合（SKILL §12 三要素）。
 *
 * 因此本测试盯三件事：
 *   1. 组合只用原文零件，缺零件必须如实 unavailable，不许编；
 *   2. 输出必须带 composed 标记与出处，不许冒充作者原文；
 *   3. 措辞不得出现断言词（K 系列守则）。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "knowledge-compose.js"), "utf8"));

const C = globalThis.MingliKnowledgeCompose;

const parts = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "compose-parts.json"), "utf8"),
);

const ASSERTIVE = /(一定|必然|必定|绝对|铁定|铁口直断|肯定|百分百|100%|绝不会)/;

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label || "值"}不符：期望 ${e}，实际 ${a}`);
}
function ok(cond, message) {
  if (!cond) throw new Error(message);
}

console.log("===== 组合生成检查 =====");

// ── 原料与结构 ─────────────────────────────────────────────
check("原料含 12 颗星的星性", () => {
  eq(Object.keys(parts.stars).length, 12);
});

check("原料含 12 个宫位 + 交友宫别名", () => {
  const names = Object.keys(parts.palaces);
  eq(names.length, 13);
  ok(names.includes("仆役宫"), "缺仆役宫");
  ok(names.includes("交友宫"), "缺交友宫别名");
});

check("交友宫是仆役宫的别名，不是独立条目", () => {
  eq(parts.palaces["交友宫"].aliasOf, "仆役宫");
  eq(parts.palaces["交友宫"].domain, parts.palaces["仆役宫"].domain);
});

// ── 正常组合 ───────────────────────────────────────────────
check("天同 + 迁移宫 + 生年忌：三要素齐备且可追溯", () => {
  const r = C.compose(parts, {
    star: "天同",
    palace: "迁移宫",
    hua: [{ layer: "生年", kind: "忌", star: "天同" }],
  });
  eq(r.status, "ok");
  eq(r.composed, true);
  ok(r.reading.includes("天同"), "句子缺星名");
  ok(r.reading.includes("出外发展"), "句子缺宫位领域");
  ok(r.reading.includes("生年忌在此"), "句子缺四化条款");
  eq(r.refs.length, 2, "出处应有星性与宫位两条");
  ok(r.refs[0].startsWith("compose:star_theology.md#"), "星性出处格式不对");
  ok(r.refs[1].startsWith("compose:palace_fly_all12.md#"), "宫位出处格式不对");
  ok(r.limitations.includes("组合生成，非原表断语"), "缺组合声明");
});

check("破军 + 仆役宫（原文两处缺口之一）可组合", () => {
  const r = C.compose(parts, { star: "破军", palace: "仆役宫", hua: [] });
  eq(r.status, "ok");
  ok(r.reading.includes("破旧立新"), "未取到破军星性");
  ok(r.reading.includes("交友层次"), "未取到仆役宫领域");
});

check("无四化时仍可组合，但必须写明只由星性与宫位义组成", () => {
  const r = C.compose(parts, { star: "七杀", palace: "官禄宫", hua: [] });
  eq(r.status, "ok");
  ok(r.huaClause === null, "无四化时不应编出四化条款");
  ok(
    r.limitations.some((x) => x.includes("无三层四化")),
    "缺「本盘该宫无三层四化」的说明",
  );
});

check("多层多象按 生年→大限→流年、禄→权→科→忌 排序", () => {
  const r = C.compose(parts, {
    star: "太阳",
    palace: "财帛宫",
    hua: [
      { layer: "流年", kind: "忌" },
      { layer: "生年", kind: "禄" },
      { layer: "大限", kind: "权" },
    ],
  });
  eq(r.status, "ok");
  const order = r.huaClauses;
  eq(order, ["生年禄", "大限权", "流年忌"]);
  const idx1 = r.reading.indexOf("生年禄在此");
  const idx2 = r.reading.indexOf("大限权在此");
  const idx3 = r.reading.indexOf("流年忌在此");
  ok(idx1 >= 0 && idx2 > idx1 && idx3 > idx2, "句内顺序与层级不符");
});

check("同层同象重复只出一句", () => {
  const r = C.compose(parts, {
    star: "天同",
    palace: "迁移宫",
    hua: [
      { layer: "流年", kind: "忌" },
      { layer: "流年", kind: "忌" },
    ],
  });
  const hits = r.reading.split("流年忌在此").length - 1;
  eq(hits, 1);
});

// ── 缺零件必须如实降级 ─────────────────────────────────────
check("星名不在 star_theology 时 unavailable 且说明来源", () => {
  const r = C.compose(parts, { star: "天哭", palace: "迁移宫", hua: [] });
  eq(r.status, "unavailable");
  eq(r.composed, true);
  ok(r.reason.includes("star_theology.md"), "理由未指向源文件");
});

check("宫位不在 palace_fly_all12 时 unavailable", () => {
  const r = C.compose(parts, { star: "天同", palace: "来因宫", hua: [] });
  eq(r.status, "unavailable");
  ok(r.reason.includes("palace_fly_all12.md"), "理由未指向源文件");
});

check("缺星名 / 缺宫位 / 缺原料都不抛异常", () => {
  eq(C.compose(parts, { palace: "迁移宫" }).status, "unavailable");
  eq(C.compose(parts, { star: "天同" }).status, "unavailable");
  eq(C.compose(null, { star: "天同", palace: "迁移宫" }).status, "unavailable");
});

check("星性只有标题没有要点时不冒充有内容", () => {
  const broken = {
    stars: { 试星: { tagline: "", nature: "", points: [], source: null } },
    palaces: parts.palaces,
  };
  const r = C.compose(broken, { star: "试星", palace: "迁移宫", hua: [] });
  eq(r.status, "unavailable");
  ok(r.reason.includes("无可组合的定语"), "理由不清楚");
});

// ── 措辞卫生 ───────────────────────────────────────────────
check("组合句不含断言词", () => {
  const combos = [
    ["天同", "迁移宫", [{ layer: "生年", kind: "忌" }]],
    ["七杀", "官禄宫", [{ layer: "大限", kind: "禄" }, { layer: "流年", kind: "忌" }]],
    ["破军", "仆役宫", [{ layer: "流年", kind: "权" }]],
    ["天府", "田宅宫", [{ layer: "生年", kind: "科" }]],
  ];
  combos.forEach(([star, palace, hua]) => {
    const r = C.compose(parts, { star, palace, hua });
    eq(r.status, "ok", `${star}@${palace}`);
    const hit = r.reading.match(ASSERTIVE);
    ok(!hit, `${star}@${palace} 含断言词「${hit ? hit[0] : ""}」`);
  });
});

check("星性定语里的转折「然…」不进组合句", () => {
  const r = C.compose(parts, { star: "天同", palace: "命宫", hua: [] });
  ok(!r.nature.startsWith("然"), `nature 以「然」开头：${r.nature}`);
});

// ── 批量与纯函数性 ─────────────────────────────────────────
check("composeMany 分开返回可用与不可用", () => {
  const r = C.composeMany(parts, [
    { star: "天同", palace: "迁移宫", hua: [] },
    { star: "天哭", palace: "迁移宫", hua: [] },
  ]);
  eq(r.status, "ok");
  eq(r.entries.length, 1);
  eq(r.failed.length, 1);
  eq(r.entries[0].star, "天同");
});

check("全部不可用时 composeMany 报 unavailable", () => {
  const r = C.composeMany(parts, [{ star: "天哭", palace: "迁移宫", hua: [] }]);
  eq(r.status, "unavailable");
  eq(r.entries.length, 0);
});

check("组合不修改传入的原料对象", () => {
  const before = JSON.stringify(parts);
  C.compose(parts, { star: "天同", palace: "迁移宫", hua: [{ layer: "生年", kind: "忌" }] });
  eq(JSON.stringify(parts), before);
});

check("同一输入两次组合结果一致", () => {
  const spec = { star: "太阳", palace: "财帛宫", hua: [{ layer: "流年", kind: "禄" }] };
  eq(C.compose(parts, spec).reading, C.compose(parts, spec).reading);
});

console.log(`\n===== 组合生成检查 ${pass} 项${fail === 0 ? "全部通过" : `，失败 ${fail} 项`} =====`);
if (fail > 0) process.exit(1);

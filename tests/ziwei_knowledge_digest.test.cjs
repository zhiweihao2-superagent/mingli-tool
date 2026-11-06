"use strict";

// 紫微知识摘录单测：验「摘录是否忠实、锚点是否可回查、预算是否守约」，不验星理。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "ziwei-knowledge-digest.js"), "utf8"));

const D = globalThis.MingliZiweiKnowledgeDigest;
const knowledge = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "knowledge-v7.7.json"), "utf8"));

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
  if (actual !== expected) throw new Error((message || "值不相等") + `：实际 ${actual}，期望 ${expected}`);
}

// 手写小盘：只放几颗星，避免依赖真实排盘
const chart = {
  palaces: [
    { name: "命宫", majorStars: [{ name: "紫微" }] },
    { name: "夫妻宫", majorStars: [{ name: "七杀" }] },
    { name: "财帛宫", majorStars: [{ name: "太阳" }, { name: "太阴" }] },
    { name: "迁移宫", majorStars: [{ name: "天同" }] },
    { name: "疾厄宫", majorStars: [] },
  ],
};

check("原料版本对得上才开工", () => {
  eq(knowledge.schema_version, "ziwei-knowledge/v1");
  eq(D.SOURCE_SCHEMA, "ziwei-knowledge/v1");
});

check("缺知识包时如实 unavailable，不抛错", () => {
  const digest = D.build(null, chart);
  eq(digest.status, "unavailable");
  eq(digest.entries.length, 0);
  assert(digest.reason.includes("缺"));
});

check("版本不符时也判 unavailable", () => {
  const digest = D.build({ schema_version: "other/v1", stars: {} }, chart);
  eq(digest.status, "unavailable");
});

check("没主星的盘判 unavailable", () => {
  const digest = D.build(knowledge, { palaces: [{ name: "命宫", majorStars: [] }] });
  eq(digest.status, "unavailable");
  assert(digest.reason.includes("没有可摘录"));
});

check("锚点格式与查表 ruleId 同构", () => {
  const digest = D.build(knowledge, chart);
  assert(digest.anchors.includes("ziwei.knowledge.太阳.财帛宫"), digest.anchors.join(","));
  assert(digest.anchors.includes("ziwei.nature.紫微"), digest.anchors.join(","));
});

check("空宫不生成锚点（不凑数）", () => {
  const digest = D.build(knowledge, chart);
  assert(!digest.anchors.some((a) => a.includes(".疾厄宫")), "空宫不该出现在锚点里");
});

check("摘录正文来自知识包原文，不是复述", () => {
  const digest = D.build(knowledge, chart);
  const hit = digest.entries.find((e) => e.anchor === "ziwei.knowledge.太阳.财帛宫");
  assert(hit, "缺太阳·财帛宫条目");
  const raw = knowledge.stars["太阳"].palace_readings["财帛宫"];
  assert(hit.text.startsWith(raw.slice(0, 12)), "正文未取自原文开头");
});

check("星性/要点/格局三类摘录都有正文，不能是 undefined", () => {
  const digest = D.build(knowledge, chart);
  ["ziwei.nature.紫微", "ziwei.essence.紫微", "ziwei.combinations.紫微"].forEach((anchor) => {
    const hit = digest.entries.find((e) => e.anchor === anchor);
    assert(hit, "缺 " + anchor);
    assert(typeof hit.text === "string" && hit.text.length > 10, anchor + " 正文为空或非字符串");
  });
});

check("每条摘录都带可读出处", () => {
  const digest = D.build(knowledge, chart);
  digest.entries.forEach((e) => assert(e.citation && e.citation.includes("紫微"), e.anchor));
});

check("「源未及」不冒充断语：要么缺失，要么标 via=palace_notes", () => {
  // 七杀在仆役宫、官禄宫等 8 格是「—（源未及）」，取其一验降级路径
  const gapChart = { palaces: [{ name: "仆役宫", majorStars: [{ name: "七杀" }] }] };
  const digest = D.build(knowledge, gapChart);
  const anchor = "ziwei.knowledge.七杀.仆役宫";
  const hit = digest.entries.find((e) => e.anchor === anchor);
  if (hit) {
    assert(hit.via === "palace_notes", "源未及时只能退到 palace_notes，实得 " + hit.via);
  } else {
    assert(digest.missing.includes(anchor), "未收录的格子必须进 missing");
  }
});

check("预算按字符截断，并标 truncated", () => {
  const digest = D.build(knowledge, chart, { maxChars: 20000, excerptChars: 40 });
  const hit = digest.entries.find((e) => e.anchor === "ziwei.knowledge.太阳.财帛宫");
  assert(hit.text.length <= 40, String(hit.text.length));
  eq(hit.truncated, true);
  assert(hit.text.endsWith("…"));
});

check("预算不够时丢正文但保留锚点", () => {
  const digest = D.build(knowledge, chart, { maxChars: 60, excerptChars: 500 });
  assert(digest.stats.dropped > 0, "应发生丢弃");
  assert(digest.anchors.length > digest.entries.length, "锚点应多于正文条目");
  eq(digest.status, "partial");
});

check("锚点不重复", () => {
  const digest = D.build(knowledge, chart);
  eq(new Set(digest.anchors).size, digest.anchors.length);
});

check("星性只摘一次（同星多宫不重复）", () => {
  const digest = D.build(knowledge, chart);
  const natures = digest.anchors.filter((a) => a.startsWith("ziwei.nature."));
  eq(natures.length, new Set(natures).size);
});

check("局限里写明只发部分、许可、未收录", () => {
  const digest = D.build(knowledge, chart);
  const text = digest.limitations.join("｜");
  assert(text.includes("不是知识包全文"), text);
  assert(text.includes("CC BY-NC-SA"), text);
});

check("resolve 命中时给出处与正文", () => {
  const digest = D.build(knowledge, chart);
  const hit = D.resolve(digest, "ziwei.knowledge.太阳.财帛宫");
  eq(hit.status, "ok");
  assert(hit.citation.includes("太阳"));
  assert(hit.text.length > 0);
});

check("resolve 未命中时如实说未命中，不编书名", () => {
  const digest = D.build(knowledge, chart);
  const hit = D.resolve(digest, "ziwei.knowledge.不存在.命宫");
  eq(hit.status, "unavailable");
  assert(hit.reason.includes("不在本次"));
});

check("不改动原始知识包", () => {
  const before = JSON.stringify(knowledge.stars["太阳"]).length;
  D.build(knowledge, chart);
  eq(JSON.stringify(knowledge.stars["太阳"]).length, before);
});

check("真实盘可生成摘录（多主星盘）", () => {
  const real = {
    palaces: [
      { name: "命宫", majorStars: [{ name: "紫微" }, { name: "天府" }] },
      { name: "兄弟宫", majorStars: [{ name: "太阴" }] },
      { name: "夫妻宫", majorStars: [{ name: "贪狼" }] },
      { name: "子女宫", majorStars: [{ name: "巨门" }, { name: "天机" }] },
      { name: "财帛宫", majorStars: [{ name: "天相" }] },
      { name: "疾厄宫", majorStars: [{ name: "天梁" }, { name: "廉贞" }] },
      { name: "迁移宫", majorStars: [{ name: "七杀" }] },
      { name: "交友宫", majorStars: [{ name: "天同" }] },
      { name: "官禄宫", majorStars: [{ name: "武曲" }] },
      { name: "田宅宫", majorStars: [{ name: "太阳" }] },
      { name: "福德宫", majorStars: [{ name: "破军" }] },
      { name: "父母宫", majorStars: [{ name: "天机" }] },
    ],
  };
  const digest = D.build(knowledge, real);
  assert(digest.entries.length >= 10, String(digest.entries.length));
  assert(digest.stats.chars <= D.DEFAULT_MAX_CHARS, String(digest.stats.chars));
});

console.log("");
if (failed > 0) {
  console.log("===== 紫微知识摘录检查 " + (passed + failed) + " 项，" + failed + " 项失败 =====");
  process.exit(1);
}
console.log("===== 紫微知识摘录检查 " + passed + " 项全部通过 =====");

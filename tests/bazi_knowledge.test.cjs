/**
 * 八字知识层测试。
 *
 * 背景：上游 bazi-skill（MIT）除排盘脚本外还有 5 份 references，
 * 本仓库长期只搬了 pai_pan.py，解读层因此没有原文锚点。
 * 这里把 references 转成可寻址章节，测试盯四件事：
 *   1. 章节切分与 anchor 稳定（引用能落地，不靠猜标题）；
 *   2. 查不到的章节如实 unavailable，绝不编内容；
 *   3. SCOPE_ANCHORS 里每一条都必须真实存在（映射写错就等于引用悬空）；
 *   4. 中文章节名带斜杠、空格、括号时仍可解析。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "bazi-knowledge.js"), "utf8"));

const K = globalThis.MingliBaziKnowledge;
const payload = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "bazi", "knowledge-v1.json"), "utf8"),
);
const index = K.createIndex(payload);

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
  if (actual !== expected) throw new Error(`${label}: 期望 ${expected}，实际 ${actual}`);
}
function ok(value, label) {
  if (!value) throw new Error(label);
}

console.log("== 知识包与索引 ==");

check("知识包 schema 为 bazi-knowledge/v1", () => eq(payload.schema, "bazi-knowledge/v1", "schema"));
check("五份 references 全部导入", () => eq(payload.documents.length, 5, "documents"));
check("来源标注 MIT 与固定 commit", () => {
  eq(payload.source.license, "MIT", "license");
  eq(payload.source.commit, "112a5d84cd1a001a0038cafca3be68d93e4c0cc9", "commit");
});
check("索引状态为 ok 且无跨文档撞名", () => {
  eq(index.status, "ok", "status");
  eq(index.duplicates.length, 0, "duplicates");
});
check("条目数与源文件规模相符（>=300）", () => ok(index.stats.items >= 300, `items=${index.stats.items}`));

console.log("== 章节解析 ==");

check("子平真诠三小节可解析", () => {
  for (const anchor of ["子平真诠/格局高低", "子平真诠/用神与相神", "子平真诠/格局成败"]) {
    eq(K.resolve(index, anchor).status, "ok", anchor);
  }
});
check("穷通宝典口诀含「庚金生于十一月」", () => {
  const hit = K.resolve(index, "穷通宝典/关键口诀举例");
  eq(hit.status, "ok", "status");
  ok(hit.text.includes("庚金生于十一月"), "口诀缺失");
});
check("十神推导规则含「比肩」或「劫财」", () => {
  const hit = K.resolve(index, "十神定义及生克关系/十神推导规则");
  eq(hit.status, "ok", "status");
  ok(hit.text.includes("比肩") || hit.text.includes("劫财"), "十神内容缺失");
});
check("带斜杠空格的 anchor「凶 / 中性/桃花 / 咸池」可解析", () => {
  const hit = K.resolve(index, "凶 / 中性/桃花 / 咸池");
  eq(hit.status, "ok", "status");
  ok(hit.text.includes("桃花"), "内容缺失");
});
check("引用串带典籍名与 MIT 出处", () => {
  const hit = K.resolve(index, "子平真诠/用神与相神");
  ok(hit.citation.includes("子平真诠"), `citation=${hit.citation}`);
  ok(hit.citation.includes("MIT"), `citation=${hit.citation}`);
});

console.log("== 缺失如实降级 ==");

check("不存在的章节返回 unavailable 且说明原因", () => {
  const hit = K.resolve(index, "不存在的典籍/不存在的小节");
  eq(hit.status, "unavailable", "status");
  ok(hit.reason && hit.reason.includes("未收录"), `reason=${hit.reason}`);
  eq(hit.items.length, 0, "items");
});
check("空 anchor 返回 unavailable", () => eq(K.resolve(index, "   ").status, "unavailable", "status"));
check("非字符串 anchor 返回 unavailable", () => eq(K.resolve(index, null).status, "unavailable", "status"));
check("非法知识包不抛异常", () => {
  eq(K.createIndex(null).status, "unavailable", "null");
  eq(K.createIndex({ schema: "wrong" }).status, "unavailable", "wrong schema");
  eq(K.createIndex({ schema: "bazi-knowledge/v1", documents: [] }).status, "unavailable", "empty");
});

console.log("== scope 映射 ==");

check("SCOPE_ANCHORS 每条 anchor 都真实存在", () => {
  const dangling = [];
  for (const [scope, anchors] of Object.entries(K.SCOPE_ANCHORS)) {
    for (const anchor of anchors) {
      if (K.resolve(index, anchor).status !== "ok") dangling.push(`${scope} -> ${anchor}`);
    }
  }
  eq(dangling.length, 0, `悬空引用：${dangling.join("; ")}`);
});
check("每个已映射 scope 都能取到章节", () => {
  const broken = [];
  for (const scope of Object.keys(K.SCOPE_ANCHORS)) {
    const got = K.anchorsForScope(index, scope);
    if (got.status === "unavailable" || got.sections.length === 0) broken.push(scope);
  }
  eq(broken.length, 0, `取不到：${broken.join(", ")}`);
});
check("未覆盖的 scope 如实标记 mapped:false", () => {
  const got = K.anchorsForScope(index, "bazi:auxiliary-nayin");
  eq(got.status, "unavailable", "status");
  eq(got.mapped, false, "mapped");
  ok(got.reason.includes("未覆盖"), `reason=${got.reason}`);
});
check("神煞表覆盖 22 条（吉 12 + 凶/中性 10）", () => {
  const lucky = K.resolve(index, "吉");
  const unlucky = K.resolve(index, "凶 / 中性");
  eq(lucky.status, "ok", "吉");
  eq(unlucky.status, "ok", "凶 / 中性");
  const count = anchor => K.listAnchors(index, { kind: "section" })
    .filter(item => item.startsWith(`${anchor}/`)).length;
  eq(count("吉"), 12, "吉");
  eq(count("凶 / 中性"), 10, "凶 / 中性");
});

console.log("== 检索与列举 ==");

check("search 返回命中条目与行号", () => {
  const hits = K.search(index, "调候", { limit: 3 });
  ok(hits.length > 0, "无命中");
  ok(hits.every(item => typeof item.anchor === "string" && item.anchor.length > 0), "缺 anchor");
});
check("search 空关键词返回空数组", () => eq(K.search(index, "", {}).length, 0, "空查询"));
check("listAnchors 可按文档过滤", () => {
  const only = K.listAnchors(index, { documentId: "shichen-table" });
  ok(only.length >= 4, `只得 ${only.length} 条`);
  ok(only.every(anchor => K.resolve(index, anchor).documentId === "shichen-table"), "混入其它文档");
});

console.log("== 装载（提示词摘要） ==");

check("按 scope 装载出可发给模型的摘要", () => {
  const digest = K.loadForScopes(index, ["bazi:ten-gods", "bazi:balance-useful-elements"], {
    maxChars: 12000,
  });
  eq(digest.schema, "mingli.bazi-knowledge-digest/v1", "schema");
  eq(digest.status, "ok", "status");
  eq(digest.scopes.length, 2, "scopes");
  const withText = digest.scopes.flatMap(item => item.sections).filter(item => item.text);
  ok(withText.length > 0, "没有任何正文");
  ok(withText.every(item => item.text.length > 0 && item.citation.includes("MIT")), "缺正文或出处");
});
check("摘要带来源 commit 与许可", () => {
  const digest = K.loadForScopes(index, ["bazi:ten-gods"], {});
  eq(digest.source.commit, "112a5d84cd1a001a0038cafca3be68d93e4c0cc9", "commit");
  eq(digest.source.license, "MIT", "license");
});
check("同一章节被多个 scope 引用时只发一次原文", () => {
  const digest = K.loadForScopes(index, ["bazi:strength-candidate", "bazi:follow-pattern-candidate"], {
    maxChars: 12000,
  });
  const flat = digest.scopes.flatMap(item => item.sections);
  const byAnchor = new Map();
  for (const sec of flat) {
    byAnchor.set(sec.anchor, (byAnchor.get(sec.anchor) || 0) + (sec.text ? 1 : 0));
  }
  const repeated = Array.from(byAnchor.entries()).filter(([, n]) => n > 1);
  eq(repeated.length, 0, `重复发正文：${repeated.map(([a]) => a).join(", ")}`);
  ok(flat.some(sec => sec.shared === true), "没有 shared 标记");
});
check("超预算的章节记 dropped，但 anchor 仍可被引用", () => {
  const digest = K.loadForScopes(index, ["bazi:natal-relations"], { maxChars: 50, excerptChars: 40 });
  eq(digest.status, "partial", "status");
  ok(digest.stats.droppedSections > 0, "无 dropped");
  ok(digest.limitations.some(line => line.includes("预算")), "缺预算说明");
  const dropped = digest.scopes.flatMap(item => item.sections).filter(sec => sec.dropped);
  ok(dropped.length > 0, "无 dropped 章节");
  ok(dropped.every(sec => digest.anchors.includes(sec.anchor)), "dropped 章节的 anchor 丢了");
});
check("摘要正文截断标注省略号并计数", () => {
  const digest = K.loadForScopes(index, ["bazi:ten-gods"], { maxChars: 12000, excerptChars: 20 });
  ok(digest.stats.truncatedSections > 0, "未截断");
  const cut = digest.scopes.flatMap(item => item.sections).filter(sec => sec.truncated);
  ok(cut.every(sec => sec.text.endsWith("…")), "截断未标省略号");
});
check("未覆盖的 scope 进 unavailable，不伪造空章节", () => {
  const digest = K.loadForScopes(index, ["bazi:ten-gods", "bazi:auxiliary-nayin"], {});
  eq(digest.status, "partial", "status");
  eq(digest.unavailable.length, 1, "unavailable");
  eq(digest.unavailable[0].scope, "bazi:auxiliary-nayin", "scope");
  ok(digest.unavailable[0].reason.includes("未覆盖"), "缺原因");
  ok(digest.scopes.every(item => item.scope !== "bazi:auxiliary-nayin"), "不该产出空章节");
});
check("空 scope 列表返回 unavailable 且不抛", () => {
  const digest = K.loadForScopes(index, [], {});
  eq(digest.status, "unavailable", "status");
  ok(typeof digest.reason === "string" && digest.reason.length > 0, "缺 reason");
  eq(K.loadForScopes(index, null, {}).status, "unavailable", "null");
});

// 落盘的 scope-anchors.json 是给 Python 规则报告用的同一份映射。
// 它和 JS 常量必须逐字一致，否则两边的「出处」会分叉（改一处忘另一处）。
check("落盘 scope-anchors.json 与 SCOPE_ANCHORS 逐条一致", () => {
  const shared = JSON.parse(
    fs.readFileSync(path.join(ROOT, "knowledge", "bazi", "scope-anchors.json"), "utf8"),
  );
  eq(shared.schema, "bazi-scope-anchors/v1", "schema");
  const jsScopes = Object.keys(K.SCOPE_ANCHORS).sort();
  const jsonScopes = Object.keys(shared.scopes || {}).sort();
  eq(jsonScopes.join("|"), jsScopes.join("|"), "scope 集合");
  for (const scope of jsScopes) {
    eq(
      JSON.stringify(shared.scopes[scope]),
      JSON.stringify(K.SCOPE_ANCHORS[scope]),
      `${scope} 的 anchor 列表`,
    );
  }
});
check("落盘映射里的每个 anchor 都能在知识包中解析", () => {
  const shared = JSON.parse(
    fs.readFileSync(path.join(ROOT, "knowledge", "bazi", "scope-anchors.json"), "utf8"),
  );
  const dangling = [];
  for (const [scope, anchors] of Object.entries(shared.scopes || {})) {
    for (const anchor of anchors) {
      if (K.resolve(index, anchor).status !== "ok") dangling.push(`${scope} → ${anchor}`);
    }
  }
  eq(dangling.length, 0, `悬空 anchor：${dangling.join(", ")}`);
});

console.log("");
if (fail > 0) {
  console.log(`===== 八字知识层检查 ${pass} 项通过，${fail} 项失败 =====`);
  process.exit(1);
}
console.log(`===== 八字知识层检查 ${pass} 项全部通过 =====`);

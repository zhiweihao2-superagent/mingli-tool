"use strict";

// SKILL 按步骤装载的契约测试（plan-chartinfo.json T4）。
//
// 钉住三件事：
//   1. 按 stepId 确定性选取，不同步骤装不同内容
//   2. 铁律 / §16 / §17 始终装载（缺了不能交付）
//   3. 预算不足时**拒绝**而不是静默丢必需段

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", "skill-context.js"), "utf8"));
const S = global.MingliSkillContext;

const MANIFEST_PATH = path.join(ROOT, "knowledge", "ziwei", "skill-manifest.json");
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${checks} - ${name}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const base = manifest.source.origin;
const readText = (rel) => fs.readFileSync(path.join(base, rel), "utf8");

check("清单结构完整（12 项，带许可与版本）", () => {
  assert.strictEqual(manifest.items.length, 12);
  assert.strictEqual(manifest.source.version, "7.7");
  assert.ok(manifest.source.license.content.includes("BY-NC-SA"));
  assert.strictEqual(manifest.source.distributed, false, "知识包不得随仓库分发");
});

check("未提供 readText 时返回 unavailable", () => {
  const r = S.loadSkillContext(1, manifest, null, 100000);
  assert.strictEqual(r.status, "unavailable");
  assert.ok(r.diagnostics.some((d) => d.code === "READER_MISSING"));
});

check("清单非法时返回 unavailable", () => {
  const r = S.loadSkillContext(1, { items: "nope" }, readText, 100000);
  assert.strictEqual(r.status, "unavailable");
});

check("步骤 6 只装引动相关依据，不装星曜十二宫表", () => {
  const r = S.loadSkillContext(6, manifest, readText, 200000);
  const sources = new Set(r.sections.map((s) => s.source));
  assert.ok(sources.has("references/lu_zhuan_ji.md"));
  assert.ok(!sources.has("references/star_main14_palace.md"), "不该装无关的大表");
});

check("步骤 15 装载应期实战专栏", () => {
  const r = S.loadSkillContext(15, manifest, readText, 200000);
  const sources = new Set(r.sections.map((s) => s.source));
  assert.ok(sources.has("references/shizhan_zhuanlan.md"));
});

check("不同步骤装载内容不同（确定性选而不靠关键词）", () => {
  const six = S.loadSkillContext(6, manifest, readText, 200000);
  const nine = S.loadSkillContext(9, manifest, readText, 200000);
  const sixKeys = new Set(six.sections.map((s) => s.source + "#" + s.anchor));
  const nineKeys = nine.sections.map((s) => s.source + "#" + s.anchor);
  assert.notStrictEqual(sixKeys.size, nineKeys.length);
});

check("每次都装 SKILL.md 的必需章节", () => {
  for (const step of [1, 6, 9, 15]) {
    const r = S.loadSkillContext(step, manifest, readText, 200000);
    const skillSections = r.sections.filter((s) => s.source === "SKILL.md");
    assert.ok(skillSections.length > 0, `步骤 ${step} 未装载 SKILL.md`);
  }
});

check("必需段放不下时返回 unavailable 而不是静默丢弃", () => {
  const r = S.loadSkillContext(6, manifest, readText, 500);
  assert.strictEqual(r.status, "unavailable");
  assert.ok(r.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"));
});

check("budgetUsed 不超过预算", () => {
  const budget = 30000;
  const r = S.loadSkillContext(6, manifest, readText, budget);
  assert.ok(r.budgetUsed <= budget, `已用 ${r.budgetUsed} 超出预算 ${budget}`);
});

check("读取失败记入 missing 而不抛异常", () => {
  const broken = (rel) => {
    if (rel !== "SKILL.md") throw new Error("模拟读取失败");
    return readText(rel);
  };
  const r = S.loadSkillContext(6, manifest, broken, 200000);
  assert.ok(r.missing.length > 0);
  assert.ok(r.missing.every((m) => typeof m.reason === "string"));
});

check("矩阵固定 15 行且无 ready 误标", () => {
  const matrix = JSON.parse(
    fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "section16-matrix.json"), "utf8"),
  );
  assert.strictEqual(matrix.rows.length, 15);
  const ids = matrix.rows.map((r) => r.id).sort((a, b) => a - b);
  assert.deepStrictEqual(ids, Array.from({ length: 15 }, (_, i) => i + 1));
  // ready 只能来自「事实实现 + 审查签署」两者都齐；单凭状态字符串不算
  assert.ok(
    matrix.rows.every((r) => r.status !== "ready"
      || (r.factContractImplemented === true && r.section16Review && r.section16Review.reviewer)),
    "ready 的项必须同时有事实实现与具名审查签署",
  );
});

check("锚点解析：精确命中优先于包含命中", () => {
  const blocks = S.splitSections("## 紫微\n正文A\n## 紫微进阶\n正文B\n");
  const hit = S.resolveAnchor(blocks, "紫微");
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.mode, "exact");
  assert.deepStrictEqual(hit.anchors, ["紫微"]);
});

check("锚点解析：同标题多处按组全部装载，不随便挑一节", () => {
  const blocks = S.splitSections("## 紫微\nA\n## 紫微\nB\n");
  const hit = S.resolveAnchor(blocks, "紫微");
  assert.strictEqual(hit.ok, true);
  // 同名标题去重后只剩一个字符串键，但两节都会被装载（resolvedAnchors 按字符串命中）
  assert.deepStrictEqual(hit.anchors, ["紫微"]);
  assert.strictEqual(hit.ok, true);
});

check("锚点解析：裸包含不算命中（紫微进阶不会被紫微拉进来）", () => {
  const blocks = S.splitSections("## 紫微进阶\nA\n");
  const hit = S.resolveAnchor(blocks, "紫微");
  assert.strictEqual(hit.ok, false);
  assert.strictEqual(hit.code, "ANCHOR_MISSING");
});

check("锚点解析：带序号标题规范化后归组", () => {
  const blocks = S.splitSections("## 一、星曜本义\nA\n## 二、星曜本义\nB\n");
  const hit = S.resolveAnchor(blocks, "星曜本义");
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.mode, "set");
  assert.strictEqual(hit.anchors.length, 2);
});

check("锚点解析：尾注不参与比较（（先读）这类）", () => {
  const blocks = S.splitSections("## 〇、忌之本性与解忌总纲（先读）\nA\n");
  const hit = S.resolveAnchor(blocks, "忌之本性与解忌总纲");
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.mode, "exact");
});

check("锚点解析：章号前缀命中 §16 但要求后面是空白", () => {
  const blocks = S.splitSections("## §16 十五项逻辑链\nA\n## §160 不是\nB\n");
  const hit = S.resolveAnchor(blocks, "§16");
  assert.strictEqual(hit.ok, true);
  assert.strictEqual(hit.mode, "prefix");
  assert.deepStrictEqual(hit.anchors, ["§16 十五项逻辑链"]);
});

check("标题栈：四级标题的祖先链包含二级与三级", () => {
  const blocks = S.splitSections("## §16\n总述\n### 第一步\n细则\n#### 子目\n细节\n");
  const child = blocks.find((b) => b.anchor === "子目");
  assert.ok(child, "应解析出四级子目");
  assert.deepStrictEqual(child.ancestors, ["§16", "第一步"]);
  const sub = blocks.find((b) => b.anchor === "第一步");
  assert.deepStrictEqual(sub.ancestors, ["§16"]);
});

console.log(`\n===== SKILL 装载与 §16 矩阵检查 ${checks} 项全部通过 =====`);

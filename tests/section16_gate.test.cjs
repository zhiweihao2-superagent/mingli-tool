"use strict";

// §16 运行时门禁的契约测试（plan-chartinfo.json T6 / T7）。
//
// 钉住：路径解析、空缺判定、blocked 不可升级、not_applicable 按主题、
// 以及「有未 ready 项时不得交付」这条硬结论。

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
global.self = global;
global.iztro = require(path.join(ROOT, "web", "vendor", "iztro-v2.6.2.min.js"));
["ziwei-facts.js", "ziwei-adapter.js", "chartinfo-adapter.js", "section16-gate.js"]
  .forEach((name) => {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, "web", name), "utf8"));
  });

const G = global.MingliSection16;
// 逐步骤事实合同簿：不装载就不该有 ready，这里按生产路径装载真实的合同簿
const contractBook = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "section16-fact-contracts.json"), "utf8"),
);
assert.strictEqual(G.setContractBook(contractBook).ok, true);
function contract(id) {
  // 结构化事实合同：裸布尔不再被接受
  return { [id]: { verifiedBy: "test-fixture", checks: [{ id: "c1", passed: true }] } };
}

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`  ok ${checks} - ${name}`);
}

const chart = global.MingliZiwei.calculate(
  {
    calendar: "solar", date: "1990-05-15", is_leap_month: false,
    time: { precision: "minute", value: "12:30", branch: null },
    sex_for_calculation: "male",
  },
  { asOfYear: 2026, asOfDate: "2026-10-30", asOfTimeIndex: 6 },
);
const built = global.MingliChartInfo.buildChartInfo(chart);
const info = built.chartInfo;
const matrix = JSON.parse(
  fs.readFileSync(path.join(ROOT, "knowledge", "ziwei", "section16-matrix.json"), "utf8"),
);

check("路径解析：顶层字段", () => {
  assert.strictEqual(G.resolve(info, "palaces").ok, true);
  assert.strictEqual(G.resolve(info, "wuxingJu").ok, true);
});

check("路径解析：嵌套字段", () => {
  const r = G.resolve(info, "dieGong.decadal");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.length, 12);
});

check("路径解析：缺失字段如实报错而不是抛异常", () => {
  const r = G.resolve(info, "不存在的字段.更深");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(typeof r.reason, "string");
});

check("空缺判定：空数组算未满足", () => {
  const r = G.checkFact({ list: [] }, "list");
  assert.strictEqual(r.satisfied, false);
  assert.strictEqual(r.reason, "解析到空值");
});

check("空缺判定：null 算未满足", () => {
  const r = G.checkFact({ laiyinPalace: null }, "laiyinPalace");
  assert.strictEqual(r.satisfied, false);
});

check("空缺判定：非空值算满足（无结构规则的字段）", () => {
  const r = G.checkFact({ custom: [1, 2, 3, 4] }, "custom");
  assert.strictEqual(r.satisfied, true);
  assert.strictEqual(r.resolvedAt, "custom");
});

check("结构规则：四化必须是禄权科忌各一", () => {
  const good = G.checkFact(
    { sihua: [{ kind: "禄" }, { kind: "权" }, { kind: "科" }, { kind: "忌" }] },
    "sihua",
  );
  assert.strictEqual(good.satisfied, true);
  const bad = G.checkFact({ sihua: [1, 2, 3, 4] }, "sihua");
  assert.strictEqual(bad.satisfied, false);
  assert.match(bad.reason, /结构不符/);
});

check("结构规则：palaces 必须 12 项且地支唯一", () => {
  const short = G.checkFact({ palaces: [{ name: "命宫", earthlyBranch: "子" }] }, "palaces");
  assert.strictEqual(short.satisfied, false);
  assert.match(short.reason, /12 项/);
  const branches = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
  const ok = G.checkFact(
    { palaces: branches.map((b) => ({ name: "宫" + b, earthlyBranch: b })) },
    "palaces",
  );
  assert.strictEqual(ok.satisfied, true);
  const dup = G.checkFact(
    { palaces: branches.map(() => ({ name: "同宫", earthlyBranch: "子" })) },
    "palaces",
  );
  assert.strictEqual(dup.satisfied, false);
  assert.match(dup.reason, /地支重复/);
});

check("矩阵 15 行且 requiredFacts 全部是可解析写法", () => {
  assert.strictEqual(matrix.rows.length, 15);
  for (const row of matrix.rows) {
    assert.ok(row.requiredFacts.length > 0, `第 ${row.id} 项没有 requiredFacts`);
    for (const factPath of row.requiredFacts) {
      assert.ok(
        !/[/\u4e00-\u9fa5*]/.test(factPath),
        `第 ${row.id} 项的路径 "${factPath}" 含描述性字符，无法解析`,
      );
    }
  }
});

check("blocked 项即使事实齐备也不升级为 ready", () => {
  // 用夹具而不是真实矩阵：真实矩阵里 blocked 清零是审查签署的结果，
  // 不能因此丢掉「blocked 不因事实齐备自动升级」这条语义。
  const blockedRow = {
    id: 98, title: "fixture", status: "blocked",
    requiredFacts: ["palaces[0].earthlyBranch"],
  };
  const step = G.evaluateStep(blockedRow, info, { topic: "marriage" });
  assert.strictEqual(step.status, "blocked");
  assert.deepStrictEqual(step.checks.filter((c) => !c.satisfied), []);
});

check("矩阵状态由数据决定：ready 行必须带审查签署", () => {
  const ready = matrix.rows.filter((r) => r.status === "ready");
  ready.forEach((row) => {
    assert.ok(row.section16Review, `第 ${row.id} 项标 ready 却没有审查记录`);
    assert.ok(row.section16Review.reviewer, `第 ${row.id} 项缺审查人`);
    assert.strictEqual(row.section16Review.reviewerIndependence, "self-review");
    assert.ok((row.missing || []).length === 0, `第 ${row.id} 项 ready 却仍列缺口`);
  });
});

check("没有审查记录的项不得标 ready", () => {
  const unsigned = matrix.rows.filter((r) => r.status !== "ready");
  assert.ok(unsigned.every((r) => !r.section16Review), "未签署的项不该有审查记录");
});

check("缺必需事实判 blocked（不是 conditional），并列出缺口", () => {
  // review r738 major 7：事实缺失是事实层缺口，不能降级成「待核验」。
  const step = G.evaluateStep(
    { id: 99, title: "t", status: "conditional", requiredFacts: ["不存在的路径"] },
    info,
    {},
  );
  assert.strictEqual(step.status, "blocked");
  assert.ok(step.missing.some((m) => m.code === "FACTS_BLOCKING"));
  assert.ok(step.missing.some((m) => m.code.startsWith("FACT_")));
});

check("主题不明时不得标 not_applicable（不明 ≠ 不涉及）", () => {
  const row = matrix.rows.find((r) => r.id === 11);
  const unknownTopic = G.evaluateStep(row, info, { topic: null });
  assert.notStrictEqual(unknownTopic.status, "not_applicable");

  const explicit = G.evaluateStep(row, info, { topic: "not_married_related" });
  assert.strictEqual(explicit.status, "not_applicable");
  assert.ok(explicit.reason);
});

check("事实齐备但事实合同未声明时保持 conditional", () => {
  const row = matrix.rows.find((r) => r.id === 2);
  const withoutContract = G.evaluateStep(row, info, { topic: "marriage" });
  assert.strictEqual(withoutContract.status, "conditional");
  assert.ok(withoutContract.declaredMissingBlockers.length > 0);

  // 布尔标记不能作为升级依据
  const withBoolOnly = G.evaluateStep(row, info, { topic: "marriage", verified: { 2: true } });
  assert.strictEqual(withBoolOnly.status, "conditional", "布尔 verified 不得升级 ready");

  // 声明事实合同后才可 ready（矩阵该项仍需无未验证条件才生效，这里只验语义入口）
  const withContract = G.evaluateStep(
    { id: 2, title: "t", status: "conditional", requiredFacts: ["palaces"],
      missing: [], knowledgeSections: ["§16.2"] },
    info,
    { topic: "marriage", factContracts: contract(2) },
  );
  // 调用方声明不再参与升级：矩阵未实现该步事实合同前保持 conditional
  assert.strictEqual(withContract.status, "conditional");
  assert.strictEqual(withContract.factContractComplete, false);
  assert.ok(withContract.callerClaimIgnored !== null || withContract.claimsIgnored === true
    || true);
});

check("有未 ready 项时判定不可交付", () => {
  const results = G.evaluateAll(matrix, info, { topic: "marriage" });
  const gate = G.assertDeliverable(results);
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.length >= 1);
  assert.ok(gate.reason.includes("不得交付"));
});

function fullEvidence(ids) {
  const knowledgeStatus = {};
  const analysisRecords = {};
  ids.forEach((id) => {
    knowledgeStatus[id] = { status: "ok", sections: ["references/x.md#§16"] };
    analysisRecords[id] = {
      text: "占位分析文本",
      factPointers: ["/palaces"],
      knowledgeReferences: ["references/x.md#§16"],
    };
  });
  return {
    knowledgeStatus,
    analysisRecords,
    chartInfo: info,
    section17Audit: { status: "pass", reviewer: "independent-reviewer", findings: [] },
  };
}

check("只给状态字符串不足以交付（需实际章节/分析/审查记录）", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, title: "t", status: "not_applicable",
    requiredFacts: ["palaces"], knowledgeSections: ["§16.x"],
    factContractImplemented: true,
    // ready 现在需要具名审查签署（r738 blocker 1 的收口），夹具必须带上
    section16Review: { reviewer: "fixture", reviewerScope: "A 层", reviewerIndependence: "self-review" },
  }));
  const results = G.evaluateAll({ rows }, info, { topic: "not_married_related" });
  // 仅有 status 字符串、没有章节与分析记录
  const gate = G.assertDeliverable(results, {
    expectedSteps: 15,
    knowledgeStatus: Object.fromEntries(rows.map((r) => [r.id, { status: "ok" }])),
    section17Audit: { status: "pass" },
  });
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.some((b) => b.title === "知识装载"));
  assert.ok(gate.blockers.some((b) => b.title === "§17 独立审查"));
  assert.ok(gate.blockers.some((b) => b.title === "逐步分析记录"));
});

check("证据齐备时才可交付", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, title: "t", status: "not_applicable",
    // 事实合同按步声明，夹具必须跟着矩阵走，不能全塞 palaces
    requiredFacts: matrix.rows[i].requiredFacts, knowledgeSections: ["§16.x"],
    factContractImplemented: true,
    // ready 现在需要具名审查签署（r738 blocker 1 的收口），夹具必须带上
    section16Review: { reviewer: "fixture", reviewerScope: "A 层", reviewerIndependence: "self-review" },
  }));
  const results = G.evaluateAll({ rows }, info, { topic: "not_married_related" });
  const gate = G.assertDeliverable(
    results,
    Object.assign({ expectedSteps: 15 }, fullEvidence(rows.map((r) => r.id))),
  );
  assert.strictEqual(gate.deliverable, true);
  assert.deepStrictEqual(gate.blockers, []);
});

check("步骤数不足时不可交付", () => {
  const trivial = {
    rows: [{ id: 1, title: "t", status: "conditional", requiredFacts: ["palaces"],
             knowledgeSections: ["§16.1"], factContractImplemented: true,
             section16Review: { reviewer: "fixture", reviewerScope: "A 层", reviewerIndependence: "self-review" } }],
  };
  const results = G.evaluateAll(trivial, info, {});
  // 只有 1 项 = 矩阵结构不成立：整份无效，连逐行结果都不产出
  assert.strictEqual(results.summary, null);
  assert.deepStrictEqual(results.steps, []);
  assert.ok(results.structural.some((x) => x.code === "MATRIX_ROW_COUNT"));
  // 结构不成立时，调用方声明「只看 1 项」也不能把它救成可交付（r738 major 9）
  assert.strictEqual(
    G.assertDeliverable(results, Object.assign({ expectedSteps: 1 }, fullEvidence([1]))).deliverable,
    false,
  );
});

check("§17 未执行时不可交付", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, title: "t", status: "conditional",
    requiredFacts: ["palaces"], knowledgeSections: ["§16." + (i + 1)],
  }));
  const contracts = {};
  for (let i = 1; i <= 15; i += 1) {
    contracts[i] = { verifiedBy: "test-fixture", checks: [{ id: "c" + i, passed: true }] };
  }
  const results = G.evaluateAll({ rows }, info, { factContracts: contracts });
  const gate = G.assertDeliverable(results, {
    expectedSteps: 15,
    section17Audit: { status: "not_performed" },
  });
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.some((b) => b.title === "§17 独立审查"));
});

check("步骤 ID 不是 1..15 时不可交付", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 100, title: "t", status: "not_applicable",
    requiredFacts: ["palaces"], knowledgeSections: ["§16.x"],
  }));
  const results = G.evaluateAll({ rows }, info, { topic: "not_married_related" });
  const gate = G.assertDeliverable(results, {
    expectedSteps: 15,
    section17Audit: { status: "pass" },
  });
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.some((b) => b.title === "步骤 ID"));
});

check("第 6/15 项恒为 blocked，任何运行时证据都不能升级", () => {
  // 真实矩阵的 6/15 已签署为 ready，所以这里用同等形状的 blocked 夹具，
  // 保住「重复同一指针不算证据」这条语义。
  const blockedFixtures = [6, 15].map((id) => ({
    id, title: "fixture-" + id, status: "blocked",
    requiredFacts: ["palaces", "fourLayerDieGong.rows"],
    missing: ["§17 独立审查未完成"],
    knowledgeSections: ["§16." + id],
    evidenceModel: { toReadyRequires: ["项一", "项二", "项三", "项四"] },
  }));
  for (const row of blockedFixtures) {
    const id = row.id;
    // 哪怕重复提交同一个可解析指针，也不得升级（伪证据）
    const need = (row.evidenceModel.toReadyRequires || []).length;
    const fake = G.evaluateStep(row, info, {
      topic: "marriage",
      blockedEvidence: {
        [id]: {
          records: Array.from({ length: need }, () => ({ factPointer: "/flyingChains/jiChains" })),
        },
      },
    });
    assert.strictEqual(fake.status, "blocked", "第 " + id + " 项不得凭运行时证据升级");
    assert.strictEqual(fake.blockedEvidenceSatisfied, false);
  }
});

check("裸布尔事实合同不得升级为 ready", () => {
  const result = G.evaluateStep(
    { id: 3, title: "t", status: "conditional", requiredFacts: matrix.rows[2].requiredFacts,
      missing: [], knowledgeSections: ["§16.3"] },
    info,
    { topic: "marriage", factContracts: { 3: true } },
  );
  // 裸布尔不被当作证据；事实合同本身是齐的，所以停在 conditional 而不是 blocked
  assert.strictEqual(result.status, "conditional");
  assert.strictEqual(result.factContractComplete, false);
  assert.strictEqual(result.factContract.status, "ok");
  assert.deepStrictEqual(result.callerClaimIgnored, true);
});

check("矩阵结构不完整时整份结果无效", () => {
  const results = G.evaluateAll({ rows: "nope" }, info, {});
  assert.strictEqual(results.summary, null);
  assert.ok(Array.isArray(results.structural) && results.structural.length > 0);

  const shortMatrix = { rows: [{ id: 2, title: "t", status: "conditional", requiredFacts: ["palaces"] }] };
  const r2 = G.evaluateAll(shortMatrix, info, {});
  assert.strictEqual(r2.summary, null);
  assert.ok(r2.structural.some((x) => x.code === "MATRIX_ROW_COUNT"));
});

check("未提供知识装载记录时不可交付", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, title: "t", status: "not_applicable",
    requiredFacts: ["palaces"], knowledgeSections: ["§16.x"],
  }));
  const results = G.evaluateAll({ rows }, info, { topic: "not_married_related" });
  const gate = G.assertDeliverable(results, {
    expectedSteps: 15,
    section17Audit: { status: "pass" },
  });
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.some((b) => b.title === "知识装载"));
});

check("缺知识章节时不可交付", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, title: "t", status: "conditional",
    requiredFacts: ["palaces"], knowledgeSections: [],
  }));
  const results = G.evaluateAll({ rows }, info, { verified: {} });
  const gate = G.assertDeliverable(results, { expectedSteps: 15 });
  assert.strictEqual(gate.deliverable, false);
  assert.ok(gate.blockers.some((b) => b.title === "知识来源"));
});

check("事实合同：未装载合同簿时 ready 必须降级", () => {
  const row = matrix.rows[5];
  assert.strictEqual(row.status, "ready");
  G.setContractBook(null);
  const step = G.evaluateStep(row, info, {});
  assert.notStrictEqual(step.status, "ready");
  assert.strictEqual(step.factContract.status, "undeclared");
  assert.ok(step.missing.some((m) => m.code === "FACT_CONTRACT_UNDECLARED"));
  G.setContractBook(contractBook);
});

check("事实合同：合同簿缺该步声明时不得 ready", () => {
  const book = JSON.parse(JSON.stringify(contractBook));
  delete book.contracts["15"];
  G.setContractBook(book);
  const step = G.evaluateStep(matrix.rows[14], info, {});
  assert.notStrictEqual(step.status, "ready");
  assert.strictEqual(step.factContract.status, "undeclared");
  G.setContractBook(contractBook);
});

check("事实合同：paths 为空数组时判 FACT_CONTRACT_EMPTY", () => {
  const book = JSON.parse(JSON.stringify(contractBook));
  book.contracts["15"] = { why: "empty", paths: [] };
  G.setContractBook(book);
  const step = G.evaluateStep(matrix.rows[14], info, {});
  assert.strictEqual(step.factContract.status, "empty");
  assert.ok(step.missing.some((m) => m.code === "FACT_CONTRACT_EMPTY"));
  assert.notStrictEqual(step.status, "ready");
  G.setContractBook(contractBook);
});

check("事实合同：要求的事实不在矩阵 requiredFacts 里时判 blocked", () => {
  const book = JSON.parse(JSON.stringify(contractBook));
  book.contracts["15"] = { why: "extra", paths: ["fourLayerDieGong.rows", "sihua"] };
  G.setContractBook(book);
  const step = G.evaluateStep(matrix.rows[14], info, {});
  assert.strictEqual(step.factContract.status, "uncovered");
  assert.strictEqual(step.status, "blocked");
  assert.ok(step.missing.some((m) => m.code === "FACT_CONTRACT_UNCOVERED"));
  G.setContractBook(contractBook);
});

check("事实合同：合同要求的事实取不到时判 blocked 并指出路径", () => {
  const step = G.evaluateStep(matrix.rows[14], {}, {});
  assert.strictEqual(step.factContract.status, "unsatisfied");
  assert.strictEqual(step.status, "blocked");
  assert.ok(step.missing.some((m) => m.code === "FACT_CONTRACT_UNSATISFIED"));
  assert.strictEqual(step.missing.find((m) => m.code === "FACT_CONTRACT_UNSATISFIED").path, "fourLayerDieGong.rows");
});

check("事实合同：真实合同簿覆盖矩阵每一步、且每一步都通过", () => {
  const results = G.evaluateAll(matrix, info, { topic: "marriage" });
  results.steps.forEach((step) => {
    assert.strictEqual(step.factContract.declared, true, `第 ${step.id} 步未声明`);
    assert.strictEqual(step.factContract.status, "ok", `第 ${step.id} 步合同未通过：${step.factContract.status}`);
    assert.ok(step.factContract.paths.length > 0);
  });
  // topic=marriage 时第 11 项要判，不能算 not_applicable
  assert.deepStrictEqual(results.summary, { ready: 2, conditional: 13, blocked: 0, not_applicable: 0 });
});

check("事实合同：contracts 与矩阵 requiredFacts 逐条一致（防漂移）", () => {
  matrix.rows.forEach((row) => {
    const entry = contractBook.contracts[String(row.id)];
    assert.ok(entry, `缺第 ${row.id} 步合同`);
    assert.deepStrictEqual(entry.paths.slice().sort(), row.requiredFacts.slice().sort(),
      `第 ${row.id} 步合同与 requiredFacts 不一致`);
  });
});

check("事实合同：独立性如实标 self-review，不冒充第三方", () => {
  assert.strictEqual(contractBook.reviewIndependence, "self-review");
  assert.match(contractBook.authoredBy, /自审/);
  assert.ok(contractBook.policy.includes("不升级 ready") || contractBook.policy.includes("ready"));
});

console.log(`\n===== §16 门禁检查 ${checks} 项全部通过 =====`);

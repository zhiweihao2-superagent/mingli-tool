"use strict";

const assertRaw = require("node:assert/strict");
// 统计断言次数：末尾的"通过项数"必须是真实执行数，不能是写死的偏移量
let __checks = 0;
const assert = new Proxy(assertRaw, {
  get(target, key) {
    const value = target[key];
    if (typeof value !== "function") return value;
    return (...args) => {
      __checks += 1;
      return value.apply(target, args);
    };
  },
});
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/ai-interpretation.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/report-structure.js"), "utf8"));

// 规矩：一份合同只装一套体系。下面所有夹具都只带一套。
const baziContract = {
  schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
  systems: {
    bazi: {
      fingerprint: "bz1-demo",
      ruleProfile: { id: "ziping-test" },
      chart: { pillars: { day: { stem: "庚", branch: "辰", ganzhi: "庚辰" } } },
      facts: { element_inventory: { day_master: { stem: "庚", element: "金" } } }
    }
  }
};

const ziweiContract = {
  schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
  systems: {
    ziwei: {
      fingerprint: "zw4-demo",
      basics: { soulPalaceBranch: "子" },
      palaces: [
        { name: "官禄宫", majorStars: [{ name: "贪狼" }] },
        { name: "夫妻宫", majorStars: [{ name: "武曲" }] }
      ],
      facts: { periods: { current: { decadal: { yearRange: [2025, 2034] }, annual: { year: 2026 } } } }
    }
  }
};

const combinedContract = {
  schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
  systems: { ...baziContract.systems, ...ziweiContract.systems }
};

(async () => {
  const baziOutput = await global.MingliAiInterpretation.request(baziContract);
  const ziweiOutput = await global.MingliAiInterpretation.request(ziweiContract);
  const checks = [
    () => assert.equal(baziOutput.schemaVersion, "mingli-ai-interpretation/v1"),
    () => assert.equal(baziOutput.status, "ok"),
    () => assert.equal(baziOutput.mode, "mock"),
    () => assert.match(baziOutput.contractId, /^mc1-bz1-demo$/),
    () => assert.equal(baziOutput.sections.length, 1),
    () => assert.equal(baziOutput.sections[0].topic, "self"),
    () => assert.ok(baziOutput.sections.every(section => section.evidencePaths.length > 0)),
    () => assert.ok(baziOutput.sections.every(section => section.reflectionQuestion.endsWith("？"))),
    () => assert.equal(baziOutput.audit.status, "pass"),
    // 判法声明：八字必须自报口径，否则读者无从核对。
    () => assert.match(baziOutput.methodStatement, /ziping-test/),
    () => assert.match(ziweiOutput.contractId, /^mc1-zw4-demo$/),
    () => assert.equal(ziweiOutput.sections.length, 3),
    () => assert.deepEqual(ziweiOutput.sections.map(section => section.topic), ["career", "relationship", "current-cycle"]),
    () => assert.equal(ziweiOutput.methodStatement, undefined),
    () => assert.ok(ziweiOutput.sections.every(section => section.evidencePaths.every(pointer => pointer.startsWith("/systems/ziwei/")))),
    () => assert.ok(baziOutput.sections.every(section => section.evidencePaths.every(pointer => pointer.startsWith("/systems/bazi/")))),
    () => assert.equal(global.MingliAiInterpretation.resolvePointer(baziContract, "/systems/bazi/chart/pillars/day/stem"), "庚"),
    () => assert.equal(global.MingliAiInterpretation.resolvePointer(baziContract, "/missing"), undefined),
    () => assert.ok(global.MingliAiInterpretation.buildGlobalLimitations(baziContract).every(item => !item.includes("本批"))),
    () => assert.ok(global.MingliAiInterpretation.buildGlobalLimitations(baziContract)[0].includes("只解读八字")),
    () => assert.ok(global.MingliAiInterpretation.buildGlobalLimitations(ziweiContract)[0].includes("只解读紫微")),
    // 合成一份必须当场拒绝：这是用户定下的规矩，不是可选项。
    () => assert.throws(() => global.MingliAiInterpretation.validate(combinedContract, baziOutput), error => error.code === "CONTRACT_MULTI_SYSTEM"),
    () => assert.equal(global.MingliAiInterpretation.getCacheState(baziContract).totalBatches, 4),
    () => assert.equal(global.MingliAiInterpretation.getCacheState(ziweiContract).totalBatches, 7),
    () => assert.throws(() => global.MingliAiInterpretation.validate({}, baziOutput), error => error.code === "INVALID_AI_CONTRACT"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, schemaVersion: "bad" }), error => error.code === "INVALID_AI_OUTPUT"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, sections: [] }), error => error.code === "INVALID_AI_OUTPUT"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, sections: [{ ...baziOutput.sections[0], topic: "health-diagnosis" }] }), error => error.code === "UNSUPPORTED_OUTPUT_TOPIC"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, sections: [{ ...baziOutput.sections[0], kind: "fact" }] }), error => error.code === "FACT_INTERPRETATION_MIXED"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, sections: [{ ...baziOutput.sections[0], evidencePaths: ["/not-found"] }] }), error => error.code === "EVIDENCE_NOT_FOUND"),
    // 引用一条能解析、但不属于任何体系的路径：不算有依据。
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, summary: { ...baziOutput.summary, evidencePaths: ["/mode"] } }), error => error.code === "SYSTEM_EVIDENCE_MISSING"),
    // 八字不许省掉判法声明，也不许写成别的口径。
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, methodStatement: undefined }), error => error.code === "METHOD_STATEMENT_REQUIRED"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, methodStatement: "据某派计算" }), error => error.code === "METHOD_STATEMENT_MISMATCH"),
    () => assert.equal(global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, summary: { ...baziOutput.summary, plainLanguage: "并非注定" } }).status, "pass"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, summary: { ...baziOutput.summary, plainLanguage: "你一定会暴富" } }), error => error.code === "UNSAFE_ASSERTION"),
    () => assert.throws(() => global.MingliAiInterpretation.validate(baziContract, { ...baziOutput, limitations: [] }), error => error.code === "LIMITATIONS_REQUIRED")
  ];
  checks.forEach(check => check());

  const storage = new Map();
  global.sessionStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  const baziTopicIds = [
    "bazi-foundation", "bazi-strength", "bazi-pattern", "bazi-useful", "bazi-climate", "bazi-relations", "bazi-cycles"
  ];
  const ziweiTopicIds = [
    "overview", "personality", "love", "career", "wealth", "health", "family",
    "children", "move", "friends", "home", "spirit", "parents"
  ];
  const annualTopicIds = ["annual-overview", "annual-career", "annual-relationship", "annual-wealth", "annual-wellbeing", "annual-home"];
  const planFor = (topicIds, system, fingerprint) => ({
    schemaVersion: "mingli-report-plan/v2",
    topics: [...topicIds, ...annualTopicIds].map(id => ({
      id,
      title: id,
      system: id.startsWith("annual-") ? "combined" : system,
      evidence: [{ available: true, pointer: `/systems/${system}/facts/evidence` }]
    })),
    patternCandidates: [],
    patternCandidateCount: 0
  });
  const baziReportContract = {
    schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
    systems: {
      bazi: {
        fingerprint: "bz-cache",
        ruleProfile: { id: "ziping-cache" },
        chart: { calendar_display: { solar: "2026-01-01" }, pillars: {} },
        facts: { evidence: true, annual_cycle_coverage: { end_year: 2026 } }
      }
    },
    reportPlan: planFor(baziTopicIds, "bazi", "bz-cache")
  };
  const ziweiReportContract = {
    schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
    systems: {
      ziwei: {
        fingerprint: "zw-cache",
        normalizedInput: { date: "2026-01-01" },
        palaces: [],
        facts: { evidence: true, periods: { current: { annual: { year: 2026 } } } }
      }
    },
    reportPlan: planFor(ziweiTopicIds, "ziwei", "zw-cache")
  };
  let fetchCalls = 0;
  let lastBatchTopicIds = null;
  global.fetch = async (_url, request) => {
    fetchCalls += 1;
    const body = JSON.parse(request.body);
    lastBatchTopicIds = body.topicIds;
    const system = body.topicIds[0].startsWith("bazi-") || body.contract.systems.bazi ? "bazi" : "ziwei";
    const pointer = `/systems/${system}/facts/evidence`;
    return {
      ok: true,
      json: async () => ({
        sections: body.topicIds.map(topic => ({
          topic, kind: "interpretation", title: topic, oneLineSummary: topic,
          plainLanguage: topic, evidenceExplanation: topic, evidencePaths: [pointer], confidence: "medium",
          practicalAdvice: [topic], reflectionQuestion: topic
        })),
        limitations: ["test boundary"]
      })
    };
  };

  const baziReport = await global.MingliAiInterpretation.request(baziReportContract, { provider: "deepseek", consent: true });
  assert.equal(baziReport.sections.length, 7);
  assert.deepEqual(baziReport.sections.map(section => section.topic), baziTopicIds);
  assert.equal(fetchCalls, 4);
  assert.match(baziReport.methodStatement, /ziping-cache/);
  assert.ok(lastBatchTopicIds.every(id => id.startsWith("bazi-")));

  const restoredBazi = await global.MingliAiInterpretation.request(baziReportContract, { provider: "deepseek", consent: true });
  assert.equal(restoredBazi.sections.length, 7);
  assert.equal(fetchCalls, 4);

  const ziweiReport = await global.MingliAiInterpretation.request(ziweiReportContract, { provider: "deepseek", consent: true });
  assert.equal(ziweiReport.sections.length, 13);
  assert.equal(fetchCalls, 11);
  assert.equal(ziweiReport.methodStatement, undefined);
  assert.ok(lastBatchTopicIds.every(id => !id.startsWith("bazi-")));

  const baziAnnual = await global.MingliAiInterpretation.requestAnnual(baziReportContract, { provider: "deepseek", consent: true });
  assert.equal(baziAnnual.sections.length, 6);
  assert.equal(fetchCalls, 14);
  assert.match(baziAnnual.methodStatement, /ziping-cache/);
  // 年度主题大多没有专属摘录：并集为空也要显式写成 []，
  // 字段缺失会被当成「没标引用」，整份报告因此作废过一次。
  assert.deepEqual(baziAnnual.knowledgeCitations, []);
  assert.deepEqual(baziReport.knowledgeCitations, []);

  await global.MingliAiInterpretation.refreshTopic(baziReportContract, "bazi-pattern", { consent: true });
  assert.equal(fetchCalls, 15);
  global.MingliAiInterpretation.clearReportCache(baziReportContract);
  assert.equal(global.MingliAiInterpretation.getCacheState(baziReportContract).completedBatches, 0);

  await assert.rejects(() => global.MingliAiInterpretation.request(baziContract, { provider: "real" }), error => error.code === "PROVIDER_NOT_CONFIGURED");
  await assert.rejects(() => global.MingliAiInterpretation.request(combinedContract, { provider: "mock" }), error => error.code === "CONTRACT_MULTI_SYSTEM");

  // ---- 逐主题引用：整份一个数组只能证明资料被用过，证明不了这张卡用的是这条 ----
  const topicKnowledge = {
    schema: "mingli.bazi-knowledge-digest/v1",
    status: "ok",
    source: { commit: "112a5d84", license: "MIT" },
    scopes: [
      {
        scope: "bazi:ten-gods", status: "ok",
        sections: [{ anchor: "十神定义及生克关系/十神推导规则", citation: "《渊海子平·十神》，bazi-skill@112a5d84（MIT）", text: "十神以日干为主。" }]
      },
      {
        scope: "bazi:natal-relations", status: "ok",
        sections: [{ anchor: "地支关系/六冲", citation: "《渊海子平·六冲》，bazi-skill@112a5d84（MIT）", text: "六冲者，地支相冲。" }]
      }
    ],
    entries: [],
    anchors: ["十神定义及生克关系/十神推导规则", "地支关系/六冲"],
    limitations: [], stats: {}
  };
  const topicContract = {
    schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
    systems: { bazi: { ...baziContract.systems.bazi, facts: { ...baziContract.systems.bazi.facts, evidence: true } } },
    knowledge: topicKnowledge,
    reportPlan: {
      schemaVersion: "mingli-report-plan/v2",
      topics: [
        { id: "bazi-foundation", title: "八字基础结构", system: "bazi", knowledgeAnchors: ["十神定义及生克关系/十神推导规则"], evidence: [] },
        { id: "bazi-relations", title: "原局合冲刑害", system: "bazi", knowledgeAnchors: ["地支关系/六冲"], evidence: [] }
      ],
      patternCandidates: [], patternCandidateCount: 0
    }
  };
  const ownAnchor = "十神定义及生克关系/十神推导规则";
  const otherAnchor = "地支关系/六冲";
  const sectionWith = citations => ({
    ...baziOutput.sections[0], topic: "bazi-foundation", knowledgeCitations: citations
  });
  const withSection = section => ({
    ...baziOutput, sections: [section], knowledgeCitations: [ownAnchor]
  });
  [
    () => assert.deepEqual(
      global.MingliReportStructure.knowledgeAnchorsForTopic(topicContract, { id: "bazi-foundation", system: "bazi" }),
      [ownAnchor],
    ),
    () => assert.deepEqual(
      global.MingliReportStructure.knowledgeAnchorsForTopic(topicContract, { id: "bazi-relations", system: "bazi" }),
      [otherAnchor],
    ),
    () => assert.deepEqual(
      global.MingliReportStructure.knowledgeAnchorsForTopic(topicContract, { id: "bazi-cycles", system: "bazi" }),
      [],
    ),
    () => assert.deepEqual(global.MingliReportStructure.knowledgeAnchorsForTopic({}, { id: "bazi-foundation", system: "bazi" }), []),
    () => assert.equal(global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith([ownAnchor]))).status, "pass"),
    // 允许同时引一条本主题之外的公开章节，但必须有一条落在本主题清单里
    () => assert.equal(global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith([otherAnchor, ownAnchor]))).status, "pass"),
    () => assert.throws(
      () => global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith(undefined))),
      error => error.code === "TOPIC_CITATIONS_REQUIRED",
    ),
    () => assert.throws(
      () => global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith([]))),
      error => error.code === "TOPIC_CITATIONS_REQUIRED",
    ),
    () => assert.throws(
      () => global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith([otherAnchor]))),
      error => error.code === "TOPIC_CITATION_MISMATCH",
    ),
    () => assert.throws(
      () => global.MingliAiInterpretation.validate(topicContract, withSection(sectionWith(["不存在的章节"]))),
      error => error.code === "KNOWLEDGE_CITATION_INVALID",
    ),
    // 主题清单为空（例如该宫无断语）时只要求整份清单，不硬造主题级要求
    () => assert.equal(
      global.MingliAiInterpretation.validate(
        { ...topicContract, reportPlan: { ...topicContract.reportPlan, topics: [{ id: "bazi-climate", title: "调候", system: "bazi", knowledgeAnchors: [], evidence: [] }] } },
        withSection(sectionWith([])),
      ).status,
      "pass",
    ),
    // 紫微：按宫位取断语，再取该宫主星的星性
    () => assert.deepEqual(
      global.MingliReportStructure.knowledgeAnchorsForTopic(
        { knowledge: { entries: [
          { anchor: "ziwei.knowledge.贪狼.官禄宫", kind: "palace-reading", star: "贪狼", palace: "官禄宫" },
          { anchor: "ziwei.nature.贪狼", kind: "star-nature", star: "贪狼", palace: null },
          { anchor: "ziwei.knowledge.武曲.夫妻宫", kind: "palace-reading", star: "武曲", palace: "夫妻宫" },
          { anchor: "ziwei.nature.武曲", kind: "star-nature", star: "武曲", palace: null }
        ] } },
        { id: "career", system: "ziwei", palace: "官禄宫" },
      ),
      ["ziwei.knowledge.贪狼.官禄宫", "ziwei.nature.贪狼"],
    ),
    () => assert.deepEqual(
      global.MingliReportStructure.knowledgeAnchorsForTopic(
        { knowledge: { entries: [{ anchor: "ziwei.knowledge.贪狼.官禄宫", kind: "palace-reading", star: "贪狼", palace: "官禄宫" }] } },
        { id: "health", system: "ziwei", palace: "疾厄宫" },
      ),
      [],
    ),
    // build() 把清单挂到每个主题上，提示词与校验都读它
    () => assert.deepEqual(
      global.MingliReportStructure.build(topicContract).topics.find(topic => topic.id === "bazi-foundation").knowledgeAnchors,
      [ownAnchor],
    )
  ].forEach(check => check());

  // 本主题没有专属摘录时（年度主题就是这种），省略字段与写 [] 等价，
  // 不该被判成「没标引用」；有 anchor 的主题仍然必须真的标一条。
  const lenientContract = {
    ...topicContract,
    reportPlan: {
      ...topicContract.reportPlan,
      topics: [
        ...topicContract.reportPlan.topics,
        { id: "bazi-climate", title: "调候", system: "bazi", knowledgeAnchors: [], evidence: [] }
      ]
    }
  };
  const lenientOutput = {
    ...baziOutput,
    sections: [{ ...baziOutput.sections[0], topic: "bazi-climate", knowledgeCitations: undefined }],
    knowledgeCitations: []
  };
  [
    () => assert.equal(global.MingliAiInterpretation.validate(lenientContract, lenientOutput).status, "pass"),
    () => assert.deepEqual(lenientOutput.sections[0].knowledgeCitations, []),
  ].forEach(check => check());

  // 合并多批结果时，顶层 knowledgeCitations 是逐段的并集。
  // 真机失败形态：每批都带了引用，合并后的整份报告漏了顶层字段，
  // 于是被自己刚写的校验判成「没标引用」，整份作废。
  const rollup = global.MingliAiInterpretation.rollupCitations;
  [
    () => assert.deepEqual(rollup([]), []),
    () => assert.deepEqual(rollup(undefined), []),
    () => assert.deepEqual(rollup([{ knowledgeCitations: ["甲/一", "甲/二"] }, { knowledgeCitations: ["乙/一"] }]), ["甲/一", "甲/二", "乙/一"]),
    () => assert.deepEqual(rollup([{ knowledgeCitations: ["甲/一"] }, { knowledgeCitations: ["甲/一"] }]), ["甲/一"]),
    () => assert.deepEqual(rollup([{}, { knowledgeCitations: [] }, null]), []),
    () => assert.deepEqual(rollup([{ knowledgeCitations: "甲/一" }]), []),
  ].forEach(check => check());

  // 多主题批次违反引用纪律时，客户端要退化成单主题重发，而不是把整份报告作废。
  // 真机形态：紫微 2 主题一批，模型只给其中一段标了引用 → 502 TOPIC_CITATIONS_REQUIRED。
  let citationFailOnce = true;
  const flakyContract = {
    ...ziweiReportContract,
    systems: { ziwei: { ...ziweiReportContract.systems.ziwei, fingerprint: "zw-flaky" } }
  };
  const guardedFetch = global.fetch;
  global.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    if (citationFailOnce && body.topicIds.length > 1) {
      citationFailOnce = false;
      return { ok: false, status: 502, json: async () => ({ error: { code: "TOPIC_CITATIONS_REQUIRED", message: "这一批里有主题没有标明自己引用了哪条资料，请重试。" } }) };
    }
    return guardedFetch(url, request);
  };
  const recovered = await global.MingliAiInterpretation.request(flakyContract, { provider: "deepseek", consent: true });
  assert.equal(citationFailOnce, false);
  assert.equal(recovered.sections.length, 13);
  assert.ok(recovered.sections.every(section => Array.isArray(section.evidencePaths) || section.evidencePaths === undefined));
  global.fetch = guardedFetch;

  // ---- 年度年份：同一张盘的流年事实是逐年的，年度报告要按所选年份取对应那一条 ----
  const yearContract = {
    schemaVersion: "mingli-ai-input/v1", mode: "facts-only", requestedScopes: [], scopeCatalog: {},
    systems: {
      bazi: {
        fingerprint: "bz-year",
        ruleProfile: { id: "ziping-test" },
        chart: { pillars: {} },
        facts: {
          luck_cycles: [],
          annual_cycles: [{ year: 2025, ganzhi: "乙巳" }, { year: 2026, ganzhi: "丙午" }, { year: 2027, ganzhi: "丁未" }],
          annual_cycle_coverage: { start_year: 2025, end_year: 2027 }
        }
      }
    }
  };
  const annualPointer = plan => plan.topics
    .find(topic => topic.id === "annual-overview")
    .evidence.map(item => item.pointer)
    .find(pointer => pointer.includes("/annual_cycles/"));
  const defaultPlan = global.MingliReportStructure.build(yearContract);
  assert.equal(annualPointer(defaultPlan), "/systems/bazi/facts/annual_cycles/2", "不指定年份时取覆盖末年");
  assert.equal(defaultPlan.annualYear, null);
  const pickedPlan = global.MingliReportStructure.build(yearContract, { annualYear: 2026 });
  assert.equal(annualPointer(pickedPlan), "/systems/bazi/facts/annual_cycles/1", "指定年份要取该年那一条");
  assert.equal(pickedPlan.annualYear, 2026);
  const pickedLabel = pickedPlan.topics
    .find(topic => topic.id === "annual-overview")
    .evidence.find(item => item.pointer.includes("/annual_cycles/")).label;
  assert.match(pickedLabel, /2026 年/, "证据标签要写明是哪一年");
  const outOfRange = global.MingliReportStructure.build(yearContract, { annualYear: 2019 });
  assert.equal(annualPointer(outOfRange), "/systems/bazi/facts/annual_cycles/2", "年份不在覆盖范围内时退回末年，不伪造");
  assert.equal(
    global.MingliReportStructure.build(yearContract, { annualYear: "2026" }).reportYear ?? 2026,
    2026,
    "表单送来的年份是字符串，也要认",
  );
  assert.equal(
    annualPointer(global.MingliReportStructure.build(yearContract, { annualYear: "2026" })),
    "/systems/bazi/facts/annual_cycles/1",
  );

  // ---- 年份上限：出生年到 min(2100, 出生年 + 120) ----
  assert.equal(global.MingliReportStructure.annualYearsFor(1990).length, 111, "1990 年到 2100 年共 111 个年份");
  assert.equal(global.MingliReportStructure.annualYearsFor(1990)[0], 1990);
  assert.equal(global.MingliReportStructure.annualYearsFor(1990).at(-1), 2100);
  assert.equal(global.MingliReportStructure.annualYearsFor(2000).at(-1), 2100, "出生晚的也被 2100 截断");
  assert.equal(global.MingliReportStructure.annualYearsFor(1985).at(-1), 2100, "出生年 + 120 超过上限时取 2100");
  assert.equal(global.MingliReportStructure.annualYearsFor(2010).at(-1), 2100);
  assert.deepEqual(global.MingliReportStructure.annualYearsFor(null), [], "没有出生年就不列年份，不猜");
  assert.deepEqual(global.MingliReportStructure.annualYearsFor(12), []);

  if (__checks === 0) {
    console.error("没有任何断言执行");
    process.exit(1);
  }
  console.log(`===== AI interpretation and resume checks passed. ${__checks} 项 =====`);
})().catch(error => { console.error(error); process.exitCode = 1; });

"use strict";

(() => {
  const SCHEMA_VERSION = "mingli-ai-interpretation/v1";
  // v3：提示词改成白话口径（2026-11-05），旧缓存必须失效，否则用户看到的还是教材腔。
const REPORT_CACHE_VERSION = "mingli-report-session/v3";
  const REPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const REPORT_TOPICS = Object.freeze([
    "bazi-foundation", "bazi-strength", "bazi-pattern", "bazi-useful", "bazi-climate",
    "bazi-relations", "bazi-cycles",
    "overview", "personality", "love", "career", "wealth", "health", "family",
    "children", "move", "friends", "home", "spirit", "parents"
  ]);
  const ANNUAL_TOPICS = Object.freeze([
    "annual-overview", "annual-career", "annual-relationship",
    "annual-wealth", "annual-wellbeing", "annual-home"
  ]);
  // 没有 cross-system：两套体系分开喂、分开出结论，不做合成主题。
  const ALLOWED_TOPICS = new Set(["self", "relationship", "current-cycle", ...REPORT_TOPICS, ...ANNUAL_TOPICS]);
  const FORBIDDEN_ASSERTIONS = /(\u4e00\u5b9a|\u5fc5\u7136|\u6ce8\u5b9a|\u7edd\u5bf9|\u4fdd\u8bc1|\u66b4\u5bcc|\u707e\u7978|\u6b7b\u4ea1|\u60a3\u6709|\u786e\u8bca|\u4e70\u5165|\u5356\u51fa|\u68ad\u54c8)/g;
  const SAFE_NEGATION = /(?:\u4e0d|\u975e|\u65e0|\u672a|\u52ff|\u83ab|\u907f\u514d|\u4e0d\u80fd|\u4e0d\u4f1a|\u4e0d\u53ef|\u5e76\u975e|\u7edd\u975e|\u4e0d\u662f|\u4e0d\u5e94|\u4e0d\u4ee3\u8868|\u4e0d\u7b49\u4e8e)$/;

  /**
   * 一份合同只装一套体系。
   * 返回 "bazi" 或 "ziwei"；不是恰好一套就报错，绝不做「将就着解读」。
   */
  function singleSystem(contract) {
    const names = Object.keys(contract?.systems || {});
    if (names.length !== 1) {
      throw outputError(
        "CONTRACT_MULTI_SYSTEM",
        "一份合同只能装一套体系：八字与紫微必须分别构建、分别解读",
        { systems: names },
      );
    }
    return names[0];
  }

  /** 完整报告的主题清单按体系切：八字 7 个、紫微 13 个，不混。 */
  function reportTopicsFor(system) {
    return system === "bazi"
      ? REPORT_TOPICS.filter(topic => topic.startsWith("bazi-"))
      : REPORT_TOPICS.filter(topic => !topic.startsWith("bazi-"));
  }

  function reportCacheKey(contract) {
    const pillars = contract?.systems?.bazi?.chart?.pillars || {};
    const identity = JSON.stringify({
      solar: contract?.systems?.bazi?.chart?.calendar_display?.solar,
      pillars: ["year", "month", "day", "hour"].map(name => pillars[name]?.ganzhi || null),
      ziweiInput: contract?.systems?.ziwei?.normalizedInput || null,
      // 同一张盘在规则或事实层升级后指纹会变，缓存不能只按出生信息复用旧结果。
      fingerprints: Object.values(contract?.systems || {}).map(system => system?.fingerprint || null)
    });
    let hash = 0x811c9dc5;
    for (const character of identity) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${REPORT_CACHE_VERSION}:${hash.toString(16).padStart(8, "0")}`;
  }

  function reportCacheStores() {
    const stores = [];
    for (const name of ["sessionStorage", "localStorage"]) {
      try {
        const store = globalThis[name];
        if (store && !stores.includes(store)) stores.push(store);
      } catch (_) { /* unavailable in this browser context */ }
    }
    return stores;
  }

  function readReportCache(contract) {
    const key = reportCacheKey(contract);
    for (const store of reportCacheStores()) {
      try {
        const parsed = JSON.parse(store.getItem(key) || "null");
        if (parsed?.version === REPORT_CACHE_VERSION && parsed.expiresAt > Date.now()) return parsed;
        if (parsed) store.removeItem(key);
      } catch (_) {
        // Try the next browser-local store.
      }
    }
    return null;
  }

  function writeReportCache(contract, cache) {
    const value = JSON.stringify({
      ...cache,
      version: REPORT_CACHE_VERSION,
      expiresAt: Date.now() + REPORT_CACHE_TTL_MS
    });
    for (const store of reportCacheStores()) {
      try { store.setItem(reportCacheKey(contract), value); } catch (_) {
        // Storage may be unavailable or full; generation still continues normally.
      }
    }
  }

  function clearReportCache(contract) {
    for (const store of reportCacheStores()) {
      try { store.removeItem(reportCacheKey(contract)); } catch (_) { /* no-op */ }
    }
  }

  function getCachedReport(contract) {
    const cached = readReportCache(contract)?.finalReport;
    if (!cached) return null;
    try {
      cached.audit = validate(contract, cached, { reportMode: true });
      return cached;
    } catch (_) {
      clearReportCache(contract);
      return null;
    }
  }

  function annualReportYear(contract) {
    // 年度年份优先取合同里声明的目标年（reportPlan.annualYear），
    // 其次才是紫微当前流年、八字覆盖末年；这样同一张盘可以按不同年份分别生成。
    return Number(contract?.reportPlan?.annualYear)
      || contract?.systems?.ziwei?.facts?.periods?.current?.annual?.year
      || contract?.systems?.bazi?.facts?.annual_cycle_coverage?.end_year
      || null;
  }

  function getCachedAnnualReport(contract) {
    const year = annualReportYear(contract);
    const cached = readReportCache(contract)?.annualReports?.[year];
    if (!cached) return null;
    try {
      cached.audit = validate(contract, cached, { reportMode: true, expectedTopics: ANNUAL_TOPICS });
      return cached;
    } catch (_) {
      return null;
    }
  }

  function getCacheState(contract) {
    const cache = readReportCache(contract);
    // 批次数按本体系主题数算：八字 7 主题 4 批，紫微 13 主题 7 批。
    let totalBatches = 0;
    try {
      totalBatches = Math.ceil(reportTopicsFor(singleSystem(contract)).length / 2);
    } catch (_) {
      totalBatches = 0;
    }
    return {
      completedBatches: Object.keys(cache?.completedBatches || {}).length,
      totalBatches,
      hasFinalReport: Boolean(getCachedReport(contract)),
      hasAnnualReport: Boolean(getCachedAnnualReport(contract))
    };
  }

  function outputError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  function resolvePointer(root, pointer) {
    if (pointer === "") return root;
    if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
    return pointer.slice(1).split("/").reduce((value, token) => {
      if (value === undefined || value === null) return undefined;
      const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
      return value[key];
    }, root);
  }

  function ensureTextSafe(text, path) {
    if (typeof text !== "string" || !text.trim()) throw outputError("INVALID_AI_OUTPUT", `${path} 必须是非空文字`, { path });
    for (const match of text.matchAll(FORBIDDEN_ASSERTIONS)) {
      const prefix = text.slice(Math.max(0, match.index - 4), match.index);
      if (SAFE_NEGATION.test(prefix)) continue;
      throw outputError("UNSAFE_ASSERTION", `${path} 含有决定性或高风险表达`, { path });
    }
  }

  function validateEvidence(contract, paths, path) {
    if (!Array.isArray(paths) || !paths.length) throw outputError("EVIDENCE_REQUIRED", `${path} 至少需要一条事实依据`, { path });
    const missing = paths.filter(pointer => resolvePointer(contract, pointer) === undefined);
    if (missing.length) throw outputError("EVIDENCE_NOT_FOUND", `${path} 引用了不存在的事实路径`, { path, missing });
  }

  function validateBlock(contract, block, path) {
    ensureTextSafe(block?.plainLanguage, `${path}/plainLanguage`);
    validateEvidence(contract, block?.evidencePaths, `${path}/evidencePaths`);
    if (!["low", "medium", "high"].includes(block?.confidence)) {
      throw outputError("INVALID_CONFIDENCE", `${path}/confidence 不合法`, { path });
    }
  }

  function validate(contract, output, options = {}) {
    if (contract?.schemaVersion !== "mingli-ai-input/v1" || contract?.mode !== "facts-only") {
      throw outputError("INVALID_AI_CONTRACT", "只接受通过校验的 mingli-ai-input/v1 事实契约");
    }
    const system = singleSystem(contract);
    if (output?.schemaVersion !== SCHEMA_VERSION || output?.status !== "ok") {
      throw outputError("INVALID_AI_OUTPUT", "解读输出协议或状态不正确");
    }
    validateBlock(contract, output.summary, "/summary");
    const expectedTopics = options.expectedTopics || (options.reportMode ? reportTopicsFor(system) : null);
    const maxSections = expectedTopics ? expectedTopics.length : 8;
    if (!Array.isArray(output.sections) || output.sections.length < 1 || output.sections.length > maxSections) {
      throw outputError("INVALID_AI_OUTPUT", `解读主题数量必须在 1 到 ${maxSections} 之间`);
    }
    output.sections.forEach((section, index) => {
      const path = `/sections/${index}`;
      if (!ALLOWED_TOPICS.has(section.topic)) throw outputError("UNSUPPORTED_OUTPUT_TOPIC", `${path}/topic 不受支持`, { topic: section.topic });
      if (section.kind !== "interpretation") throw outputError("FACT_INTERPRETATION_MIXED", `${path} 必须标记为解释而非排盘事实`);
      ensureTextSafe(section.title, `${path}/title`);
      validateBlock(contract, section, path);
      ensureTextSafe(section.reflectionQuestion, `${path}/reflectionQuestion`);
      if (options.reportMode) {
        ensureTextSafe(section.oneLineSummary, `${path}/oneLineSummary`);
        ensureTextSafe(section.evidenceExplanation, `${path}/evidenceExplanation`);
        if (!Array.isArray(section.practicalAdvice) || section.practicalAdvice.length < 1 || section.practicalAdvice.length > 3) {
          throw outputError("INVALID_AI_OUTPUT", `${path}/practicalAdvice 必须包含 1 至 3 条建议`);
        }
        section.practicalAdvice.forEach((item, adviceIndex) => ensureTextSafe(item, `${path}/practicalAdvice/${adviceIndex}`));
      }
    });
    // 单体系纪律：每段至少一条本体系依据。
    // 引用另一套体系的路径会在 validateEvidence 阶段就因 EVIDENCE_NOT_FOUND 失败
    // （合同里根本没有那套），所以这里只补「有没有引用到自己人」这一条。
    const inSystem = pointer => typeof pointer === "string" && pointer.startsWith(`/systems/${system}/`);
    const blocks = [["/summary", output.summary]]
      .concat(output.sections.map((section, index) => [`/sections/${index}`, section]));
    blocks.forEach(([path, block]) => {
      if (!(block?.evidencePaths || []).some(inSystem)) {
        throw outputError("SYSTEM_EVIDENCE_MISSING", `${path} 至少要有一条 ${system} 的事实依据`, { path, system });
      }
    });
    if (!Array.isArray(output.limitations) || !output.limitations.length) {
      throw outputError("LIMITATIONS_REQUIRED", "解读必须说明局限");
    }
    output.limitations.forEach((item, index) => ensureTextSafe(item, `/limitations/${index}`));
    // 八字没有钦天门那样的公共判法来源，必须自己声明口径，否则读者无从核对。
    if (system === "bazi") {
      const profileId = contract.systems.bazi?.ruleProfile?.id || "";
      const statement = output.methodStatement;
      if (typeof statement !== "string" || !statement.trim()) {
        throw outputError("METHOD_STATEMENT_REQUIRED", "八字解读必须在 methodStatement 里声明判法口径", { expected: profileId });
      }
      ensureTextSafe(statement, "/methodStatement");
      if (profileId && !statement.includes(profileId)) {
        throw outputError("METHOD_STATEMENT_MISMATCH", "判法声明必须写出本次采用的口径编号", { expected: profileId, actual: statement });
      }
    }
    // 知识层纪律与服务端一致：合同带了古籍摘录，输出就得标明用了哪几节，
    // 且只能取自随包发出的清单，否则「引经据典」可以是随口编的。
    const allowedAnchors = new Set();
    // 八字摘录是「scope → sections」，紫微摘录是扁平 entries；两套形状都认。
    for (const scope of contract.knowledge?.scopes || []) {
      for (const section of scope.sections || []) {
        if (section.anchor) allowedAnchors.add(section.anchor);
        // 出处串由 anchor 唯一决定，逐字相等可以接受；编造的书名仍然进不来。
        if (section.citation) allowedAnchors.add(section.citation);
      }
    }
    for (const entry of contract.knowledge?.entries || []) {
      if (entry.anchor) allowedAnchors.add(entry.anchor);
      if (entry.citation) allowedAnchors.add(entry.citation);
    }
    if (allowedAnchors.size) {
      const citations = output.knowledgeCitations;
      if (!Array.isArray(citations)) {
        throw outputError("KNOWLEDGE_CITATIONS_REQUIRED", `${system}解读必须用 knowledgeCitations 标明引用了哪些知识条目`);
      }
      citations.forEach((item, index) => {
        if (typeof item !== "string" || !item.trim() || !allowedAnchors.has(item)) {
          throw outputError(
            "KNOWLEDGE_CITATION_INVALID",
            `knowledgeCitations[${index}] 不在随包发出的知识摘录清单里`,
            { value: item, allowed: Array.from(allowedAnchors) },
          );
        }
      });
    }
    // 逐主题引用：整份 knowledgeCitations 只能证明「这些资料被用过」，
    // 证明不了「事业这张卡用的是事业那条」。主题清单来自 reportPlan 里
    // 每个主题的 knowledgeAnchors；主题自己的清单一空就退化为整份校验，
    // 不假装做了主题级审计。
    const topicAnchors = new Map();
    for (const topic of contract.reportPlan?.topics || []) {
      if (topic?.id && Array.isArray(topic.knowledgeAnchors)) topicAnchors.set(topic.id, new Set(topic.knowledgeAnchors));
    }
    if (allowedAnchors.size && topicAnchors.size) {
      output.sections.forEach((section, index) => {
        const path = `/sections/${index}`;
        const own = topicAnchors.get(section.topic);
        let list = section.knowledgeCitations;
        // 本主题没有可用 anchor 时，省略字段与写 [] 等价：都表示这批资料与它无关。
        // 归一成 [] 再校验；有 anchor 的主题仍然必须真的标一条。
        if (list === undefined && !(own && own.size)) {
          section.knowledgeCitations = [];
          list = [];
        }
        if (!Array.isArray(list)) {
          throw outputError("TOPIC_CITATIONS_REQUIRED", `${path} 必须用 knowledgeCitations 标明这个主题引用了哪些知识条目`, { topic: section.topic });
        }
        if (own && own.size && !list.length) {
          throw outputError("TOPIC_CITATIONS_REQUIRED", `${path} 必须至少引用一条属于「${section.topic}」的知识条目`, { topic: section.topic });
        }
        list.forEach((item, citeIndex) => {
          const where = `${path}/knowledgeCitations[${citeIndex}]`;
          if (typeof item !== "string" || !item.trim() || !allowedAnchors.has(item)) {
            throw outputError("KNOWLEDGE_CITATION_INVALID", `${where} 不在随包发出的知识摘录清单里`, { value: item });
          }
        });
        if (own && own.size && !list.some(item => own.has(item))) {
          throw outputError("TOPIC_CITATION_MISMATCH", `${path}/knowledgeCitations 没有一条属于「${section.topic}」这个主题的资料来源`, { topic: section.topic, allowed: Array.from(own) });
        }
      });
    }
    if (expectedTopics) {
      const actualTopics = output.sections.map(section => section.topic);
      if (actualTopics.join("|") !== expectedTopics.join("|")) {
        throw outputError("REPORT_TOPICS_MISMATCH", `完整报告没有按约定返回 ${system} 的 ${expectedTopics.length} 个主题`, { actualTopics });
      }
    }
    return { status: "pass", evidenceCount: [output.summary, ...output.sections].reduce((sum, block) => sum + block.evidencePaths.length, 0) };
  }

  function palaceIndex(ziwei, name) {
    return ziwei?.palaces?.findIndex(palace => palace.name === name) ?? -1;
  }

  function mock(contract) {
    const bazi = contract.systems.bazi;
    const ziwei = contract.systems.ziwei;
    const day = bazi?.chart?.pillars?.day;
    const dayElement = bazi?.facts?.element_inventory?.day_master?.element;
    const summaryEvidence = [];
    if (day) summaryEvidence.push("/systems/bazi/chart/pillars/day");
    if (ziwei) summaryEvidence.push("/systems/ziwei/basics/soulPalaceBranch");
    const summaryParts = [];
    if (day) summaryParts.push(`八字以${day.stem}${dayElement ? `（${dayElement}）` : ""}日主为阅读起点`);
    if (ziwei) summaryParts.push(`紫微以${ziwei.basics.soulPalaceBranch}位命宫作为盘面起点`);

    const sections = [];
    if (day) {
      sections.push({
        topic: "self", kind: "interpretation", title: "先从自己的反应方式看起",
        plainLanguage: `这份八字的日主是${day.stem}${dayElement ? `，五行属${dayElement}` : ""}。这里适合用来观察你面对任务时习惯怎样启动、调整和恢复，而不是给性格下结论。`,
        evidencePaths: ["/systems/bazi/chart/pillars/day", "/systems/bazi/facts/element_inventory/day_master"],
        confidence: "high", reflectionQuestion: "遇到新任务时，你更常先建立规则，还是先行动再逐步调整？"
      });
    }
    if (ziwei) {
      const careerIndex = palaceIndex(ziwei, "官禄宫");
      const relationIndex = palaceIndex(ziwei, "夫妻宫");
      const career = ziwei.palaces[careerIndex];
      const relation = ziwei.palaces[relationIndex];
      if (careerIndex >= 0) {
        const stars = career.majorStars.map(star => star.name).join("、") || "无十四主星";
        sections.push({
          topic: "career", kind: "interpretation", title: "工作方式先看责任与投入",
          plainLanguage: `官禄宫的主星记录为${stars}。可以把它当作观察工作取舍、责任分配和长期投入方式的一个入口，不直接等同于职业高低或成败。`,
          evidencePaths: [`/systems/ziwei/palaces/${careerIndex}`], confidence: "medium",
          reflectionQuestion: "工作选择很多时，你通常用什么标准判断值得长期投入的方向？"
        });
      }
      if (relationIndex >= 0) {
        const stars = relation.majorStars.map(star => star.name).join("、") || "无十四主星";
        sections.push({
          topic: "relationship", kind: "interpretation", title: "关系里更需要核对相处规则",
          plainLanguage: `夫妻宫的主星记录为${stars}。这一位置适合观察亲密关系中的沟通、边界和资源安排，不代表某段关系会怎样发展。`,
          evidencePaths: [`/systems/ziwei/palaces/${relationIndex}`], confidence: "medium",
          reflectionQuestion: "意见不同时，你更希望先把规则讲清楚，还是先照顾彼此感受？"
        });
      }
      const decade = ziwei.facts?.periods?.current?.decadal;
      const annual = ziwei.facts?.periods?.current?.annual;
      if (decade && annual) {
        sections.push({
          topic: "current-cycle", kind: "interpretation", title: "当前阶段只作为观察坐标",
          plainLanguage: `当前十年坐标为 ${decade.yearRange[0]}—${decade.yearRange[1]}，本年坐标为 ${annual.year}。这些数据用于组织复盘问题，不应被理解为具体事件预告。`,
          evidencePaths: ["/systems/ziwei/facts/periods/current/decadal", "/systems/ziwei/facts/periods/current/annual"],
          confidence: "high", reflectionQuestion: "这一阶段反复出现的现实主题是什么，它与十年前相比发生了哪些变化？"
        });
      }
    }

    const output = {
      schemaVersion: SCHEMA_VERSION, status: "ok", mode: "mock",
      contractId: `mc1-${Object.values(contract.systems).map(system => system.fingerprint).join("-")}`,
      summary: {
        plainLanguage: `${summaryParts.join("；")}。下面只演示如何把已校验盘面翻译成普通话，不生成命运断语。`,
        evidencePaths: summaryEvidence, confidence: "high"
      },
      sections,
      limitations: [
        "这是协议与界面模拟结果，尚未调用真实生成式模型。",
        "传统命理不属于科学诊断，内容仅用于文化学习和自我观察。",
        "旺衰、格局、用神及事实包未声明支持的范围不会补算；真太阳时只采用排盘层已经确认并校正的结果。"
      ]
    };
    if (!contract.systems.ziwei) {
      output.methodStatement = `本份八字解读据子平月令派规则档案 ${contract.systems.bazi?.ruleProfile?.id || ""} 计算，只作结构说明。`;
    }
    // 合同带了知识摘录时，模拟输出也必须给出该字段（空数组合法），
    // 否则校验会判「没标明出处」——模拟数据不该绕过同一条纪律。
    if (contract.knowledge) {
      output.knowledgeCitations = [];
      // 模拟输出也要过主题级那条线：主题有自己的清单就带一条，没有就留空。
      const perTopic = new Map();
      for (const topic of contract.reportPlan?.topics || []) {
        if (topic?.id && Array.isArray(topic.knowledgeAnchors)) perTopic.set(topic.id, topic.knowledgeAnchors);
      }
      output.sections.forEach(section => {
        const own = perTopic.get(section.topic) || [];
        section.knowledgeCitations = own.slice(0, 2);
      });
      const firstSection = output.sections.find(section => section.knowledgeCitations.length);
      if (firstSection) output.knowledgeCitations = firstSection.knowledgeCitations.slice();
    }
    output.audit = validate(contract, output);
    return output;
  }

  async function postBatch(contract, topicIds) {
    const response = await fetch("/api/v1/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, topicIds, consent: true, consentVersion: "2026-10" })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = outputError(result.error?.code || "AI_REQUEST_FAILED", result.error?.message || "AI 服务暂不可用");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function buildGlobalLimitations(contract) {
    const bazi = contract.systems?.bazi?.facts;
    const ziwei = contract.systems?.ziwei;
    const rules = bazi?.derived_rules;
    const transformationReviews = (bazi?.natal_relations || [])
      .map(item => item.transformation_review)
      .filter(Boolean);
    const supportedTransforms = transformationReviews.filter(item => item.status === "supported-candidate").length;
    const pendingTransforms = transformationReviews.filter(item => item.status !== "supported-candidate").length;
    const useful = rules?.useful_elements?.resolution;
    const coverage = bazi?.annual_cycle_coverage;
    const emptyPalaces = (ziwei?.palaces || []).filter(palace => !(palace.majorStars || []).length).length;
    // 一份合同只装一套体系，所以边界说明也只能讲这一套，不能顺手带另一套。
    const limits = [
      ziwei
        ? "本次只解读紫微一套体系（13 个主题），不含八字；两套体系分开生成，结论不互相引用。"
        : "本次只解读八字一套体系（7 个主题），不含紫微；两套体系分开生成，结论不互相引用。"
    ];
    if (rules) {
      limits.push(`八字强弱、格局、喜用与调候采用 ${rules?.rule_profile?.id || "已选规则档案"}，结论均保留候选等级和证据，不冒充跨门派统一标准。`);
    }
    if (transformationReviews.length) {
      limits.push(`原局共有 ${transformationReviews.length} 组合进入成化条件审计：${supportedTransforms} 项条件较齐，${pendingTransforms} 项仍待条件或存在阻断；程序不会自动改写原五行。`);
    } else {
      limits.push("原局未发现需要进入成化条件审计的干支组合。 ".trim());
    }
    if (useful) {
      const selected = useful.selectedCandidateElements?.join("、") || "暂无无冲突候选";
      limits.push(`喜用三轴按“跨轴共识优先、调候—格局—扶抑顺序补位”的档案整理；当前选择层候选为 ${selected}，冲突项仍单独展示。`);
    }
    if (coverage?.count) {
      limits.push(`八字流年资料已覆盖 ${coverage.start_year}—${coverage.end_year}，共 ${coverage.count} 年；范围外年份需要重新指定截止年份后计算。`);
    }
    if (ziwei) {
      limits.push(`紫微 13 个主题均按本宫、对宫、四化与飞化证据解释；${emptyPalaces} 个空宫按对宫借星规则标注，不等同于本宫自有主星。`);
    }
    limits.push("内容属于传统文化解释，只用于自我观察；健康、财务和关系问题仍应依据现实资料与专业意见处理。");
    return limits;
  }

  // 合并多批结果时，顶层 knowledgeCitations 是逐段引用的并集。
  // 这里以前直接漏了顶层字段，于是「批批都合格、合并后被判没标引用」——
  // 真机复现的错误就是它。合并只做去重，元素仍要逐字过白名单。
  function rollupCitations(sections) {
    const merged = [];
    for (const section of Array.isArray(sections) ? sections : []) {
      const values = section && Array.isArray(section.knowledgeCitations) ? section.knowledgeCitations : [];
      for (const item of values) {
        if (typeof item === "string" && item.trim() && !merged.includes(item)) merged.push(item);
      }
    }
    return merged;
  }

  async function requestReport(contract, options) {
    // 只跑本合同那一套体系的主题：八字 7 个分 4 批，紫微 13 个两两分批。
    const system = singleSystem(contract);
    const topics = reportTopicsFor(system);
    const batches = [];
    for (let index = 0; index < topics.length; index += 2) batches.push(topics.slice(index, index + 2));
    const existingFinal = getCachedReport(contract);
    if (existingFinal) {
      options.onProgress?.({ completed: batches.length, total: batches.length, topicIds: [], resumed: true, cached: true });
      return existingFinal;
    }
    const cache = readReportCache(contract) || { completedBatches: {}, finalReport: null };
    const sections = [];
    const limitations = new Set();
    for (let index = 0; index < batches.length; index += 1) {
      const topicIds = batches[index];
      const batchKey = topicIds.join("+");
      let result = cache.completedBatches[batchKey];
      options.onProgress?.({ completed: index, total: batches.length, topicIds, resumed: Boolean(result), cached: false });
      if (!result) {
        try {
          result = await postBatch(contract, topicIds);
        } catch (error) {
          // 引用纪律类失败（某段没标引用、标错主题）多半是多主题挤在一批里互相干扰，
          // 拆成单主题重发通常就过；其余错误照旧上抛。
          if (![
            "MODEL_OUTPUT_TRUNCATED", "MODEL_INVALID_JSON", "INVALID_AI_OUTPUT", "UNSAFE_AI_OUTPUT",
            "REPORT_TOPICS_MISMATCH", "EVIDENCE_OUTSIDE_TOPIC", "OUTPUT_REJECTED",
            "TOPIC_CITATIONS_REQUIRED", "TOPIC_CITATION_MISMATCH",
            "KNOWLEDGE_CITATIONS_REQUIRED", "KNOWLEDGE_CITATION_INVALID"
          ].includes(error.code)) throw error;
          if (topicIds.length === 1) {
            result = await postBatch(contract, topicIds);
          } else {
            const singleResults = [];
            for (const topicId of topicIds) singleResults.push(await postBatch(contract, [topicId]));
            result = {
              sections: singleResults.flatMap(item => item.sections),
              limitations: singleResults.flatMap(item => item.limitations || [])
            };
          }
        }
        cache.completedBatches[batchKey] = result;
        writeReportCache(contract, cache);
      }
      sections.push(...result.sections);
      (result.limitations || []).forEach(item => limitations.add(item));
    }
    const firstEvidence = sections.find(section => (section.evidencePaths || []).length)?.evidencePaths?.[0];
    const output = {
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      mode: "model-report",
      contractId: `mir1-${Object.values(contract.systems).map(item => item.fingerprint).join("-")}`,
      summary: {
        plainLanguage: system === "bazi"
          ? "以下用七个主题依次解读八字的四柱、旺衰、格局、喜用、调候、原局关系与运限；只引用八字证据，不掺紫微。"
          : "以下用十三个生活主题依次解读紫微的宫位、星曜与四化；只引用紫微证据，不掺八字。",
        evidencePaths: firstEvidence ? [firstEvidence] : [],
        confidence: "high"
      },
      sections,
      limitations: buildGlobalLimitations(contract)
    };
    // 顶层数组是逐段引用的并集，即使是空集也要显式写出来：
    // 字段缺失与「这批资料与主题无关」在校验层是两件事，缺了会被判成"没标引用"。
    output.knowledgeCitations = rollupCitations(sections);
    if (system === "bazi") {
      output.methodStatement = `本份八字解读据子平月令派规则档案 ${contract.systems.bazi?.ruleProfile?.id || ""} 计算，`
        + "旺衰、格局、喜用与调候均保留候选与破格条件，不代表各派统一结论。";
    }
    try {
      output.audit = validate(contract, output, { reportMode: true });
    } catch (error) {
      clearReportCache(contract);
      throw error;
    }
    cache.finalReport = output;
    writeReportCache(contract, cache);
    options.onProgress?.({ completed: batches.length, total: batches.length, topicIds: [] });
    return output;
  }

  async function refreshTopic(contract, topicId, options = {}) {
    if (options.consent !== true) throw outputError("CONSENT_REQUIRED", "请先确认数据使用说明");
    if (!REPORT_TOPICS.includes(topicId)) throw outputError("UNSUPPORTED_OUTPUT_TOPIC", "不支持重新生成这个主题");
    const current = getCachedReport(contract);
    if (!current) throw outputError("REPORT_CACHE_MISSING", "当前会话没有可更新的完整报告");
    const result = await postBatch(contract, [topicId]);
    const replacement = result.sections?.[0];
    if (!replacement || replacement.topic !== topicId) throw outputError("REPORT_TOPICS_MISMATCH", "模型返回了错误的主题");
    const next = {
      ...current,
      sections: current.sections.map(section => section.topic === topicId ? replacement : section),
      limitations: buildGlobalLimitations(contract)
    };
    next.knowledgeCitations = rollupCitations(next.sections);
    next.audit = validate(contract, next, { reportMode: true });
    const cache = readReportCache(contract) || { completedBatches: {} };
    Object.keys(cache.completedBatches || {}).forEach(key => {
      if (key.split("+").includes(topicId)) delete cache.completedBatches[key];
    });
    cache.finalReport = next;
    writeReportCache(contract, cache);
    return next;
  }

  async function requestAnnualReport(contract, options) {
    const year = annualReportYear(contract);
    if (!year) throw outputError("ANNUAL_FACTS_MISSING", "所选年份的流年事实尚未生成");
    const existing = getCachedAnnualReport(contract);
    if (existing) {
      options.onProgress?.({ completed: 3, total: 3, topicIds: [], resumed: true, cached: true });
      return existing;
    }
    const batches = [ANNUAL_TOPICS.slice(0, 2), ANNUAL_TOPICS.slice(2, 4), ANNUAL_TOPICS.slice(4, 6)];
    const cache = readReportCache(contract) || { completedBatches: {}, annualBatches: {}, annualReports: {} };
    cache.annualBatches ||= {};
    cache.annualReports ||= {};
    const sections = [];
    for (let index = 0; index < batches.length; index += 1) {
      const topicIds = batches[index];
      const batchKey = `${year}:${topicIds.join("+")}`;
      let result = cache.annualBatches[batchKey];
      options.onProgress?.({ completed: index, total: batches.length, topicIds, resumed: Boolean(result), cached: false });
      if (!result) {
        try {
          result = await postBatch(contract, topicIds);
        } catch (error) {
          // 引用纪律类失败（某段没标引用、标错主题）多半是多主题挤在一批里互相干扰，
          // 拆成单主题重发通常就过；其余错误照旧上抛。
          if (![
            "MODEL_OUTPUT_TRUNCATED", "MODEL_INVALID_JSON", "INVALID_AI_OUTPUT", "UNSAFE_AI_OUTPUT",
            "REPORT_TOPICS_MISMATCH", "EVIDENCE_OUTSIDE_TOPIC", "OUTPUT_REJECTED",
            "TOPIC_CITATIONS_REQUIRED", "TOPIC_CITATION_MISMATCH",
            "KNOWLEDGE_CITATIONS_REQUIRED", "KNOWLEDGE_CITATION_INVALID"
          ].includes(error.code)) throw error;
          const singles = [];
          for (const topicId of topicIds) singles.push(await postBatch(contract, [topicId]));
          result = { sections: singles.flatMap(item => item.sections), limitations: singles.flatMap(item => item.limitations || []) };
        }
        cache.annualBatches[batchKey] = result;
        writeReportCache(contract, cache);
      }
      sections.push(...result.sections);
    }
    const annualPlan = contract.reportPlan?.topics?.find(topic => topic.id === "annual-overview");
    const summaryEvidence = [
      annualPlan?.evidence?.find(item => item.available && item.pointer.startsWith(`/systems/${singleSystem(contract)}/`))?.pointer
    ].filter(Boolean);
    const output = {
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      mode: "model-annual-report",
      contractId: `miy1-${year}-${Object.values(contract.systems).map(item => item.fingerprint).join("-")}`,
      summary: {
        plainLanguage: `${year} 年度报告只用一套体系（${singleSystem(contract) === "bazi" ? "八字" : "紫微"}）的年度坐标翻译成可观察的问题，不把结构关系写成事件预告，也不掺入另一套体系。`,
        evidencePaths: summaryEvidence,
        confidence: "high"
      },
      sections,
      limitations: [
        `本报告只解释 ${year} 年已计算的 ${singleSystem(contract) === "bazi" ? "八字" : "紫微"}年度坐标，不推演其他年份。`,
        "两套体系分开生成：本份只引用自己那套证据，结论不与另一套合成。",
        "月度阶段只在确定性资料支持时说明，不根据年度盘补造具体月份事件。",
        "内容用于传统文化学习与年度复盘，不用于医疗、投资、法律或其他重大决定。"
      ]
    };
    // 同上：年度主题大多没有专属摘录，空并集也必须写成 []。
    output.knowledgeCitations = rollupCitations(sections);
    if (singleSystem(contract) === "bazi") {
      output.methodStatement = `本份八字年度解读据子平月令派规则档案 ${contract.systems.bazi?.ruleProfile?.id || ""} 计算，只作结构说明。`;
    }
    output.audit = validate(contract, output, { reportMode: true, expectedTopics: ANNUAL_TOPICS });
    cache.annualReports[year] = output;
    writeReportCache(contract, cache);
    options.onProgress?.({ completed: batches.length, total: batches.length, topicIds: [] });
    return output;
  }

  async function requestAnnual(contract, options = {}) {
    singleSystem(contract);
    if (options.provider !== "deepseek") throw outputError("PROVIDER_NOT_CONFIGURED", "当前只配置了 DeepSeek 本机网关");
    if (options.consent !== true) throw outputError("CONSENT_REQUIRED", "请先确认数据使用说明");
    return requestAnnualReport(contract, options);
  }

  async function request(contract, options = {}) {
    singleSystem(contract);
    if (options.provider == null || options.provider === "mock") return mock(contract);
    if (options.provider !== "deepseek") throw outputError("PROVIDER_NOT_CONFIGURED", "当前只配置了 DeepSeek 本机网关");
    if (options.consent !== true) throw outputError("CONSENT_REQUIRED", "请先确认数据使用说明");
    if (contract.reportPlan?.schemaVersion === "mingli-report-plan/v2") {
      return requestReport(contract, options);
    }
    const response = await fetch("/api/v1/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract, consent: true, consentVersion: "2026-10" })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = outputError(result.error?.code || "AI_REQUEST_FAILED", result.error?.message || "AI 服务暂不可用");
      error.status = response.status;
      throw error;
    }
    result.audit = validate(contract, result);
    return result;
  }

  globalThis.MingliAiInterpretation = Object.freeze({
    request, validate, resolvePointer, buildGlobalLimitations, getCachedReport, getCacheState,
    clearReportCache, refreshTopic, getCachedAnnualReport, requestAnnual, rollupCitations,
    schemaVersion: SCHEMA_VERSION
  });
})();

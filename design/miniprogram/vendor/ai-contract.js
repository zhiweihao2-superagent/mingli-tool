"use strict";

(() => {
  const SCHEMA_VERSION = "mingli-ai-input/v1";

  function contractError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  function assertPassed(system, facts) {
    if (!facts) throw contractError("FACTS_MISSING", `${system} AI 事实包缺失`, { system });
    if (facts.validation?.status !== "pass") {
      throw contractError("FACTS_VALIDATION_FAILED", `${system} AI 事实包未通过校验`, {
        system,
        hardFailures: facts.validation?.hard_failures || facts.validation?.hardFailures || []
      });
    }
    if (facts.readiness?.ai_may_interpret === false || facts.readiness?.aiMayInterpret === false) {
      throw contractError("AI_INTERPRETATION_BLOCKED", `${system} 事实包禁止进入 AI 解读`, { system });
    }
  }

  function scopesFor(system, facts) {
    const supported = facts.readiness?.supported_scopes || facts.readiness?.supportedScopes || [];
    const unsupported = facts.readiness?.unsupported_scopes || facts.readiness?.unsupportedScopes || [];
    const contract = {
      supported: supported.map(scope => `${system}:${scope}`),
      unsupported: unsupported.map(scope => `${system}:${scope}`)
    };
    return contract;
  }

  function build({ bazi = null, ziwei = null, requestedScopes = null, annualYear = null } = {}) {
    const systems = {};
    const scopeCatalog = { supported: [], unsupported: [] };

    if (bazi?.status === "ok") {
      assertPassed("bazi", bazi.ai_facts);
      if (bazi.ai_facts.derived_rules?.validation?.status !== "pass") {
        throw contractError("BAZI_DERIVED_RULES_VALIDATION_FAILED", "八字规则推导层未通过校验");
      }
      const scopes = scopesFor("bazi", bazi.ai_facts);
      scopeCatalog.supported.push(...scopes.supported);
      scopeCatalog.unsupported.push(...scopes.unsupported);
      systems.bazi = {
        engine: bazi.calculation.engine,
        ruleProfile: bazi.calculation.rule_profile,
        fingerprint: bazi.ai_facts.fingerprint,
        chart: bazi.calculation,
        facts: bazi.ai_facts,
        warnings: bazi.warnings || []
      };
      // 只有输入真的带了月度事实才挂上去：不存在时不制造空壳键
      const monthlyFacts = bazi.monthly_facts || bazi.monthlyFacts || null;
      if (monthlyFacts) {
        systems.bazi.monthlyFacts = monthlyFacts;
      }
    }

    if (ziwei?.status === "ok") {
      assertPassed("ziwei", ziwei.aiFacts);
      if (ziwei.aiFacts.flyingValidation?.status !== "pass"
          || ziwei.aiFacts.periods?.validation?.decadal?.status !== "pass"
          || ziwei.aiFacts.periods?.validation?.annual?.status !== "pass"
          || ziwei.aiFacts.fineTiming?.status !== "pass") {
        throw contractError("DYNAMIC_FACTS_VALIDATION_FAILED", "紫微飞化或运限事实未全部通过校验");
      }
      const scopes = scopesFor("ziwei", ziwei.aiFacts);
      scopeCatalog.supported.push(...scopes.supported);
      scopeCatalog.unsupported.push(...scopes.unsupported);
      systems.ziwei = {
        engine: ziwei.engine,
        ruleProfile: ziwei.ruleProfile,
        fingerprint: ziwei.aiFacts.fingerprint,
        normalizedInput: ziwei.normalizedInput,
        calendarDisplay: ziwei.calendarDisplay,
        basics: ziwei.basics,
        palaces: ziwei.palaces,
        facts: ziwei.aiFacts
      };
    }

    if (!Object.keys(systems).length) throw contractError("NO_VALID_SYSTEM", "没有可供 AI 读取的已校验排盘");

    // 一套系统一份合同。八字走子平月令派，紫微走钦天门，两套判法与术语不通用，
    // 装进同一份喂给模型必然串味（模型会把两边句式缝合，读者分不清哪句来自哪套）。
    const systemNames = Object.keys(systems);
    if (systemNames.length > 1) {
      throw contractError("CONTRACT_MULTI_SYSTEM", "一份合同只能装一套体系，八字与紫微必须分别构建", {
        systems: systemNames,
        hint: "分别调用 build({ bazi }) 与 build({ ziwei })，再各自请求解读"
      });
    }

    const selectedScopes = requestedScopes == null ? [...scopeCatalog.supported] : [...requestedScopes];
    const denied = selectedScopes.filter(scope => !scopeCatalog.supported.includes(scope));
    if (denied.length) {
      throw contractError("UNSUPPORTED_AI_SCOPE", "请求包含未实现或未校验的解读范围", {
        denied,
        supported: scopeCatalog.supported,
        explicitlyUnsupported: scopeCatalog.unsupported
      });
    }

    const contract = {
      schemaVersion: SCHEMA_VERSION,
      mode: "facts-only",
      systems,
      requestedScopes: selectedScopes,
      scopeCatalog,
      evidenceProtocol: {
        citationFormat: "JSON Pointer",
        requirement: "每个具体判断必须引用 systems 下的事实路径；没有事实路径时必须明确说资料不足。"
      },
      modelPolicy: {
        may: ["翻译术语", "解释已校验结构", "给出非决定性的生活观察问题", "指出不同体系相互印证或冲突之处"],
        must: ["区分排盘事实与解释", "使用可能/倾向/可观察而非必然措辞", "保留出生时间与规则边界"],
        mustNot: ["重新计算或篡改命盘", "补造缺失字段", "把传统命理当作科学定论", "作出疾病诊断、投资指令或必然事件预测"]
      },
      segmentSemantics: {
        // 紫微流月按农历月切段：一个节气月可能横跨两个农历月。
        meaning: "段的 verified 只确认「边界与农历月归属」，不代表段内每个字段都通过校验",
        fieldRule: "引用段内事实时，必须看该字段 envelope.status === \"validated\"",
        unverifiedRule: "verified !== true 的段不得作为已验证事实引用，字段一律 unavailable",
        topLevelRule: "月级顶层字段只代表**主段**（天数最多的那段，相同时取较早段），不能推断整个节气月",
        citationRule: "引用段事实时使用该段的 jsonPointer 或 fieldPointers，并把结论限制在该段日期区间内",
        note: "实际 verified 状态以年度时间线中每段的字段为准，本条只是读法约定",
      },
      relationSemantics: {
        // 关系分两类，读法不同：确定关系可以直接陈述，候选只能作为倾向参考。
        confirmedKinds: "除 candidateKinds 之外的所有 kind 都是确定关系，可以直接引用",
        candidateKinds: ["branch-hidden-stem-combine-candidate"],
        candidateMeaning: "藏干五合枚举候选：只证明两柱藏干之间存在五合，不等于严格暗合，也不代表合化成立",
        candidateUsage: [
          "可以据此提出可能/倾向性的观察，但不能表述为「命中有暗合」",
          "不得计入「关系很多/合很多」这类密度判断",
          "引用时必须说明它是候选，而不是已成立的关系",
        ],
        countingRule:
          "relation_count 等于 relations 数组总条数；confirmed_count 是确定关系数，"
          + "candidate_count 是候选数，两者相加等于 relation_count。"
          + "判断关系密度时用 confirmed_count，不要用 relation_count",
      },
    };
    // 证据消费入口：给定 evidence_id，返回它所在的事实包与 RFC 6901 指针。
    // 索引缺失、跨包冲突、指针解不出来都要明确报错，不能静默返回 undefined。
    contract.resolveEvidence = function resolveEvidence(evidenceId) {
      if (typeof evidenceId !== "string" || !evidenceId) {
        throw new Error("EVIDENCE_ID_REQUIRED: evidence_id 必须是非空字符串");
      }
      // 两个事实包都要检查，**包括没有索引的**：否则月度包缺索引时会被
      // 报成"ID 不存在"，掩盖真正的原因。
      const packs = [];
      const baziFacts = systems.bazi?.facts;
      if (baziFacts) packs.push({ name: "systems.bazi.facts", facts: baziFacts });
      const monthlyFacts = systems.bazi?.monthlyFacts;
      if (monthlyFacts) packs.push({ name: "systems.bazi.monthlyFacts", facts: monthlyFacts });
      if (packs.length === 0) {
        throw new Error("EVIDENCE_INDEX_MISSING: 契约里没有任何事实包");
      }
      const missingIndex = packs.filter((pack) => !pack.facts.evidence_index);
      if (missingIndex.length > 0) {
        // 只要有一个包缺索引，就无法排除同 ID 在那边也存在——
        // 这种情况必须报错，不能"查到就算数"。
        throw new Error(
          "EVIDENCE_INDEX_MISSING: " + missingIndex.map((p) => p.name).join(" 与 ") + " 缺少 evidence_index",
        );
      }
      const hits = [];
      for (const pack of packs) {
        if (!pack.facts.evidence_index) continue;
        const pointer = pack.facts.evidence_index[evidenceId];
        if (pointer !== undefined) hits.push({ ...pack, pointer });
      }
      if (hits.length === 0) {
        const suffix = missingIndex.length
          ? `（另有 ${missingIndex.map((p) => p.name).join(" 与 ")} 缺少 evidence_index，无法排除在那里）`
          : "";
        throw new Error(`EVIDENCE_NOT_FOUND: ${evidenceId} 不在任何事实包的索引里${suffix}`);
      }
      if (hits.length > 1) {
        const where = hits.map((hit) => `${hit.name}#${hit.pointer}`).join(" 与 ");
        throw new Error(`EVIDENCE_ID_CONFLICT: ${evidenceId} 同时出现在 ${where}`);
      }
      const [hit] = hits;
      const value = resolvePointer(hit.facts, hit.pointer);
      if (value === undefined) {
        throw new Error(
          `EVIDENCE_POINTER_UNRESOLVED: ${hit.name} 里的 ${hit.pointer} 解不出值`,
        );
      }
      // 指针必须真的指向**这条**证据：索引把 A 指到 B 的位置时，
      // 只检查"解得出值"会静默返回 B。
      if (!value || typeof value !== "object" || value.evidence_id !== evidenceId) {
        const actual = value && typeof value === "object" ? value.evidence_id : undefined;
        throw new Error(
          `EVIDENCE_POINTER_MISMATCH: ${hit.name} 里的 ${hit.pointer} 指向 ${actual ?? "非证据对象"}，`
          + `而不是请求的 ${evidenceId}`,
        );
      }
      return { package: hit.name, pointer: hit.pointer, value };
    };

    if (globalThis.MingliReportStructure?.build) {
      contract.reportPlan = globalThis.MingliReportStructure.build(contract, { annualYear });
    }
    return contract;
  }

  function resolvePointer(root, pointer) {
    if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
    return pointer
      .slice(1)
      .split("/")
      .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce(
        (node, token) => (node === undefined || node === null ? undefined : node[token]),
        root,
      );
  }

  globalThis.MingliAiContract = Object.freeze({ build, schemaVersion: SCHEMA_VERSION });
})();

"use strict";

(() => {
  const SCHEMA_VERSION = "mingli-report-plan/v2";
  const BRANCHES = Object.freeze(["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]);
  const BRIGHT = new Set(["庙", "旺"]);
  const DIM = new Set(["不", "闲", "陷"]);

  // Exact public topic keys and labels from Renhuai123/ziwei-doushu.
  // Its detailed 14-star interpretation copy is explicitly not open source.
  const BAZI_TOPICS = Object.freeze([
    { id: "bazi-foundation", system: "bazi", title: "你是什么底子", method: "四柱与日主", question: "四柱、日主和五行清单为后续解读提供了哪些基础？" },
    { id: "bazi-strength", system: "bazi", title: "你是偏硬还是偏软", method: "扶抑量化", question: "生扶与消耗克制的比例，在现实中更适合怎样观察？" },
    { id: "bazi-pattern", system: "bazi", title: "你做事的惯性", method: "月令取格", question: "首要格局的成立、加分与破格条件分别是什么？" },
    { id: "bazi-useful", system: "bazi", title: "什么对你有用", method: "扶抑／格局／调候", question: "三套取法有哪些重复与冲突，为什么不能压成一个答案？" },
    { id: "bazi-climate", system: "bazi", title: "你适合什么环境", method: "穷通速查", question: "调候主用、辅用在原局中是透干、藏支还是未见？" },
    { id: "bazi-relations", system: "bazi", title: "身上互相拉扯的地方", method: "干支关系", question: "原局有哪些可核对的组合关系，哪些成化条件仍需保留？" },
    { id: "bazi-cycles", system: "bazi", title: "这些年怎么走", method: "运限关系", question: "怎样把大运和流年当作阶段观察坐标，而不是事件预告？" }
  ]);
  const ZIWEI_TOPICS = Object.freeze([
    { id: "overview", system: "ziwei", title: "整体看这张盘", palace: "命宫", question: "整张盘的主要结构与阅读重点是什么？" },
    { id: "personality", system: "ziwei", title: "性格特质", palace: "命宫", question: "面对选择、压力和协作时，常见的反应方式是什么？" },
    { id: "love", system: "ziwei", title: "感情婚姻", palace: "夫妻宫", question: "亲密关系里更需要留意哪些沟通、边界与相处方式？" },
    { id: "career", system: "ziwei", title: "事业职业", palace: "官禄宫", question: "工作中更适合怎样承担责任、组织资源与长期投入？" },
    { id: "wealth", system: "ziwei", title: "钱这件事", palace: "财帛宫", question: "金钱、时间和资源的取得与安排方式有哪些特点？" },
    { id: "health", system: "ziwei", title: "健康状况", palace: "疾厄宫", question: "哪些身心习惯值得观察与照顾？（不作医学诊断）" },
    { id: "family", system: "ziwei", title: "同辈与合作", palace: "兄弟宫", question: "与手足、同辈或合伙人协作时，常见的互动模式是什么？" },
    { id: "children", system: "ziwei", title: "子女缘分", palace: "子女宫", question: "在子女、创作或培养他人方面，常见的投入方式是什么？" },
    { id: "move", system: "ziwei", title: "出去闯这件事", palace: "迁移宫", question: "进入新环境、出行或对外发展时，哪些条件更值得留意？" },
    { id: "friends", system: "ziwei", title: "人际贵人", palace: "仆役宫", question: "朋友、团队与合作关系中，怎样识别支持与责任边界？" },
    { id: "home", system: "ziwei", title: "家与住处", palace: "田宅宫", question: "家庭、居所与长期资产方面，常见的关注点是什么？" },
    { id: "spirit", system: "ziwei", title: "怎么休息", palace: "福德宫", question: "怎样休息、恢复与获得内在满足更值得观察？" },
    { id: "parents", system: "ziwei", title: "父母长辈", palace: "父母宫", question: "与父母、长辈及支持系统之间，常见的互动主题是什么？" }
  ]);
  const ANNUAL_YEAR_CAP = 2100;
const ANNUAL_SPAN_YEARS = 120;

const ANNUAL_TOPICS = Object.freeze([
    { id: "annual-overview", system: "combined", title: "这一年整体", method: "大运流年／紫微流年", question: "这一年最值得观察的结构主题是什么？" },
    { id: "annual-career", system: "combined", title: "工作与学习", palace: "官禄宫", question: "工作、学习和责任安排上更值得留意什么？" },
    { id: "annual-relationship", system: "combined", title: "感情与人际", palace: "夫妻宫", question: "关系沟通和合作边界上更值得留意什么？" },
    { id: "annual-wealth", system: "combined", title: "金钱与资源", palace: "财帛宫", question: "金钱、时间和资源安排上更值得留意什么？" },
    { id: "annual-wellbeing", system: "combined", title: "身心与节奏", palace: "疾厄宫", question: "作息、压力和恢复节奏上更值得观察什么？" },
    { id: "annual-home", system: "combined", title: "家庭与居住", palace: "田宅宫", question: "家庭、居住与长期安排上更值得留意什么？" }
  ]);
  const TOPICS = Object.freeze([...BAZI_TOPICS, ...ZIWEI_TOPICS]);

  function resolvePointer(root, pointer) {
    if (pointer === "") return root;
    if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
    return pointer.slice(1).split("/").reduce((value, token) => {
      if (value === undefined || value === null) return undefined;
      return value[token.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
  }

  function palaceIndex(ziwei, name) {
    return ziwei?.palaces?.findIndex(palace => palace.name === name) ?? -1;
  }

  function evidenceItem(contract, pointer, role, label) {
    return { role, label, pointer, available: resolvePointer(contract, pointer) !== undefined };
  }

  function topicEvidence(contract, spec) {
    const ziwei = contract.systems?.ziwei;
    if (!ziwei) return [];
    const index = palaceIndex(ziwei, spec.palace);
    if (index < 0) return [];
    const palace = ziwei.palaces[index];
    const evidence = [evidenceItem(contract, `/systems/ziwei/palaces/${index}`, "primary-palace", `${spec.palace}本宫`)];
    const oppositeIndex = palaceIndex(ziwei, palace.oppositePalace);
    if (oppositeIndex >= 0) {
      evidence.push(evidenceItem(contract, `/systems/ziwei/palaces/${oppositeIndex}`, "opposite-palace", `${palace.oppositePalace}对宫`));
    }
    (ziwei.facts?.fourTransformations || []).forEach((item, itemIndex) => {
      if (item.palace === spec.palace) {
        evidence.push(evidenceItem(contract, `/systems/ziwei/facts/fourTransformations/${itemIndex}`, "natal-transformation", `${item.star}化${item.kind}入${spec.palace}`));
      }
    });
    (ziwei.facts?.palaceFlying || []).forEach((item, itemIndex) => {
      if ((item.sourcePalace === spec.palace || item.targetPalace === spec.palace) && evidence.length < 10) {
        evidence.push(evidenceItem(contract, `/systems/ziwei/facts/palaceFlying/${itemIndex}`, "palace-flying", `${item.sourcePalace}${item.star}化${item.kind}至${item.targetPalace}`));
      }
    });
    return evidence;
  }

  function baziEvidence(contract, spec) {
    if (!contract.systems?.bazi) return [];
    const paths = {
      "bazi-foundation": [
        ["/systems/bazi/chart/pillars", "four-pillars", "四柱与藏干"],
        ["/systems/bazi/facts/element_inventory", "element-inventory", "日主、月令与五行清单"]
      ],
      "bazi-strength": [
        ["/systems/bazi/facts/derived_rules/strength", "strength-rule", "旺衰比例、三因素与逐项证据"]
      ],
      "bazi-pattern": [
        ["/systems/bazi/facts/derived_rules/pattern", "pattern-rule", "月令格局候选与破格条件"],
        ["/systems/bazi/facts/derived_rules/strength/followCandidate", "follow-pattern", "从格严格候选"],
        ["/systems/bazi/facts/derived_rules/strength/dominantCandidate", "dominant-pattern", "专旺格严格候选"]
      ],
      "bazi-useful": [
        ["/systems/bazi/facts/derived_rules/useful_elements", "useful-elements", "扶抑、格局、调候三轴及冲突"]
      ],
      "bazi-climate": [
        ["/systems/bazi/facts/derived_rules/climate_adjustment", "climate-rule", "调候主用、辅用与透藏状态"]
      ],
      "bazi-relations": [
        ["/systems/bazi/facts/natal_relations", "natal-relations", "原局合冲刑害与合会候选"]
      ],
      "bazi-cycles": [
        ["/systems/bazi/chart/luck_cycles", "luck-cycles", "大运方向、起运估算与各步干支"],
        ["/systems/bazi/facts/annual_cycle_coverage", "annual-coverage", "流年资料的完整起止年份与数量"],
        ["/systems/bazi/facts/annual_cycles", "annual-cycles", "已计算范围内的逐年干支及与原局关系"]
      ]
    };
    return (paths[spec.id] || []).map(([pointer, role, label]) => evidenceItem(contract, pointer, role, label));
  }

  function annualEvidence(contract, spec, annualYear) {
    // 一份合同只装一套体系：年度证据也只取这一套，不把另一套的指针塞进来。
    if (contract.systems?.bazi) {
      const baziAnnual = contract.systems.bazi.facts?.annual_cycles || [];
      const wanted = Number(annualYear);
      const picked = Number.isInteger(wanted) ? baziAnnual.findIndex(item => Number(item?.year) === wanted) : -1;
      const annualIndex = picked >= 0 ? picked : Math.max(0, baziAnnual.length - 1);
      const label = Number.isInteger(wanted) && picked >= 0 ? `${wanted} 年` : "所选年份";
      return [
        evidenceItem(contract, "/systems/bazi/facts/luck_cycles", "bazi-luck-context", "八字大运阶段与原局关系"),
        evidenceItem(contract, `/systems/bazi/facts/annual_cycles/${annualIndex}`, "bazi-annual", `${label}的八字流年干支与原局关系`)
      ];
    }
    const evidence = [
      evidenceItem(contract, "/systems/ziwei/facts/periods/current/decadal", "ziwei-decadal", "紫微大限宫位、四化与飞化"),
      evidenceItem(contract, "/systems/ziwei/facts/periods/current/annual", "ziwei-annual", "紫微流年宫位叠加、四化与飞化")
    ];
    if (spec.palace) {
      const index = palaceIndex(contract.systems?.ziwei, spec.palace);
      if (index >= 0) evidence.push(evidenceItem(contract, `/systems/ziwei/palaces/${index}`, "natal-palace", `${spec.palace}本命结构`));
    }
    return evidence;
  }

  function mapBrightness(value) {
    if (BRIGHT.has(value)) return "bright";
    if (DIM.has(value)) return "dim";
    return "normal";
  }

  function toRenhuaiChart(ziwei) {
    const palaces = (ziwei?.palaces || []).map(palace => ({
      name: palace.name,
      branch: BRANCHES.indexOf(palace.earthlyBranch),
      stars: [
        ...(palace.majorStars || []).map(star => ({ ...star, type: "major" })),
        ...(palace.minorStars || []).map(star => ({ ...star, type: "minor" })),
        ...(palace.auxiliaryStars || []).map(star => ({ ...star, type: "minor" }))
      ].map(star => ({
        name: star.name,
        type: star.type,
        brightness: mapBrightness(star.brightness),
        siHua: star.transformation || undefined
      }))
    }));
    const ming = palaces.find(palace => palace.name === "命宫");
    const bodySource = (ziwei?.palaces || []).find(palace => palace.isBodyPalace);
    return {
      palaces,
      mingGongBranch: ming?.branch ?? -1,
      shenGongBranch: BRANCHES.indexOf(bodySource?.earthlyBranch)
    };
  }

  function patternEvidence(contract, pattern) {
    const ziwei = contract.systems?.ziwei;
    if (!ziwei) return [];
    const evidence = [...new Set(pattern.palaces || [])].map(name => {
      const index = palaceIndex(ziwei, name);
      return index < 0 ? null : evidenceItem(contract, `/systems/ziwei/palaces/${index}`, "pattern-palace", `${name}星曜与亮度`);
    }).filter(Boolean);
    if (!evidence.length) {
      const mingIndex = palaceIndex(ziwei, "命宫");
      if (mingIndex >= 0) evidence.push(evidenceItem(contract, `/systems/ziwei/palaces/${mingIndex}`, "pattern-palace", "命宫星曜与亮度"));
    }
    return evidence;
  }

  // 年度可看年份：从出生年到引擎上限 2100，同时不超过出生年 + 120（大限与小限的循环上限）。
  function annualYearsFor(birthYear) {
    const birth = Number(birthYear);
    if (!Number.isInteger(birth) || birth < 1800) return [];
    const last = Math.min(ANNUAL_YEAR_CAP, birth + ANNUAL_SPAN_YEARS);
    const years = [];
    for (let year = birth; year <= last; year += 1) years.push(year);
    return years;
  }

  function buildPatterns(contract) {
    const ziwei = contract.systems?.ziwei;
    const detector = globalThis.MingliRenhuaiPatterns?.detectPatterns;
    if (!ziwei || typeof detector !== "function") return [];
    return detector(toRenhuaiChart(ziwei)).map((pattern, index) => ({
      id: `renhuai-pattern-${index + 1}`,
      name: pattern.name,
      status: "matched-candidate",
      level: pattern.level,
      involvedPalaces: pattern.palaces || [],
      conditions: {
        requiredMatched: pattern.conditions?.required || [],
        bonusMatched: pattern.conditions?.bonus || [],
        breakingTriggered: pattern.conditions?.breaking || []
      },
      evidence: patternEvidence(contract, pattern),
      source: pattern.source || "Renhuai123/ziwei-doushu 公开格局规则",
      provenance: {
        repository: "Renhuai123/ziwei-doushu",
        revision: "e478393ad6c865ad6270e978a3164d2f2cb5315b",
        file: "lib/ziwei/patterns.ts"
      },
      interpretationPolicy: "这是严格规则命中的格局候选，不单独等同于现实结论；报告必须同时展示成立条件、加分项、破格项和盘面证据。"
    }));
  }

  // 主题 → 知识 scope：八字的知识包按 scope 挂 anchor，紫微按宫位挂断语与星性。
  // 逐主题引用的第一半在这里：给每个主题一份「本主题可用 anchor」清单，
  // 提示词只发这一份，校验也只认这一份里的 anchor。
  const BAZI_KNOWLEDGE_SCOPES = Object.freeze({
    "bazi-foundation": ["bazi:pillars", "bazi:stem-branch-properties", "bazi:ten-gods", "bazi:hidden-stems", "bazi:element-inventory"],
    "bazi-strength": ["bazi:strength-candidate", "bazi:element-inventory"],
    "bazi-pattern": ["bazi:pattern-candidates", "bazi:dominant-pattern-candidate", "bazi:follow-pattern-candidate"],
    "bazi-useful": ["bazi:balance-useful-elements", "bazi:pattern-useful-elements", "bazi:useful-element-conflicts"],
    "bazi-climate": ["bazi:full-qiongtong-120-cell-climate-candidate"],
    "bazi-relations": ["bazi:natal-relations", "bazi:combination-transformation-condition-audit"],
    "bazi-cycles": ["bazi:luck-cycle-relations", "bazi:annual-relations", "bazi:annual-cycle-coverage"]
  });

  /**
   * 取某个主题可用的知识 anchor。
   *
   * 为什么按主题切：整份一个 knowledgeCitations 只能证明「这些资料被用过」，
   * 证明不了「事业这张卡用的是事业那条」。切到主题级，审计才落到一行。
   * 只返回随包发出的 anchor；知识包缺失时返回空数组，不伪造。
   */
  function knowledgeAnchorsForTopic(contract, spec) {
    const knowledge = contract && contract.knowledge;
    const out = [];
    const push = value => {
      if (typeof value === "string" && value && out.indexOf(value) < 0) out.push(value);
    };
    if (!knowledge || !spec) return out;
    if (spec.system === "bazi") {
      const wanted = BAZI_KNOWLEDGE_SCOPES[spec.id] || [];
      (knowledge.scopes || []).forEach(scope => {
        if (wanted.indexOf(scope.scope) < 0) return;
        (scope.sections || []).forEach(section => push(section.anchor));
      });
      return out;
    }
    const palace = spec.palace;
    if (!palace) return out;
    const stars = [];
    (knowledge.entries || []).forEach(entry => {
      if (entry.kind !== "palace-reading" || entry.palace !== palace) return;
      push(entry.anchor);
      if (entry.star && stars.indexOf(entry.star) < 0) stars.push(entry.star);
    });
    (knowledge.entries || []).forEach(entry => {
      if (entry.kind === "palace-reading") return;
      if (stars.indexOf(entry.star) >= 0) push(entry.anchor);
    });
    return out;
  }

  function build(contract, options = {}) {
    const annualYear = Number.isInteger(Number(options.annualYear)) ? Number(options.annualYear) : null;
    const topics = TOPICS.map(spec => {
      const evidence = spec.system === "bazi" ? baziEvidence(contract, spec) : topicEvidence(contract, spec);
      return {
        ...spec,
        status: evidence.length > 0 && evidence.every(item => item.available) ? "evidence-ready" : "insufficient-evidence",
        evidence,
        knowledgeAnchors: knowledgeAnchorsForTopic(contract, spec),
        reportSlots: {
          oneLineSummary: null,
          coreReading: null,
          evidenceExplanation: null,
          classicalSource: null,
          reflectionQuestion: spec.question
        }
      };
    });
    const annualTopics = ANNUAL_TOPICS.map(spec => {
      const evidence = annualEvidence(contract, spec, annualYear);
      return {
        ...spec,
        status: evidence.length > 0 && evidence.every(item => item.available) ? "evidence-ready" : "insufficient-evidence",
        evidence,
        knowledgeAnchors: knowledgeAnchorsForTopic(contract, spec),
        reportSlots: { oneLineSummary: null, coreReading: null, evidenceExplanation: null, reflectionQuestion: spec.question }
      };
    });
    const patternCandidates = buildPatterns(contract);
    return {
      schemaVersion: SCHEMA_VERSION,
      structureSource: {
        bazi: {
          profile: contract.systems?.bazi?.facts?.derived_rules?.rule_profile?.id,
          note: "7 个八字主题只读取 bazi-derived-rules/v2 与结构事实，不让模型重算旺衰、格局、喜用或调候。"
        },
        ziwei: {
          repository: "Renhuai123/ziwei-doushu",
          revision: "e478393ad6c865ad6270e978a3164d2f2cb5315b",
          topicsFile: "lib/ziwei/db-analysis.ts",
          patternsFile: "lib/ziwei/patterns.ts",
          note: "13 个主题标签与公开格局规则来自开源仓库；原仓库的详细 14 主星论断库未开源，本项目不复制或冒充该内容。"
        }
      },
      topicCount: topics.length,
      topicCounts: { bazi: BAZI_TOPICS.length, ziwei: ZIWEI_TOPICS.length },
      annualTopicCount: annualTopics.length,
      annualYear,
      topics: [...topics, ...annualTopics],
      patternCandidates,
      patternCandidateCount: patternCandidates.length,
      evidencePolicy: {
        citationFormat: "JSON Pointer",
        topicRule: "每个主题只能引用本主题 evidence 中 available=true 的路径；八字和紫微必须保持各自证据边界，资料不足时明确说明，不补造。",
        patternRule: "只允许讨论 status=matched-candidate 的候选，并逐条展示 requiredMatched、bonusMatched 与 breakingTriggered。",
        healthRule: "健康主题只讨论文化视角下的习惯观察，不作诊断、治疗或风险预测。"
      }
    };
  }

  globalThis.MingliReportStructure = Object.freeze({
    build, annualYearsFor, knowledgeAnchorsForTopic, baziKnowledgeScopes: BAZI_KNOWLEDGE_SCOPES,
    topics: TOPICS, baziTopics: BAZI_TOPICS, ziweiTopics: ZIWEI_TOPICS,
    annualTopics: ANNUAL_TOPICS, schemaVersion: SCHEMA_VERSION
  });
})();

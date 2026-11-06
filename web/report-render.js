/* 渲染层：把「应期四阶梯」的判定结果翻成可读句子。
 *
 * 设计约束（三条，全部来自 skill 原文，不许自创）：
 *  1. 不改判定。本模块只重排文字，所有结论、宫位、时间窗都直接取自
 *     MingliYingqiLadder.evaluateTimeline 的输出，不新增任何推断。
 *  2. 措辞仍是倾向语。SKILL「铁律」禁铁口直断；本模块补的措辞同样过一遍
 *     断言词检查，命中即视为缺陷（测试会拦）。
 *  3. 「宫位 → 生活领域」的映射逐条锚定 references/ 里的章节标题或括注，
 *     不凭常识编。锚点写进 PALACE_DOMAINS[].anchor，可人工核对。
 */
(function () {
  "use strict";

  var SCHEMA = "mingli.report-render/v1";

  var REF_12 = "palace_fly_all12.md";
  var REF_LZJ = "lu_zhuan_ji.md";

  /* 十二宫的「生活领域」译名。
   * domain 取自章节括注 / 该宫在 lu_zhuan_ji 的职务括注；
   * anchor 是该依据的原文标题（含 `#` 层级的纯文本），用于人工核对。 */
  var PALACE_DOMAINS = {
    "命宫": {
      short: "自己",
      domain: "你自己：性格、状态与给人的印象",
      anchor: REF_12 + " §一、命宫四化入十二宫（性格倾向层）",
    },
    "兄弟宫": {
      short: "合伙与现金流",
      domain: "合伙人、身边同事与现金流的周转",
      anchor: REF_LZJ + "「兄弟宫（现金流）」",
    },
    "夫妻宫": {
      short: "伴侣关系",
      domain: "伴侣与婚姻关系",
      anchor: REF_12 + " §三、夫妻宫四化入十二宫（配偶职业 · 婚象）",
    },
    "子女宫": {
      short: "子女与合伙",
      domain: "子女、桃花与合伙投资",
      anchor: REF_12 + " §四、子女宫（桃花方向 · 生产医疗象 · 合伙）",
    },
    "财帛宫": {
      short: "钱",
      domain: "钱：收入、花销与存留",
      anchor: REF_12 + " §五、财帛宫四化入十二宫（钱花在哪）",
    },
    "疾厄宫": {
      short: "身体",
      domain: "身体与健康",
      anchor: REF_12 + " §六、父疾线（文书 · 银行 · 健康 · 教育）",
    },
    "迁移宫": {
      short: "出外",
      domain: "出外、差旅与在外的发展空间",
      anchor: REF_12 + " §七、迁移宫（出外发展 · 驿马）",
    },
    "仆役宫": {
      short: "朋友",
      domain: "朋友与人际往来",
      anchor: REF_12 + " §二、兄友线（交友层次 · 员工位）",
    },
    "交友宫": {
      short: "朋友",
      domain: "朋友与人际往来",
      anchor: REF_12 + " §二、兄友线（交友层次 · 员工位）",
    },
    "官禄宫": {
      short: "工作",
      domain: "工作与事业形态",
      anchor: REF_12 + " §八、官禄宫四化入十二宫（职业形态 · 外缘提示）",
    },
    "田宅宫": {
      short: "房子与家",
      domain: "房子、家庭与储蓄（财库）",
      anchor: REF_12 + " §九、田宅宫四化入十二宫（置业 · 家运 · 库）",
    },
    "福德宫": {
      short: "心情",
      domain: "心情、享受与精神内耗",
      anchor: REF_12 + " §十、福德宫（享受 · 心性）",
    },
    "父母宫": {
      short: "长辈与文书",
      domain: "长辈、文书与证照借贷",
      anchor: REF_LZJ + "「父母宫」；" + REF_12 + " §六、父疾线（文书 · 银行 …）",
    },
  };

  /* 格局 → 人话倾向。priority 决定同一条断语挂多个格局时谁当主句。
   * 这些都是对「结构含义」的转述，不是新增判断：
   *   negative-line = 忌入父母/疾厄，原文称「负极线」「上不了台面」，故译为操劳与留意；
   *   lu-po        = 禄逢冲破，原文「吉象受损、先得后失」；
   *   lu-ji-same   = 跨层禄忌同宫，好与卡同时落一处；
   *   same-star-lu-ji = 同星叠临，旧期待被重新引动；
   *   double/triple-ji = 忌叠加，原文「双忌缩短应期」。 */
  var PATTERN_TENDENCIES = {
    "triple-ji": { priority: 60, plain: "压力叠到三层，诸事宜守不宜进" },
    "negative-line": { priority: 50, plain: "容易操劳，身体或文书、借贷上要多留意" },
    "lu-po": { priority: 40, plain: "先见到好处，随后可能回吐一部分" },
    "double-ji": { priority: 30, plain: "压力集中，短期难以松手" },
    "lu-ji-same": { priority: 20, plain: "同一件事上，好处与阻力同时存在" },
    "same-star-lu-ji": { priority: 10, plain: "旧的期待被重新翻出来，成与不成看当年" },
  };
  var FALLBACK_TENDENCY = { priority: 0, plain: "有动静，方向未定" };

  var ASSERTIVE_RESIDUAL = /(一定|必然|必定|绝对|铁定|铁口直断|肯定|百分百|100%|绝不会)/;

  function domainOf(palace) {
    var hit = PALACE_DOMAINS[palace];
    if (hit) return { domain: hit.domain, short: hit.short, anchor: hit.anchor, known: true };
    return {
      domain: palace ? String(palace) : "未定位",
      short: palace ? String(palace) : "未定位",
      anchor: null,
      known: false,
    };
  }

  function tendencyOf(codes) {
    var list = (Array.isArray(codes) ? codes : [])
      .map(function (code) { return { code: code, meta: PATTERN_TENDENCIES[code] }; })
      .filter(function (item) { return item.meta; })
      .sort(function (a, b) { return b.meta.priority - a.meta.priority; });
    if (list.length === 0) return { primary: null, plain: FALLBACK_TENDENCY.plain, others: [] };
    return {
      primary: list[0].code,
      plain: list[0].meta.plain,
      others: list.slice(1).map(function (item) { return item.meta.plain; }),
    };
  }

  /** 时间落点：只复述阶梯 4 之后的 granularity 裁定，不另算。 */
  function plainTiming(yearResult, decadal) {
    var g = yearResult && yearResult.granularity ? yearResult.granularity.granularity : "none";
    var year = yearResult ? yearResult.year : null;
    var range = decadal && Array.isArray(decadal.yearRange) ? decadal.yearRange : null;
    if (g === "decadal") {
      return {
        when: range ? range[0] + "–" + range[1] + " 年（" + decadal.ganzhi + "大限内）" : "本大限内",
        granularity: g,
        plain: range ? "未来 5–10 年" : "本大限内",
      };
    }
    if (g === "year") {
      return { when: year + " 年当年", granularity: g, plain: year + " 年" };
    }
    return { when: "不定时间", granularity: "none", plain: "结构上" };
  }

  /** 主句拼装：时间前缀 + 领域（星曜）+ 倾向。 */
  function composePlain(time, domainShort, stars, tendency, others) {
    var who = domainShort;
    var named = (Array.isArray(stars) ? stars : []).filter(Boolean);
    if (named.length > 0) who = who + "（" + named.join("、") + "）";
    var tail = tendency;
    if (Array.isArray(others) && others.length > 0) tail = tail + "；同时" + others.join("；");
    return time.plain + "，" + who + "：倾向" + tail + "。";
  }

  /** 去掉断语自带的「本命XX宫坐YY，」前缀，避免与外部句子重复。 */
  function stripLeadingClause(text) {
    var source = String(text || "");
    var cut = source.search(/[，,]/);
    if (cut > 0 && cut <= 18) return source.slice(cut + 1);
    return source;
  }

  /**
   * 渲染一条断语。
   * 输入必须是 MingliYingqiLadder 输出的 statement，字段：palace/star/shortText/
   * patternCodes/patternTexts/factPointers/knowledgeRefs。
   */
  function renderStatement(stmt, yearResult, decadal) {
    if (!stmt || !stmt.palace) {
      return { status: "unavailable", reason: "缺少断语或宫位" };
    }
    var dom = domainOf(stmt.palace);
    var tend = tendencyOf(stmt.patternCodes);
    var time = plainTiming(yearResult, decadal);
    return {
      status: "pass",
      year: yearResult ? yearResult.year : null,
      palace: stmt.palace,
      star: stmt.star || null,
      stars: stmt.star ? [stmt.star] : [],
      domain: dom.domain,
      domainShort: dom.short,
      domainAnchor: dom.anchor,
      domainKnown: dom.known,
      when: time.when,
      granularity: time.granularity,
      tendency: tend.plain,
      plain: composePlain(time, dom.short, stmt.star ? [stmt.star] : [], tend.plain, tend.others),
      quote: stripLeadingClause(stmt.shortText || stmt.text),
      mechanism: Array.isArray(stmt.patternTexts) ? stmt.patternTexts.join("；") : "",
      patternCodes: Array.isArray(stmt.patternCodes) ? stmt.patternCodes.slice() : [],
      // 组合生成声明必须一路带到报告：读者要能分清「作者原表断语」与「按 §12 现场组合」
      composed: Boolean(stmt.composed),
      composeLimitations: Array.isArray(stmt.composeLimitations) ? stmt.composeLimitations.slice() : [],
      // 动因宫：这件事是谁引起的、落在六内还是六外。§17「我宫他宫」靠它判，不靠文本猜。
      motivations: (Array.isArray(stmt.huaOrigins) ? stmt.huaOrigins : []).map(function (o) {
        return { layer: o.layer, kind: o.kind, star: o.star, palace: o.palace, zone: o.zone, label: o.label };
      }),
      motivationText: (Array.isArray(stmt.huaOrigins) ? stmt.huaOrigins : [])
        .map(function (o) { return o.label; }).join("、"),
      evidence: {
        factPointers: Array.isArray(stmt.factPointers) ? stmt.factPointers.slice() : [],
        knowledgeRefs: Array.isArray(stmt.knowledgeRefs) ? stmt.knowledgeRefs.slice() : [],
      },
    };
  }

  /**
   * 同一宫位、同一倾向的多条断语合并成一句。
   * 只做「同宫 + 同倾向」的合并：星曜并列进括号，原文与依据全部保留。
   * 倾向不同则不合并——那是两件事，合了会误导。
   */
  function mergeByPalace(lines) {
    var groups = [];
    var index = {};
    lines.forEach(function (line) {
      var key = line.palace + "|" + line.tendency;
      if (!index[key]) {
        index[key] = { key: key, line: line, members: [] };
        groups.push(index[key]);
      }
      index[key].members.push(line);
    });
    return groups.map(function (group) {
      var merged = JSON.parse(JSON.stringify(group.line));
      var stars = [];
      var quotes = [];
      var mechanisms = [];
      var pointers = [];
      var refs = [];
      var motivations = [];
      group.members.forEach(function (item) {
        (item.stars || []).forEach(function (star) { if (stars.indexOf(star) < 0) stars.push(star); });
        if (item.quote && quotes.indexOf(item.quote) < 0) quotes.push(item.quote);
        (item.motivations || []).forEach(function (o) {
          var dup = motivations.some(function (row) {
            return row.layer === o.layer && row.kind === o.kind && row.palace === o.palace;
          });
          if (!dup) motivations.push(o);
        });
        if (item.mechanism && mechanisms.indexOf(item.mechanism) < 0) mechanisms.push(item.mechanism);
        item.evidence.factPointers.forEach(function (p) { if (pointers.indexOf(p) < 0) pointers.push(p); });
        item.evidence.knowledgeRefs.forEach(function (r) { if (refs.indexOf(r) < 0) refs.push(r); });
      });
      merged.stars = stars;
      merged.star = stars.length > 0 ? stars.join("、") : null;
      var tend = tendencyOf(merged.patternCodes);
      var others = [];
      group.members.forEach(function (item) {
        if (item.tendency !== merged.tendency && others.indexOf(item.tendency) < 0) others.push(item.tendency);
      });
      var time = { plain: merged.when === "不定时间" ? "结构上" : merged.when.replace(" 年当年", " 年") };
      merged.plain = composePlain(time, merged.domainShort, stars, merged.tendency, others);
      merged.quotes = quotes;
      merged.quote = quotes[0] || "";
      merged.mechanisms = mechanisms;
      merged.mechanism = mechanisms.join("／");
      merged.evidence = { factPointers: pointers, knowledgeRefs: refs };
      merged.mergedCount = group.members.length;
      merged.motivations = motivations;
      merged.motivationText = motivations.map(function (o) { return o.label; }).join("、");
      merged.composedCount = group.members.filter(function (item) { return item.composed; }).length;
      merged.composed = merged.composedCount > 0;
      if (tend.others.length > 0) merged.otherTendencies = tend.others;
      return merged;
    });
  }

  /** 一年的一句话概括：只报「哪几个领域有动静」，不合成新判断。 */
  function yearHeadline(yearResult, lines) {
    if (!yearResult) return "";
    if (yearResult.reachableDepth !== 4 || lines.length === 0) {
      var stop = yearResult.reachableDepth || 0;
      var why = (yearResult.diagnostics || []).join("；");
      return yearResult.year + " 年：停在" + stop + "阶，不出断语" + (why ? "（" + why + "）" : "");
    }
    var domains = [];
    lines.forEach(function (item) {
      if (domains.indexOf(item.domainShort) < 0) domains.push(item.domainShort);
    });
    return yearResult.year + " 年：" + domains.join("、") + "上有动静。";
  }

  function renderYear(yearResult, decadal) {
    if (!yearResult) return { status: "unavailable", year: null, lines: [] };
    var raw = (yearResult.statements || [])
      .map(function (stmt) { return renderStatement(stmt, yearResult, decadal); })
      .filter(function (item) { return item.status === "pass"; });
    var lines = mergeByPalace(raw);
    return {
      status: lines.length > 0 ? "pass" : "empty",
      year: yearResult.year,
      ganzhi: yearResult.ganzhi,
      nominalAge: yearResult.nominalAge,
      reachableDepth: yearResult.reachableDepth,
      granularity: yearResult.granularity ? yearResult.granularity.granularity : "none",
      granularityReason: yearResult.granularity ? yearResult.granularity.reason : "",
      headline: yearHeadline(yearResult, lines),
      diagnostics: (yearResult.diagnostics || []).slice(),
      lines: lines,
    };
  }

  function renderTimeline(result) {
    if (!result || !Array.isArray(result.years)) {
      return { status: "unavailable", schema: SCHEMA, years: [], reason: "缺少判定结果" };
    }
    var decadal = result.decadal || null;
    var years = result.years.map(function (item) { return renderYear(item, decadal); });
    var allLines = years.reduce(function (acc, item) { return acc.concat(item.lines); }, []);
    var bad = allLines.filter(function (item) {
      return ASSERTIVE_RESIDUAL.test(item.plain) || ASSERTIVE_RESIDUAL.test(item.quote || "");
    }).map(function (item) { return item.plain; });
    var unknownDomain = allLines
      .filter(function (item) { return !item.domainKnown; })
      .map(function (item) { return item.palace; });
    return {
      status: bad.length > 0 ? "invalid" : (allLines.length > 0 ? "pass" : "partial"),
      schema: SCHEMA,
      decadal: decadal,
      years: years,
      stats: {
        yearCount: years.length,
        yearsWithPlainText: years.filter(function (item) { return item.lines.length > 0; }).length,
        lineCount: allLines.length,
        decadalLines: allLines.filter(function (item) { return item.granularity === "decadal"; }).length,
        yearLines: allLines.filter(function (item) { return item.granularity === "year"; }).length,
        untimedLines: allLines.filter(function (item) { return item.granularity === "none"; }).length,
      },
      assertiveViolations: bad,
      unknownDomains: Array.from(new Set(unknownDomain)),
    };
  }

  globalThis.MingliReportRender = Object.freeze({
    SCHEMA: SCHEMA,
    PALACE_DOMAINS: Object.freeze(PALACE_DOMAINS),
    PATTERN_TENDENCIES: Object.freeze(PATTERN_TENDENCIES),
    ASSERTIVE_RESIDUAL: ASSERTIVE_RESIDUAL,
    granularity: "none",
    domainOf: domainOf,
    tendencyOf: tendencyOf,
    plainTiming: plainTiming,
    composePlain: composePlain,
    mergeByPalace: mergeByPalace,
    renderStatement: renderStatement,
    renderYear: renderYear,
    renderTimeline: renderTimeline,
  });
})();

"use strict";

/**
 * 八字知识层：把上游 bazi-skill 的 references（经典摘要 / 参考表 / 神煞表 / 大运规则 / 时辰表）
 * 变成可寻址的章节索引，供解读层按「典籍 / 小节」引用。
 *
 * 与紫微那边的区别要先说清楚：
 *   - 紫微 knowledge-v7.7 是「14 星 × 12 宫」的逐宫断语表，查到就能出话；
 *   - 八字这份是**通则**（成格条件、调候原则、十神含义、查表口径），它给的是依据，不是条目。
 * 所以这里只提供「引用到章节」的能力，不假装能直接产出断语。
 *
 * 上游：jinchenma94/bazi-skill（MIT），commit 112a5d84。
 */
(() => {
  const SCHEMA = "mingli.bazi-knowledge/v1";
  const SOURCE_SCHEMA = "bazi-knowledge/v1";
  const DIGEST_SCHEMA = "mingli.bazi-knowledge-digest/v1";

  /** 生成索引；输入不合法时给 unavailable，不抛异常。 */
  function createIndex(knowledge) {
    const base = {
      schema: SCHEMA,
      status: "unavailable",
      documents: [],
      byAnchor: new Map(),
      anchors: [],
      stats: { documents: 0, chapters: 0, sections: 0, items: 0 },
      duplicates: [],
      reason: null,
      source: knowledge && typeof knowledge === "object" ? (knowledge.source || null) : null,
    };
    if (!knowledge || typeof knowledge !== "object") {
      return { ...base, reason: "知识包不是对象" };
    }
    if (knowledge.schema !== SOURCE_SCHEMA) {
      return { ...base, reason: `知识包 schema 不匹配：期望 ${SOURCE_SCHEMA}` };
    }
    if (!Array.isArray(knowledge.documents) || knowledge.documents.length === 0) {
      return { ...base, reason: "知识包没有 documents" };
    }

    const documents = [];
    const byAnchor = new Map();
    const duplicates = [];
    let chapters = 0;
    let sections = 0;
    let items = 0;

    const register = entry => {
      const existing = byAnchor.get(entry.anchor);
      if (!existing) {
        byAnchor.set(entry.anchor, entry);
        return;
      }
      // 同文档内「章与唯一小节同名」不算冲突（保留先注册的小节）；
      // 跨文档撞名才是真冲突，必须报出来而不是静默覆盖。
      if (existing.documentId !== entry.documentId) duplicates.push(entry.anchor);
    };

    for (const doc of knowledge.documents) {
      if (!doc || typeof doc !== "object" || !Array.isArray(doc.chapters)) continue;
      const summary = {
        id: doc.id || "",
        title: doc.title || doc.id || "",
        file: doc.file || "",
        chapterCount: doc.chapters.length,
      };
      documents.push(summary);
      for (const chapter of doc.chapters) {
        if (!chapter || typeof chapter !== "object" || !chapter.anchor) continue;
        chapters += 1;
        const sectionList = Array.isArray(chapter.subsections) ? chapter.subsections : [];
        // 章节本身也可被引用：合并其下所有条目
        const chapterItems = [];
        for (const section of sectionList) {
          if (!section || typeof section !== "object" || !section.anchor) continue;
          const entryItems = (Array.isArray(section.items) ? section.items : [])
            .filter(item => item && typeof item.text === "string" && item.text.trim())
            .map(item => ({ kind: item.kind || "point", text: item.text, line: item.line ?? null }));
          chapterItems.push(...entryItems);
          sections += 1;
          items += entryItems.length;
          register({
            anchor: section.anchor,
            kind: "section",
            documentId: summary.id,
            documentTitle: summary.title,
            chapter: chapter.anchor,
            title: section.title || section.anchor,
            line: section.line ?? null,
            items: entryItems,
          });
        }
        register({
          anchor: chapter.anchor,
          kind: "chapter",
          documentId: summary.id,
          documentTitle: summary.title,
          chapter: chapter.anchor,
          title: chapter.title || chapter.anchor,
          line: chapter.line ?? null,
          items: chapterItems,
        });
      }
    }

    const status = byAnchor.size === 0 ? "unavailable" : (duplicates.length ? "partial" : "ok");
    return {
      schema: SCHEMA,
      status,
      documents,
      byAnchor,
      anchors: Array.from(byAnchor.keys()),
      stats: { documents: documents.length, chapters, sections, items },
      duplicates,
      source: knowledge.source || null,
      reason: status === "unavailable" ? "知识包没有可寻址章节" : null,
    };
  }

  function citationOf(entry) {
    if (!entry) return "";
    const source = entry.documentId === "classical-texts"
      ? `《${entry.chapter}·${entry.title}》`
      : `《${entry.documentTitle}·${entry.title}》`;
    return `${source}，bazi-skill@112a5d84（MIT）`;
  }

  /** 取一个章节；找不到就给 unavailable + 原因，绝不编造内容。 */
  function resolve(index, anchor) {
    const empty = {
      status: "unavailable",
      anchor: String(anchor ?? ""),
      documentId: null,
      documentTitle: null,
      chapter: null,
      title: null,
      kind: null,
      line: null,
      items: [],
      text: "",
      citation: "",
      reason: null,
    };
    if (!index || !(index.byAnchor instanceof Map)) {
      return { ...empty, reason: "索引不可用" };
    }
    if (typeof anchor !== "string" || !anchor.trim()) {
      return { ...empty, reason: "缺少 anchor" };
    }
    const entry = index.byAnchor.get(anchor.trim());
    if (!entry) {
      return { ...empty, reason: `知识包未收录该章节：${anchor}` };
    }
    return {
      status: "ok",
      anchor: entry.anchor,
      documentId: entry.documentId,
      documentTitle: entry.documentTitle,
      chapter: entry.chapter,
      title: entry.title,
      kind: entry.kind,
      line: entry.line,
      items: entry.items,
      text: entry.items.map(item => item.text).join("\n"),
      citation: citationOf(entry),
      reason: null,
    };
  }

  function listAnchors(index, options = {}) {
    if (!index || !Array.isArray(index.anchors)) return [];
    const docId = options.documentId || null;
    const kind = options.kind || null;
    return index.anchors.filter(anchor => {
      const entry = index.byAnchor.get(anchor);
      if (!entry) return false;
      if (docId && entry.documentId !== docId) return false;
      if (kind && entry.kind !== kind) return false;
      return true;
    });
  }

  /** 关键词检索：返回命中条目与其所属 anchor，供人工核对用。 */
  function search(index, keyword, options = {}) {
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 20;
    const needle = String(keyword ?? "").trim();
    if (!index || !(index.byAnchor instanceof Map) || !needle) return [];
    const hits = [];
    for (const anchor of index.anchors) {
      const entry = index.byAnchor.get(anchor);
      if (!entry || entry.kind !== "section") continue;
      for (const item of entry.items) {
        if (!item.text.includes(needle)) continue;
        hits.push({ anchor, title: entry.title, line: item.line, text: item.text });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  /**
   * scope → 可引章节。只映射**已验证存在**的 anchor；
   * 上游未覆盖的 scope（纳音/旬空/胎元等）如实留空，交给调用方降级。
   */
  const SCOPE_ANCHORS = Object.freeze({
    "bazi:pillars": [
      "十天干阴阳五行表",
      "十二地支阴阳五行表",
      "日上起时法（五鼠遁元）",
    ],
    "bazi:stem-branch-properties": [
      "十天干阴阳五行表",
      "十二地支阴阳五行表",
      "天干五合",
    ],
    "bazi:ten-gods": [
      "十神定义及生克关系/十神推导规则",
      "十神定义及生克关系/十神详解",
      "渊海子平/十神与六亲",
    ],
    "bazi:hidden-stems": ["地支藏干表"],
    "bazi:twelve-life-stages": ["十二长生表"],
    "bazi:natal-relations": [
      "地支关系/六冲",
      "地支关系/三合局",
      "地支关系/六合",
      "地支关系/相刑",
      "地支关系/相害（相穿）",
    ],
    "bazi:element-inventory": ["滴天髓/旺衰判断原则"],
    "bazi:strength-candidate": ["滴天髓/旺衰判断原则", "滴天髓/气势流通", "滴天髓/核心理论"],
    "bazi:follow-pattern-candidate": ["渊海子平/基本格局分类", "滴天髓/气势流通"],
    "bazi:dominant-pattern-candidate": ["渊海子平/基本格局分类", "神峰通考/核心观点"],
    "bazi:pattern-candidates": ["三命通会/核心格局", "渊海子平/基本格局分类", "子平真诠/格局高低"],
    "bazi:balance-useful-elements": ["渊海子平/用神取法", "子平真诠/用神与相神"],
    "bazi:pattern-useful-elements": ["子平真诠/用神与相神", "子平真诠/格局成败"],
    "bazi:full-qiongtong-120-cell-climate-candidate": ["穷通宝典/核心规则", "穷通宝典/关键口诀举例"],
    "bazi:useful-element-conflicts": ["子平真诠/格局成败", "子平真诠/格局高低"],
    "bazi:combination-transformation-condition-audit": ["天干五合", "地支关系/六合"],
    "bazi:luck-cycle-relations": ["大运顺逆规则", "大运排列方法/顺排", "大运排列方法/逆排", "起运年龄计算/顺排起运年龄"],
    "bazi:annual-relations": ["流年", "注意事项"],
    "bazi:annual-cycle-coverage": ["流年"],
    "bazi:auxiliary-shensha": ["吉", "凶 / 中性"],
  });

  /** 取某 scope 的引用块；anchor 缺失的条目进 missing，不静默跳过。 */
  function anchorsForScope(index, scope) {
    const wanted = SCOPE_ANCHORS[scope] || [];
    const sections = [];
    const missing = [];
    for (const anchor of wanted) {
      const hit = resolve(index, anchor);
      if (hit.status === "ok") sections.push(hit);
      else missing.push({ anchor, reason: hit.reason });
    }
    return {
      status: sections.length ? (missing.length ? "partial" : "ok") : "unavailable",
      scope,
      mapped: wanted.length > 0,
      sections,
      missing,
      reason: wanted.length ? null : `知识层未覆盖该 scope：${scope}`,
    };
  }

  /**
   * 把一组 scope 装载成「可直接塞进提示词的知识摘要」。
   *
   * 为什么需要它：知识包能寻址还不够，解读时必须让模型看到原文，
   * 否则它只能凭训练记忆编一句，事后无法核对是哪本书哪一节。
   *
   * 三条纪律：
   *   1. 预算必须显式给。超预算的章节记 dropped，不放正文，但它的 anchor
   *      仍在 anchors 里 —— 引用可以指向「已装载但未随包发出」的章，
   *      不能因此判它不存在。
   *   2. 同一章节被多个 scope 引用时只发一次原文（shared 标记），
   *      避免同一段文字在提示词里重复占用预算。
   *   3. 上游未覆盖的 scope 进 unavailable，不伪造空章节。
   */
  function loadForScopes(index, scopes, options) {
    const opts = options || {};
    const list = Array.isArray(scopes) ? scopes : [];
    const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 12000;
    const excerptChars = Number.isFinite(opts.excerptChars) ? opts.excerptChars : 600;

    const entries = [];
    const unavailable = [];
    const anchorSet = new Set();
    const seen = new Set();
    let chars = 0;
    let sectionCount = 0;
    let truncatedSections = 0;
    let droppedSections = 0;

    for (const scope of list) {
      const got = anchorsForScope(index, scope);
      if (got.status === "unavailable") {
        unavailable.push({ scope, reason: got.reason });
        continue;
      }
      const sections = [];
      for (const sec of got.sections) {
        anchorSet.add(sec.anchor);
        sectionCount += 1;
        const head = {
          anchor: sec.anchor,
          title: sec.title,
          documentId: sec.documentId,
          chapter: sec.chapter,
          citation: sec.citation,
        };
        if (seen.has(sec.anchor)) {
          sections.push({ ...head, shared: true, text: "" });
          continue;
        }
        let text = String(sec.text || "");
        let cut = false;
        if (text.length > excerptChars) {
          text = `${text.slice(0, excerptChars)}…`;
          cut = true;
          truncatedSections += 1;
        }
        if (chars + text.length > maxChars) {
          droppedSections += 1;
          sections.push({ ...head, dropped: true, text: "" });
          continue;
        }
        seen.add(sec.anchor);
        chars += text.length;
        sections.push({ ...head, truncated: cut, text });
      }
      entries.push({ scope, status: got.status, sections });
    }

    const limitations = [];
    if (droppedSections > 0) {
      limitations.push(
        `受 ${maxChars} 字预算限制，${droppedSections} 个章节未随包发出（其 anchor 仍可被引用）`,
      );
    }
    if (unavailable.length > 0) {
      limitations.push(
        `${unavailable.length} 个 scope 上游未覆盖，只能靠事实层说明：${unavailable
          .map(item => item.scope)
          .join("、")}`,
      );
    }

    return {
      schema: DIGEST_SCHEMA,
      status: entries.length === 0
        ? "unavailable"
        : (unavailable.length || droppedSections ? "partial" : "ok"),
      source: index && index.source ? index.source : null,
      scopes: entries,
      unavailable,
      anchors: Array.from(anchorSet),
      stats: {
        scopeCount: entries.length,
        sectionCount,
        chars,
        truncatedSections,
        droppedSections,
      },
      limitations,
      reason: entries.length === 0 ? "没有可装载的 scope" : null,
    };
  }

  const api = {
    SCHEMA,
    SOURCE_SCHEMA,
    DIGEST_SCHEMA,
    SCOPE_ANCHORS,
    createIndex,
    resolve,
    listAnchors,
    search,
    anchorsForScope,
    loadForScopes,
    citationOf,
  };
  globalThis.MingliBaziKnowledge = Object.freeze(api);
})();

/**
 * 应期四阶梯执行器（钦天门 SKILL v7.7 §12）
 *
 * 四阶：结构引力 → 宫位交感 → 格局触发 → 单星应象。
 * 规则：禁跳级，每级需前一阶成立；本命大运定框架，流年只在此框架内择应期。
 *
 * 本模块只做**判定与措辞降级**，不新增技法：
 *   - 每一阶成立与否都必须给出可回指的事实指针（factPointers）；
 *   - 前者不成立，后者一律判 `skipped`，绝不越级出结论；
 *   - 第四阶必须凑齐「星曜组合 + 宫位 + 四化结构」三要素，缺一即 `unavailable`；
 *   - 断语文本里的断言词（一定/必然/绝对…）一律降级为倾向语（SKILL 铁律 5）。
 *
 * 依赖：MingliZiweiFacts.opposites（十二宫对宫表）
 */
(function (root) {
  "use strict";

  var SCHEMA = "mingli.yingqi-ladder/v1";

  var LADDERS = Object.freeze([
    { step: 1, key: "gravity", name: "结构引力" },
    { step: 2, key: "interaction", name: "宫位交感" },
    { step: 3, key: "pattern", name: "格局触发" },
    { step: 4, key: "manifestation", name: "单星应象" },
  ]);

  // 父母宫+疾厄宫即「负极线」（shizhan_zhuanlan 第一节：忌入父疾线主钱财事业上不了台面）
  var NEGATIVE_LINE = ["父母宫", "疾厄宫"];
  // 大限命财官：应期落此三宫为「年限断」；落流年命财官为「年份断」
  var KEY_PALACES_IN_PERIOD = ["命宫", "财帛宫", "官禄宫"];

  // SKILL 铁律 5「读象不铁口直断」：断言词必须降级
  var ASSERTIVE_REPLACEMENTS = [
    ["一定", "倾向"],
    ["必然", "多半"],
    ["必定", "多半"],
    ["绝对", "大体"],
    ["铁定", "多半"],
    ["铁口直断", "倾向"],
    ["肯定", "多"],
  ];
  var ASSERTIVE_RESIDUAL = /(一定|必然|必定|绝对|铁定|铁口直断|肯定|百分百|100%|绝不会)/;

  function opposites() {
    var table = root.MingliZiweiFacts && root.MingliZiweiFacts.opposites;
    if (!table || typeof table !== "object") {
      throw new Error("缺少 MingliZiweiFacts.opposites，无法判定对宫");
    }
    return table;
  }

  function oppositeOf(name) {
    if (!name) return null;
    var table = opposites();
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
  }

  /** 断言词降级。返回 {text, downgraded, residual}。 */
  function downgradeAssertive(text) {
    if (typeof text !== "string" || text.length === 0) {
      return { text: text, downgraded: false, residual: false };
    }
    var out = text;
    var changed = false;
    ASSERTIVE_REPLACEMENTS.forEach(function (pair) {
      if (out.indexOf(pair[0]) >= 0) {
        out = out.split(pair[0]).join(pair[1]);
        changed = true;
      }
    });
    return { text: out, downgraded: changed, residual: ASSERTIVE_RESIDUAL.test(out) };
  }

  function huaOf(list, kind) {
    return (list || []).find(function (item) { return item && item.kind === kind; }) || null;
  }

  function palaceByName(palaces, name) {
    return (palaces || []).find(function (item) { return item && item.name === name; }) || null;
  }

  function majorStarNames(palace) {
    return ((palace && palace.majorStars) || [])
      .map(function (star) { return star && star.name; })
      .filter(Boolean);
  }

  // ── 阶梯 1：结构引力 ────────────────────────────────────────────
  // 成立条件＝大限四化四条齐全且落宫可解析（框架先立）。
  // 在此之上给出「引力中心」：大限四化落宫中最密集的一宫。
  function evaluateGravity(timeline) {
    var decadal = timeline && timeline.decadal;
    var hua = (decadal && decadal.fourTransformations) || [];
    var evidence = [];
    var missing = [];
    ["禄", "权", "科", "忌"].forEach(function (kind) {
      var item = huaOf(hua, kind);
      if (!item || !item.natalPalace) { missing.push(kind); return; }
      evidence.push({
        pointer: "/decadal/fourTransformations[" + kind + "]",
        text: "大限" + kind + item.star + "→本命" + item.natalPalace,
      });
    });

    if (missing.length > 0) {
      return {
        step: 1, key: "gravity", name: "结构引力",
        fired: false,
        evidence: evidence,
        reason: "大限四化缺少 " + missing.join("/") + "，框架未立，不得下判",
        gravityCenter: null,
      };
    }

    // 引力中心：落宫频次最高者；同频按 禄>权>科>忌 取
    var counts = {};
    var order = [];
    ["禄", "权", "科", "忌"].forEach(function (kind) {
      var name = huaOf(hua, kind).natalPalace;
      if (!counts[name]) { counts[name] = []; order.push(name); }
      counts[name].push(kind);
    });
    var center = order[0];
    order.forEach(function (name) {
      if (counts[name].length > counts[center].length) center = name;
    });

    var onDecadalSoul = center === decadal.natalAnchorPalace;
    var onDecadalSoulOpposite = center === oppositeOf(decadal.natalAnchorPalace);
    var onKeyPalace = KEY_PALACES_IN_PERIOD.indexOf(center) >= 0;

    evidence.push({
      pointer: "/decadal/fourTransformations",
      text: "引力中心落本命" + center + "（承载 " + counts[center].join("、") + " 四化）"
        + (onDecadalSoul ? "，即大限命宫" : (onDecadalSoulOpposite ? "，冲大限命宫" : "")),
    });

    return {
      step: 1, key: "gravity", name: "结构引力",
      fired: true,
      evidence: evidence,
      reason: null,
      gravityCenter: center,
      gravityHua: counts[center].slice(),
      gravityStrength: onDecadalSoul ? "strong" : (onKeyPalace || onDecadalSoulOpposite ? "normal" : "weak"),
      onDecadalSoul: onDecadalSoul,
      onDecadalSoulOpposite: onDecadalSoulOpposite,
    };
  }

  // ── 阶梯 2：宫位交感 ────────────────────────────────────────────
  // 成立条件＝流年层与本命/大限层发生实质接触，至少一条：
  //   a) 流年四化落大限命宫或冲大限命宫
  //   b) 流年四化落宫与生年四化落宫同宫
  //   c) 流年四化落宫与大限四化落宫同宫
  //   d) 三重叠加：生年忌宫 ∧ 大限忌宫 ∧ 流年忌宫 三宫相同
  // 一条都不成立即「不引动不发」，当年不出应期。
  function evaluateInteraction(yearFact, timeline) {
    var decadal = timeline.decadal;
    var rows = (yearFact.activation && yearFact.activation.rows) || [];
    var hits = [];
    var soul = decadal.natalAnchorPalace;
    var soulOpp = oppositeOf(soul);

    rows.forEach(function (row) {
      if (!row || row.status !== "ok") return;
      var label = "流年" + row.kind + row.star + "落本命" + row.natalPalace;
      if (row.onDecadalSoul) {
        hits.push({ code: "on-decadal-soul", pointer: "/years[" + yearFact.year + "]/activation/rows[" + row.kind + "]", text: label + "，即大限命宫" });
      } else if (row.onDecadalSoulOpposite) {
        hits.push({ code: "opposite-decadal-soul", pointer: "/years[" + yearFact.year + "]/activation/rows[" + row.kind + "]", text: label + "，冲大限命宫" });
      }
      var natal = (row.overlapsNatal || []).filter(function (item) { return item && item.relation === "同宫"; });
      if (natal.length > 0) {
        hits.push({
          code: "overlap-natal",
          pointer: "/years[" + yearFact.year + "]/activation/rows[" + row.kind + "]",
          text: label + "，与生年" + natal.map(function (item) { return item.natalKind + item.star; }).join("、") + "同宫",
        });
      }
      if (row.stacked && (row.stackedOnDecadalHua || []).length > 0) {
        hits.push({
          code: "overlap-decadal",
          pointer: "/years[" + yearFact.year + "]/activation/rows[" + row.kind + "]",
          text: label + "，与大限" + row.stackedOnDecadalHua.map(function (item) { return item.kind + item.star; }).join("、") + "同宫",
        });
      }
    });

    var natalJi = yearFact.activation && yearFact.activation.natalHua && yearFact.activation.natalHua["忌"];
    var decadalJi = huaOf(decadal.fourTransformations, "忌");
    var annualJi = huaOf(yearFact.fourTransformations, "忌");
    if (natalJi && decadalJi && annualJi
      && natalJi.palace === decadalJi.natalPalace
      && natalJi.palace === annualJi.natalPalace) {
      hits.push({
        code: "triple-overlap",
        pointer: "/years[" + yearFact.year + "]/fourTransformations[忌]",
        text: "生年忌、大限忌、流年忌三重同落本命" + natalJi.palace,
      });
    }

    var fired = hits.length > 0;
    return {
      step: 2, key: "interaction", name: "宫位交感",
      fired: fired,
      evidence: hits,
      reason: fired ? null : "该年流年四化未触及大限命宫/生年四化/大限四化，依「不引动不发」不判应期",
      hits: hits,
    };
  }

  // ── 阶梯 3：格局触发 ────────────────────────────────────────────
  // 只认「多层结构」型格局，不做单星符号映射。
  //   triple-ji   三忌叠加：三层化忌同落一宫
  //   double-ji   双忌重叠：两层化忌同落一宫
  //   lu-ji-same  禄忌同宫：同宫同时承受禄与忌（跨层）
  //   lu-po       禄逢冲破：一线上一禄一忌相对（对宫），「用去冲体」尤重
  //   negative    忌入负极线（父母/疾厄）
  // 一切跨层配对都要求至少一方来自大限或流年——生年内部的禄忌对置属先天格局，
  // 是「体」不是「应期」，不得当作流年触发。
  var HUA_LAYERS = ["生年", "大限", "流年"];

  // §17「我宫他宫」要判动因落在六内还是六外：
  //   六内 = 命财疾官田福（自己的事）；六外 = 兄夫子交友父迁（人事与外部）。
  // 这里只做归类，不下吉凶——六内六外是「这件事归谁」的口径，不是好坏。
  var INSIDE_PALACES = ["命宫", "财帛宫", "疾厄宫", "官禄宫", "田宅宫", "福德宫"];
  var OUTSIDE_PALACES = ["兄弟宫", "夫妻宫", "子女宫", "交友宫", "仆役宫", "父母宫", "迁移宫"];

  function palaceZone(palaceName) {
    if (!palaceName) return null;
    if (INSIDE_PALACES.indexOf(palaceName) >= 0) return "inside";
    if (OUTSIDE_PALACES.indexOf(palaceName) >= 0) return "outside";
    return null;
  }

  /** 把参与某个格局的化星整理成可追溯的动因（层 + 象 + 星 + 落宫 + 内外）。 */
  function originsOf(items) {
    return (items || []).map(function (item) {
      return {
        layer: item.layer,
        kind: item.kind,
        star: item.star,
        palace: item.palace,
        zone: palaceZone(item.palace),
        label: item.layer + item.kind + item.star + "（本命" + item.palace + "·"
          + (palaceZone(item.palace) === "inside" ? "六内" : (palaceZone(item.palace) === "outside" ? "六外" : "未归类")) + "）",
      };
    });
  }

  function collectHua(yearFact, timeline) {
    var out = [];
    var natal = (yearFact.activation && yearFact.activation.natalHua) || {};
    ["禄", "权", "科", "忌"].forEach(function (kind) {
      var item = natal[kind];
      if (item && item.palace) out.push({ layer: "生年", kind: kind, star: item.star, palace: item.palace });
    });
    (timeline.decadal.fourTransformations || []).forEach(function (item) {
      if (item && item.natalPalace) out.push({ layer: "大限", kind: item.kind, star: item.star, palace: item.natalPalace });
    });
    (yearFact.fourTransformations || []).forEach(function (item) {
      if (item && item.natalPalace) out.push({ layer: "流年", kind: item.kind, star: item.star, palace: item.natalPalace });
    });
    return out;
  }

  function isDynamic(entry) {
    return entry.layer === "大限" || entry.layer === "流年";
  }

  function evaluatePattern(yearFact, timeline, interaction) {
    if (!interaction || !interaction.fired) {
      return {
        step: 3, key: "pattern", name: "格局触发",
        fired: false, evidence: [], reason: "上一阶未成立，禁跳级", skipped: true, patterns: [],
      };
    }
    var patterns = [];
    var all = collectHua(yearFact, timeline);
    var ji = all.filter(function (item) { return item.kind === "忌"; });
    var lu = all.filter(function (item) { return item.kind === "禄"; });

    // ── 化忌叠加：按宫位归纳层数 ──
    var byPalace = {};
    ji.forEach(function (item) {
      if (!byPalace[item.palace]) byPalace[item.palace] = [];
      if (!byPalace[item.palace].some(function (x) { return x.layer === item.layer; })) {
        byPalace[item.palace].push(item);
      }
    });
    Object.keys(byPalace).forEach(function (palace) {
      var layers = byPalace[palace];
      if (layers.length < 2) return;
      if (!layers.some(isDynamic)) return; // 生年内部不算引动
      var isTriple = layers.length >= 3;
      patterns.push({
        code: isTriple ? "triple-ji" : "double-ji",
        palace: palace,
        pointer: "/years/" + yearFact.year + "/activation/natalHua[忌]",
        origins: originsOf(layers),
        text: (isTriple ? "三忌叠加" : "双忌重叠") + "："
          + layers.map(function (item) { return item.layer + "忌" + item.star; }).join("、")
          + "同落本命" + palace,
      });
    });

    // ── 负极线 ──
    ji.forEach(function (item) {
      if (NEGATIVE_LINE.indexOf(item.palace) < 0) return;
      if (!isDynamic(item)) return;
      patterns.push({
        code: "negative-line",
        palace: item.palace,
        pointer: "/years/" + yearFact.year + "/fourTransformations[忌]",
        origins: originsOf([item]),
        text: item.layer + "忌" + item.star + "入" + item.palace + "（负极线）",
      });
    });

    // ── 禄忌同宫 / 禄逢冲破 ──
    lu.forEach(function (luItem) {
      ji.forEach(function (jiItem) {
        if (luItem.layer === jiItem.layer) return;      // 同层不成碰撞
        if (!isDynamic(luItem) && !isDynamic(jiItem)) return; // 生年内部是体，不是应期
        if (luItem.star === jiItem.star) return;         // 同星禄忌属自化范畴，另计
        if (luItem.palace === jiItem.palace) {
          patterns.push({
            code: "lu-ji-same",
            palace: luItem.palace,
            pointer: "/years/" + yearFact.year + "/fourTransformations",
            origins: originsOf([luItem, jiItem]),
            text: "本命" + luItem.palace + "同时承受 " + luItem.layer + "禄" + luItem.star
              + " 与 " + jiItem.layer + "忌" + jiItem.star + "（禄忌同宫）",
          });
        } else if (oppositeOf(luItem.palace) === jiItem.palace) {
          patterns.push({
            code: "lu-po",
            // 被冲的是禄所在宫，单星应象取该宫
            palace: luItem.palace,
            pointer: "/years/" + yearFact.year + "/fourTransformations[忌]",
            origins: originsOf([luItem, jiItem]),
            text: luItem.layer + "禄" + luItem.star + "在本命" + luItem.palace + "，"
              + jiItem.layer + "忌" + jiItem.star + "自" + jiItem.palace + "对冲，构成禄逢冲破",
          });
        }
      });
    });
    // 同星同宫的禄忌（流年忌入生年禄等）另作一条，不与「同宫异星」混为一类
    lu.forEach(function (luItem) {
      ji.forEach(function (jiItem) {
        if (luItem.layer === jiItem.layer) return;
        if (luItem.star !== jiItem.star) return;
        if (luItem.palace !== jiItem.palace) return;
        if (!isDynamic(luItem) && !isDynamic(jiItem)) return;
        patterns.push({
          code: "same-star-lu-ji",
          palace: luItem.palace,
          pointer: "/years/" + yearFact.year + "/fourTransformations",
          origins: originsOf([luItem, jiItem]),
          text: "本命" + luItem.palace + "的" + luItem.star + "同承" + luItem.layer + "禄与"
            + jiItem.layer + "忌（同星禄忌叠临）",
        });
      });
    });

    // 去重：同 code + 同宫只留一条
    var unique = [];
    var seen = {};
    patterns.forEach(function (item) {
      var key = item.code + "@" + item.palace;
      if (seen[key]) return;
      seen[key] = true;
      unique.push(item);
    });

    var fired = unique.length > 0;
    return {
      step: 3, key: "pattern", name: "格局触发",
      fired: fired,
      evidence: unique,
      reason: fired ? null : "本阶五种多层结构（双忌/三忌/禄忌同宫/禄逢冲破/负极线）均未成立",
      skipped: false,
      patterns: unique,
    };
  }

  // ── 阶梯 4：单星应象 ────────────────────────────────────────────
  // 三要素缺一不可：星曜组合（宫位主星且知识库命中）+ 宫位 + 四化结构（上一阶的格局）。
  // 缺知识库命中即 `unavailable`，绝不自行编造星意。
  function evaluateManifestation(yearFact, timeline, pattern, palaces, knowledge, knowledgeIndex, composeParts) {
    if (!pattern || !pattern.fired) {
      return {
        step: 4, key: "manifestation", name: "单星应象",
        fired: false, evidence: [], reason: "上一阶未成立，禁跳级", skipped: true,
        statements: [], unavailable: [],
      };
    }
    if (!knowledge || !knowledgeIndex) {
      return {
        step: 4, key: "manifestation", name: "单星应象",
        fired: false, evidence: [], reason: "未提供知识库索引，无法凑齐三要素", skipped: false,
        statements: [], unavailable: [{ reason: "knowledge-missing" }],
      };
    }

    var statements = [];
    var unavailable = [];
    var seen = {};

    pattern.patterns.forEach(function (item) {
      // 宫位只认该格局自身携带的 palace，绝不从文本或别的化星反推，
      // 否则会把 A 宫的格局套到 B 宫的星曜断语上。
      var palaceName = item.palace || null;
      if (!palaceName) {
        unavailable.push({ code: item.code, reason: "格局未定位到唯一宫位" });
        return;
      }
      var key = item.code + "@" + palaceName;
      if (seen[key]) return;
      seen[key] = true;

      var palace = palaceByName(palaces, palaceName);
      var stars = majorStarNames(palace);
      if (stars.length === 0) {
        unavailable.push({ code: item.code, palace: palaceName, reason: "该宫无主星，无以构成星曜组合" });
        return;
      }
      var hits = [];
      stars.forEach(function (starName) {
        var reading = knowledge.lookupPalaceReading(knowledgeIndex, starName, palaceName);
        if (reading) hits.push(reading);
      });

      // 逐宫断语表里这一格若是「—（源未及）」，回退到同体系的组合生成。
      // 依据 SKILL §12：正统断法是「星曜组合 + 宫位 + 四化结构」三要素现场组合，
      // 逐宫断语表只是便利索引；索引空着不等于这条路走不通。
      // 组合句一律带 composed 标记，报告正文必须显式标注，不得冒充原表断语。
      var composedRows = [];
      if (hits.length === 0 && composeParts && typeof MingliKnowledgeCompose !== "undefined") {
        var huaRows = collectHua(yearFact, timeline)
          .filter(function (entry) { return entry.palace === palaceName; })
          .map(function (entry) { return { layer: entry.layer, kind: entry.kind, star: entry.star }; });
        var built = MingliKnowledgeCompose.composeMany(composeParts, stars.map(function (starName) {
          return { star: starName, palace: palaceName, hua: huaRows };
        }));
        composedRows = built.entries;
        built.failed.forEach(function (item) {
          unavailable.push({
            code: item.code, palace: palaceName, stars: stars,
            reason: "该宫断语未载，组合生成也不可用：" + (item.reason || "原因不明"),
          });
        });
      }

      var entries = hits.map(function (item) {
        return { star: item.star, text: item.reading, refs: [item.ruleId], composed: false, limitations: [] };
      }).concat(composedRows.map(function (item) {
        return { star: item.star, text: item.reading, refs: item.refs, composed: true, limitations: item.limitations };
      }));

      if (entries.length === 0) {
        unavailable.push({
          code: item.code, palace: palaceName, stars: stars,
          reason: "知识库未收录 " + stars.join("/") + " 在" + palaceName + "的断语",
        });
        return;
      }

      entries.forEach(function (reading) {
        var downgraded = downgradeAssertive(reading.text);
        if (downgraded.residual) {
          unavailable.push({ code: item.code, palace: palaceName, reason: "断语含未降级的断言词，拒绝输出" });
          return;
        }
        var composedMark = reading.composed ? "（组合生成，非原表断语）" : "";
        // 同一颗星在同一宫：多个格局命中只合并格局来源，不重复出句
        var statementKey = palaceName + "|" + reading.star;
        var existing = statements.find(function (row) { return row.key === statementKey; });
        if (existing) {
          if (existing.patternCodes.indexOf(item.code) < 0) {
            existing.patternCodes.push(item.code);
            existing.patternTexts.push(item.text);
            existing.text = "本命" + palaceName + "坐" + reading.star + "，受"
              + existing.patternTexts.join("；") + "引动，倾向" + downgraded.text;
            existing.factPointers = Array.from(new Set(existing.factPointers.concat([item.pointer])));
          }
          // 动因随格局一起合并：多个格局指向同一句时，动因清单取并集
          (item.origins || []).forEach(function (origin) {
            var dup = existing.huaOrigins.some(function (row) {
              return row.layer === origin.layer && row.kind === origin.kind && row.palace === origin.palace;
            });
            if (!dup) existing.huaOrigins.push(origin);
          });
          if (reading.composed) existing.composed = true;
          return;
        }
        statements.push({
          key: statementKey,
          text: "本命" + palaceName + "坐" + reading.star + "，受" + item.text + "引动，倾向"
            + downgraded.text,
          // 报告正文用：只取第一层语义（首个分句），完整断语留在 text 里备查。
          // 组合句本身不长，放宽上限，避免把四化条款截掉一半。
          shortText: "本命" + palaceName + "坐" + reading.star + "，"
            + shortenReading(downgraded.text, reading.composed ? 120 : 48) + composedMark,
          ladderStep: 4,
          patternCode: item.code,
          patternCodes: [item.code],
          patternTexts: [item.text],
          palace: palaceName,
          star: reading.star,
          factPointers: [item.pointer],
          // §17「我宫他宫」的判据：动因宫落六内还是六外，逐条可查，不从文本反推
          huaOrigins: (item.origins || []).slice(),
          knowledgeRefs: reading.refs,
          downgraded: downgraded.downgraded,
          composed: Boolean(reading.composed),
          composeLimitations: reading.limitations || [],
        });
      });
    });

    return {
      step: 4, key: "manifestation", name: "单星应象",
      fired: statements.length > 0,
      evidence: statements.map(function (item) {
        return { pointer: item.factPointers[0], text: item.text, ruleId: item.knowledgeRefs[0] };
      }),
      reason: statements.length > 0 ? null : "三要素未能凑齐，不出单星断语",
      skipped: false,
      statements: statements,
      unavailable: unavailable,
    };
  }

  /** 应期远近（shizhan_zhuanlan 第一节）：落大限命财官=年限断；落流年命财官=年份断。 */
  function evaluateGranularity(yearFact, timeline, ladder4) {
    if (!ladder4 || !ladder4.fired) {
      return { granularity: "none", reason: "未达第四阶，不定应期远近" };
    }
    var palaces = Array.from(new Set(ladder4.statements
      .map(function (item) { return item.palace; })
      .filter(Boolean)));
    var decadeHit = palaces.filter(function (name) {
      var row = (yearFact.palaceOverlay || []).find(function (item) { return item && item.natalPalace === name; });
      return row && KEY_PALACES_IN_PERIOD.indexOf(row.decadalPalace) >= 0;
    });
    if (decadeHit.length > 0) {
      return {
        granularity: "decadal",
        reason: "触发宫在大限命/财/官（" + decadeHit.join("、") + "），按年限断（5–10 年计）",
      };
    }
    var annualHit = palaces.filter(function (name) {
      var row = (yearFact.palaceOverlay || []).find(function (item) { return item && item.natalPalace === name; });
      return row && KEY_PALACES_IN_PERIOD.indexOf(row.annualPalace) >= 0;
    });
    if (annualHit.length > 0) {
      return {
        granularity: "year",
        reason: "触发宫在流年命/财/官（" + annualHit.join("、") + "），按年份断（当年验）",
      };
    }
    return { granularity: "none", reason: "触发宫不在命财官，只作结构提示，不定时间" };
  }

  /** 取断语的第一层语义（首个分句），供报告正文使用；完整文本仍保留在 text。 */
  function shortenReading(text, limit) {
    var cap = typeof limit === "number" ? limit : 48;
    var source = String(text || "");
    var cut = source.search(/[。；;]/);
    var head = cut > 0 ? source.slice(0, cut) : source;
    if (head.length > cap) head = head.slice(0, cap) + "…";
    return head;
  }

  /**
   * 逐年判四阶梯。
   * @param {object} timeline  buildDecadalAnnualTimeline 的结果
   * @param {object} options   {palaces, knowledge, knowledgeIndex}
   */
  function evaluateTimeline(timeline, options) {
    var opts = options || {};
    if (!timeline || !Array.isArray(timeline.years)) {
      return { status: "unavailable", schema: SCHEMA, reason: "缺少大限逐年事实", years: [] };
    }
    var gravity = evaluateGravity(timeline);

    var years = timeline.years.map(function (yearFact) {
      var ladders = [gravity];
      if (!gravity.fired) {
        // 阶梯 1 未成立：后续一律 skipped
        [2, 3, 4].forEach(function (step) {
          ladders.push({
            step: step, name: LADDERS[step - 1].name, key: LADDERS[step - 1].key,
            fired: false, evidence: [], reason: "阶梯 1 未成立，禁跳级", skipped: true,
          });
        });
        return {
          year: yearFact.year, ganzhi: yearFact.ganzhi, nominalAge: yearFact.nominalAge,
          status: "unavailable", ladders: ladders, reachableDepth: 0,
          granularity: { granularity: "none", reason: "框架未立" },
          statements: [], diagnostics: ["阶梯 1 未成立"],
        };
      }

      var interaction = evaluateInteraction(yearFact, timeline);
      var pattern = evaluatePattern(yearFact, timeline, interaction);
      var manifestation = evaluateManifestation(yearFact, timeline, pattern, opts.palaces, opts.knowledge, opts.knowledgeIndex, opts.composeParts);
      ladders.push(interaction, pattern, manifestation);

      var depth = 0;
      ladders.forEach(function (item) { if (item.fired) depth = item.step; });

      var granularity = evaluateGranularity(yearFact, timeline, manifestation);
      var diagnostics = [];
      if (interaction.fired && !pattern.fired) diagnostics.push("已交感但未成格局，停在第二阶");
      if (pattern.fired && !manifestation.fired) diagnostics.push("已成格局但三要素不齐，停在第三阶");
      (manifestation.unavailable || []).forEach(function (item) {
        diagnostics.push("单星应象缺料：" + (item.palace || "") + " " + item.reason);
      });

      return {
        year: yearFact.year, ganzhi: yearFact.ganzhi, nominalAge: yearFact.nominalAge,
        status: depth === 4 ? "pass" : "partial",
        ladders: ladders,
        reachableDepth: depth,
        granularity: granularity,
        statements: manifestation.statements || [],
        diagnostics: diagnostics,
      };
    });

    var deep = years.filter(function (item) { return item.reachableDepth === 4; });
    return {
      status: gravity.fired ? (deep.length > 0 ? "pass" : "partial") : "unavailable",
      schema: SCHEMA,
      decadal: {
        ganzhi: timeline.decadal.ganzhi,
        ageRange: timeline.decadal.ageRange,
        yearRange: timeline.decadal.yearRange,
        natalAnchorPalace: timeline.decadal.natalAnchorPalace,
        gravityCenter: gravity.gravityCenter,
        gravityStrength: gravity.gravityStrength,
      },
      ladderTotals: LADDERS.map(function (item) {
        return {
          step: item.step, name: item.name,
          firedYears: years.filter(function (y) { return y.ladders[item.step - 1] && y.ladders[item.step - 1].fired; }).length,
        };
      }),
      years: years,
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    LADDERS: LADDERS,
    NEGATIVE_LINE: NEGATIVE_LINE,
    INSIDE_PALACES: INSIDE_PALACES,
    OUTSIDE_PALACES: OUTSIDE_PALACES,
    palaceZone: palaceZone,
    evaluateTimeline: evaluateTimeline,
    evaluateGravity: evaluateGravity,
    evaluateInteraction: evaluateInteraction,
    evaluatePattern: evaluatePattern,
    evaluateManifestation: evaluateManifestation,
    evaluateGranularity: evaluateGranularity,
    downgradeAssertive: downgradeAssertive,
    shortenReading: shortenReading,
    oppositeOf: oppositeOf,
  };

  root.MingliYingqiLadder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

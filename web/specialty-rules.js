/* §16 专题判定：#7 六宫禄打分、#10 破财五法则、#11 离婚四法则
 *
 * 规则出处（SKILL.md 原文，不改写口径）：
 *  §11 六宫禄打分：本命(财帛/兄弟/田宅)+大运同三宫=六宫；禄3·权2·科1·忌-1，
 *      自化禄权科+1·自化忌-1（自化不分向心离心均±1；同宫可叠加：生年权2+自化禄+1=3）。满分18
 *  破财五法则：①忌坐财帛 ②忌冲财帛 ③财帛自化忌 ④交友宫地劫/地空/忌=损友破财
 *      ⑤命/夫妻/子女有贪狼廉贞+化禄权=桃花破财
 *  离婚四法则：①夫妻宫忌=不可调和 ②子女宫忌=因孩子 ③迁移宫忌=聚少离多
 *      ④福德宫忌=价值观不合（最难修复）
 *
 * 三条纪律：
 *  1. 只判「规则条件是否成立」，不给吉凶强弱以外的引申。成立即报成立，不成立的
 *     也留痕（fired:false + 原因），不做沉默丢弃。
 *  2. 每条款都带证据指针（宫位 + 星曜下标），可倒查。
 *  3. 「满分18」意味着单宫封顶 3（6×3）；封顶只影响合计，原始分同时保留。
 */
(function () {
  "use strict";

  var SCHEMA = "mingli.specialty-rules/v1";

  var HUA_WEIGHT = { 禄: 3, 权: 2, 科: 1, 忌: -1 };
  var SELF_WEIGHT = { 禄: 1, 权: 1, 科: 1, 忌: -1 };
  var SIX_PALACES = ["财帛宫", "兄弟宫", "田宅宫"];
  var PALACE_CAP = 3;
  var MAX_SCORE = 18;

  var LOST_FRIEND_STARS = ["地劫", "地空"];
  var PEACH_BLOSSOM_STARS = ["贪狼", "廉贞"];
  var PEACH_BLOSSOM_PALACES = ["命宫", "夫妻宫", "子女宫"];

  var DIVORCE_CLAUSES = [
    { code: "spouse-ji", palace: "夫妻宫", label: "夫妻宫忌", note: "不可调和的冲突" },
    { code: "child-ji", palace: "子女宫", label: "子女宫忌", note: "因孩子而起" },
    { code: "travel-ji", palace: "迁移宫", label: "迁移宫忌", note: "聚少离多" },
    { code: "fortune-ji", palace: "福德宫", label: "福德宫忌", note: "价值观不合（最难修复）" },
  ];

  function fourHuaTable() {
    var facts = globalThis.MingliZiweiFacts;
    return facts && facts.fourHuaTable ? facts.fourHuaTable : null;
  }

  function starList(palace, key) {
    return Array.isArray(palace && palace[key]) ? palace[key] : [];
  }

  function allStars(palace) {
    return starList(palace, "majorStars")
      .concat(starList(palace, "minorStars"))
      .concat(starList(palace, "auxiliaryStars"));
  }

  function starNames(palace) {
    return allStars(palace).map(function (item) { return item && item.name; }).filter(Boolean);
  }

  function findPalace(palaces, name) {
    return (palaces || []).find(function (item) { return item && item.name === name; }) || null;
  }

  /** 生年四化：从星曜的 transformation 字段反查，不另推年干。 */
  function natalHua(palaces) {
    var out = [];
    (palaces || []).forEach(function (palace) {
      ["majorStars", "minorStars", "auxiliaryStars"].forEach(function (key) {
        starList(palace, key).forEach(function (star, i) {
          if (!star || !star.transformation) return;
          out.push({
            layer: "生年",
            kind: star.transformation,
            star: star.name,
            palace: palace.name,
            pointer: "/palaces/" + palace.index + "/" + key + "/" + i + "/transformation",
          });
        });
      });
    });
    return out;
  }

  /** 自化：宫干四化所化之星落在本宫。 */
  function selfHua(palace) {
    var table = fourHuaTable();
    var out = [];
    if (!table || !palace || !palace.heavenlyStem) return out;
    var map = table[palace.heavenlyStem];
    if (!map) return out;
    var names = starNames(palace);
    ["禄", "权", "科", "忌"].forEach(function (kind) {
      var star = map[kind];
      if (star && names.indexOf(star) >= 0) {
        out.push({
          layer: "自化",
          kind: kind,
          star: star,
          palace: palace.name,
          pointer: "/palaces/" + palace.index + "/heavenlyStem",
        });
      }
    });
    return out;
  }

  function decadalHua(timeline) {
    var list = timeline && timeline.decadal && timeline.decadal.fourTransformations;
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (item) { return item && item.kind && item.star && item.natalPalace; })
      .map(function (item) {
        return {
          layer: "大限",
          kind: item.kind,
          star: item.star,
          palace: item.natalPalace,
          pointer: "/decadal/fourTransformations[" + item.kind + "]",
        };
      });
  }

  function annualHua(yearFact) {
    var list = yearFact && yearFact.fourTransformations;
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (item) { return item && item.kind && item.star && (item.natalPalace || item.palace); })
      .map(function (item) {
        return {
          layer: "流年",
          kind: item.kind,
          star: item.star,
          palace: item.natalPalace || item.palace,
          pointer: "/years/" + yearFact.year + "/fourTransformations[" + item.kind + "]",
        };
      });
  }

  /** 大限十二宫 → 本命宫名 的对照表（取自逐月叠宫的 decadalPalace 列）。 */
  function decadalPalaceMap(timeline) {
    var year = timeline && Array.isArray(timeline.years) ? timeline.years[0] : null;
    var rows = year && Array.isArray(year.palaceOverlay) ? year.palaceOverlay : [];
    var map = {};
    rows.forEach(function (row) {
      if (row && row.decadalPalace && row.natalPalace) map[row.decadalPalace] = row.natalPalace;
    });
    return map;
  }

  // ───────────────────────── #7 六宫禄打分 ─────────────────────────

  /**
   * @param {{palaces:Array, timeline:object}} input
   * @returns 六宫逐宫得分 + 合计（封顶 18，原始分同时给出）
   */
  function scoreSixPalaces(input) {
    var palaces = (input && input.palaces) || [];
    var timeline = input && input.timeline;
    if (palaces.length === 0) {
      return { status: "unavailable", schema: SCHEMA, reason: "缺少十二宫" };
    }
    var natal = natalHua(palaces);
    var decadal = decadalHua(timeline);
    var map = decadalPalaceMap(timeline);
    if (!timeline || !timeline.decadal) {
      return { status: "unavailable", schema: SCHEMA, reason: "缺少大限信息，六宫只有三宫可算" };
    }

    var slots = [];
    SIX_PALACES.forEach(function (name) {
      slots.push({ layer: "本命", palace: name, source: name });
    });
    SIX_PALACES.forEach(function (name) {
      var natalName = map[name];
      if (!natalName) return;
      slots.push({ layer: "大运", palace: name, source: natalName });
    });

    var rows = slots.map(function (slot) {
      var items = [];
      var pool = slot.layer === "本命" ? natal : decadal;
      pool.forEach(function (hua) {
        if (hua.palace !== slot.source) return;
        var weight = HUA_WEIGHT[hua.kind];
        if (typeof weight !== "number") return;
        items.push({ source: hua.layer, kind: hua.kind, star: hua.star, weight: weight, pointer: hua.pointer });
      });
      // 自化是本命宫干的属性，不随大限重算；同一宫位同时出现在本命槽与大运槽时
      // 只在本命槽计一次，否则同一事实被重复扣分/加分。
      if (slot.layer === "本命") {
        var palace = findPalace(palaces, slot.source);
        selfHua(palace).forEach(function (hua) {
          var weight = SELF_WEIGHT[hua.kind];
          if (typeof weight !== "number") return;
          items.push({ source: "自化", kind: hua.kind, star: hua.star, weight: weight, pointer: hua.pointer });
        });
      }
      var raw = items.reduce(function (sum, item) { return sum + item.weight; }, 0);
      return {
        layer: slot.layer,
        slot: slot.palace,
        palace: slot.source,
        items: items,
        raw: raw,
        score: Math.min(PALACE_CAP, raw),
        capped: raw > PALACE_CAP,
      };
    });

    var total = rows.reduce(function (sum, row) { return sum + row.score; }, 0);
    var rawTotal = rows.reduce(function (sum, row) { return sum + row.raw; }, 0);
    return {
      status: "pass",
      schema: SCHEMA,
      max: MAX_SCORE,
      cap: PALACE_CAP,
      total: total,
      rawTotal: rawTotal,
      rows: rows,
      rule: "禄3·权2·科1·忌-1，自化±1，同宫叠加；单宫封顶 3，满分 18",
      dedupeNote: "自化只在本命槽计一次；本命与大运三宫可落在同一宫位（例：大限财帛=本命兄弟），此时生年四化与大限四化各自计入，互不替代",
    };
  }

  // ───────────────────────── #10 破财五法则 ─────────────────────────

  function jiIn(pool, palaceName) {
    return pool.filter(function (item) { return item.kind === "忌" && item.palace === palaceName; });
  }

  function evaluateWealth(input) {
    var palaces = (input && input.palaces) || [];
    var timeline = input && input.timeline;
    var yearFact = input && input.yearFact;
    if (palaces.length === 0) {
      return { status: "unavailable", schema: SCHEMA, reason: "缺少十二宫" };
    }
    var pool = natalHua(palaces).concat(decadalHua(timeline));
    if (yearFact) pool = pool.concat(annualHua(yearFact));

    var cai = findPalace(palaces, "财帛宫");
    var fu = findPalace(palaces, "财帛宫") ? findPalace(palaces, "福德宫") : null;
    var friend = findPalace(palaces, "仆役宫") || findPalace(palaces, "交友宫");

    var clauses = [];

    // ① 忌坐财帛
    var seated = jiIn(pool, "财帛宫");
    clauses.push({
      code: "ji-in-cai",
      label: "忌坐财帛",
      fired: seated.length > 0,
      detail: seated.length > 0
        ? seated.map(function (item) { return item.layer + "忌" + item.star; }).join("、") + "坐财帛宫"
        : "财帛宫无化忌坐守",
      evidence: seated.map(function (item) { return item.pointer; }),
    });

    // ② 忌冲财帛（对宫为福德）
    var opposing = jiIn(pool, "福德宫");
    clauses.push({
      code: "ji-chong-cai",
      label: "忌冲财帛",
      fired: opposing.length > 0,
      detail: opposing.length > 0
        ? opposing.map(function (item) { return item.layer + "忌" + item.star; }).join("、") + "在福德宫，冲财帛"
        : "福德宫无化忌，财帛未被冲",
      evidence: opposing.map(function (item) { return item.pointer; }),
    });

    // ③ 财帛自化忌
    var selfJi = cai ? selfHua(cai).filter(function (item) { return item.kind === "忌"; }) : [];
    clauses.push({
      code: "cai-self-ji",
      label: "财帛自化忌",
      fired: selfJi.length > 0,
      detail: selfJi.length > 0
        ? "财帛宫干" + cai.heavenlyStem + "自化忌（" + selfJi[0].star + "）"
        : "财帛宫无自化忌",
      evidence: selfJi.map(function (item) { return item.pointer; }),
    });

    // ④ 交友宫地劫/地空/忌 = 损友破财
    var friendNames = friend ? starNames(friend) : [];
    var lostStars = friendNames.filter(function (name) { return LOST_FRIEND_STARS.indexOf(name) >= 0; });
    var friendJi = jiIn(pool, "仆役宫").concat(jiIn(pool, "交友宫"));
    clauses.push({
      code: "lost-friend",
      label: "损友破财",
      fired: lostStars.length > 0 || friendJi.length > 0,
      detail: (lostStars.length > 0 || friendJi.length > 0)
        ? [
          lostStars.length > 0 ? "仆役宫坐" + lostStars.join("、") : "",
          friendJi.length > 0 ? friendJi.map(function (item) { return item.layer + "忌" + item.star; }).join("、") + "入仆役宫" : "",
        ].filter(Boolean).join("；")
        : "仆役宫无地劫地空，亦无化忌",
      evidence: friendJi.map(function (item) { return item.pointer; }),
    });

    // ⑤ 命/夫妻/子女有贪狼廉贞 + 化禄权 = 桃花破财
    var peach = [];
    PEACH_BLOSSOM_PALACES.forEach(function (name) {
      var palace = findPalace(palaces, name);
      if (!palace) return;
      allStars(palace).forEach(function (star, i) {
        if (!star || PEACH_BLOSSOM_STARS.indexOf(star.name) < 0) return;
        var key = "majorStars";
        if (starList(palace, "minorStars").indexOf(star) >= 0) key = "minorStars";
        if (starList(palace, "auxiliaryStars").indexOf(star) >= 0) key = "auxiliaryStars";
        var natalKind = star.transformation;
        if (natalKind === "禄" || natalKind === "权") {
          peach.push({
            text: name + star.name + "生年化" + natalKind,
            pointer: "/palaces/" + palace.index + "/" + key + "/" + i + "/transformation",
          });
        }
        pool.forEach(function (hua) {
          if (hua.palace !== name || hua.star !== star.name) return;
          if (hua.kind !== "禄" && hua.kind !== "权") return;
          peach.push({ text: name + star.name + hua.layer + "化" + hua.kind, pointer: hua.pointer });
        });
      });
    });
    clauses.push({
      code: "peach-spend",
      label: "桃花破财",
      fired: peach.length > 0,
      detail: peach.length > 0
        ? peach.map(function (item) { return item.text; }).join("；")
        : "命/夫妻/子女无贪狼廉贞被化禄权",
      evidence: peach.map(function (item) { return item.pointer; }),
    });

    var fired = clauses.filter(function (item) { return item.fired; });
    return {
      status: "pass",
      schema: SCHEMA,
      firedCount: fired.length,
      total: clauses.length,
      singleSupport: fired.length === 1,
      clauses: clauses,
      note: "§17 多项定一象：仅 1 条成立时按单象处理，不作结论。",
    };
  }

  // ───────────────────────── #11 离婚四法则 ─────────────────────────

  function evaluateDivorce(input) {
    var palaces = (input && input.palaces) || [];
    var timeline = input && input.timeline;
    var yearFact = input && input.yearFact;
    if (palaces.length === 0) {
      return { status: "unavailable", schema: SCHEMA, reason: "缺少十二宫" };
    }
    var pool = natalHua(palaces).concat(decadalHua(timeline));
    if (yearFact) pool = pool.concat(annualHua(yearFact));

    var clauses = DIVORCE_CLAUSES.map(function (spec) {
      var hits = jiIn(pool, spec.palace);
      return {
        code: spec.code,
        label: spec.label,
        palace: spec.palace,
        note: spec.note,
        fired: hits.length > 0,
        detail: hits.length > 0
          ? hits.map(function (item) { return item.layer + "忌" + item.star; }).join("、") + "入" + spec.palace
          : spec.palace + "无化忌",
        evidence: hits.map(function (item) { return item.pointer; }),
      };
    });

    var fired = clauses.filter(function (item) { return item.fired; });
    return {
      status: "pass",
      schema: SCHEMA,
      firedCount: fired.length,
      total: clauses.length,
      singleSupport: fired.length === 1,
      clauses: clauses,
      note: "§17 多项定一象：须 ≥2 条独立成立方可作为倾向结论；单条只记「单象，待验证」。",
    };
  }

  function evaluateAll(input) {
    return {
      status: "pass",
      schema: SCHEMA,
      sixPalaces: scoreSixPalaces(input),
      wealth: evaluateWealth(input),
      divorce: evaluateDivorce(input),
    };
  }

  globalThis.MingliSpecialtyRules = Object.freeze({
    SCHEMA: SCHEMA,
    HUA_WEIGHT: Object.freeze(HUA_WEIGHT),
    SELF_WEIGHT: Object.freeze(SELF_WEIGHT),
    SIX_PALACES: Object.freeze(SIX_PALACES),
    PALACE_CAP: PALACE_CAP,
    MAX_SCORE: MAX_SCORE,
    DIVORCE_CLAUSES: Object.freeze(DIVORCE_CLAUSES),
    natalHua: natalHua,
    selfHua: selfHua,
    decadalPalaceMap: decadalPalaceMap,
    scoreSixPalaces: scoreSixPalaces,
    evaluateWealth: evaluateWealth,
    evaluateDivorce: evaluateDivorce,
    evaluateAll: evaluateAll,
  });
})();

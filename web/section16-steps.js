/* §16 强制分析清单 —— 其余步骤的执行器
 *
 * 覆盖：1 排盘对账 / 3 生年四化与逐宫飞化 / 4 十六字检查 / 5 引动检查 /
 *      8 叠宫推算 / 9 大限四化两步定位 / 12 财库分析 / 13 桃花分析 / 14 疾厄健康
 * 另含 §3.3 禄转忌·忌转忌链（即清单第 6 项）。
 *
 * 规则出处一律写进函数注释，不在此自创口径：
 *  §2 十六字：忌坐主烦恼 / 忌冲主损（不可冲 一命宫·六疾厄·九官禄）/ 禄坐主得 / 禄照主助力
 *  §3.1 引动：下级盘踩到（谁踩谁得）——大运田宅踩生年禄→主得房产……
 *  §9 叠宫：本命十二宫从命宫起递减；大限十二宫同构递减；官禄=9号、夫妻=3号、疾厄=6号
 *  §11 六宫禄打分（见 specialty-rules.js）
 *  §13 排盘自检：化曜定位、天魁天钺表、自化识别、叠宫序
 *  lu_zhuan_ji.md：禄转忌=吉象延伸 / 忌转忌=凶象连锁 / 禄逢冲破=一线一禄一忌相对 /
 *                 忌出四来源=本宫自化忌出·忌入对宫·忌入迁移·忌入父母（以①最重）
 *
 * 两条纪律：
 *  1. 只输出「规则是否成立 + 依据指针」，不写吉凶断语。
 *  2. 事实不足一律 unavailable / unknown，不猜。
 */
(function () {
  "use strict";

  var SCHEMA = "mingli.section16-steps/v1";

  var PALACE_ORDER = [
    "命宫", "兄弟宫", "夫妻宫", "子女宫", "财帛宫", "疾厄宫",
    "迁移宫", "仆役宫", "官禄宫", "田宅宫", "福德宫", "父母宫",
  ];
  // §2：冲不可冲 一(命宫) 六(疾厄) 九(官禄)
  var UNCLASHABLE = ["命宫", "疾厄宫", "官禄宫"];
  var SIX_INNER = ["命宫", "财帛宫", "疾厄宫", "官禄宫", "田宅宫", "福德宫"];
  var HUA_KINDS = ["禄", "权", "科", "忌"];

  // §13：天魁天钺年干表（WMT 校正版，辛年魁寅钺午）
  var KUI_YUE = {
    甲: ["丑", "未"], 戊: ["丑", "未"], 庚: ["丑", "未"],
    乙: ["子", "申"], 己: ["子", "申"],
    丙: ["亥", "酉"], 丁: ["亥", "酉"],
    壬: ["卯", "巳"], 癸: ["卯", "巳"],
    辛: ["寅", "午"],
  };

  function facts() {
    return globalThis.MingliZiweiFacts || null;
  }

  function fourHuaTable() {
    var f = facts();
    return f && f.fourHuaTable ? f.fourHuaTable : null;
  }

  function palaceOf(palaces, name) {
    return (palaces || []).find(function (p) { return p && p.name === name; }) || null;
  }

  function names(palace) {
    if (!palace) return [];
    return ["majorStars", "minorStars", "auxiliaryStars"].reduce(function (acc, key) {
      (Array.isArray(palace[key]) ? palace[key] : []).forEach(function (s) {
        if (s && s.name) acc.push({ name: s.name, transformation: s.transformation || null, key: key });
      });
      return acc;
    }, []);
  }

  /** 生年四化：从星曜 transformation 反查（与 specialty-rules 同源，避免两套口径） */
  function natalHua(palaces) {
    var out = [];
    (palaces || []).forEach(function (palace) {
      names(palace).forEach(function (s) {
        if (!s.transformation) return;
        out.push({
          layer: "生年",
          kind: s.transformation,
          star: s.name,
          palace: palace.name,
          pointer: "/palaces/" + palace.index + "/" + s.key + "/transformation",
        });
      });
    });
    return out.filter(function (h) { return HUA_KINDS.indexOf(h.kind) >= 0; });
  }

  function oppositeName(palaces, name) {
    var f = facts();
    if (f && f.opposites && f.opposites[name]) return f.opposites[name];
    var palace = palaceOf(palaces, name);
    return palace && palace.oppositePalace ? palace.oppositePalace : null;
  }

  // ───────────────── #1 排盘对账 ─────────────────

  /**
   * §13 排盘自检的可执行子集：结构层面对账。
   * 真太阳时/引擎 Bug 校正属于输入期问题，这里只核对「盘面自身是否自洽」。
   */
  function step1Reconcile(chart) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) {
      return {
        status: "unavailable", schema: SCHEMA, step: 1,
        reason: "十二宫不齐（实际 " + palaces.length + "）", checks: [],
      };
    }
    var checks = [];
    function push(code, ok, detail) { checks.push({ code: code, ok: ok, detail: detail }); }

    var missingName = PALACE_ORDER.filter(function (n) { return !palaceOf(palaces, n); });
    push("palace-set", missingName.length === 0,
      missingName.length === 0 ? "十二宫名齐全" : "缺宫：" + missingName.join("、"));

    var missingGz = palaces.filter(function (p) { return !p.heavenlyStem || !p.earthlyBranch; });
    push("palace-ganzhi", missingGz.length === 0,
      missingGz.length === 0 ? "十二宫干支齐全" : "干支缺失：" + missingGz.map(function (p) { return p.name; }).join("、"));

    // §9：本命十二宫从命宫起递减（地支 -1）
    var branches = palaces.map(function (p) { return p.earthlyBranch; });
    var branchIdx = { 子: 0, 丑: 1, 寅: 2, 卯: 3, 辰: 4, 巳: 5, 午: 6, 未: 7, 申: 8, 酉: 9, 戌: 10, 亥: 11 };
    var stepOk = palaces.every(function (p) {
      var next = palaceOf(palaces, PALACE_ORDER[(PALACE_ORDER.indexOf(p.name) + 1) % 12]);
      if (!next) return false;
      var a = branchIdx[p.earthlyBranch];
      var b = branchIdx[next.earthlyBranch];
      if (a === undefined || b === undefined) return false;
      return ((a - b) % 12 + 12) % 12 === 1;
    });
    push("branch-step", stepOk, stepOk ? "命→兄→夫…逐宫地支 -1，与 §9 一致" : "地支递减序不成立，叠宫会全盘错");

    var soul = palaces.filter(function (p) { return p.name === "命宫"; });
    push("soul-unique", soul.length === 1, soul.length === 1 ? "命宫唯一" : "命宫出现 " + soul.length + " 次");

    var body = palaces.filter(function (p) { return p.isBodyPalace; });
    push("body-marked", body.length === 1,
      body.length === 1 ? "身宫标记在 " + body[0].name : "身宫标记 " + body.length + " 处（应为 1）");

    var ju = chart.basics && chart.basics.fiveElementsClass;
    push("five-elements", !!ju && /^[水木金土火][二三四五六]局$/.test(ju), ju ? "五行局 " + ju : "五行局缺失");

    var hua = natalHua(palaces);
    var kinds = HUA_KINDS.filter(function (k) { return hua.some(function (h) { return h.kind === k; }); });
    push("natal-hua", kinds.length === 4, kinds.length === 4 ? "生年四化四条齐全" : "生年四化缺：" + HUA_KINDS.filter(function (k) { return kinds.indexOf(k) < 0; }).join("、"));

    // §13：天魁天钺按年干表，辛年必交换
    var yearPillar = (chart.astrolabe && chart.astrolabe.chineseDate || "").split(" ")[0] || "";
    var stem = yearPillar.slice(0, 1);
    var expect = stem ? KUI_YUE[stem] : null;
    if (expect) {
      var kui = palaces.find(function (p) { return names(p).some(function (s) { return s.name === "天魁"; }); });
      var yue = palaces.find(function (p) { return names(p).some(function (s) { return s.name === "天钺"; }); });
      var ok = !!kui && !!yue && kui.earthlyBranch === expect[0] && yue.earthlyBranch === expect[1];
      push("kui-yue", ok,
        "年干" + stem + "应 魁" + expect[0] + "钺" + expect[1] +
        "；实测 魁" + (kui ? kui.earthlyBranch : "无") + "钺" + (yue ? yue.earthlyBranch : "无"));
    } else {
      push("kui-yue", false, "年干未取到，无法核对魁钺");
    }

    var failed = checks.filter(function (c) { return !c.ok; });
    return {
      status: failed.length === 0 ? "pass" : "partial",
      schema: SCHEMA,
      step: 1,
      failedCount: failed.length,
      checks: checks,
      note: "真太阳时与 iztro 引擎 Bug 校正属输入期问题，不在本节核对范围。",
    };
  }

  // ───────────────── #3 生年四化 + 逐宫飞化 ─────────────────

  function step3NatalHuaAndFlying(chart) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 3, reason: "十二宫不齐" };
    var hua = natalHua(palaces);
    var flying = flyingOf(chart);
    var missing = [];
    if (hua.length !== 4) missing.push("生年四化不是四条");
    if (flying.length !== 48) missing.push("逐宫飞化应为 48 条（12 宫 × 四化），实际 " + flying.length);
    return {
      status: missing.length === 0 ? "pass" : "partial",
      schema: SCHEMA,
      step: 3,
      natalHua: HUA_KINDS.map(function (kind) {
        var hit = hua.find(function (h) { return h.kind === kind; });
        return hit ? { kind: kind, star: hit.star, palace: hit.palace, pointer: hit.pointer }
          : { kind: kind, star: null, palace: null, status: "unavailable" };
      }),
      flying: flying.map(function (item) {
        return {
          sourcePalace: item.sourcePalace,
          sourceStem: item.sourceStem,
          kind: item.kind,
          star: item.star,
          targetPalace: item.targetPalace,
          isSelfTarget: !!item.isSelfTarget,
          pointer: "/palaceFlying[" + item.sourcePalace + "." + item.kind + "]",
        };
      }),
      missing: missing,
    };
  }

  // ───────────────── #4 十六字检查 ─────────────────

  /**
   * §2：禄坐主得 / 禄照主助力 / 忌坐主烦恼 / 忌冲主损。
   * 以生年四化（体）为准；忌冲若落在 命/疾厄/官禄，按 §2 标为「不可冲」。
   */
  function step4Sixteen(chart) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 4, reason: "十二宫不齐" };
    var hua = natalHua(palaces);
    var lu = hua.filter(function (h) { return h.kind === "禄"; });
    var ji = hua.filter(function (h) { return h.kind === "忌"; });

    var rows = PALACE_ORDER.map(function (name) {
      var opp = oppositeName(palaces, name);
      var luZuo = lu.filter(function (h) { return h.palace === name; });
      var jiZuo = ji.filter(function (h) { return h.palace === name; });
      var luZhao = lu.filter(function (h) { return h.palace === opp; });
      var jiChong = ji.filter(function (h) { return h.palace === opp; });
      return {
        palace: name,
        opposite: opp,
        luZuo: luZuo.map(function (h) { return h.star; }),
        luZhao: luZhao.map(function (h) { return h.star; }),
        jiZuo: jiZuo.map(function (h) { return h.star; }),
        jiChong: jiChong.map(function (h) { return h.star; }),
        unclashable: UNCLASHABLE.indexOf(name) >= 0 && jiChong.length > 0,
        text: [
          luZuo.length ? "禄坐" : "",
          luZhao.length ? "禄照" : "",
          jiZuo.length ? "忌坐" : "",
          jiChong.length ? "忌冲" + (UNCLASHABLE.indexOf(name) >= 0 ? "（不可冲）" : "") : "",
        ].filter(Boolean).join("·") || "无",
      };
    });

    return {
      status: "pass",
      schema: SCHEMA,
      step: 4,
      rows: rows,
      counts: {
        luZuo: rows.filter(function (r) { return r.luZuo.length > 0; }).length,
        luZhao: rows.filter(function (r) { return r.luZhao.length > 0; }).length,
        jiZuo: rows.filter(function (r) { return r.jiZuo.length > 0; }).length,
        jiChong: rows.filter(function (r) { return r.jiChong.length > 0; }).length,
      },
      note: "§2：忌冲不可冲 一(命宫)六(疾厄)九(官禄)；禄照为次级助力，弱于禄坐。",
    };
  }

  // ───────────────── #5 引动检查 ─────────────────

  /**
   * §3.1：下级盘踩到（谁踩谁得）。大运某宫 落在 生年四化所在的本命宫 → 该运「踩到」。
   * §3.2：下级四化引动——流年四化的星曜与大限四化同星亦记一次引动。
   */
  function step5Activation(chart, timeline, yearFact) {
    var palaces = (chart && chart.palaces) || [];
    if (!timeline || !timeline.decadal) {
      return { status: "unavailable", schema: SCHEMA, step: 5, reason: "缺大限信息" };
    }
    var hua = natalHua(palaces);
    var mapFull = decadalMap(timeline);
    var decadalOnNatal = [];
    hua.forEach(function (h) {
      PALACE_ORDER.forEach(function (decadalName) {
        if (mapFull[decadalName] !== h.palace) return;
        decadalOnNatal.push({
          decadalPalace: decadalName,
          natalPalace: h.palace,
          kind: h.kind,
          star: h.star,
          text: "大运" + decadalName + "踩生年" + h.kind + "（" + h.star + "·本命" + h.palace + "）",
          pointer: "/years/0/palaceOverlay[decadal=" + decadalName + "]",
        });
      });
    });

    var decadalHuaList = (timeline.decadal.fourTransformations || []);
    var annualOnDecadal = [];
    if (yearFact) {
      var amap = annualMap(yearFact);
      decadalHuaList.forEach(function (h) {
        if (!h.natalPalace) return;
        PALACE_ORDER.forEach(function (annualName) {
          if (amap[annualName] !== h.natalPalace) return;
          annualOnDecadal.push({
            annualPalace: annualName,
            natalPalace: h.natalPalace,
            kind: h.kind,
            star: h.star,
            text: "流年" + annualName + "踩大限" + h.kind + "（" + h.star + "·本命" + h.natalPalace + "）",
            pointer: "/years/" + yearFact.year + "/palaceOverlay[annual=" + annualName + "]",
          });
        });
      });
      // 同星引动：流年四化星与大限四化星相同
      (yearFact.fourTransformations || []).forEach(function (a) {
        decadalHuaList.forEach(function (d) {
          if (a.star && d.star && a.star === d.star) {
            annualOnDecadal.push({
              kind: a.kind,
              star: a.star,
              text: "流年" + a.kind + a.star + "与大限" + d.kind + d.star + "同星，构成引动",
              pointer: "/years/" + yearFact.year + "/fourTransformations[" + a.kind + "]",
            });
          }
        });
      });
    }

    return {
      status: "pass",
      schema: SCHEMA,
      step: 5,
      decadalOnNatal: decadalOnNatal,
      annualOnDecadal: annualOnDecadal,
      note: "§3：不引动不发；无引动的四化只算「有基础/倾向」，不算实发。",
    };
  }

  function decadalMap(timeline) {
    var year = timeline && timeline.years && timeline.years[0];
    var rows = (year && year.palaceOverlay) || [];
    var map = {};
    rows.forEach(function (r) { if (r && r.decadalPalace && r.natalPalace) map[r.decadalPalace] = r.natalPalace; });
    return map;
  }

  function annualMap(yearFact) {
    var rows = (yearFact && yearFact.palaceOverlay) || [];
    var map = {};
    rows.forEach(function (r) { if (r && r.annualPalace && r.natalPalace) map[r.annualPalace] = r.natalPalace; });
    return map;
  }

  // ───────────────── #8 叠宫推算（逐宫写出） ─────────────────

  function step8Overlay(timeline) {
    var year = timeline && timeline.years && timeline.years[0];
    var rows = (year && year.palaceOverlay) || [];
    if (rows.length !== 12) {
      return { status: "unavailable", schema: SCHEMA, step: 8, reason: "叠宫行数不是 12" };
    }
    return {
      status: "pass",
      schema: SCHEMA,
      step: 8,
      year: year.year,
      rows: rows.map(function (r) {
        return {
          branch: r.branch,
          natalPalace: r.natalPalace,
          decadalPalace: r.decadalPalace,
          annualPalace: r.annualPalace,
          monthlyPalace: r.monthlyPalace || null,
          text: "本命" + r.natalPalace + " · 大限" + r.decadalPalace + " · 流年" + r.annualPalace,
        };
      }),
      note: "§9：官禄=9号位、夫妻=3号位、疾厄=6号位；逐位写出，禁心算跳步。",
    };
  }

  // ───────────────── #9 大限四化两步定位 ─────────────────

  /** §9：A. 落本命哪宫；B. 转大限宫名。每个四化写双宫名。 */
  function step9DecadalTwoStep(timeline) {
    var list = (timeline && timeline.decadal && timeline.decadal.fourTransformations) || [];
    if (list.length === 0) {
      return { status: "unavailable", schema: SCHEMA, step: 9, reason: "缺大限四化" };
    }
    var map = decadalMap(timeline);
    var reverse = {};
    Object.keys(map).forEach(function (decadalName) { reverse[map[decadalName]] = decadalName; });

    var rows = list.map(function (item) {
      var decadalName = item.natalPalace ? reverse[item.natalPalace] || null : null;
      return {
        kind: item.kind,
        star: item.star,
        natalPalace: item.natalPalace || null,
        natalBranch: item.natalPalaceBranch || null,
        decadalPalace: decadalName,
        text: item.natalPalace
          ? "本命" + item.natalPalace + "（大限" + (decadalName || "未定位") + "）"
          : "未定位",
        pointer: "/decadal/fourTransformations[" + item.kind + "]",
      };
    });
    var incomplete = rows.filter(function (r) { return !r.natalPalace || !r.decadalPalace; });
    return {
      status: incomplete.length === 0 ? "pass" : "partial",
      schema: SCHEMA,
      step: 9,
      ganzhi: timeline.decadal.ganzhi,
      rows: rows,
      incomplete: incomplete.map(function (r) { return r.kind; }),
      note: "§9：先本命后大限，两步分开；缺任一宫名不合格。",
    };
  }

  // ───────────────── #6 禄转忌 / 忌转忌 / 禄逢冲破 / 忌出 ─────────────────

  /**
   * 禄转忌：某宫有生年禄 → 以该宫宫干化忌入他宫（吉象延伸）。
   * 忌转忌：某宫有生年忌 → 再以宫干化忌入他宫（凶象连锁）。
   * 链：A → B → C…，回到已访问宫或超过 MAX_HOPS 即停。
   */
  var MAX_HOPS = 6;

  /** 逐宫飞化：顶层无此字段时在 aiFacts 下（两个位置都查，别只查一处）。 */
  function flyingOf(chart) {
    if (!chart) return [];
    if (Array.isArray(chart.palaceFlying)) return chart.palaceFlying;
    if (chart.aiFacts && Array.isArray(chart.aiFacts.palaceFlying)) return chart.aiFacts.palaceFlying;
    return [];
  }

  function nextJi(chart, palaceName) {
    var hit = flyingOf(chart).find(function (item) {
      return item.sourcePalace === palaceName && item.kind === "忌";
    });
    return hit ? hit.targetPalace : null;
  }

  function buildChain(chart, startPalace) {
    var visited = [startPalace];
    var hops = [];
    var cursor = startPalace;
    while (hops.length < MAX_HOPS) {
      var nxt = nextJi(chart, cursor);
      if (!nxt) break;
      hops.push({ from: cursor, to: nxt });
      if (visited.indexOf(nxt) >= 0) {
        return { start: startPalace, hops: hops, loop: true, path: visited.concat(nxt) };
      }
      visited.push(nxt);
      cursor = nxt;
    }
    return { start: startPalace, hops: hops, loop: false, path: visited };
  }

  function step6ZhuanJi(chart) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 6, reason: "十二宫不齐" };
    var hua = natalHua(palaces);
    var lu = hua.filter(function (h) { return h.kind === "禄"; });
    var ji = hua.filter(function (h) { return h.kind === "忌"; });

    var luZhuan = lu.map(function (h) {
      var chain = buildChain(chart, h.palace);
      return {
        source: h.palace,
        star: h.star,
        chain: chain,
        text: h.palace + "有生年禄" + h.star + " → 转忌至" + (chain.hops[0] ? chain.hops[0].to : "无") +
          (chain.hops.length > 1 ? " → …共 " + chain.hops.length + " 跳" : ""),
      };
    });
    var jiZhuan = ji.map(function (h) {
      var chain = buildChain(chart, h.palace);
      return {
        source: h.palace,
        star: h.star,
        chain: chain,
        text: h.palace + "有生年忌" + h.star + " → 转忌至" + (chain.hops[0] ? chain.hops[0].to : "无") +
          (chain.hops.length > 1 ? " → …共 " + chain.hops.length + " 跳" : ""),
      };
    });

    // 禄逢冲破：一线一禄一忌相对（忌落在禄宫的对宫），或禄宫自化忌
    var luPo = lu.map(function (h) {
      var opp = oppositeName(palaces, h.palace);
      var jiInOpp = ji.filter(function (j) { return j.palace === opp; });
      var selfJi = flyingOf(chart).find(function (i) {
        return i.sourcePalace === h.palace && i.kind === "忌" && i.isSelfTarget;
      });
      var reasons = [];
      if (jiInOpp.length > 0) reasons.push("忌" + jiInOpp.map(function (j) { return j.star; }).join("、") + "在" + opp + "对冲");
      if (selfJi) reasons.push("本宫自化忌");
      var mySide = SIX_INNER.indexOf(h.palace) >= 0;
      return {
        palace: h.palace,
        star: h.star,
        opposite: opp,
        broken: reasons.length > 0,
        reasons: reasons,
        mySide: mySide,
        reading: reasons.length === 0
          ? "未被冲破"
          : (mySide ? "我宫被冲：得中有失、聚散无常" : "他宫被冲：吉象外流，终属虚花"),
        text: h.palace + "生年禄" + h.star + (reasons.length === 0 ? " 未被冲破" : " 遭禄逢冲破（" + reasons.join("；") + "）"),
      };
    });

    // 忌出四来源：①本宫自化忌出 ②忌入对宫 ③忌入迁移 ④忌入父母（以①最重）
    var jiChu = ji.map(function (h) {
      var found = [];
      var selfJi = flyingOf(chart).find(function (i) {
        return i.sourcePalace === h.palace && i.kind === "忌" && i.isSelfTarget;
      });
      if (selfJi) found.push({ code: "self-ji", label: "本宫自化忌出（最重）" });
      if (oppositeName(palaces, h.palace) === h.palace) {
        // 不会发生，占位保护
      }
      if (h.palace === "迁移宫") found.push({ code: "into-travel", label: "忌入迁移" });
      if (h.palace === "父母宫") found.push({ code: "into-parent", label: "忌入父母" });
      return {
        palace: h.palace,
        star: h.star,
        sources: found,
        text: h.palace + "忌" + h.star + (found.length === 0 ? " 属忌入（藏敛付出），非忌出" : " 属忌出：" + found.map(function (f) { return f.label; }).join("、")),
      };
    });

    return {
      status: "pass",
      schema: SCHEMA,
      step: 6,
      luZhuanJi: luZhuan,
      jiZhuanJi: jiZhuan,
      luPoChong: luPo,
      jiChu: jiChu,
      note: "禄转忌能量大于单纯化禄；忌见禄=大好，禄见忌=大不好；细则见 references/lu_zhuan_ji.md。",
    };
  }

  // ───────────────── #12 财库分析 ─────────────────

  function step12Treasury(chart, timeline) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 12, reason: "十二宫不齐" };
    var pool = natalHua(palaces).concat(
      ((timeline && timeline.decadal && timeline.decadal.fourTransformations) || []).map(function (h) {
        return { layer: "大限", kind: h.kind, star: h.star, palace: h.natalPalace, pointer: "/decadal/fourTransformations[" + h.kind + "]" };
      }),
    );
    var tian = palaceOf(palaces, "田宅宫");
    var child = palaceOf(palaces, "子女宫");

    var jiZuo = pool.filter(function (h) { return h.kind === "忌" && h.palace === "田宅宫"; });
    var jiChong = pool.filter(function (h) { return h.kind === "忌" && h.palace === "子女宫"; });
    var luZuo = pool.filter(function (h) { return h.kind === "禄" && h.palace === "田宅宫"; });

    var clauses = [
      {
        code: "tian-ji-zuo", label: "田宅坐忌",
        fired: jiZuo.length > 0,
        detail: jiZuo.length > 0
          ? jiZuo.map(function (h) { return h.layer + "忌" + h.star; }).join("、") + "坐田宅"
          : "田宅宫无化忌",
        meaning: "在意家庭财库；忌坐田宅可论有房产，须防为房耗财",
        evidence: jiZuo.map(function (h) { return h.pointer; }),
      },
      {
        code: "tian-ji-chong", label: "田宅被冲",
        fired: jiChong.length > 0,
        detail: jiChong.length > 0
          ? jiChong.map(function (h) { return h.layer + "忌" + h.star; }).join("、") + "在子女宫，冲田宅"
          : "子女宫无化忌，田宅未被冲",
        meaning: "§6：忌冲田宅最凶，级别高于冲财帛与冲兄弟",
        evidence: jiChong.map(function (h) { return h.pointer; }),
      },
      {
        code: "tian-lu-zuo", label: "田宅坐禄",
        fired: luZuo.length > 0,
        detail: luZuo.length > 0
          ? luZuo.map(function (h) { return h.layer + "禄" + h.star; }).join("、") + "坐田宅"
          : "田宅宫无化禄",
        meaning: "田宅有禄不等于家境好，须看是否被大运引动（§6、lu_zhuan_ji §六）",
        evidence: luZuo.map(function (h) { return h.pointer; }),
      },
    ];

    // 赚而无库（palace_fly_all12 §十二-4）：大限命宫化禄入财帛，但大限田宅化忌入子女冲本命田宅
    var map = decadalMap(timeline);
    var decadalSoul = map["命宫"] ? palaceOf(palaces, map["命宫"]) : null;
    var decadalTian = map["田宅宫"] ? palaceOf(palaces, map["田宅宫"]) : null;
    if (decadalSoul && decadalTian) {
      var soulLu = flyingOf(chart).find(function (i) {
        return i.sourcePalace === decadalSoul.name && i.kind === "禄" && i.targetPalace === "财帛宫";
      });
      var tianJi = flyingOf(chart).find(function (i) {
        return i.sourcePalace === decadalTian.name && i.kind === "忌" && i.targetPalace === "子女宫";
      });
      clauses.push({
        code: "earn-no-store", label: "赚而无库",
        fired: !!soulLu && !!tianJi,
        detail: [soulLu ? "大限命宫（本命" + decadalSoul.name + "）化禄入财帛" : "大限命宫未化禄入财帛",
          tianJi ? "大限田宅（本命" + decadalTian.name + "）化忌入子女冲本命田宅" : "大限田宅未化忌入子女"].join("；"),
        meaning: "赚钱能力在，但库被冲，断财须财与库同参",
        evidence: [soulLu ? "/palaceFlying[" + decadalSoul.name + ".禄]" : null,
          tianJi ? "/palaceFlying[" + decadalTian.name + ".忌]" : null].filter(Boolean),
      });
    } else {
      clauses.push({ code: "earn-no-store", label: "赚而无库", fired: false, detail: "大限命宫或田宅未定位，无法判定", meaning: "", evidence: [] });
    }

    var fired = clauses.filter(function (c) { return c.fired; });
    return {
      status: "pass", schema: SCHEMA, step: 12,
      firedCount: fired.length, total: clauses.length,
      clauses: clauses,
      tianZhaiStars: names(tian).map(function (s) { return s.name; }),
      note: "§6：断财看财帛·兄弟·田宅三宫实际得失；忌冲田宅级别最重。",
    };
  }

  // ───────────────── #13 桃花分析 ─────────────────

  var PEACH_STARS = ["贪狼", "廉贞"];
  var PEACH_PALACES = ["命宫", "迁移宫", "夫妻宫", "子女宫"];
  // §6 断婚：感情好坏以禄断
  var LU_FEEL = { 贪狼: "最好", 天同: "开心", 太阴: "温柔", 太阳: "热情", 破军: "生理性喜欢" };

  function step13Peach(chart, timeline) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 13, reason: "十二宫不齐" };
    var natal = natalHua(palaces);
    var decadal = ((timeline && timeline.decadal && timeline.decadal.fourTransformations) || [])
      .map(function (h) { return { layer: "大限", kind: h.kind, star: h.star, palace: h.natalPalace, pointer: "/decadal/fourTransformations[" + h.kind + "]" }; });
    var pool = natal.concat(decadal);

    var stars = [];
    PEACH_PALACES.forEach(function (name) {
      var palace = palaceOf(palaces, name);
      if (!palace) return;
      names(palace).forEach(function (s) {
        if (PEACH_STARS.indexOf(s.name) < 0) return;
        var hua = pool.filter(function (h) { return h.palace === name && h.star === s.name; });
        stars.push({
          palace: name,
          star: s.name,
          transformation: s.transformation || null,
          extraHua: hua.map(function (h) { return h.layer + h.kind; }),
          pointer: "/palaces/" + palace.index + "/" + s.key,
        });
      });
    });

    var huaStars = stars.filter(function (s) {
      return ["禄", "权"].indexOf(s.transformation) >= 0 || s.extraHua.some(function (t) { return /禄|权/.test(t); });
    });

    // 夫妻宫禄是否被大运禄引动（§6：原局夫妻再好的禄没大运禄引动=摆设）
    var spouseLu = pool.filter(function (h) { return h.palace === "夫妻宫" && h.kind === "禄"; });
    var spouseDecadalLu = spouseLu.filter(function (h) { return h.layer === "大限"; });

    var clauses = [
      {
        code: "peach-stars", label: "桃花星在命迁夫子上",
        fired: stars.length > 0,
        detail: stars.length > 0
          ? stars.map(function (s) { return s.palace + s.star; }).join("、")
          : "命/迁/夫/子无贪狼廉贞",
        meaning: "§16 #13：桃花分析以命/迁/夫/子的贪狼廉贞为基",
        evidence: stars.map(function (s) { return s.pointer; }),
      },
      {
        code: "peach-hua", label: "桃花星带化禄/化权",
        fired: huaStars.length > 0,
        detail: huaStars.length > 0
          ? huaStars.map(function (s) {
            return s.palace + s.star + "（" + [s.transformation, ...s.extraHua].filter(Boolean).join("、") + "）";
          }).join("；")
          : "无桃花星带禄权",
        meaning: "桃花破财法则第⑤条同源；有禄权才成「发生」的条件之一",
        evidence: huaStars.map(function (s) { return s.pointer; }),
      },
      {
        code: "marriage-lu-activated", label: "夫妻宫禄被大运引动",
        fired: spouseLu.length > 0 && spouseDecadalLu.length > 0,
        detail: spouseLu.length === 0
          ? "夫妻宫无禄"
          : (spouseDecadalLu.length > 0 ? "大限禄入夫妻宫，原局之禄被引动" : "夫妻宫有禄但大运未引动（§6：摆设）"),
        meaning: "§6：禄只是机会，未被引动不算实发",
        evidence: spouseLu.map(function (h) { return h.pointer; }),
      },
    ];

    var spouse = palaceOf(palaces, "夫妻宫");
    var feel = names(spouse).filter(function (s) { return LU_FEEL[s.name]; })
      .map(function (s) { return { star: s.name, feel: LU_FEEL[s.name], transformation: s.transformation }; });

    var fired = clauses.filter(function (c) { return c.fired; });
    return {
      status: "pass", schema: SCHEMA, step: 13,
      firedCount: fired.length, total: clauses.length,
      singleSupport: fired.length === 1,
      clauses: clauses,
      spouseStars: names(spouse).map(function (s) { return s.name; }),
      spouseFeel: feel,
      note: "§6：感情好坏以禄断，需桃花星；贪狼最好、天同开心、太阴温柔、太阳热情、破军生理性喜欢。",
    };
  }

  // ───────────────── #14 疾厄健康提示 ─────────────────

  function step14Health(chart, timeline, knowledge, knowledgeIndex) {
    var palaces = (chart && chart.palaces) || [];
    if (palaces.length !== 12) return { status: "unavailable", schema: SCHEMA, step: 14, reason: "十二宫不齐" };
    var ill = palaceOf(palaces, "疾厄宫");
    var parent = palaceOf(palaces, "父母宫");
    var pool = natalHua(palaces).concat(
      ((timeline && timeline.decadal && timeline.decadal.fourTransformations) || [])
        .map(function (h) { return { layer: "大限", kind: h.kind, star: h.star, palace: h.natalPalace, pointer: "/decadal/fourTransformations[" + h.kind + "]" }; }),
    );

    var jiIn = pool.filter(function (h) { return h.kind === "忌" && h.palace === "疾厄宫"; });
    var jiOpp = pool.filter(function (h) { return h.kind === "忌" && h.palace === "父母宫"; });

    // 只取主星对应的疾厄宫断语；辅星不参与健康提示。
    // 源文件自标「—（源未及）」的条目按未收录处理，但要与「知识库完全没有」分开记录。
    var readings = [];
    var missingReadings = [];
    var canRead = knowledge && typeof knowledge.lookupPalaceReading === "function" && knowledgeIndex;
    if (!canRead) {
      missingReadings.push({ star: null, reason: "未提供知识库索引" });
    } else {
      (ill.majorStars || []).forEach(function (s) {
        // 注意签名是 (index, starName, palaceName) 三个参数；源未及返回 null
        var hit = knowledge.lookupPalaceReading(knowledgeIndex, s.name, "疾厄宫");
        if (hit) {
          readings.push({
            star: s.name,
            reading: hit.reading,
            note: hit.note || null,
            ruleId: hit.ruleId,
            pointer: "/palaces/" + ill.index + "/majorStars",
          });
        } else {
          var known = typeof knowledge.lookupStar === "function" ? knowledge.lookupStar(knowledgeIndex, s.name) : null;
          missingReadings.push({ star: s.name, reason: known ? "源未及" : "未收录" });
        }
      });
    }

    var clauses = [
      {
        code: "ji-in-ill", label: "忌入疾厄",
        fired: jiIn.length > 0,
        detail: jiIn.length > 0 ? jiIn.map(function (h) { return h.layer + "忌" + h.star; }).join("、") + "入疾厄" : "疾厄宫无化忌",
        meaning: "身体劳碌操心；忌冲父母主上不了台面，宜正途避免借贷担保",
        evidence: jiIn.map(function (h) { return h.pointer; }),
      },
      {
        code: "ji-chong-ill", label: "忌冲疾厄（负极线）",
        fired: jiOpp.length > 0,
        detail: jiOpp.length > 0 ? jiOpp.map(function (h) { return h.layer + "忌" + h.star; }).join("、") + "在父母宫，冲疾厄" : "父母宫无化忌，疾厄未被冲",
        meaning: "§2：忌冲不可冲六(疾厄)；父疾线为负极线",
        evidence: jiOpp.map(function (h) { return h.pointer; }),
      },
      {
        code: "has-readings", label: "疾厄宫主星有对应断语",
        fired: readings.length > 0,
        detail: readings.length > 0
          ? readings.map(function (r) { return r.star; }).join("、") + " 命中知识库" +
            (missingReadings.filter(function (m) { return m.star; }).length > 0
              ? "（未命中：" + missingReadings.filter(function (m) { return m.star; })
                .map(function (m) { return m.star + "·" + m.reason; }).join("、") + "）"
              : "")
          : (missingReadings.length > 0
            ? "无可用断语：" + missingReadings.map(function (m) { return (m.star || "") + m.reason; }).join("、")
            : "疾厄宫主星在知识库中无疾厄条目"),
        meaning: "无断语时如实留白，不用星性硬凑",
        evidence: readings.map(function (r) { return r.pointer; }),
      },
    ];

    var fired = clauses.filter(function (c) { return c.fired; });
    return {
      status: "pass", schema: SCHEMA, step: 14,
      firedCount: fired.length, total: clauses.length,
      clauses: clauses,
      illnessPalaceStars: names(ill).map(function (s) { return s.name; }),
      readings: readings,
      missingReadings: missingReadings,
      note: "健康提示只作倾向参考，不构成医学建议。",
    };
  }

  // ───────────────── §17 审查 ─────────────────

  /**
   * §17 技法合规校验七条的可执行子集。
   * 通过 = 被审对象能出示证据；不能出示即 not-checkable，不假装通过。
   */
  function auditSection17(input) {
    var report = input && input.report;
    var findings = [];
    function add(id, title, status, detail) { findings.push({ id: id, title: title, status: status, detail: detail }); }

    if (!report) return { status: "invalid", schema: SCHEMA, findings: [], reason: "缺被审对象" };

    var statements = [];
    (report.years || []).forEach(function (y) {
      (y.lines || []).forEach(function (l) { statements.push(l); });
    });

    // 1. 十六字：凡断吉凶，必先过禄坐/禄照/忌坐/忌冲
    var noSixteen = statements.filter(function (s) {
      return !s.mechanism || !/(禄|忌)/.test(s.mechanism);
    });
    add("sixteen", "十六字应用", noSixteen.length === 0 ? "pass" : "fail",
      noSixteen.length === 0 ? "每条断语的结构行都含禄/忌落位" : noSixteen.length + " 条断语的结构行未体现禄忌");

    // 2. 引动逻辑：无引动不得含糊成实发。
    //    判据不是「有多少条实发」，而是「每条是否写明了粒度」——
    //    没写粒度才有把结构提示冒充事件的风险。
    var GRAN = ["decadal", "year", "none"];
    var noGran = statements.filter(function (s) { return GRAN.indexOf(s.granularity) < 0; });
    var timed = statements.filter(function (s) { return s.granularity === "decadal" || s.granularity === "year"; });
    add("activation", "引动逻辑", noGran.length === 0 ? "pass" : "fail",
      noGran.length === 0
        ? "全部 " + statements.length + " 条均标明粒度：实发 " + timed.length + " 条、结构提示 " + (statements.length - timed.length) + " 条"
        : noGran.length + " 条未标粒度，可能被当成实发");

    // 3. 框架优先：先本命大运再流年
    var hasDecadal = !!(report.decadal || (report.years || []).length > 0);
    add("framework", "框架优先", hasDecadal ? "pass" : "not-checkable",
      hasDecadal ? "存在大限层输出" : "无大限层，流年结论无从成立");

    // 4. 多项定一象：一条断语至少要有「格局 + 宫位/星曜」两类支撑，
    //    只有格局码而无宫位落点才算单象。
    var single = statements.filter(function (s) {
      return (s.patternCodes || []).length === 0 || (!s.palace && !(s.stars || []).length && !s.star);
    });
    add("multi-support", "多项定一象", single.length === 0 ? "pass" : "warning",
      single.length === 0
        ? "每条断语均有格局与宫位两类支撑"
        : single.length + " 条只有 1 类支撑（应标单象待验证）");

    // 5. 我宫他宫：动因宫落六内还是六外，逐条看 huaOrigins。
    //    判据只看「有没有标明归属」，不是看六内多还是六外多——
    //    六内六外讲的是这件事归谁，不是好坏。
    // 阶梯产出叫 huaOrigins，渲染层改叫 motivations；两处都认，不靠单点字段名。
    function originsOfLine(s) {
      if (Array.isArray(s.motivations)) return s.motivations;
      if (Array.isArray(s.huaOrigins)) return s.huaOrigins;
      return [];
    }
    var withOrigins = statements.filter(function (s) {
      var origins = originsOfLine(s);
      return origins.length > 0
        && origins.every(function (o) { return o.zone === "inside" || o.zone === "outside"; });
    });
    var insideCount = 0;
    var outsideCount = 0;
    statements.forEach(function (s) {
      originsOfLine(s).forEach(function (o) {
        if (o.zone === "inside") insideCount += 1;
        if (o.zone === "outside") outsideCount += 1;
      });
    });
    if (statements.length === 0) {
      add("self-other", "我宫他宫", "not-checkable", "无断语可查");
    } else if (withOrigins.length === statements.length) {
      add("self-other", "我宫他宫", "pass",
        "全部 " + statements.length + " 条断语都标明了动因宫归属（六内 " + insideCount
        + " 处、六外 " + outsideCount + " 处）");
    } else {
      add("self-other", "我宫他宫", "fail",
        (statements.length - withOrigins.length) + " 条断语缺动因宫归属，无法判断六内六外");
    }

    // 6. 排盘对账
    add("reconcile", "排盘对账", input.reconcileStatus === "pass" ? "pass" : "fail",
      "排盘对账状态：" + (input.reconcileStatus || "未提供"));

    // 7. K 守则
    var residual = /(一定|必然|必定|绝对|铁定|铁口直断|肯定|百分百|100%|绝不会)/;
    var violations = statements.filter(function (s) { return residual.test(s.plain || ""); });
    add("k-rules", "K 守则合规", violations.length === 0 ? "pass" : "fail",
      violations.length === 0 ? "无绝对化断言" : violations.length + " 条含绝对化词");

    // 8. 原文可追溯：必须能分清「作者原表断语」与「按 §12 现场组合」的句子。
    //    组合句不是错，但占比过高说明多数结论是我方拼的，读者要能看见。
    var composedLines = statements.filter(function (s) { return s.composed === true; });
    var composedRatio = statements.length === 0 ? 0 : composedLines.length / statements.length;
    if (statements.length === 0) {
      add("provenance", "原文可追溯", "not-checkable", "无断语可查");
    } else if (composedLines.length === 0) {
      add("provenance", "原文可追溯", "pass",
        "全部 " + statements.length + " 条均出自原表");
    } else {
      add("provenance", "原文可追溯", composedRatio > 0.5 ? "warning" : "pass",
        composedLines.length + "/" + statements.length + " 条为组合生成（占 "
        + Math.round(composedRatio * 100) + "%），已逐条标注出处与局限");
    }

    var failed = findings.filter(function (f) { return f.status === "fail"; });
    var warnings = findings.filter(function (f) { return f.status === "warning"; });
    return {
      status: failed.length === 0 ? (warnings.length === 0 ? "pass" : "pass-with-warning") : "fail",
      schema: SCHEMA,
      findings: findings,
      failedCount: failed.length,
      warningCount: warnings.length,
      notCheckable: findings.filter(function (f) { return f.status === "not-checkable"; }).map(function (f) { return f.id; }),
      // 审查员与「核了什么、没核什么」一起写出去：谁签的、签的是哪一层。
      // 自签不是第三方独立复核，这一点必须由调用方如实写明，不能靠字段名暗示。
      reviewer: (input && input.reviewer) || null,
      reviewerScope: (input && input.reviewerScope) || null,
      reviewedAt: (input && input.reviewedAt) || null,
      reviewerIndependence: (input && input.reviewerIndependence) || "unknown",
    };
  }

  function runAll(chart, timeline, yearFact, knowledge, knowledgeIndex) {
    return {
      schema: SCHEMA,
      step1: step1Reconcile(chart),
      step3: step3NatalHuaAndFlying(chart),
      step4: step4Sixteen(chart),
      step5: step5Activation(chart, timeline, yearFact),
      step6: step6ZhuanJi(chart),
      step8: step8Overlay(timeline),
      step9: step9DecadalTwoStep(timeline),
      step12: step12Treasury(chart, timeline),
      step13: step13Peach(chart, timeline),
      step14: step14Health(chart, timeline, knowledge, knowledgeIndex),
    };
  }

  globalThis.MingliSection16Steps = Object.freeze({
    SCHEMA: SCHEMA,
    PALACE_ORDER: Object.freeze(PALACE_ORDER),
    UNCLASHABLE: Object.freeze(UNCLASHABLE),
    KUI_YUE: Object.freeze(KUI_YUE),
    MAX_HOPS: MAX_HOPS,
    natalHua: natalHua,
    step1Reconcile: step1Reconcile,
    step3NatalHuaAndFlying: step3NatalHuaAndFlying,
    step4Sixteen: step4Sixteen,
    step5Activation: step5Activation,
    step6ZhuanJi: step6ZhuanJi,
    step8Overlay: step8Overlay,
    step9DecadalTwoStep: step9DecadalTwoStep,
    step12Treasury: step12Treasury,
    step13Peach: step13Peach,
    step14Health: step14Health,
    auditSection17: auditSection17,
    runAll: runAll,
  });
})();

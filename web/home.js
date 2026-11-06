"use strict";

// 入口页（第一屏）的数据层。
//
// 只做两件事：
//   1. 把一张已经算好的盘压成「一屏能读完」的摘要（命宫/身宫/五行局 + 今年三条主线）
//   2. 用 localStorage 记住最近几次的输入与摘要，避免每次重填六个字段
//
// 三条主线是**规则挑选**，不是解读：每条都带 evidenceId 指针，可回到盘面核对。
// 措辞一律「倾向/值得留意」，不做断言。

(function (global) {
  var SCHEMA = "mingli.home/v1";
  var STORAGE_KEY = "mingli.recent.v1";
  var STORAGE_VERSION = 1;
  var MAX_RECORDS = 3;

  var BODY_PALACES = ["命宫", "身宫"];

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function palaceLabel(row, field) {
    return text(row && row[field]);
  }

  /**
   * 三条主线的候选规则。rank 越大越优先显示。
   * 每条都返回 evidenceId，指向 ChartInfo/aiFacts 里真实存在的路径片段。
   */
  function candidateLines(chart, year) {
    var facts = chart && chart.aiFacts;
    var periods = facts && facts.periods;
    var current = periods && periods.current;
    if (!current) return { lines: [], skipped: "该年没有大限/流年数据（超出已支持年份）" };

    var annualHua = (current.annual && current.annual.fourTransformations) || [];
    var decadalHua = (current.decadal && current.decadal.fourTransformations) || [];
    var natalHua = (facts.fourTransformations || []).filter(function (item) {
      return item && item.kind === "忌";
    });
    var lines = [];

    function push(rank, kind, title, body, basis) {
      lines.push({ rank: rank, kind: kind, title: title, text: body, basis: basis });
    }

    annualHua.forEach(function (item) {
      if (!item) return;
      var natal = palaceLabel(item, "natalPalace");
      var decadal = palaceLabel(item, "decadalPalace");
      var basis = text(item.evidenceId);
      if (item.kind === "忌") {
        if (natal === "命宫" || natal === "身宫") {
          push(100, "caution", "流年忌落" + natal,
            "流年化忌引到" + item.star + "，" + natal + "被直接引动；这类年份更适合放慢节奏、少做不可逆决定。",
            basis);
        } else if (decadal === "命宫") {
          push(90, "caution", "流年忌落大限命宫",
            "流年化忌引到" + item.star + "，落在本段大限的命宫；十年主轴被点名，值得提前排好优先级。",
            basis);
        }
        natalHua.forEach(function (natalJi) {
          if (natalJi.star === item.star) {
            push(85, "caution", "生年忌与流年忌同星（" + item.star + "）",
              "同一颗星再次被引动，旧议题容易复现；这更像提醒，不是判决。",
              basis);
          }
        });
      }
      if (item.kind === "禄") {
        if (["命宫", "财帛宫", "官禄宫"].indexOf(natal) >= 0) {
          push(70, "opportunity", "流年禄入本命" + natal,
            "流年化禄引到" + item.star + "，落在" + natal + "；适合把资源往这个方向靠一点。",
            basis);
        }
      }
      if (item.kind === "权" && natal === "命宫") {
        push(50, "opportunity", "流年权入命宫",
          "流年化权引到" + item.star + "，主动权更集中在自己手上，也更容易把事揽多。",
          basis);
      }
      if (item.kind === "科" && ["命宫", "官禄宫"].indexOf(natal) >= 0) {
        push(40, "opportunity", "流年科入本命" + natal,
          "流年化科引到" + item.star + "，多与文书、口碑、被看见有关。",
          basis);
      }
    });

    decadalHua.forEach(function (item) {
      if (!item || item.kind !== "忌") return;
      var natal = palaceLabel(item, "natalPalace");
      if (natal === "命宫" || natal === "身宫") {
        push(65, "caution", "大限忌落" + natal,
          "十年尺度的化忌引到" + item.star + "，" + natal + "在这一段里更敏感。",
          text(item.evidenceId));
      }
    });

    // 去重：同一 title 只留最高 rank 的一条
    var seen = {};
    var deduped = [];
    lines.sort(function (a, b) { return b.rank - a.rank; });
    lines.forEach(function (line) {
      if (seen[line.title]) return;
      seen[line.title] = true;
      deduped.push(line);
    });

    return {
      lines: deduped.slice(0, 3),
      poolSize: deduped.length,
      year: year,
      skipped: deduped.length ? null : "今年没有触发规则清单里的引动，属相对平稳的一年"
    };
  }

  function summarize(chart, options) {
    var opts = options || {};
    if (!chart || chart.status !== "ok") {
      return { schema: SCHEMA, status: "unavailable", reason: "没有可用的排盘结果" };
    }
    var basics = chart.basics || {};
    var current = chart.aiFacts && chart.aiFacts.periods && chart.aiFacts.periods.current;
    var year = Number(opts.year || (current && current.annual && current.annual.year) || 0) || null;

    var yearInfo = null;
    if (current && current.annual) {
      yearInfo = {
        year: current.annual.year,
        ganzhi: current.annual.ganzhi,
        nominalAge: current.annual.nominalAge,
        decadal: current.decadal ? {
          range: current.decadal.yearRange,
          ageRange: current.decadal.ageRange,
          ganzhi: current.decadal.ganzhi
        } : null
      };
    }

    var mainlines = year ? candidateLines(chart, year) : { lines: [], skipped: "未指定年份" };

    return {
      schema: SCHEMA,
      status: "ok",
      year: year,
      basics: {
        soulPalace: basics.soulPalaceBranch || null,
        bodyPalace: basics.bodyPalaceBranch || null,
        fiveElementsClass: basics.fiveElementsClass || null,
        soulRuler: basics.soulRuler || null,
        bodyRuler: basics.bodyRuler || null,
        originalPalace: basics.originalPalace || null,
        zodiac: basics.zodiac || null
      },
      yearInfo: yearInfo,
      natalHua: (chart.aiFacts && chart.aiFacts.fourTransformations || []).map(function (item) {
        return { kind: item.kind, star: item.star, palace: item.palace };
      }),
      mainlines: mainlines.lines,
      mainlinesSkipped: mainlines.skipped,
      months: opts.monthly ? monthGroups(opts.monthly) : null,
      // 月份块需要年度时间轴（逐月事实），入口页不重复计算，交给年度视图
      monthsNote: "逐月安排需要展开年度视图（逐月事实与交界日都在那里）"
    };
  }

  // 逐月两块：只看「流月这一柱」与年/大运/流年形成的关系，不统计整月所有关系
  // （整月一律 20+ 条，直接计数没有区分度）。
  var MONTH_SEVERE = ["branch-six-clash", "stem-clash", "branch-punishment", "branch-harm", "branch-break"];
  var MONTH_SUPPORT = ["stem-combine", "stem-three-combine", "branch-six-combine", "branch-three-harmony"];
  var SLOW_MIN_SEVERE = 4;
  var PREPARE_MIN_SUPPORT = 3;
  var PREPARE_MAX_SEVERE = 2;

  function monthGroups(monthly) {
    var months = (monthly && monthly.months) || [];
    if (!months.length) {
      return { status: "unavailable", reason: "没有逐月事实（年度包未生成）", prepare: [], slow: [], rules: monthRuleText() };
    }
    var rows = months.map(function (month) {
      var relations = month.relations || [];
      var own = relations.filter(function (rel) {
        return rel && Array.isArray(rel.layers) && rel.layers.indexOf("monthly") >= 0;
      });
      var severe = own.filter(function (rel) { return MONTH_SEVERE.indexOf(rel.kind) >= 0; });
      var support = own.filter(function (rel) { return MONTH_SUPPORT.indexOf(rel.kind) >= 0; });
      return {
        index: month.index,
        label: month.label,
        ganzhi: month.ganzhi,
        start: String(month.start || "").slice(0, 10),
        jie: month.jie,
        severe: severe.length,
        support: support.length,
        severeKinds: Array.from(new Set(severe.map(function (rel) { return rel.kind; }))),
        evidenceId: month.evidence_id || ("monthly.months[" + (month.index - 1) + "]")
      };
    });

    var slow = rows.filter(function (row) { return row.severe >= SLOW_MIN_SEVERE; })
      .sort(function (a, b) { return b.severe - a.severe || a.index - b.index; })
      .slice(0, 3)
      .map(function (row) {
        return {
          index: row.index, label: row.label, ganzhi: row.ganzhi, start: row.start, jie: row.jie,
          score: row.severe,
          text: "与年/大运/流年之间出现 " + row.severe + " 条冲刑害，适合把不可逆的决定往后挪。",
          basis: row.evidenceId
        };
      });

    var prepare = rows.filter(function (row) {
      return row.support >= PREPARE_MIN_SUPPORT && row.severe <= PREPARE_MAX_SEVERE;
    })
      .sort(function (a, b) { return b.support - a.support || b.support - b.severe - (a.support - a.severe) || a.index - b.index; })
      .slice(0, 3)
      .map(function (row) {
        return {
          index: row.index, label: row.label, ganzhi: row.ganzhi, start: row.start, jie: row.jie,
          score: row.support,
          text: "合成关系 " + row.support + " 条、冲刑害 " + row.severe + " 条，适合提前准备、把资源先摆好。",
          basis: row.evidenceId
        };
      });

    return {
      status: "ok",
      targetYear: monthly && monthly.target_year ? monthly.target_year : null,
      prepare: prepare,
      slow: slow,
      monthsConsidered: rows.length,
      rules: monthRuleText(),
      reason: prepare.length || slow.length ? null : "这一年没有落在阈值上的月份"
    };
  }

  function monthRuleText() {
    return "只看流月这一柱：与年/大运/流年出现 " + SLOW_MIN_SEVERE + " 条以上冲刑害算「放慢」，"
      + "合成 " + PREPARE_MIN_SUPPORT + " 条以上且冲刑害不超过 " + PREPARE_MAX_SEVERE + " 条算「提前准备」；各取前三。";
  }

  function storage() {
    try {
      var store = global.localStorage;
      if (!store) return null;
      var probe = "__mingli_probe__";
      store.setItem(probe, "1");
      store.removeItem(probe);
      return store;
    } catch (err) {
      return null;
    }
  }

  function readAll() {
    var store = storage();
    if (!store) return { available: false, records: [] };
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return { available: true, records: [] };
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.records)) {
        return { available: true, records: [], corrupt: true };
      }
      return { available: true, records: parsed.records.slice(0, MAX_RECORDS) };
    } catch (err) {
      return { available: true, records: [], corrupt: true };
    }
  }

  function fingerprintOf(input, summary) {
    var profile = (input && input.profile) || {};
    return [
      profile.calendar, profile.date, profile.is_leap_month ? "leap" : "normal",
      profile.time && profile.time.precision, profile.time && profile.time.value,
      profile.sex_for_calculation,
      summary && summary.year
    ].join("|");
  }

  function writeAll(records) {
    var store = storage();
    if (!store) return { ok: false, reason: "浏览器不允许本地保存（隐私模式？）" };
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        updatedAt: new Date().toISOString(),
        records: records.slice(0, MAX_RECORDS)
      }));
      return { ok: true, count: records.length };
    } catch (err) {
      return { ok: false, reason: "本地存储写入失败：" + (err && err.message ? err.message : "未知原因") };
    }
  }

  function save(input, summary, extra) {
    var record = {
      id: fingerprintOf(input, summary),
      savedAt: new Date().toISOString(),
      input: input || null,
      summary: summary || null,
      chartTitle: (extra && extra.title) || null
    };
    var all = readAll();
    var records = (all.records || []).filter(function (item) { return item && item.id !== record.id; });
    records.unshift(record);
    var result = writeAll(records);
    return Object.assign({ record: record }, result);
  }

  function removeAt(index) {
    var all = readAll();
    var records = (all.records || []).slice();
    if (index < 0 || index >= records.length) return { ok: false, reason: "没有这条记录" };
    records.splice(index, 1);
    return writeAll(records);
  }

  function clearAll() {
    var store = storage();
    if (!store) return { ok: false, reason: "浏览器不允许本地保存" };
    try {
      store.removeItem(STORAGE_KEY);
      return { ok: true, count: 0 };
    } catch (err) {
      return { ok: false, reason: "清除失败" };
    }
  }

  global.MingliHome = {
    SCHEMA: SCHEMA,
    STORAGE_KEY: STORAGE_KEY,
    STORAGE_VERSION: STORAGE_VERSION,
    MAX_RECORDS: MAX_RECORDS,
    summarize: summarize,
    monthGroups: monthGroups,
    monthRuleText: monthRuleText,
    fingerprintOf: fingerprintOf,
    save: save,
    loadAll: readAll,
    removeAt: removeAt,
    clearAll: clearAll
  };
})(typeof window !== "undefined" ? window : globalThis);

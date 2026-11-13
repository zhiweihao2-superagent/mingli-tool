// 时间三页（流年 / 流月 / 流日）出图：把当期事实和已生成的 AI 解读拼成一张长图。
// 只做排版，不判断、不发请求；画布由 vendor/report-image.js 提供。
(function (global) {
  "use strict";

  var SCHEMA = "mingli.moment-image/v1";
  var DISCLAIMER = "传统文化学习与娱乐参考，不构成医疗、法律、投资或其他现实决策建议。";

  var SEVERE = {
    "stem-clash": "天干相冲",
    "branch-six-clash": "地支六冲",
    "branch-punishment": "相刑",
    "branch-harm": "相害",
    "branch-break": "相破"
  };
  var SUPPORT = {
    "stem-combine": "天干相合",
    "stem-three-combine": "天干三合",
    "branch-six-combine": "地支六合",
    "branch-three-harmony": "三合",
    "branch-half-harmony": "半合",
    "branch-arch-harmony": "拱合"
  };
  var LAYER = { natal: "本命", luck: "大运", annual: "流年", monthly: "流月", day: "流日" };

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function fmtMoment(iso) {
    var match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return match ? match[2] + "-" + match[3] + " " + match[4] + ":" + match[5] : clean(iso);
  }

  function layersOf(relation) {
    var list = (relation && relation.layers) || [];
    return list.map(function (key) { return LAYER[key] || key; }).filter(Boolean).join(" / ");
  }

  function kindLabel(kind) {
    return SEVERE[kind] || SUPPORT[kind] || clean(kind);
  }

  function countByMonthLayer(months) {
    var severe = {};
    var support = {};
    (months || []).forEach(function (month, index) {
      var s = 0;
      var h = 0;
      ((month && month.relations) || []).forEach(function (relation) {
        var layers = (relation && relation.layers) || [];
        if (layers.indexOf("monthly") < 0) return;
        if (SEVERE[relation.kind]) s += 1;
        else if (SUPPORT[relation.kind]) h += 1;
      });
      severe[index] = s;
      support[index] = h;
    });
    return { severe: severe, support: support };
  }

  function aiSections(ai) {
    var output = ai && ai.output ? ai.output : ai;
    var sections = (output && output.sections) || [];
    return sections.map(function (section) {
      return {
        title: clean(section.title),
        plainLanguage: clean(section.plainLanguage),
        practicalAdvice: (section.practicalAdvice || []).slice(0, 4),
        reflectionQuestion: clean(section.reflectionQuestion)
      };
    }).filter(function (section) { return section.title || section.plainLanguage; });
  }

  function fromAnnual(data, year, ai) {
    var facts = (data && data.ai_facts) || {};
    var annual = (facts.annual_cycles || []).filter(function (item) { return Number(item.year) === Number(year); })[0] || {};
    var months = (data && data.monthly_facts && data.monthly_facts.months) || [];
    var luck = (months[0] && months[0].luck) || {};
    var counts = countByMonthLayer(months);
    var severeTotal = 0;
    var supportTotal = 0;
    var rows = months.map(function (month, index) {
      severeTotal += counts.severe[index] || 0;
      supportTotal += counts.support[index] || 0;
      return { month: month, severe: counts.severe[index] || 0, support: counts.support[index] || 0 };
    });
    var slow = rows.slice().sort(function (a, b) { return b.severe - a.severe; }).filter(function (row) { return row.severe > 0; }).slice(0, 3);
    var fast = rows.slice().sort(function (a, b) { return b.support - a.support; }).filter(function (row) { return row.support > 0; }).slice(0, 3);

    var slowText = slow.map(function (row) {
      return clean(row.month.label) + " " + clean(row.month.ganzhi) + "（冲刑害 " + row.severe + " 处）";
    });
    var fastText = fast
      .filter(function (row) { return slow.indexOf(row) < 0; })
      .map(function (row) {
        return clean(row.month.label) + " " + clean(row.month.ganzhi) + "（合会 " + row.support + " 处）";
      });

    var sections = [{
      title: "这一年",
      plainLanguage: (function () {
        var head = clean(annual.ganzhi) ? clean(annual.ganzhi) + " 年" : clean(year) + " 年";
        var god = clean(annual.ten_god) ? "，流年十神是" + clean(annual.ten_god) : "";
        var luckText = "";
        if (luck && clean(luck.ganzhi)) {
          var range = clean(luck.age_range).replace(/\s*岁/g, "");
          luckText = "；这一步大运是 " + clean(luck.ganzhi) + (range ? "（" + range + " 岁）" : "");
        }
        return head + god + luckText + "。";
      })()
    }, {
      title: "十二个月的节奏",
      plainLanguage: [
        "按节气分成 12 个月，只算流月这一柱：冲刑害共 " + severeTotal + " 处，合会共 " + supportTotal + " 处。",
        slowText.length ? "最需要让路的是 " + slowText.join("、") + "，这几处适合把不可逆的事往后挪。" : "",
        fastText.length ? "最适合提前准备的是 " + fastText.join("、") + "，把资源先摆好。" : ""
      ].filter(Boolean).join("\n")
    }];

    return {
      systemLabel: "流年",
      title: clean(year) + " 年" + (clean(annual.ganzhi) ? " " + clean(annual.ganzhi) : "") + " · 流年",
      sections: sections.concat(aiSections(ai))
    };
  }

  function fromMonth(data, month, ai) {
    var target = month || {};
    var rows = (target.relations || []).slice().sort(function (a, b) {
      var am = ((a && a.layers) || []).indexOf("monthly") >= 0 ? 1 : 0;
      var bm = ((b && b.layers) || []).indexOf("monthly") >= 0 ? 1 : 0;
      if (am !== bm) return bm - am;
      var av = SEVERE[a.kind] ? 1 : 0;
      var bv = SEVERE[b.kind] ? 1 : 0;
      return bv - av;
    });
    var shown = rows.filter(function (relation) { return SEVERE[relation.kind] || SUPPORT[relation.kind]; }).slice(0, 6);
    var severe = 0;
    var support = 0;
    // 与页面口径一致：计数只算「这一柱是流月」的关系，年/运带来的不重复计。
    rows.forEach(function (relation) {
      var layers = (relation && relation.layers) || [];
      if (layers.indexOf("monthly") < 0) return;
      if (SEVERE[relation.kind]) severe += 1;
      else if (SUPPORT[relation.kind]) support += 1;
    });

    var sections = [{
      title: "这个月",
      plainLanguage: [
        clean(target.ganzhi) ? clean(target.ganzhi) + " 月" : "",
        clean(target.jie) ? clean(target.jie) + "起" : "",
        clean(target.start) ? fmtMoment(target.start) + " → " + fmtMoment(target.end) : ""
      ].filter(Boolean).join(" · ") + "。冲刑害 " + severe + " 处，合会 " + support + " 处。"
    }, {
      title: "几处互动",
      plainLanguage: shown.length
        ? "只列冲、合、刑、害、破这类直接关系，藏干之间的候选没有放进来：" +
          shown.map(function (relation) {
            return kindLabel(relation.kind) + "（" + layersOf(relation) + "）";
          }).join("、") + "。"
        : "这个月没有留下直接的冲合关系。"
    }].concat(aiSections(ai));

    return {
      systemLabel: "流月",
      title: (clean(target.ganzhi) || "流月") + " 月" + (clean(target.label) ? " · " + clean(target.label) : "") + " · 流月",
      sections: sections
    };
  }

  function fromDay(user, today, ai, extra) {
    var userDay = (((user || {}).calculation || {}).pillars || {}).day || {};
    var dayPillars = (((today || {}).calculation || {}).pillars) || {};
    var todayDay = dayPillars.day || {};
    var display = (((today || {}).calculation || {}).calendar_display) || {};
    var rows = [];

    if (todayDay.ganzhi) {
      rows.push(clean(todayDay.ganzhi) + " 日" + (display.solar ? "（" + clean(display.solar) + "）" : ""));
      if (display.lunar) rows.push("农历 " + clean(display.lunar));
    }

    var contextText = [
        userDay.ganzhi ? "你的日柱是 " + clean(userDay.ganzhi) : "",
        dayPillars.year && dayPillars.year.ganzhi ? "今年 " + clean(dayPillars.year.ganzhi) + " 年" : "",
        dayPillars.month && dayPillars.month.ganzhi ? "本月 " + clean(dayPillars.month.ganzhi) + " 月" : ""
      ].filter(Boolean).join("，");

    var sections = [{
      title: "这一天",
      plainLanguage: [
        rows.length ? rows.join(" · ") + "。" : "今天的干支还没取到。",
        contextText ? contextText + "。" : ""
      ].filter(Boolean).join("")
    }];

    var extraLines = [];
    if (extra && clean(extra.god)) extraLines.push("今日十神是 " + clean(extra.god) + "。");
    if (extra && clean(extra.lead)) extraLines.push(clean(extra.lead));
    var extraRelations = (extra && extra.relations) || [];
    if (extraRelations.length) extraLines.push("与四柱的互动：" + extraRelations.join("；") + "。");
    if (extraLines.length) {
      sections.push({ title: "和你的关系", plainLanguage: extraLines.join("\n") });
    }

    var extraContext = (extra && extra.context) || [];
    if (extraContext.length) {
      sections.push({ title: "今天的坐标", plainLanguage: extraContext.join("；") + "。" });
    }

    return {
      systemLabel: "流日",
      title: (clean(todayDay.ganzhi) || "这一天") + " · 流日",
      sections: sections.concat(aiSections(ai))
    };
  }

  function save(record) {
    if (!global.MingliReportImage) {
      return Promise.resolve({ ok: false, reason: "出图模块没有加载，请刷新页面重试。" });
    }
    var payload = {
      system: record.systemLabel || "",
      systemLabel: record.systemLabel || "时间",
      title: record.title || "时间",
      createdAt: new Date().toISOString(),
      sections: record.sections || [],
      limitations: [DISCLAIMER],
      audit: null
    };
    try {
      return global.MingliReportImage.download(payload);
    } catch (error) {
      return Promise.resolve({ ok: false, reason: "导出失败：" + (error && error.message ? error.message : error) });
    }
  }

  global.MingliMomentImage = Object.freeze({
    SCHEMA: SCHEMA,
    fromAnnual: fromAnnual,
    fromMonth: fromMonth,
    fromDay: fromDay,
    save: save,
    kindLabel: kindLabel
  });
})(typeof window !== "undefined" ? window : globalThis);

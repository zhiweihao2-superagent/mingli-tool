// 合盘对照：八字（日主/十神/地支/五行）与紫微（命宫/夫妻宫/四化/大限）两套视角。
// 只描述两张盘放在一起的结构差异，不判断合不合，也不预测关系走向。
(function () {
  "use strict";
function mingliApiBase() {
  var loc = window.location;
  var host = loc.host || "";
  var name = loc.hostname || "";
  var loopback = name === "127.0.0.1" || name === "localhost" || name === "::1" || name === "[::1]";
  // file:// 打开、或本机静态预览服务（如 serve.py 的 8899）都没有 /api：
  // 这两种情况显式回到排盘服务端口，避免把请求发到静态服务器上 404。
  if (!host || (loopback && host !== "127.0.0.1:8765" && host !== "localhost:8765")) {
    return "http://127.0.0.1:8765";
  }
  // 其它情况（公网隧道、局域网 IP、8765 同源）一律用同源，由隧道/服务自己转发。
  return loc.protocol + "//" + host;
}

  var API = mingliApiBase() + "/api/v1/bazi/calculate";
  var MATCH = mingliApiBase() + "/api/v1/match";
  var ELEMENTS = ["木", "火", "土", "金", "水"];

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");
  var selectA = document.getElementById("a");
  var selectB = document.getElementById("b");
  var aiResult = document.getElementById("match-result");
  var reportLink = document.getElementById("match-report-link");
  var actions = document.getElementById("match-actions");
  var aiButtons = [document.getElementById("match-ai"), document.getElementById("match-ai2")].filter(Boolean);
  var saveButton = document.getElementById("match-save");
  var ziweiCard = document.getElementById("ziwei-card");
  var zwRows = document.getElementById("zw-rows");
  var modeBazi = document.getElementById("mode-bazi");
  var modeZiwei = document.getElementById("mode-ziwei");

  var baziCache = {};
  var ziweiCache = {};
  var state = { mode: "bazi", pair: null };

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function baziOf(item) {
    if (baziCache[item.id]) return baziCache[item.id];
    baziCache[item.id] = fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.profile)
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
    return baziCache[item.id];
  }

  function ziweiOf(item) {
    if (ziweiCache[item.id]) return ziweiCache[item.id];
    var profile = item.profile.profile || {};
    var time = profile.time || {};
    var now = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    try {
      var chart = window.MingliZiwei.calculate({
        calendar: profile.calendar,
        date: profile.date,
        time: { precision: time.precision, value: time.value || null, branch: time.branch || null },
        sex_for_calculation: profile.sex_for_calculation
      }, {
        asOfYear: now.getFullYear(),
        asOfDate: now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()),
        asOfTimeIndex: 6
      });
      ziweiCache[item.id] = Promise.resolve(chart);
    } catch (err) {
      ziweiCache[item.id] = Promise.reject(err);
    }
    return ziweiCache[item.id];
  }

  function countsOf(data) {
    var inv = (data.ai_facts && data.ai_facts.element_inventory) || {};
    var counts = (inv.counts && inv.counts.hidden_stems) || {};
    return ELEMENTS.map(function (name) { return Number(counts[name] || 0); });
  }

  function palaceOf(chart, name) {
    return (chart.palaces || []).filter(function (palace) { return palace.name === name; })[0] || null;
  }

  function starsOf(palace) {
    if (!palace) return "—";
    var list = (palace.majorStars || []).map(function (star) {
      return star.name + (star.brightness ? "（" + star.brightness + "）" : "") + (star.transformation || "");
    });
    return list.length ? list.join("、") : "空宫";
  }

  function huaOf(chart) {
    var list = [];
    (chart.palaces || []).forEach(function (palace) {
      (palace.majorStars || []).concat(palace.minorStars || []).forEach(function (star) {
        if (star.transformation) list.push(star.name + star.transformation);
      });
    });
    return list.length ? list.join(" ") : "—";
  }

  function decadalOf(chart, birthYear) {
    var age = new Date().getFullYear() - Number(birthYear) + 1;
    var hit = (chart.palaces || []).filter(function (palace) {
      var d = palace.decadal || {};
      return d.fromAge != null && age >= d.fromAge && age <= d.toAge;
    })[0];
    if (!hit) return "—";
    return hit.decadal.fromAge + "–" + hit.decadal.toAge + " " + String(hit.name).replace("宫", "");
  }

  function rowsForBazi(a, b, dataA, dataB) {
    var dayA = dataA.calculation.pillars.day;
    var dayB = dataB.calculation.pillars.day;
    var godAB = window.MingliCycle.tenGod(dayA.stem, dayB.stem);
    var godBA = window.MingliCycle.tenGod(dayB.stem, dayA.stem);
    var rows = [
      ["日主", dayA.stem + " " + window.MingliCycle.elementOf(dayA.stem), dayB.stem + " " + window.MingliCycle.elementOf(dayB.stem)],
      [a.name + " 看 " + b.name, godAB || "—", godBA || "—"],
      ["年支", dataA.calculation.pillars.year.branch + " · " + (window.MingliCycle.branchRelation(dataA.calculation.pillars.year.branch, dataB.calculation.pillars.year.branch) || "无合冲"),
        dataB.calculation.pillars.year.branch + " · " + (window.MingliCycle.branchRelation(dataB.calculation.pillars.year.branch, dataA.calculation.pillars.year.branch) || "无合冲")],
      ["日支", dataA.calculation.pillars.day.branch + " · " + (window.MingliCycle.branchRelation(dataA.calculation.pillars.day.branch, dataB.calculation.pillars.day.branch) || "无合冲"),
        dataB.calculation.pillars.day.branch + " · " + (window.MingliCycle.branchRelation(dataB.calculation.pillars.day.branch, dataA.calculation.pillars.day.branch) || "无合冲")]
    ];
    var ca = countsOf(dataA);
    var cb = countsOf(dataB);
    ELEMENTS.forEach(function (name, index) {
      rows.push([name + "（藏干）", String(ca[index]), String(cb[index])]);
    });
    return rows;
  }

  function rowsForZiwei(a, b, chartA, chartB) {
    var soulA = palaceOf(chartA, "命宫");
    var soulB = palaceOf(chartB, "命宫");
    var spouseA = palaceOf(chartA, "夫妻宫");
    var spouseB = palaceOf(chartB, "夫妻宫");
    var birthA = String((a.profile.profile || {}).date || "").slice(0, 4);
    var birthB = String((b.profile.profile || {}).date || "").slice(0, 4);
    return [
      ["命宫", starsOf(soulA) + " · " + ((soulA && soulA.earthlyBranch) || ""), starsOf(soulB) + " · " + ((soulB && soulB.earthlyBranch) || "")],
      ["夫妻宫", starsOf(spouseA), starsOf(spouseB)],
      ["生年四化", huaOf(chartA), huaOf(chartB)],
      ["当前大限", decadalOf(chartA, birthA), decadalOf(chartB, birthB)],
      ["五行局", (chartA.astrolabe || {}).fiveElementsClass || "—", (chartB.astrolabe || {}).fiveElementsClass || "—"],
      ["命主 / 身主", ((chartA.astrolabe || {}).soul || "—") + " / " + ((chartA.astrolabe || {}).body || "—"),
        ((chartB.astrolabe || {}).soul || "—") + " / " + ((chartB.astrolabe || {}).body || "—")]
    ];
  }

  function renderMain(a, b, rows) {
    var pair = state.pair;
    var lead = document.getElementById("day-lead");
    var titleA = document.getElementById("a-day");
    var titleB = document.getElementById("b-day");
    if (state.mode === "bazi") {
      titleA.textContent = a.name + " · " + rows[0][1];
      titleB.textContent = b.name + " · " + rows[0][2];
      lead.textContent = "日主决定一个人遇到事情时的第一反应方式；下面逐项是两张盘放在一起的结构。";
    } else {
      titleA.textContent = a.name + " · " + rows[0][1];
      titleB.textContent = b.name + " · " + rows[0][2];
      lead.textContent = "命宫看本人，夫妻宫看亲密关系里的相处方式；四化标记这一年被特别引动的星。";
    }
    document.getElementById("mutual").innerHTML = rows.slice(1, 3).map(function (row) {
      return "<li><b>" + esc(row[0]) + '</b><span class="meta">' + esc(row[1]) + " ｜ " + esc(row[2]) + "</span></li>";
    }).join("");
    document.getElementById("mutual-lead").textContent = pair ? "" : "";
    document.getElementById("branches").innerHTML = rows.slice(3).map(function (row) {
      return "<li><b>" + esc(row[0]) + '</b><span class="meta">' + esc(row[1]) + " ｜ " + esc(row[2]) + "</span></li>";
    }).join("");
    return rows;
  }

  function listHtml(rows) {
    return rows.map(function (row) {
      return "<li><b>" + esc(row[0]) + '</b><span class="meta">' + esc(row[1]) + " ｜ " + esc(row[2]) + "</span></li>";
    }).join("");
  }

  // 两套体系行结构不同：八字是「日主 / 互看 / 年支 / 日支 / 五行」，紫微是「命宫 / 夫妻宫 / 四化 / 大限 / 五行局 / 命主」。
  function paint(rows, mode) {
    var mutualTitle = document.getElementById("mutual-title");
    var branchTitle = document.getElementById("branch-title");
    var elementsCard = document.getElementById("elements-card");

    document.getElementById("a-day").textContent = (state.pair.a.name) + " · " + rows[0][1];
    document.getElementById("b-day").textContent = (state.pair.b.name) + " · " + rows[0][2];

    if (mode === "ziwei") {
      mutualTitle.textContent = "夫妻宫与四化";
      branchTitle.textContent = "大限与结构";
      document.getElementById("mutual").innerHTML = listHtml([rows[1], rows[2]]);
      document.getElementById("branches").innerHTML = listHtml(rows.slice(3));
      elementsCard.hidden = true;
      document.getElementById("day-lead").textContent = "命宫看本人，夫妻宫看亲密关系里的相处方式，四化标记被特别引动的星。";
    } else {
      mutualTitle.textContent = "互相看见的方式";
      branchTitle.textContent = "地支之间的关系";
      document.getElementById("mutual").innerHTML = listHtml([rows[1]]);
      document.getElementById("branches").innerHTML = listHtml(rows.slice(2, 4));
      elementsCard.hidden = false;
      document.getElementById("elements").innerHTML = listHtml(rows.slice(4));
      document.getElementById("day-lead").textContent = "日主决定一个人遇到事情时的第一反应方式；下面逐项是两张盘放在一起的结构。";
    }
  }

  function refresh() {
    var items = window.MingliProfile ? window.MingliProfile.list() : [];
    if (items.length < 2) {
      empty.hidden = false;
      content.hidden = true;
      if (actions) actions.hidden = true;
      return;
    }
    content.hidden = false;
    empty.hidden = true;
    if (actions) actions.hidden = false;

    var a = items.filter(function (item) { return item.id === selectA.value; })[0];
    var b = items.filter(function (item) { return item.id === selectB.value; })[0];
    if (!a || !b) return;
    if (a.id === b.id) {
      errorText.textContent = "两边选的是同一个人，换一个再看。";
      errorBox.hidden = false;
      return;
    }
    errorBox.hidden = true;

    if (state.mode === "ziwei") {
      Promise.all([ziweiOf(a), ziweiOf(b)]).then(function (charts) {
        state.pair = { a: a, b: b, chartA: charts[0], chartB: charts[1] };
        state.rows = rowsForZiwei(a, b, charts[0], charts[1]);
        paint(state.rows, "ziwei");
      }).catch(function (err) {
        errorText.textContent = "紫微排盘失败：" + (err && err.message ? err.message : err) +
          "。紫微需要出生时辰，未知时辰时请回出生信息补充。";
        errorBox.hidden = false;
      });
    } else {
      Promise.all([baziOf(a), baziOf(b)]).then(function (results) {
        state.pair = { a: a, b: b, dataA: results[0], dataB: results[1] };
        state.rows = rowsForBazi(a, b, results[0], results[1]);
        paint(state.rows, "bazi");
      }).catch(function (err) {
        errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) +
          "。排盘服务没有响应，请稍后点「重试」。";
        errorBox.hidden = false;
      });
    }
  }
  function setMode(mode) {
    state.mode = mode;
    modeBazi.setAttribute("aria-pressed", String(mode === "bazi"));
    modeZiwei.setAttribute("aria-pressed", String(mode === "ziwei"));
    if (aiResult) aiResult.innerHTML = "";
    refresh();
  }

  // 模型偶尔还会写「a 方」，渲染时兜底换成真名
  function humanize(text) {
    var a = (state.pair && state.pair.a && state.pair.a.name) || "前者";
    var b = (state.pair && state.pair.b && state.pair.b.name) || "后者";
    return String(text == null ? "" : text)
      .replace(/a\s*方|甲方|前者/g, a)
      .replace(/b\s*方|乙方|后者/g, b);
  }

  function renderAi(output) {
    var sections = (output && output.sections) || [];
    var summary = humanize((output && output.summary) || "");
    var html = (summary ? '<p class="match-summary">' + esc(summary) + "</p>" : "") +
      sections.map(function (section) {
        var advice = (section.practicalAdvice || []).map(function (item) {
          return "<li>" + esc(humanize(item)) + "</li>";
        }).join("");
        return '<article class="ai-section"><h3>' + esc(humanize(section.title || section.topic)) + "</h3>" +
          "<p>" + esc(humanize(section.plainLanguage || "")) + "</p>" +
          (advice ? '<ul class="ai-advice">' + advice + "</ul>" : "") +
          (section.reflectionQuestion ? '<p class="ai-q">一起想想：' + esc(humanize(section.reflectionQuestion)) + "</p>" : "") +
          "</article>";
      }).join("");
    var limits = ((output && output.limitations) || []).map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    aiResult.innerHTML = html + (limits ? '<div class="ai-limits"><b>资料边界</b><ul>' + limits + "</ul></div>" : "") +
      '<p class="ai-audit">共 ' + sections.length + " 段 · 已通过服务端结构与证据校验</p>";
  }

  async function runAi() {
    if (!state.pair || !aiResult) return;
    aiButtons.forEach(function (button) { button.disabled = true; });
    aiResult.innerHTML = '<p class="ai-audit">正在生成，通常需要 20–60 秒…</p>';
    try {
      var contracts;
      if (state.mode === "ziwei") {
        contracts = await Promise.all([
          window.MingliAiContract.build({ ziwei: state.pair.chartA }),
          window.MingliAiContract.build({ ziwei: state.pair.chartB })
        ]);
      } else {
        contracts = await Promise.all([
          window.MingliAiContract.build({ bazi: state.pair.dataA }),
          window.MingliAiContract.build({ bazi: state.pair.dataB })
        ]);
      }
      var response = await fetch(MATCH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          a: contracts[0],
          b: contracts[1],
          names: { a: state.pair.a.name, b: state.pair.b.name },
          system: state.mode,
          consent: true,
          consentVersion: "2026-10"
        })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
      renderAi(data.output);
      saveToJournal(data.output);
    } catch (err) {
      aiResult.innerHTML = '<p class="ai-error">' + esc("合盘解读失败：" + (err && err.message ? err.message : err)) + "</p>";
    } finally {
      aiButtons.forEach(function (button) { button.disabled = false; });
    }
  }

  // 存进「解读记录」：和八字/紫微/年度的报告放同一个列表，报告页能看全文、存长图
  function saveToJournal(output) {
    if (!window.MingliAi || !output) return;
    var a = state.pair.a.name;
    var b = state.pair.b.name;
    var evidence = 0;
    (output.sections || []).forEach(function (section) {
      evidence += (section.evidencePaths || []).length;
    });
    var report = window.MingliAi.saveReport({
      schema: "mingli.report.v1",
      system: "合盘",
      title: "合盘解读报告 · " + a + " 与 " + b,
      createdAt: new Date().toISOString(),
      summary: { plainLanguage: output.summary || "", confidence: "medium", evidencePaths: [] },
      sections: (output.sections || []).map(function (section) {
        return {
          topic: section.topic,
          title: section.title,
          plainLanguage: section.plainLanguage,
          practicalAdvice: section.practicalAdvice || [],
          reflectionQuestion: section.reflectionQuestion,
          evidencePaths: section.evidencePaths || []
        };
      }),
      limitations: output.limitations || [],
      audit: { status: "pass", evidenceCount: evidence }
    });
    if (reportLink && report) {
      reportLink.href = "report.html?id=" + encodeURIComponent(report.id);
      reportLink.hidden = false;
    }
  }

  function saveImage() {
    if (!state.rows || !window.MingliChartImage) return;
    var a = state.pair.a;
    var b = state.pair.b;
    var canvas = window.MingliChartImage.drawCompare({
      title: (state.mode === "ziwei" ? "紫微合盘" : "八字合盘") + " · " + a.name + " 与 " + b.name,
      subtitle: "只描述两张盘放在一起的结构差异，不判断合不合",
      left: { name: a.name, sub: "前者" },
      right: { name: b.name, sub: "后者" },
      rows: state.rows
    });
    window.MingliChartImage.save(canvas, window.MingliChartImage.matchFile(a.name + "-" + b.name));
  }

  function run() {
    var items = window.MingliProfile ? window.MingliProfile.list() : [];
    if (items.length < 2) {
      empty.hidden = false;
      return;
    }
    var activeId = window.MingliProfile.activeId();
    var options = items.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.name) + "</option>";
    }).join("");
    selectA.innerHTML = options;
    selectB.innerHTML = options;
    selectA.value = activeId || items[0].id;
    selectB.value = (items.filter(function (item) { return item.id !== selectA.value; })[0] || items[1]).id;

    modeBazi.addEventListener("click", function () { setMode("bazi"); });
    modeZiwei.addEventListener("click", function () { setMode("ziwei"); });
    selectA.addEventListener("change", refresh);
    selectB.addEventListener("change", refresh);
    aiButtons.forEach(function (button) { button.addEventListener("click", runAi); });
    if (saveButton) saveButton.addEventListener("click", saveImage);

    refresh();
  }

  run();
})();

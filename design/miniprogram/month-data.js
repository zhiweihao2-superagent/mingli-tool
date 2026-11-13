/* 时间 · 流月：年份 → 十二个节气月 → 单月互动。
   数据来自 /api/v1/bazi/calculate 的 monthly_facts；先画 demo 快照，联网后覆盖。 */
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

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");

  var yearEl = document.getElementById("year");
  var yearMeta = document.getElementById("year-meta");
  var rail = document.getElementById("months");
  var gzEl = document.getElementById("m-ganzhi");
  var metaEl = document.getElementById("m-meta");
  var factsEl = document.getElementById("m-facts");
  var relEl = document.getElementById("m-rel");
  var countEl = document.getElementById("m-count");
  var aiButton = document.getElementById("month-ai");
  var aiResult = document.getElementById("month-result");

  var lastData = null;
  var lastAi = null;

  if (aiButton) {
    aiButton.disabled = true;
    aiButton.textContent = "正在取盘…";
  }

  var state = { year: new Date().getFullYear(), months: [], selected: 0 };

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
    "branch-three-harmony": "三合局",
    "branch-half-harmony": "半合",
    "branch-arch-harmony": "拱合"
  };
  var LAYER = { natal: "本命", luck: "大运", annual: "流年", monthly: "流月" };

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }


  function fmtMoment(value) {
    var text = String(value || "");
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) return m[2] + "-" + m[3] + " " + m[4] + ":" + m[5];
    var d = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return d ? d[2] + "-" + d[3] : text;
  }

  function loadProfile() {
    try {
      if (window.MingliProfile) {
        var current = window.MingliProfile.currentProfile();
        if (current) return current;
      }
      var raw = localStorage.getItem("mingli.profile.v1");
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 存储不可用时退回示例盘 */ }
    return window.MINGLI_DEMO_PROFILE || null;
  }

  function payloadFor(year) {
    var base = loadProfile();
    if (!base) return null;
    var copy = JSON.parse(JSON.stringify(base));
    copy.options = copy.options || {};
    copy.options.annual_cycles_through = year;
    copy.options.save_history = false;
    return copy;
  }

  function monthFactsOf(data, year) {
    var facts = (data && data.monthly_facts) || null;
    if (!facts) return null;
    if (facts.target_year && Number(facts.target_year) !== Number(year)) return null;
    return (facts.months || []).slice();
  }

  function relationsOf(month) {
    var list = (month && month.relations) || [];
    return list.map(function (item) {
      var kind = String(item.kind || "");
      var label = SEVERE[kind] || SUPPORT[kind] || (item.label || kind);
      var tone = SEVERE[kind] ? "severe" : (SUPPORT[kind] ? "support" : "other");
      var layers = (item.layers || []).map(function (layer) { return LAYER[layer] || layer; });
      var derived = item.derived_from_monthly === true || (item.layers || []).indexOf("monthly") >= 0;
      return {
        kind: kind,
        label: label,
        tone: tone,
        layers: layers,
        derivedFromMonth: derived,
        text: item.note || item.detail || ""
      };
    });
  }

  function monthIndexForNow() {
    var now = new Date();
    var iso = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    for (var i = 0; i < state.months.length; i++) {
      var m = state.months[i];
      if (m.start && m.end && iso >= m.start && iso <= m.end) return i;
    }
    return 0;
  }

  function renderRail() {
    rail.innerHTML = state.months.map(function (month, index) {
      return '<a class="mon' + (index === state.selected ? " on" : "") + '" href="#m" data-index="' + index + '">' +
        "<b>" + esc(month.ganzhi || "—") + "</b><span>" + esc(month.label || "") + "</span></a>";
    }).join("");
  }

  function scrollRailToSelected() {
    var on = rail.querySelector(".mon.on");
    if (!on) return;
    var left = on.offsetLeft - rail.offsetLeft - 8;
    if (left > 0) rail.scrollLeft = left;
  }

  function resetAi() {
    if (!aiResult) return;
    aiResult.innerHTML = "";
    if (aiButton) {
      aiButton.disabled = false;
      aiButton.textContent = "生成这个月的解读";
    }
  }

  function renderMonth() {
    resetAi();
    lastAi = null;    var month = state.months[state.selected];
    if (!month) return;
    var rels = relationsOf(month);
    var severe = rels.filter(function (r) { return r.tone === "severe" && r.derivedFromMonth; });
    var support = rels.filter(function (r) { return r.tone === "support" && r.derivedFromMonth; });

    gzEl.textContent = (month.ganzhi || "—") + " 月";
    metaEl.textContent = [month.jie, month.label, month.start && month.end ? fmtMoment(month.start) + " → " + fmtMoment(month.end) : ""]
      .filter(Boolean).join(" · ");

    factsEl.innerHTML = [
      cell("冲刑害", severe.length + " 处", severe.length ? "需要让路或推迟的事" : "没有明显的硬碰"),
      cell("合会", support.length + " 处", support.length ? "可以借力的地方" : "这个月合作面偏淡")
    ].join("");

    var meaningful = rels.filter(function (r) { return r.tone !== "other"; });
    meaningful.sort(function (a, b) {
      if (a.derivedFromMonth !== b.derivedFromMonth) return a.derivedFromMonth ? -1 : 1;
      if (a.tone !== b.tone) return a.tone === "severe" ? -1 : 1;
      return 0;
    });
    var shown = meaningful.slice(0, 6);
    countEl.textContent = meaningful.length
      ? "共 " + meaningful.length + " 处" + (shown.length < meaningful.length ? " · 显示前 " + shown.length : "")
      : "";
    relEl.innerHTML = shown.map(function (rel, index) {
      var layers = rel.layers.length ? "对照 " + rel.layers.join(" / ") : "";
      return "<li><div><span class=\"r-idx\">" + (index + 1) + "</span>" +
        '<span class="r-txt"><b>' + esc(rel.label) + (rel.derivedFromMonth ? "" : "（源自年/运）") + "</b>" +
        "<p>" + esc([layers, rel.text].filter(Boolean).join(" · ")) + "</p></span></div></li>";
    }).join("") || '<li><div><span class="r-txt"><b>这个月没有落在冲合上的关系</b><p>可以先按原计划推进。</p></span></div></li>';
  }

  function cell(label, value, note) {
    return '<div class="fcell"><span>' + esc(label) + "</span><b>" + esc(value) + "</b><p>" + esc(note) + "</p></div>";
  }

  function paint(data, year) {
    var months = monthFactsOf(data, year);
    if (!months || !months.length) {
      errorText.textContent = "这一年的流月还没算出来，换一年试试。";
      errorBox.hidden = false;
      content.hidden = true;
      return;
    }
    lastData = data;
    state.year = year;
    state.months = months;
    state.selected = monthIndexForNow();
    errorBox.hidden = true;
    content.hidden = false;

    yearEl.textContent = String(year);
    var annual = ((data.ai_facts || {}).annual_cycles || []).filter(function (item) {
      return Number(item.year) === Number(year);
    })[0];
    yearMeta.textContent = [annual && annual.ganzhi, annual && annual.nominal_age ? "虚岁 " + annual.nominal_age : ""]
      .filter(Boolean).join(" · ") || "—";

    renderRail();
    renderMonth();
    scrollRailToSelected();
  }

  function markLoading(on) {
    var box = document.getElementById("content");
    if (box) box.classList.toggle("is-loading", !!on);
  }

  async function load(year) {
    markLoading(true);
    try {
      return await loadInner(year);
    } finally {
      markLoading(false);
    }
  }

  async function loadInner(year) {
    var payload = payloadFor(year);
    if (!payload) {
      empty.hidden = false;
      return;
    }
    var painted = false;
    var snapshot = window.MINGLI_DEMO_BAZI;
    var snapshotYear = snapshot && snapshot.monthly_facts ? Number(snapshot.monthly_facts.target_year) : NaN;
    if (snapshot && snapshotYear === Number(year)) {
      // demo 快照只有默认那一年；年份对得上就先画，避免画布空白
      try {
        paint(window.MINGLI_DEMO_BAZI, year);
        painted = true;
      } catch (e) { painted = false; }
    }
    try {
      var response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      var data = await response.json();
      if (!response.ok || data.status !== "ok") {
        if (painted) {
          errorText.textContent = (data.error && data.error.message) || "这一年的流月没算出来。";
          errorBox.hidden = false;
          return;
        }
        errorText.textContent = (data.error && data.error.message) || "这一年的流月没算出来。";
        errorBox.hidden = false;
        content.hidden = true;
        return;
      }
      paint(data, year);
    } catch (err) {
      if (painted) return;
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) + "。排盘服务没有响应，请稍后点「重试」。";
      errorBox.hidden = false;
      content.hidden = true;
    }
  }

  rail.addEventListener("click", function (event) {
    var link = event.target.closest ? event.target.closest(".mon") : null;
    if (!link) return;
    event.preventDefault();
    state.selected = Number(link.getAttribute("data-index")) || 0;
    renderRail();
    renderMonth();
    scrollRailToSelected();
  });

  document.getElementById("prev").addEventListener("click", function () {
    load(state.year - 1);
  });
  document.getElementById("next").addEventListener("click", function () {
    load(state.year + 1);
  });

  if (aiButton) {
    aiButton.addEventListener("click", async function () {
      var month = state.months[state.selected];
      if (!lastData || !month) return;
      aiButton.disabled = true;
      aiButton.textContent = "正在生成…";
      if (aiResult) aiResult.innerHTML = '<p class="ai-audit">正在生成，通常需要 20–40 秒…</p>';
      try {
        if (!window.MingliAiContract || !window.MingliAiContract.build) {
          throw new Error("页面缺少 AI 模块，请刷新后重试");
        }
        var contract = await window.MingliAiContract.build({ bazi: lastData });
        var name = "";
        try {
          if (window.MingliProfile && window.MingliProfile.active) {
            var who = window.MingliProfile.active();
            name = (who && who.name) || "";
          }
        } catch (e) { name = ""; }
        var response = await fetch(mingliApiBase() + "/api/v1/moment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract: contract,
            kind: "month",
            anchor: {
              ganzhi: String(month.ganzhi || ""),
              label: (month.label || "") + "月 · " + state.year + " 年"
            },
            name: name,
            consent: true,
            consentVersion: "2026-10"
          })
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
        lastAi = data.output || null;
      if (saveButton) { saveButton.hidden = false; saveButton.disabled = false; saveButton.textContent = "存长图"; }
      if (saveNote) saveNote.hidden = true;
      try {
        var monthRecord = window.MingliMomentImage.fromMonth(lastData, month, data.output);
        var savedMonth = window.MingliAi && window.MingliAi.saveReport
          ? window.MingliAi.saveReport({ schema: "mingli.report.v1", title: monthRecord.title, system: "流月", systemLabel: "流月", sections: monthRecord.sections, limitations: [window.MingliMomentImage.DISCLAIMER || ""], summary: {}, audit: null })
          : null;
        if (reportLink && savedMonth) reportLink.href = "report.html?id=" + encodeURIComponent(savedMonth.id);
      } catch (e) { /* 忽略 */ }
      if (reportLink) reportLink.hidden = false;
        if (window.MingliAi && window.MingliAi.renderOutput) {
          window.MingliAi.renderOutput(aiResult, data.output);
        } else if (aiResult) {
          aiResult.textContent = data.summary || "已生成。";
        }
        aiButton.textContent = "重新生成";
      } catch (err) {
        var message = "生成失败：" + (err && err.message ? err.message : err);
        if (window.MingliAi && window.MingliAi.renderError) {
          window.MingliAi.renderError(aiResult, message);
        } else if (aiResult) {
          aiResult.textContent = message;
        }
        aiButton.textContent = "生成这个月的解读";
      } finally {
        aiButton.disabled = false;
      }
    });
  }


  var saveButton = document.getElementById("save-month");
  var saveNote = document.getElementById("save-note-month");
  var reportLink = document.getElementById("report-link");

  if (saveButton) { saveButton.hidden = true; saveButton.textContent = "存长图"; }

  if (saveButton && window.MingliMomentImage) {
    saveButton.addEventListener("click", async function () {
      if (!lastAi) {
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = "先让 AI 讲完这个月，长图里才有解读可以存。"; }
        saveButton.textContent = "存长图";
        setTimeout(function () { saveButton.textContent = "存长图"; }, 1800);
        return;
      }
      if (!lastData) { saveButton.textContent = "还没有可画的内容"; setTimeout(function () { saveButton.textContent = "存长图"; }, 1600); return; }
      var keep = saveButton.textContent;
      saveButton.disabled = true;
      saveButton.textContent = "正在出图…";
      try {
        var result = await window.MingliMomentImage.save(window.MingliMomentImage.fromMonth(lastData, state.months[state.selected], lastAi));
        saveButton.textContent = result && result.ok ? "已保存" : "导出失败";
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = result && result.ok ? "已存成 PNG，在浏览器的下载目录（一般叫「下载」或 Downloads）里。" : "出图失败，可以再点一次。"; }
        if (result && !result.ok && result.reason) console.warn(result.reason);
      } catch (err) {
        saveButton.textContent = "导出失败";
        console.warn(err);
      } finally {
        setTimeout(function () { saveButton.textContent = "存长图"; saveButton.disabled = !lastAi; }, 1800);
      }
    });
  }


  var yearPick = document.getElementById("year-pick");
  var yearPickRange = null;

  function fillYearPick(year, low, high) {
    if (!yearPick) return;
    var key = low + ":" + high;
    if (yearPickRange !== key) {
      var html = "";
      for (var y = low; y <= high; y++) html += '<option value="' + y + '">' + y + "</option>";
      yearPick.innerHTML = html;
      yearPickRange = key;
    }
    yearPick.value = String(year);
  }

  if (yearPick) {
    yearPick.addEventListener("change", function () {
      var picked = Number(yearPick.value);
      if (picked) onYearPicked(picked);
    });
  }

  var pickMonth = null;
  var basePaint = paint;
  paint = function (data, year) {
    basePaint(data, year);
    var low = 1900;
    try {
      var who = loadProfile();
      var by = Number(String((who && who.profile && who.profile.date) || "").slice(0, 4));
      if (by >= 1800) low = by;
    } catch (e) { /* 用兜底年份区间 */ }
    fillYearPick(year, low, 2100);
    if (aiButton && aiButton.disabled && aiButton.textContent === "正在取盘…") {
      aiButton.disabled = false;
      aiButton.textContent = "生成这个月的解读";
    }
    if (pickMonth != null && state.months[pickMonth]) {
      state.selected = pickMonth;
      pickMonth = null;
      renderRail();
      renderMonth();
      scrollRailToSelected();
    }
  };

  function onYearPicked(picked) {
    if (picked && picked !== state.year) load(picked);
  }

  try {
    var search = String(location.search || "").replace(/^\?/, "");
    search.split("&").forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split("=");
      var key = decodeURIComponent(kv[0] || "");
      var val = decodeURIComponent(kv[1] || "");
      if (key === "y") {
        var qy = Number(val);
        if (qy >= 1900 && qy <= 2100) state.year = qy;
      } else if (key === "m") {
        var qm = Number(val);
        if (qm >= 0 && qm <= 11) pickMonth = qm;
      }
    });
  } catch (e) { /* 参数解析失败就按默认年份 */ }

  load(state.year);

  var retryButton = document.getElementById("retry");
  if (retryButton) {
    retryButton.addEventListener("click", function () {
      retryButton.disabled = true;
      retryButton.textContent = "重试中…";
      location.reload();
    });
  }
})();

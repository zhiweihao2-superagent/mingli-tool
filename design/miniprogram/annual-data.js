// 年度解读页：按填写的出生资料，逐年取流年干支、流月与盘面关系。
// 全部来自本机排盘服务的确定性结果，不用模型、不写死数据。
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
  var STORE = "mingli.profile.v1";

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");

  var profile = null;
  var birthYear = 0;
  var current = new Date().getFullYear();
  var selected = current;
  var cache = {};
  var lastData = null;
  var lastYear = null;
var lastAiAnnual = null;
  var aiButton = document.querySelector(".ai-btn");
  var aiResult = document.getElementById("ai-result");
  var reportLink = document.getElementById("report-link");

  function loadProfile() {
    try {
      if (window.MingliProfile) {
        var current = window.MingliProfile.currentProfile();
        if (current) return current;
      }
      var raw = localStorage.getItem(STORE);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 存储不可用时退回示例盘 */ }
    return window.MINGLI_DEMO_PROFILE || null;
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // 十神 → 这一年的观察方向（措辞保守，只描述倾向）
  var GOD_ALIAS = { "偏官": "七杀", "正官": "正官", "偏印": "偏印", "正印": "正印" };
  var RELATION_CN = {
    "clash": "冲", "six-clash": "六冲", "punishment": "刑", "six-harm": "害", "harm": "害",
    "combine": "合", "six-combine": "六合", "half-meeting": "半会", "hidden-combine": "暗合",
    "hidden-combine-candidate": "暗合候选", "half-combine": "半合", "break": "破"
  };

  var TOPIC_COPY = {
    "比肩": { career: "更像靠自己扛事的一年，合作里先把分工写清楚。", money: "钱多花在自己的事上，别把人情账和不记账混在一起。" },
    "劫财": { career: "同辈之间的竞争感变强，先定好规则再一起做。", money: "容易为别人的事掏钱，先分清借与给。" },
    "食神": { career: "适合把想法做成作品或流程，输出比争抢更有用。", money: "收入跟产出挂钩，稳扎稳打反而更顺。" },
    "伤官": { career: "表达欲强，容易顶到台面上；说之前先想好边界。", money: "有机会也有波动，别用一次判断替代长期安排。" },
    "偏财": { career: "外部机会变多，判断哪一个是能长期做的更要紧。", money: "临时机会多，正财和偏财分开记账。" },
    "正财": { career: "把该交付的交付好，回报会跟着来。", money: "适合做储蓄和固定投入，不适合追热点。" },
    "七杀": { career: "任务与压力同时变重，先排优先级再答应新事。", money: "支出容易集中在一次决策上，留出缓冲。" },
    "正官": { career: "责任和规则更明确，把职责写清反而是保护。", money: "收入节奏更规律，适合按计划推进。" },
    "偏印": { career: "适合学习、考证、做方法论，别急着换赛道。", money: "钱更多花在自我投入上，记得算回报。" },
    "正印": { career: "有贵人和资质相关的机会，主动去把手续办完。", money: "偏向稳，适合整理账目和长期安排。" }
  };

  function yearPayload(year) {
    var copy = JSON.parse(JSON.stringify(profile));
    copy.options = copy.options || {};
    copy.options.annual_cycles_through = year;
    return copy;
  }

  async function fetchYear(year) {
    if (cache[year]) return cache[year];
    var response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(yearPayload(year))
    });
    var data = await response.json();
    if (!response.ok || data.status !== "ok") {
      throw new Error((data.error && data.error.message) || "排盘失败");
    }
    cache[year] = data;
    return data;
  }

  function relationNote(annual) {
    var relations = annual.relations_to_natal || [];
    if (!relations.length) return "与四柱没有特别的合冲刑害。";
    var kinds = {};
    relations.forEach(function (item) {
      var kind = String(item.kind || "").replace("branch-", "").replace("stem-", "");
      kind = RELATION_CN[kind] || kind;
      kinds[kind] = (kinds[kind] || 0) + 1;
    });
    var parts = Object.keys(kinds).map(function (key) {
      return key + " " + kinds[key] + " 处";
    });
    return "与四柱有 " + relations.length + " 处互动（" + parts.join("、") + "）。";
  }

  function monthIndexOf(month) {
    var now = Date.now();
    var start = Date.parse(month.start);
    var end = Date.parse(month.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return now >= start && now < end;
  }

  function render(data, year) {
    fillYearPick(year, birthYear || 1900, 2100);
    var annual = (data.ai_facts.annual_cycles || []).filter(function (item) {
      return item.year === year;
    })[0] || {};
    var months = (data.monthly_facts && data.monthly_facts.months) || [];
    var luck = (months[0] && months[0].luck) || {};
    var god = annual.ten_god || "";
    var copy = TOPIC_COPY[GOD_ALIAS[god] || god] || TOPIC_COPY[god] || { career: "", money: "" };

    document.getElementById("year").textContent = String(year);
    document.getElementById("year-meta").textContent =
      "虚岁 " + (year - birthYear + 1) + (luck.age_range ? " · 大运 " + luck.ganzhi : "");
    document.getElementById("ganzhi").textContent = annual.ganzhi || "—";
    document.getElementById("head-meta").textContent = [
      god ? god + "年" : "",
      luck.ganzhi ? "大运 " + luck.ganzhi : "",
      relationNote(annual)
    ].filter(Boolean).join(" · ");

    document.getElementById("ai-title").textContent = god
      ? "流年 " + annual.ganzhi + "，十神是" + god
      : "流年 " + (annual.ganzhi || "—");
    document.getElementById("ai-body").innerHTML =
      "这一年天干为 <strong>" + esc(god || "—") + "</strong>，" + esc(copy.career || "按盘面关系看节奏。") +
      "下面 12 个流月按节气分，具体解读在小程序里调本机模型生成。";
    document.getElementById("ai-note").textContent = "6 个主题 · 12 个流月";

    var nowIndex = -1;
    document.getElementById("months").innerHTML = months.map(function (month, index) {
      var isNow = monthIndexOf(month);
      if (isNow && nowIndex < 0) nowIndex = index;
      var day = String(month.start || "").slice(5, 10).replace("-", "/");
      return '<a class="mon' + (isNow ? " on" : "") + '" href="month.html?m=' + index + '&y=' + year + '"><b>' + esc(month.ganzhi) + "</b><span>" + esc(month.jie) +
        "</span><span class=\"mon-day\">" + esc(day) + "</span></a>";
    }).join("");
    var rail = document.getElementById("months");
    var active = rail.querySelector(".mon.on");
    if (active) rail.scrollLeft = Math.max(0, active.offsetLeft - rail.clientWidth / 2 + active.offsetWidth / 2);
    document.getElementById("month-meta").textContent =
      months.length + " 个节气月" + (nowIndex >= 0 ? " · 现在 " + months[nowIndex].ganzhi : "");

    var topics = [
      { title: "年度总览", text: (annual.ganzhi || "") + (god ? " 年，" + god + "当令。" : " 年。") + "先看这一年最常出现的主题，再谈具体安排。" },
      { title: "事业", text: copy.career || "按流年与日主的关系看工作节奏。" },
      { title: "关系", text: relationNote(annual) },
      { title: "财务", text: copy.money || "按财星在不在流年判断收支节奏。" },
      { title: "健康", text: "按流年与日主的强弱关系看作息节奏，忙的时候先保证睡眠；这只是传统说法，不构成医学判断。" },
      { title: "家宅", text: "与年柱的互动见上条关系说明；家里旧事容易被翻出来，留出一次长谈的时间。" }
    ];
    document.getElementById("topics").innerHTML = topics.map(function (topic, index) {
      return '<li><div><span class="t-idx">' + String(index + 1).padStart(2, "0") + "</span>" +
        '<span class="t-txt"><b>' + esc(topic.title) + "</b><p>" + esc(topic.text) + "</p></span></div></li>";
    }).join("");

    document.getElementById("prev").disabled = year <= birthYear;
    document.getElementById("next").disabled = year >= 2100;
  }

  async function load(year) {
    selected = year;
    try {
      var data = await fetchYear(year);
      content.hidden = false;
      errorBox.hidden = true;
      lastData = data;
      lastYear = year;
      if (lastAiAnnual) {
        lastAiAnnual = null;
        if (saveButton) { saveButton.hidden = true; saveButton.textContent = "存长图"; saveButton.disabled = true; }
        if (saveNote) saveNote.hidden = true;
        if (reportLink) reportLink.hidden = true;
      }
      render(data, year);
    } catch (err) {
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) +
        "。排盘服务没有响应，请稍后点「重试」。";
      errorBox.hidden = false;
      content.hidden = true;
    }
  }

  document.getElementById("prev").addEventListener("click", function () {
    if (selected > birthYear) load(selected - 1);
  });
  document.getElementById("next").addEventListener("click", function () {
    if (selected < 2100) load(selected + 1);
  });

  if (aiButton) {
    aiButton.addEventListener("click", async function () {
      if (!lastData || !aiResult) return;
      aiButton.setAttribute("aria-busy", "true");
      aiButton.disabled = true;
      aiResult.innerHTML = '<p class="ai-audit">正在生成 1/3 批，整份大约 1–2 分钟…</p>';
      try {
        var report = await window.MingliAi.runAnnual(lastData, lastYear, function (done, total) {
          aiResult.innerHTML = '<p class="ai-audit">正在生成 ' + done + "/" + total + " 批…</p>";
        });
        window.MingliAi.renderOutput(aiResult, report);
        lastAiAnnual = report || null;
        if (saveButton) { saveButton.hidden = false; saveButton.disabled = false; saveButton.textContent = "存长图"; }
        if (saveNote) saveNote.hidden = true;
        try {
          report.system = "流年";
          report.systemLabel = "流年";
          var savedYear = window.MingliAi.saveReport(report);
          if (reportLink && savedYear) reportLink.href = "report.html?id=" + encodeURIComponent(savedYear.id);
        } catch (e) { /* 忽略 */ }
        if (reportLink) reportLink.hidden = false;
      } catch (err) {
        window.MingliAi.renderError(aiResult, "解读失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.removeAttribute("aria-busy");
        aiButton.disabled = false;
      }
    });
  }


  var saveButton = document.getElementById("save-annual");
  var saveNote = document.getElementById("save-note-annual");

  if (saveButton) { saveButton.hidden = true; saveButton.textContent = "存长图"; }

  if (saveButton && window.MingliMomentImage) {
    saveButton.addEventListener("click", async function () {
      if (!lastAiAnnual) {
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = "先让 AI 讲完这一年，长图里才有解读可以存。"; }
        saveButton.textContent = "存长图";
        setTimeout(function () { saveButton.textContent = "存长图"; }, 1800);
        return;
      }
      if (!lastData) { saveButton.textContent = "还没有可画的内容"; setTimeout(function () { saveButton.textContent = "存长图"; }, 1600); return; }
      var keep = saveButton.textContent;
      saveButton.disabled = true;
      saveButton.textContent = "正在出图…";
      try {
        var result = await window.MingliMomentImage.save(window.MingliMomentImage.fromAnnual(lastData, lastYear, lastAiAnnual));
        saveButton.textContent = result && result.ok ? "已保存" : "导出失败";
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = result && result.ok ? "已存成 PNG，在浏览器的下载目录（一般叫「下载」或 Downloads）里。" : "出图失败，可以再点一次。"; }
        if (result && !result.ok && result.reason) console.warn(result.reason);
      } catch (err) {
        saveButton.textContent = "导出失败";
        console.warn(err);
      } finally {
        setTimeout(function () { saveButton.textContent = "存长图"; saveButton.disabled = !lastAiAnnual; }, 1800);
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

  function onYearPicked(picked) {
    if (picked !== selected) load(picked);
  }

  profile = loadProfile();
  if (!profile) {
    empty.hidden = false;
  } else {
    birthYear = Number(String(profile.profile.date || "").slice(0, 4)) || current;
    selected = Math.max(current, birthYear);
    load(selected);
  }

  var retryButton = document.getElementById("retry");
  if (retryButton) {
    retryButton.addEventListener("click", function () {
      retryButton.disabled = true;
      retryButton.textContent = "重试中…";
      location.reload();
    });
  }
})();

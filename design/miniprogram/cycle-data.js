// 时间坐标页：一个十年大运，或者一个流月，展开看它的干支、十神与和四柱的关系。
// 参数：?type=luck&index=3  或  ?type=month&index=5
(function () {
  "use strict";

  var API = "http://127.0.0.1:8765/api/v1/bazi/calculate";
  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");
  var aiCard = document.getElementById("ai-card");
  var aiButton = document.getElementById("cycle-ai");
  var aiResult = document.getElementById("cycle-result");
  var aiLead = document.getElementById("ai-lead");
  var lastData = null;
  var lastAnchor = null;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function params() {
    var query = new URLSearchParams(location.search);
    return {
      type: query.get("type") === "month" ? "month" : "luck",
      index: Math.max(0, Number(query.get("index") || 0))
    };
  }

  function profile() {
    try {
      if (window.MingliProfile) return window.MingliProfile.currentProfile();
      var raw = localStorage.getItem("mingli.profile.v1");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function post(payload) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function renderLuck(data, index) {
    var calc = data.calculation;
    var cycles = (calc.luck_cycles && calc.luck_cycles.cycles) || [];
    var cycle = cycles[index];
    if (!cycle) throw new Error("没有第 " + (index + 1) + " 步大运");

    var dayStem = calc.pillars.day.stem;
    var ganzhi = String(cycle.ganzhi || "").replace("（小运）", "");
    var god = window.MingliCycle.tenGod(dayStem, ganzhi.charAt(0));

    document.getElementById("nav-title").textContent = "大运";
    document.getElementById("title").textContent = ganzhi + " 运";
    document.getElementById("subtitle").textContent = (cycle.age_range || "") + " · 第 " + (index + 1) + " 步";
    document.getElementById("ganzhi").textContent = ganzhi;
    document.getElementById("god").textContent = god || "—";
    document.getElementById("lead").textContent = (window.MingliCycle.copyOf(god) || "这一段没有突出的十神。") +
      " 大运是十年一段的时间坐标，只说明这段时期的基调，不代表具体事件。";

    var rows = [];
    ["year", "month", "day"].forEach(function (key) {
      var pillar = calc.pillars[key];
      if (!pillar) return;
      var rel = window.MingliCycle.branchRelation(ganzhi.charAt(1), pillar.branch);
      var label = { year: "与年支", month: "与月支", day: "与日支" }[key];
      rows.push([label, rel || "无合冲", ganzhi.charAt(1) + " 对 " + pillar.branch]);
    });
    var stemGod = window.MingliCycle.tenGod(dayStem, ganzhi.charAt(0));
    rows.unshift(["天干对日主", stemGod || "—", dayStem + " 见 " + ganzhi.charAt(0)]);
    document.getElementById("relations").innerHTML = rows.map(function (row) {
      return "<li><b data-term=\"" + esc(row[1]) + "\">" + esc(row[0]) + '</b><span class="meta">' +
        esc(row[1]) + " · " + esc(row[2]) + "</span></li>";
    }).join("");
  }

  function renderMonth(data, index) {
    var calc = data.calculation;
    var months = (data.monthly_facts && data.monthly_facts.months) || [];
    var month = months[index];
    if (!month) throw new Error("没有第 " + (index + 1) + " 个流月");

    var dayStem = calc.pillars.day.stem;
    var ganzhi = month.ganzhi;
    var god = window.MingliCycle.tenGod(dayStem, ganzhi.charAt(0));

    lastAnchor = { ganzhi: ganzhi, label: [month.jie, String(month.start || "").slice(0, 10)].filter(Boolean).join(" ") };
    document.getElementById("nav-title").textContent = "流月";
    document.getElementById("title").textContent = ganzhi + " 月";
    document.getElementById("subtitle").textContent = [month.jie, String(month.start || "").slice(0, 10)].filter(Boolean).join(" · ");
    document.getElementById("ganzhi").textContent = ganzhi;
    document.getElementById("god").textContent = god || "—";
    document.getElementById("lead").textContent = (window.MingliCycle.copyOf(god) || "这个月没有突出的十神。") +
      " 流月按节气划分，从「" + (month.jie || "") + "」起算。";

    var rows = [];
    ["year", "month", "day"].forEach(function (key) {
      var pillar = calc.pillars[key];
      if (!pillar) return;
      var rel = window.MingliCycle.branchRelation(ganzhi.charAt(1), pillar.branch);
      var label = { year: "与年支", month: "与月支", day: "与日支" }[key];
      rows.push([label, rel || "无合冲", ganzhi.charAt(1) + " 对 " + pillar.branch]);
    });
    rows.unshift(["天干对日主", god || "—", dayStem + " 见 " + ganzhi.charAt(0)]);
    rows.push(["节气区间", month.start && month.end ? String(month.start).slice(5, 10) + " → " + String(month.end).slice(5, 10) : "—", "按节气分月"]);
    document.getElementById("relations").innerHTML = rows.map(function (row) {
      return "<li><b data-term=\"" + esc(row[1]) + "\">" + esc(row[0]) + '</b><span class="meta">' +
        esc(row[1]) + " · " + esc(row[2]) + "</span></li>";
    }).join("");
  }

  if (aiButton) {
    aiButton.addEventListener("click", async function () {
      if (!lastData || !lastAnchor || !aiResult) return;
      aiButton.disabled = true;
      aiButton.textContent = "正在生成…";
      aiResult.innerHTML = '<p class="ai-audit">正在生成，通常需要 20–40 秒…</p>';
      try {
        var contract = await window.MingliAiContract.build({ bazi: lastData });
        var active = window.MingliProfile && window.MingliProfile.active();
        var response = await fetch("http://127.0.0.1:8765/api/v1/moment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract: contract,
            kind: "month",
            anchor: lastAnchor,
            name: active ? active.name : "",
            consent: true,
            consentVersion: "2026-10"
          })
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
        window.MingliAi.renderOutput(aiResult, data.output);
      } catch (err) {
        window.MingliAi.renderError(aiResult, "生成失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.textContent = "生成解读";
        aiButton.disabled = false;
      }
    });
  }

  var current = profile();
  if (!current || !current.profile) {
    empty.hidden = false;
  } else {
    content.hidden = false;
    var query = params();
    var payload = JSON.parse(JSON.stringify(current));
    payload.options = payload.options || {};
    if (query.type === "month") payload.options.annual_cycles_through = new Date().getFullYear();
    post(payload).then(function (data) {
      if (data.status !== "ok") throw new Error("排盘失败");
      lastData = data;
      if (query.type === "month") renderMonth(data, query.index);
      else renderLuck(data, query.index);
      if (aiCard) {
        aiCard.hidden = query.type !== "month";
        if (aiLead) aiLead.textContent = query.type === "month"
          ? "把这个月放到你的盘上，讲这个月的节奏和能做的事。"
          : "";
      }
      if (window.MingliGlossary) window.MingliGlossary.bind(document.getElementById("relations"));
    }).catch(function (err) {
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) +
        "。请确认本机服务在 127.0.0.1:8765 运行。";
      errorBox.hidden = false;
      content.hidden = true;
    });
  }
})();

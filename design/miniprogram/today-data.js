// 今日与我：把今天的干支和「你的日主 / 当前大运」放到一起，看今天落在什么坐标上。
// 十神与地支关系用固定表格推，不下事件结论。
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
  var STEMS = "甲乙丙丁戊己庚辛壬癸";
  var BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
  var ELEMENT = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
  var YANG = { 甲: true, 丙: true, 戊: true, 庚: true, 壬: true };
  var GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
  var CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");
  var aiButton = document.getElementById("today-ai");
  var aiReady = false;
  var saveButton = document.getElementById("save-day");
  var saveNote = document.getElementById("save-note-day");
  var reportLink = document.getElementById("report-link");

  function pad2(n) { return String(n).padStart(2, "0"); }

  function isoToday() {
    var n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate());
  }

  function readDate() {
    var raw = null;
    try { raw = new URLSearchParams(location.search).get("d"); } catch (e) { raw = null; }
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var t = new Date(raw + "T12:00:00");
      if (!Number.isNaN(t.getTime())) return raw;
    }
    return isoToday();
  }

  function shiftDate(iso, delta) {
    var t = new Date(iso + "T12:00:00");
    t.setDate(t.getDate() + delta);
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
  }

  function dayDiff(a, b) {
    return Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000);
  }

  function dayLabel(iso, solarText) {
    var diff = dayDiff(iso, isoToday());
    if (diff === 0) return "今天";
    if (diff === -1) return "昨天";
    if (diff === 1) return "明天";
    var m = String(solarText || iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[2]) + " 月 " + Number(m[3]) + " 日" : iso;
  }

  var selectedDate = readDate();

  function markAiReady() {
    if (aiReady || !aiButton) return;
    aiReady = true;
    aiButton.disabled = false;
    if (aiButton.textContent === "正在取盘…") aiButton.textContent = "生成今天的解读";
  }

  if (aiButton) {
    aiButton.disabled = true;
    aiButton.textContent = "正在取盘…";
  }
  var aiResult = document.getElementById("today-result");
  var lastToday = null;
  var lastUser = null;
  var lastAiDay = null;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function tenGod(dayStem, otherStem) {
    var a = ELEMENT[dayStem];
    var b = ELEMENT[otherStem];
    var samePolarity = Boolean(YANG[dayStem]) === Boolean(YANG[otherStem]);
    if (b === a) return samePolarity ? "比肩" : "劫财";
    if (GENERATES[a] === b) return samePolarity ? "食神" : "伤官";
    if (CONTROLS[a] === b) return samePolarity ? "偏财" : "正财";
    if (CONTROLS[b] === a) return samePolarity ? "偏官" : "正官";
    if (GENERATES[b] === a) return samePolarity ? "偏印" : "正印";
    return "—";
  }

  var COMBINE = { "子丑": 1, "寅亥": 1, "卯戌": 1, "辰酉": 1, "巳申": 1, "午未": 1 };
  var CLASH = { "子午": 1, "丑未": 1, "寅申": 1, "卯酉": 1, "辰戌": 1, "巳亥": 1 };
  var HARM = { "子未": 1, "丑午": 1, "寅巳": 1, "卯辰": 1, "申亥": 1, "酉戌": 1 };

  function branchRelation(a, b) {
    if (!a || !b) return "";
    var key = a + b;
    var alt = b + a;
    if (COMBINE[key] || COMBINE[alt]) return "六合";
    if (CLASH[key] || CLASH[alt]) return "相冲";
    if (HARM[key] || HARM[alt]) return "相害";
    if (a === b) return "同支";
    return "";
  }

  var GOD_COPY = {
    "比肩": "今天更像「自己扛」的一天：事情落在你手上，协作前先把分工讲清。",
    "劫财": "今天同辈之间的比较、分账容易冒头，先定规则再一起做。",
    "食神": "今天适合产出：把想法写下来、把该做的做完，比争抢有用。",
    "伤官": "今天表达欲偏强，容易直说；重要的话先说结论，再补理由。",
    "偏财": "今天外部机会、临时事务偏多，先分清哪些值得跟。",
    "正财": "今天适合按部就班：把该交付的交付好，回报会跟着来。",
    "偏官": "今天压力与责任容易一起上来，先排优先级再答应新事。",
    "正官": "今天规则与职责更显眼，把职责写清反而是保护。",
    "偏印": "今天适合学习、整理方法，不太适合临场拍板。",
    "正印": "今天容易得到帮助或资质相关的好消息，主动去把手续办完。"
  };

  var whoSelect = document.getElementById("who-select");
  var whoDefault = document.getElementById("who-default");
  var whoNote = document.getElementById("who-note");

  function defaultId() {
    return window.MingliProfile ? window.MingliProfile.defaultId() : null;
  }

  function tempId() {
    return window.MingliProfile ? window.MingliProfile.viewingId() : null;
  }

  function setTempId(id) {
    if (window.MingliProfile) window.MingliProfile.setViewing(id);
  }

  function pickId() {
    var items = window.MingliProfile ? window.MingliProfile.list() : [];
    var wanted = tempId();
    if (wanted && items.some(function (item) { return item.id === wanted; })) return wanted;
    return defaultId() || (items[0] && items[0].id) || null;
  }

  function renderWhoBar() {
    if (!window.MingliProfile || !whoSelect) return;
    var items = window.MingliProfile.list();
    var currentId = pickId();
    whoSelect.innerHTML = items.map(function (item) {
      return '<option value="' + item.id + '">' + item.name + "</option>";
    }).join("");
    if (currentId) whoSelect.value = currentId;

    var isDefault = currentId === defaultId();
    if (whoDefault) {
      whoDefault.disabled = isDefault;
      whoDefault.textContent = isDefault ? "已是默认" : "设为默认";
    }
    if (whoNote) {
      var current = items.filter(function (item) { return item.id === currentId; })[0];
      whoNote.textContent = current
        ? (isDefault ? "「" + current.name + "」是默认档案，以后进来都是这位；想换可以改默认。"
                     : "现在看的是「" + current.name + "」，还不是默认；确定后点「设为默认」。")
        : "";
    }
  }

  function readProfile() {
    try {
      if (window.MingliProfile) {
        var id = pickId();
        var item = window.MingliProfile.list().filter(function (entry) { return entry.id === id; })[0];
        return item ? item.profile : null;
      }
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

  function todayPayload(dateText) {
    var iso = dateText || selectedDate;
    var year = Number(iso.slice(0, 4));
    return {
      schema_version: "1.0",
      profile: {
        calendar: "solar",
        date: iso,
        is_leap_month: false,
        time: { precision: "unknown" },
        timezone: "Asia/Shanghai",
        sex_for_calculation: "male",
        birthplace: { label: null, longitude: null }
      },
      rules: { profile_id: "engine-default-v1", true_solar_time: false, clock_time_is_dst: false },
      options: { save_history: false, annual_cycles_through: year }
    };
  }

  function monthOfYear(chart, iso) {
    var months = (chart.monthly_facts && chart.monthly_facts.months) || [];
    if (!months.length) return null;
    var now = new Date((iso || selectedDate) + "T12:00:00").getTime();
    return months.filter(function (month) {
      var start = Date.parse(month.start);
      var end = Date.parse(month.end);
      return !Number.isNaN(start) && now >= start && now < end;
    })[0] || null;
  }

  function fmtSolar(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number(m[2]) + " 月 " + Number(m[3]) + " 日 周" + "日一二三四五六".charAt(date.getDay());
  }

  function fmtLunar(text) {
    return String(text || "").replace(/^\d{4}年/, "");
  }

  function render(user, today) {
    markAiReady();
    lastUser = user;
    var day = user.calculation.pillars.day;
    var todayYear = today.calculation.pillars.year;
    var todayMonth = today.calculation.pillars.month;
    var todayDay = today.calculation.pillars.day;
    var display = today.calculation.calendar_display || {};

    var god = tenGod(day.stem, todayDay.stem);
    var selectedId = pickId();
    var activeItem = window.MingliProfile
      ? window.MingliProfile.list().filter(function (entry) { return entry.id === selectedId; })[0]
      : null;
    var name = activeItem ? activeItem.name : (window.MingliProfile && window.MingliProfile.currentName());

    document.getElementById("today-date").textContent = dayLabel(selectedDate, display.solar);
    document.getElementById("today-gz").textContent = todayDay.ganzhi + " 日";
    document.getElementById("today-sub").textContent = [fmtSolar(display.solar), fmtLunar(display.lunar), todayYear.ganzhi + "年", todayMonth.ganzhi + "月"].filter(Boolean).join(" · ");

    document.getElementById("relation-lead").textContent = (GOD_COPY[god] || "今天的十神与你的日主没有特别的关系。") +
      " 这是按流日天干与日主推出来的传统说法，只作观察角度。";
    document.getElementById("day-master").textContent = day.stem + " " + ELEMENT[day.stem];
    document.getElementById("today-god").textContent = god;

    var relations = [];
    var withDay = branchRelation(todayDay.branch, day.branch);
    var withMonth = branchRelation(todayDay.branch, user.calculation.pillars.month.branch);
    var withYear = branchRelation(todayDay.branch, user.calculation.pillars.year.branch);
    if (withDay) relations.push(["流日与日支", withDay, todayDay.branch + " 对 " + day.branch]);
    if (withMonth) relations.push(["流日与月支", withMonth, todayDay.branch + " 对 " + user.calculation.pillars.month.branch]);
    if (withYear) relations.push(["流日与年支", withYear, todayDay.branch + " 对 " + user.calculation.pillars.year.branch]);
    if (!relations.length) relations.push(["流日与四柱", "无合冲刑害", "今天的地支与你的四柱没有直接互动"]);

    document.getElementById("relations").innerHTML = relations.map(function (row) {
      return "<li><b>" + esc(row[0]) + '</b><span class="meta">' + esc(row[1]) + " · " + esc(row[2]) + "</span></li>";
    }).join("");

    // 大运与流月
    // 流月要看「今年」的月份表，所以用今天这份结果里的 monthly_facts
    var luck = monthOfYear(today, selectedDate);
    var cycles = (user.calculation.luck_cycles && user.calculation.luck_cycles.cycles) || [];
    var birthYear = Number(String(user.calculation.calendar_display.solar).slice(0, 4));
    var age = Number(selectedDate.slice(0, 4)) - birthYear + 1;
    var current = cycles.filter(function (cycle) {
      var nums = String(cycle.age_range || "").match(/\d+/g);
      return nums && nums.length >= 2 && age >= Number(nums[0]) && age <= Number(nums[1]);
    })[0];
    var luckGod = current ? tenGod(day.stem, current.ganzhi.charAt(0)) : "";

    var context = [
      ["当前大运", current ? current.ganzhi + "（" + current.age_range + "）" : "—", current ? "大运十神 " + luckGod : ""],
      ["当前流月", luck ? luck.ganzhi + "（" + luck.jie + "起）" : "—", luck ? "流月十神 " + tenGod(day.stem, luck.ganzhi.charAt(0)) : ""],
      ["虚岁", String(age), "按公历年计算"]
    ];
    document.getElementById("context").innerHTML = context.map(function (row) {
      return "<li><b>" + esc(row[0]) + '</b><span class="meta">' + esc(row[1]) + (row[2] ? " · " + esc(row[2]) : "") + "</span></li>";
    }).join("");

    var tips = [
      GOD_COPY[god] ? "今天的主线是「" + god + "」：先按这个方向安排一两件事，不用排满。" : "今天没有特别突出的十神，照常安排就好。",
      withDay ? "地支出现「" + withDay + "」，容易在熟悉的人或事上被触发，说话前先停一下。" : "地支没有合冲，节奏相对平。",
      luckGod ? "当前大运十神是「" + luckGod + "」，今天的感受会被这十年的基调放大或削弱。" : "",
      "这一页只给观察角度，不作具体事件预测，也不替代任何现实判断。"
    ].filter(Boolean);
    document.getElementById("tips").innerHTML = tips.map(function (tip) {
      return "<li>" + esc(tip) + "</li>";
    }).join("");
  }

  if (whoSelect) {
    whoSelect.addEventListener("change", function () {
      setTempId(whoSelect.value);
      location.reload();
    });
  }
  if (whoDefault) {
    whoDefault.addEventListener("click", function () {
      var id = pickId();
      if (window.MingliProfile && id) window.MingliProfile.setDefault(id);
      renderWhoBar();
    });
  }
  renderWhoBar();

  if (aiButton) {
    aiButton.addEventListener("click", async function () {
      if (!lastToday || !aiResult) return;
      aiButton.disabled = true;
      aiButton.textContent = "正在生成…";
      aiResult.innerHTML = '<p class="ai-audit">正在生成，通常需要 20–40 秒…</p>';
      try {
        var calc = await fetch(mingliApiBase() + "/api/v1/bazi/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(readProfile())
        }).then(function (r) { return r.json(); });
        var contract = await window.MingliAiContract.build({ bazi: calc });
        var day = lastToday.calculation.pillars.day;
        var response = await fetch(mingliApiBase() + "/api/v1/moment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contract: contract,
            kind: "day",
            anchor: { ganzhi: day.ganzhi, label: (lastToday.calculation.calendar_display || {}).solar || "" },
            name: (window.MingliProfile && window.MingliProfile.active() ? window.MingliProfile.active().name : ""),
            consent: true,
            consentVersion: "2026-10"
          })
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error((data.error && data.error.message) || ("HTTP " + response.status));
        lastAiDay = data.output || null;
        window.MingliAi.renderOutput(aiResult, data.output);
        if (saveButton) { saveButton.hidden = false; saveButton.disabled = false; saveButton.textContent = "存长图"; }
        if (saveNote) { saveNote.hidden = true; }
        try {
          var dayRecord = window.MingliMomentImage.fromDay(lastUser, lastToday, lastAiDay, {});
          var savedDay = window.MingliAi && window.MingliAi.saveReport
            ? window.MingliAi.saveReport({
                schema: "mingli.report.v1", title: dayRecord.title, system: "流日", systemLabel: "流日",
                sections: dayRecord.sections, limitations: [window.MingliMomentImage.DISCLAIMER || ""],
                summary: {}, audit: null
              })
            : null;
          if (reportLink && savedDay) reportLink.href = "report.html?id=" + encodeURIComponent(savedDay.id);
        } catch (e) { /* 忽略 */ }
        if (reportLink) reportLink.hidden = false;
      } catch (err) {
        window.MingliAi.renderError(aiResult, "生成失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.textContent = "生成这天的解读";
        aiButton.disabled = false;
      }
    });
  }


  if (saveButton && window.MingliMomentImage) {
    saveButton.addEventListener("click", async function () {
      if (!lastAiDay) {
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = "先让 AI 讲完这一天，长图里才有解读可以存。"; }
        saveButton.textContent = "存长图";
        setTimeout(function () { saveButton.textContent = "存长图"; }, 1800);
        return;
      }
      var keep = saveButton.textContent;
      saveButton.disabled = true;
      saveButton.textContent = "正在出图…";
      try {
        var pickText = function (selector) {
          return Array.prototype.map.call(document.querySelectorAll(selector), function (node) {
            return String(node.textContent || "").replace(/\s+/g, " ").trim();
          }).filter(Boolean);
        };
        var extra = {
          god: (document.getElementById("today-god") || {}).textContent || "",
          lead: (document.getElementById("relation-lead") || {}).textContent || "",
          relations: pickText("#relations li"),
          context: pickText("#context li")
        };
        var result = await window.MingliMomentImage.save(window.MingliMomentImage.fromDay(lastUser, lastToday, lastAiDay, extra));
        saveButton.textContent = result && result.ok ? "已保存" : "导出失败";
        if (saveNote) { saveNote.hidden = false; saveNote.textContent = result && result.ok ? "已存成 PNG，在浏览器的下载目录（一般叫「下载」或 Downloads）里。" : "出图失败，可以再点一次。"; }
        if (result && !result.ok && result.reason) console.warn(result.reason);
      } catch (err) {
        saveButton.textContent = "导出失败";
        console.warn(err);
      } finally {
        setTimeout(function () { saveButton.textContent = "存长图"; saveButton.disabled = !lastAiDay; }, 1800);
      }
    });
  }

  // 日期的前后切换与自绘的日期选择面板
  (function () {
    var prevLink = document.getElementById("prev-day");
    var nextLink = document.getElementById("next-day");
    var label = document.getElementById("day-label");
    var open = document.getElementById("day-open");
    var sheet = document.getElementById("day-sheet");
    var closeBtn = document.getElementById("day-sheet-close");
    var todayBtn = document.getElementById("day-sheet-today");
    var goBtn = document.getElementById("day-sheet-go");
    var yearSel = document.getElementById("pick-year");
    var monthSel = document.getElementById("pick-month");
    var daySel = document.getElementById("pick-day");

    if (prevLink) prevLink.href = "today.html?d=" + shiftDate(selectedDate, -1);
    if (nextLink) nextLink.href = "today.html?d=" + shiftDate(selectedDate, 1);
    if (label) label.textContent = dayLabel(selectedDate, selectedDate);
    if (!open || !sheet || !yearSel || !monthSel || !daySel) return;

    function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
    function fillYears() {
      if (yearSel.options.length) return;
      for (var y = 1900; y <= 2100; y++) yearSel.add(new Option(String(y), String(y)));
    }
    function fillMonths() {
      if (monthSel.options.length) return;
      for (var m = 1; m <= 12; m++) monthSel.add(new Option(m + " 月", String(m)));
    }
    function fillDays() {
      var y = Number(yearSel.value) || 2000;
      var m = Number(monthSel.value) || 1;
      var keep = Number(daySel.value) || 1;
      var total = daysIn(y, m);
      daySel.innerHTML = "";
      for (var d = 1; d <= total; d++) daySel.add(new Option(d + " 日", String(d)));
      daySel.value = String(Math.min(keep, total));
    }
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function current() {
      return yearSel.value + "-" + pad(Number(monthSel.value)) + "-" + pad(Number(daySel.value));
    }
    function sync(dateText) {
      var parts = String(dateText || "").split("-");
      fillYears();
      fillMonths();
      yearSel.value = parts[0] || String(new Date().getFullYear());
      monthSel.value = String(Number(parts[1] || 1));
      fillDays();
      daySel.value = String(Math.min(Number(parts[2] || 1), daysIn(Number(yearSel.value), Number(monthSel.value))));
    }
    function hide() {
      sheet.hidden = true;
      document.body.style.overflow = "";
    }
    function go(dateText) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return;
      location.href = "today.html?d=" + dateText;
    }

    open.addEventListener("click", function () {
      sync(selectedDate);
      sheet.hidden = false;
      document.body.style.overflow = "hidden";
      try { yearSel.focus(); } catch (e) {}
    });
    yearSel.addEventListener("change", fillDays);
    monthSel.addEventListener("change", fillDays);
    if (closeBtn) closeBtn.addEventListener("click", hide);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) hide(); });
    if (todayBtn) todayBtn.addEventListener("click", function () { go(isoToday()); });
    if (goBtn) goBtn.addEventListener("click", function () { go(current()); });
  })();

  var profile = readProfile();
  if (!profile || !profile.profile) {
    empty.hidden = false;
  } else {
    content.hidden = false;
    Promise.all([
      post(profile),
      post(todayPayload(selectedDate))
    ]).then(function (results) {
      var user = results[0];
      var today = results[1];
      if (user.status !== "ok" || today.status !== "ok") throw new Error("排盘失败");
      lastToday = today;
      if (saveButton) { saveButton.hidden = true; saveButton.disabled = true; saveButton.textContent = "存长图"; }
      render(user, today);
    }).catch(function (err) {
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) +
        "。排盘服务没有响应，请稍后点「重试」。";
      errorBox.hidden = false;
      content.hidden = true;
    });
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

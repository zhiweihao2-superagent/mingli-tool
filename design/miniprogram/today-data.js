// 今日与我：把今天的干支和「你的日主 / 当前大运」放到一起，看今天落在什么坐标上。
// 十神与地支关系用固定表格推，不下事件结论。
(function () {
  "use strict";

  var API = "http://127.0.0.1:8765/api/v1/bazi/calculate";
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
  var aiResult = document.getElementById("today-result");
  var lastToday = null;

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

  function todayPayload() {
    var now = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return {
      schema_version: "1.0",
      profile: {
        calendar: "solar",
        date: now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()),
        is_leap_month: false,
        time: { precision: "unknown" },
        timezone: "Asia/Shanghai",
        sex_for_calculation: "male",
        birthplace: { label: null, longitude: null }
      },
      rules: { profile_id: "engine-default-v1", true_solar_time: false, clock_time_is_dst: false },
      options: { save_history: false, annual_cycles_through: now.getFullYear() }
    };
  }

  function monthOfYear(chart) {
    var months = (chart.monthly_facts && chart.monthly_facts.months) || [];
    if (!months.length) return null;
    var now = Date.now();
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

    document.getElementById("today-date").textContent = [fmtSolar(display.solar), fmtLunar(display.lunar)].filter(Boolean).join(" · ");
    document.getElementById("today-gz").textContent = todayDay.ganzhi + " 日";
    document.getElementById("today-sub").textContent = [
      name ? "与「" + name + "」的盘对照" : "",
      todayYear.ganzhi + "年",
      todayMonth.ganzhi + "月"
    ].filter(Boolean).join(" · ");

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
    var luck = monthOfYear(today);
    var cycles = (user.calculation.luck_cycles && user.calculation.luck_cycles.cycles) || [];
    var birthYear = Number(String(user.calculation.calendar_display.solar).slice(0, 4));
    var age = new Date().getFullYear() - birthYear + 1;
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
        var calc = await fetch("http://127.0.0.1:8765/api/v1/bazi/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(readProfile())
        }).then(function (r) { return r.json(); });
        var contract = await window.MingliAiContract.build({ bazi: calc });
        var day = lastToday.calculation.pillars.day;
        var response = await fetch("http://127.0.0.1:8765/api/v1/moment", {
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
        window.MingliAi.renderOutput(aiResult, data.output);
      } catch (err) {
        window.MingliAi.renderError(aiResult, "生成失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.textContent = "生成这天的解读";
        aiButton.disabled = false;
      }
    });
  }

  var profile = readProfile();
  if (!profile || !profile.profile) {
    empty.hidden = false;
  } else {
    content.hidden = false;
    Promise.all([
      post(profile),
      post(todayPayload())
    ]).then(function (results) {
      var user = results[0];
      var today = results[1];
      if (user.status !== "ok" || today.status !== "ok") throw new Error("排盘失败");
      lastToday = today;
      render(user, today);
    }).catch(function (err) {
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) +
        "。请确认本机服务在 127.0.0.1:8765 运行。";
      errorBox.hidden = false;
      content.hidden = true;
    });
  }
})();

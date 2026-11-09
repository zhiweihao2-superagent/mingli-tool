// 出生信息页交互：历法切换、年月日自动跳项、三段式时间精度、时辰选择、真太阳时。
// 只用原生 DOM；真正的排盘交给本机服务，这里只负责收集与校验输入。
(function () {
  "use strict";

  var y = document.getElementById("y");
  var m = document.getElementById("m");
  var d = document.getElementById("d");
  var timeInput = document.getElementById("time");
  var readout = document.getElementById("readout");
  var branchReadout = document.getElementById("branch-readout");
  var blockMinute = document.getElementById("block-minute");
  var blockBranch = document.getElementById("block-branch");
  var blockUnknown = document.getElementById("block-unknown");
  var timeHint = document.getElementById("time-hint");
  var pMinute = document.getElementById("p-minute");
  var pBranch = document.getElementById("p-branch");
  var pUnknown = document.getElementById("p-unknown");
  var tabSolar = document.getElementById("tab-solar");
  var tabLunar = document.getElementById("tab-lunar");
  var calendarLabel = document.getElementById("calendar-label");
  var dateHint = document.getElementById("date-hint");
  var leapRow = document.getElementById("leap-row");
  var solarReadout = document.getElementById("solar-readout");
  var solarDate = document.getElementById("solar-date");
  var leapHint = document.getElementById("leap-hint");
  var leapNo = document.getElementById("leap-no");
  var leapYes = document.getElementById("leap-yes");
  var city = document.getElementById("city");
  var lng = document.getElementById("lng");
  var placeStatus = document.getElementById("place-status");
  var lngField = document.getElementById("lng-field");
  var chips = Array.prototype.slice.call(document.querySelectorAll("#block-branch .chip"));
  var sexButtons = Array.prototype.slice.call(document.querySelectorAll(".seg2 button"));
  var startBtn = document.getElementById("start");
  var whoInput = document.getElementById("who");
  var editingId = null;

  var BRANCHES = [
    { name: "子", from: 23, to: 1 },
    { name: "丑", from: 1, to: 3 },
    { name: "寅", from: 3, to: 5 },
    { name: "卯", from: 5, to: 7 },
    { name: "辰", from: 7, to: 9 },
    { name: "巳", from: 9, to: 11 },
    { name: "午", from: 11, to: 13 },
    { name: "未", from: 13, to: 15 },
    { name: "申", from: 15, to: 17 },
    { name: "酉", from: 17, to: 19 },
    { name: "戌", from: 19, to: 21 },
    { name: "亥", from: 21, to: 23 }
  ];

  var state = { calendar: "solar", precision: "minute", branch: "午", sex: "male" };

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function rangeOf(branch) {
    var found = BRANCHES.filter(function (item) { return item.name === branch; })[0];
    if (!found) return "";
    var from = pad(found.from) + ":00";
    var to = pad((found.to === 1 ? 0 : found.to - 1)) + (found.to === 1 ? ":59" : ":59");
    return from + "–" + to;
  }

  function branchOfHour(hour) {
    // 23 点与 0 点都算子时
    var h = hour % 24;
    if (h === 23 || h === 0) return "子";
    return BRANCHES.filter(function (item) {
      var to = item.to === 1 ? 25 : item.to;
      return h >= item.from && h < to;
    })[0].name;
  }

  // 农历闰月表（1900–2100，由本机排盘引擎逐月反推得出；只列有闰月的年份）
  var LUNAR_LEAP = {"1900":8,"1903":6,"1906":4,"1909":2,"1911":6,"1914":5,"1917":3,"1919":8,"1922":6,"1925":4,"1928":2,"1930":7,"1933":5,"1936":3,"1938":8,"1941":6,"1944":4,"1947":3,"1949":7,"1952":5,"1955":4,"1957":8,"1960":6,"1963":4,"1966":3,"1968":7,"1971":5,"1974":4,"1976":8,"1979":6,"1982":4,"1985":3,"1987":7,"1990":5,"1993":4,"1995":9,"1998":6,"2001":5,"2004":2,"2006":7,"2009":5,"2012":4,"2015":1,"2017":6,"2020":5,"2023":2,"2025":7,"2028":5,"2031":4,"2034":1,"2036":6,"2039":5,"2042":3,"2044":7,"2047":6,"2050":4,"2052":8,"2055":6,"2058":4,"2061":3,"2063":7,"2066":5,"2069":4,"2071":8,"2074":6,"2077":4,"2080":3,"2082":7,"2085":5,"2088":4,"2090":9,"2093":6,"2096":5,"2099":3};
  var NUM_CN = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  state.leap = false;

  function monthName(month) {
    var n = Number(month);
    return n >= 1 && n <= 12 ? NUM_CN[n - 1] + "月" : "这个月";
  }

  // 只有「该年确有闰月」且「填的正是那个月」时才让对方二选一，其余情况不出现。
  function updateLeap() {
    if (state.calendar !== "lunar") { leapRow.hidden = true; return; }
    var year = Number(y.value);
    var month = Number(m.value);
    var leapMonth = LUNAR_LEAP[year] || 0;
    if (!leapMonth || month !== leapMonth) {
      leapRow.hidden = true;
      state.leap = false;
      return;
    }
    leapRow.hidden = false;
    var name = monthName(leapMonth);
    leapHint.textContent = year + " 年有闰" + name + "（这年有两个" + name + "）。记得公历生日就切回公历填，最稳；只记得农历，就按家里记的日期选，落在后一个" + name + "就选右边。";
    leapNo.textContent = name;
    leapYes.textContent = "闰" + name;
    leapNo.setAttribute("aria-pressed", String(!state.leap));
    leapYes.setAttribute("aria-pressed", String(state.leap));
    updateSolarReadout();
  }

  if (leapNo) leapNo.addEventListener("click", function () {
    state.leap = false;
    updateLeap();
  });
  if (leapYes) leapYes.addEventListener("click", function () {
    state.leap = true;
    updateLeap();
  });

  // ── 农历填完给出「对应公历」，让用户自己核对有没有选错闰月 ──
  function updateSolarReadout() {
    if (!solarReadout) return;
    if (state.calendar !== "lunar" || !window.MingliLunar) {
      solarReadout.hidden = true;
      return;
    }
    var year = Number(y.value);
    var month = Number(m.value);
    var day = Number(d.value);
    if (!(year >= 1900 && year <= 2100) || !month || !day) {
      solarReadout.hidden = true;
      return;
    }
    var result = window.MingliLunar.toSolar(year, month, day, state.leap);
    solarReadout.hidden = false;
    if (result.ok) {
      solarReadout.className = "solar-readout";
      solarDate.textContent = result.text;
    } else {
      solarReadout.className = "solar-readout bad";
      solarDate.textContent = result.reason;
    }
  }

  // ── 三段式精度 ───────────────────────────────────────
  function setPrecision(mode) {
    state.precision = mode;
    pMinute.setAttribute("aria-pressed", String(mode === "minute"));
    pBranch.setAttribute("aria-pressed", String(mode === "branch"));
    pUnknown.setAttribute("aria-pressed", String(mode === "unknown"));
    blockMinute.hidden = mode !== "minute";
    blockBranch.hidden = mode !== "branch";
    blockUnknown.hidden = mode !== "unknown";
    if (mode === "unknown") {
      timeHint.textContent = "已按时柱未知处理：八字照常出四柱，紫微需要补充时辰。";
      timeHint.className = "hint warn";
    } else if (mode === "branch") {
      timeHint.textContent = "按时辰排：只精确到两小时一段，时柱取该时辰。";
      timeHint.className = "hint";
    } else {
      timeHint.textContent = "不记得几点几分就用「只知时辰」；完全不确定就选「不知道」。";
      timeHint.className = "hint";
    }
    validate();
  }

  pMinute.addEventListener("click", function () { setPrecision("minute"); });
  pBranch.addEventListener("click", function () { setPrecision("branch"); });
  pUnknown.addEventListener("click", function () { setPrecision("unknown"); });

  // ── 精确时间：原生时间控件，下面同步显示时辰段 ────────
  function syncReadout() {
    var value = timeInput.value || "12:30";
    var hour = Number(value.split(":")[0]);
    var branch = branchOfHour(hour);
    state.branch = branch;
    if (readout) readout.innerHTML = "<b>" + branch + "时</b><span>" + rangeOf(branch) + "</span>";
    if (branchReadout) branchReadout.innerHTML = "<b>" + branch + "时</b><span>" + rangeOf(branch) + "</span>";
  }
  timeInput.addEventListener("input", syncReadout);
  timeInput.addEventListener("change", syncReadout);

  // ── 时辰 chips ───────────────────────────────────────
  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chips.forEach(function (other) { other.setAttribute("aria-pressed", "false"); });
      chip.setAttribute("aria-pressed", "true");
      state.branch = chip.getAttribute("data-branch");
      var hour = Number(chip.getAttribute("data-hour"));
      timeInput.value = pad(hour) + ":00";
      syncReadout();
    });
  });

  // ── 开关：整行都能点（含文字与开关本体）─────────────
  function bindSwitch(row, onChange) {
    if (!row) return;
    var knob = row.querySelector(".switch");
    row.addEventListener("click", function (event) {
      event.preventDefault();
      var on = knob.getAttribute("aria-checked") !== "true";
      knob.setAttribute("aria-checked", String(on));
      if (onChange) onChange(on);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); row.click(); }
    });
    row.setAttribute("tabindex", "0");
  }

  bindSwitch(leapRow, null);

  // ── 出生地：填了城市就等于打开真太阳时校正 ─────────
  var CITY_LNG = {
    "北京": 116.41, "上海": 121.47, "广州": 113.26, "深圳": 114.06, "杭州": 120.15,
    "南京": 118.80, "苏州": 120.59, "成都": 104.07, "重庆": 106.55, "武汉": 114.30,
    "西安": 108.94, "天津": 117.20, "郑州": 113.62, "长沙": 112.94, "青岛": 120.38,
    "沈阳": 123.43, "哈尔滨": 126.53, "昆明": 102.71, "福州": 119.30, "厦门": 118.09,
    "乌鲁木齐": 87.62, "兰州": 103.83, "海口": 110.20, "合肥": 117.23, "南昌": 115.86,
    "太原": 112.55, "石家庄": 114.51, "贵阳": 106.63, "南宁": 108.37, "台北": 121.52,
    "香港": 114.17, "澳门": 113.55
  };

  function lookupLongitude(name) {
    var text = String(name || "").trim();
    if (!text) return null;
    var exact = CITY_LNG[text];
    if (exact) return exact;
    var keys = Object.keys(CITY_LNG);
    for (var i = 0; i < keys.length; i += 1) {
      if (text.indexOf(keys[i]) >= 0) return CITY_LNG[keys[i]];
    }
    return null;
  }

  function updatePlace() {
    var name = city.value.trim();
    var found = lookupLongitude(name);
    if (!name) {
      lngField.hidden = true;
      lng.value = "";
      placeStatus.textContent = "留空即可。只有出生时间贴着时辰交界（比如 10:58、12:59）时，出生地才会改变时柱。";
      placeStatus.className = "hint";
      return;
    }
    lngField.hidden = false;
    if (found && !lng.value.trim()) lng.value = found.toFixed(2);
    var degree = Number(lng.value);
    if (degree > 0 && degree < 180) {
      placeStatus.textContent = "已按真太阳时校正 · 东经 " + lng.value + "（" + name + "）";
      placeStatus.className = "hint";
    } else {
      placeStatus.textContent = "没有这个城市的经度，补一个东经度数就能校正；不补则按北京时间排。";
      placeStatus.className = "hint warn";
    }
  }

  city.addEventListener("input", updatePlace);
  lng.addEventListener("input", function () {
    lng.value = lng.value.replace(/[^\d.]/g, "");
    updatePlace();
  });

  // ── 历法切换 ─────────────────────────────────────────
  function setCalendar(kind) {
    state.calendar = kind;
    var lunar = kind === "lunar";
    tabSolar.setAttribute("aria-selected", String(!lunar));
    tabLunar.setAttribute("aria-selected", String(lunar));
    calendarLabel.textContent = lunar ? "农历" : "公历";
    if (!lunar) { leapRow.hidden = true; state.leap = false; } else { updateLeap(); }
    updateSolarReadout();
    dateHint.textContent = lunar
      ? "按农历填（例如 1990 年四月廿一 填 1990 / 04 / 21）；这一年有闰月时会自动问你一次。"
      : "按公历填，年月日填满会自动跳到下一项。";
  }
  tabSolar.addEventListener("click", function () { setCalendar("solar"); });
  tabLunar.addEventListener("click", function () { setCalendar("lunar"); });

  // ── 年月日：自动跳项、退格回退、粘贴八位 ─────────────
  function isFilled(input) { return input.value.trim().length >= Number(input.maxLength); }
  function focusNext(input) {
    if (input === y) m.focus();
    else if (input === m) d.focus();
  }
  function focusPrev(input) {
    if (input === d) m.focus();
    else if (input === m) y.focus();
  }

  [y, m, d].forEach(function (input) {
    input.addEventListener("input", function () {
      input.value = input.value.replace(/[^\d]/g, "");
      if (isFilled(input)) focusNext(input);
      updateLeap();
      updateSolarReadout();
      validate();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Backspace" && input.value.length === 0) focusPrev(input);
    });
    input.addEventListener("paste", function (event) {
      var raw = (event.clipboardData || window.clipboardData);
      var text = (raw ? raw.getData("text") : "").replace(/[^\d]/g, "");
      if (text.length < 6) return;
      event.preventDefault();
      y.value = text.slice(0, 4);
      m.value = text.slice(4, 6);
      if (text.length >= 8) d.value = text.slice(6, 8);
      (text.length >= 8 ? d : m).focus();
      validate();
    });
  });

  // ── 性别 ─────────────────────────────────────────────
  sexButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      sexButtons.forEach(function (other) { other.setAttribute("aria-pressed", "false"); });
      button.setAttribute("aria-pressed", "true");
      state.sex = button.textContent.trim() === "女" ? "female" : "male";
    });
  });

  // ── 必填校验：年月日齐了才能开始 ─────────────────────
  function validate() {
    var ok = y.value.length === 4 && m.value.length >= 1 && d.value.length >= 1;
    startBtn.setAttribute("aria-disabled", String(!ok));
    startBtn.style.pointerEvents = ok ? "" : "none";
  }

  // ── 开始排盘：把这次填的资料留给结果页 ───────────────
  function buildPayload() {
    var year = y.value.trim();
    var month = pad(Number(m.value));
    var day = pad(Number(d.value));
    var time;
    if (state.precision === "unknown") {
      time = { precision: "unknown" };
    } else if (state.precision === "branch") {
      time = { precision: "branch", branch: state.branch };
    } else {
      time = { precision: "minute", value: timeInput.value || "12:30" };
    }
    var cityText = city.value.trim();
    var degree = Number(lng.value);
    var hasDegree = degree > 0 && degree < 180;
    return {
      schema_version: "1.0",
      profile: {
        calendar: state.calendar,
        date: year + "-" + month + "-" + day,
        is_leap_month: state.calendar === "lunar" ? Boolean(state.leap) : false,
        time: time,
        timezone: "Asia/Shanghai",
        sex_for_calculation: state.sex,
        birthplace: {
          label: cityText || null,
          longitude: hasDegree ? degree : null
        }
      },
      rules: { profile_id: "engine-default-v1", true_solar_time: hasDegree, clock_time_is_dst: false },
      options: { save_history: false, annual_cycles_through: new Date().getFullYear() + 5 }
    };
  }

  startBtn.addEventListener("click", function (event) {
    if (startBtn.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }
    var payload = buildPayload();
    var saved = null;
    try {
      if (window.MingliProfile) {
        saved = window.MingliProfile.save({
          id: editingId,
          name: whoInput ? whoInput.value : "",
          profile: payload
        });
      } else {
        localStorage.setItem("mingli.profile.v1", JSON.stringify(payload));
      }
    } catch (e) {
      /* 存储不可用时照样跳转，结果页会提示先填资料 */
    }
    if (saved) {
      editingId = saved.id;
      if (whoInput && !whoInput.value.trim()) whoInput.value = saved.name;
    }
  });

  // 打开时把「当前档案」填回表单，等于在编辑这个人
  (function preload() {
    if (!window.MingliProfile) return;
    var isNew = false;
    try { isNew = new URLSearchParams(location.search).get("new") === "1"; } catch (e) { isNew = false; }
    if (isNew) {
      editingId = null;
      if (whoInput) whoInput.value = "";
      y.value = ""; m.value = ""; d.value = "";
      document.getElementById("city").value = "";
      validate();
      return;
    }
    var item = window.MingliProfile.active();
    if (!item || !item.profile) return;
    editingId = item.id;
    if (whoInput) whoInput.value = item.name || "";
    var p = item.profile.profile || {};
    var bits = String(p.date || "").split("-");
    if (bits.length === 3) {
      y.value = bits[0];
      m.value = bits[1];
      d.value = bits[2];
    }
    setCalendar(p.calendar === "lunar" ? "lunar" : "solar");
    if (p.is_leap_month) {
      state.leap = true;
      updateLeap();
    }
    var time = p.time || {};
    if (time.precision === "unknown") setPrecision("unknown");
    else if (time.precision === "branch") {
      state.branch = time.branch || "午";
      chips.forEach(function (chip) {
        chip.setAttribute("aria-pressed", String(chip.getAttribute("data-branch") === state.branch));
      });
      setPrecision("branch");
    } else if (time.value) {
      timeInput.value = time.value;
      syncReadout();
      setPrecision("minute");
    }
    if (p.sex_for_calculation === "female") {
      sexButtons.forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.textContent.trim() === "女"));
      });
      state.sex = "female";
    }
    if (p.birthplace && p.birthplace.label && city) {
      city.value = p.birthplace.label;
      updatePlace();
    }
    if (p.birthplace && p.birthplace.longitude != null && lng) {
      lng.value = String(p.birthplace.longitude);
      updatePlace();
    }
    updateSolarReadout();
    validate();
  })();

  setCalendar("solar");
  setPrecision("minute");
  syncReadout();
  updatePlace();
  updateLeap();
  updateSolarReadout();
  validate();
})();

// 首页：把「今天」按真实日期算出来（干支、农历、节气），并标清「和谁的盘对照」。
// 服务没开时保留页面上的静态兜底文案，不报错。
(function () {
  "use strict";

  var API = "http://127.0.0.1:8765/api/v1/bazi/calculate";

  function pad(n) { return String(n).padStart(2, "0"); }

  function todayPayload() {
    var now = new Date();
    return {
      schema_version: "1.0",
      profile: {
        calendar: "solar",
        date: now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()),
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

  function escapeHtml(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // 引擎给的是 ISO 与「2026年九月三十」，这里换成读者顺眼的写法
  function fmtSolar(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number(m[2]) + " 月 " + Number(m[3]) + " 日 周" + "日一二三四五六".charAt(date.getDay());
  }

  function fmtLunar(text) {
    return String(text || "").replace(/^\d{4}年/, "");
  }

  function fillDates(display) {
    var solar = document.querySelector(".datepair div:first-child b");
    var lunar = document.querySelector(".datepair div:last-child b");
    if (solar && display.solar) solar.textContent = fmtSolar(display.solar);
    if (lunar && display.lunar) lunar.textContent = fmtLunar(display.lunar);
  }

  function fillHero(calc) {
    var day = calc.pillars.day;
    var title = document.querySelector(".hero-title");
    if (title && day) {
      var elements = (day.stem_element || "") + (day.branch_element || "");
      title.innerHTML = escapeHtml(day.ganzhi) + "日" + (elements ? "<small>" + escapeHtml(elements) + "</small>" : "");
    }
    var meta = document.querySelector(".hero-body .meta");
    if (meta) {
      var bits = [];
      if (calc.pillars.year) bits.push(calc.pillars.year.ganzhi + "年");
      if (calc.pillars.month) bits.push(calc.pillars.month.ganzhi + "月");
      var term = (calc.derived && calc.derived.solar_term_month_boundary) || "";
      if (term) bits.push(term + "当天");
      meta.textContent = bits.join(" · ");
    }
  }

  // 说清这一页到底是「和谁」对照
  function fillWhom() {
    var eyebrow = document.querySelector(".hero-body .eyebrow");
    var button = document.querySelector(".hero-btn");
    var item = window.MingliProfile && window.MingliProfile.active();
    if (item && item.profile && item.profile.profile) {
      if (eyebrow) eyebrow.textContent = "今日流日 · 默认档案「" + item.name + "」";
      if (button) button.innerHTML = "看今日流日" +
        '<svg class="ico"><use href="#i-arrow"/></svg>';
    } else {
      if (eyebrow) eyebrow.textContent = "今日流日";
      if (button) button.innerHTML = "看今日流日" +
        '<svg class="ico"><use href="#i-arrow"/></svg>';
    }
  }

  fillWhom();

  fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(todayPayload())
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }).then(function (data) {
    if (data.status !== "ok") return;
    fillDates(data.calculation.calendar_display || {});
    fillHero(data.calculation);
  }).catch(function () {
    /* 服务没开：保留静态兜底，不影响首页浏览 */
  });
})();

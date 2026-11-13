// 首页：把「今天」按真实日期算出来（干支、农历、节气），并标清「和谁的盘对照」。
// 服务没开时留破折号并说明原因——不再用静态日期兜底（那种「11 月 8 日」看着像真数据，其实是死值）。
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
    var solar = document.getElementById("today-solar");
    var lunar = document.getElementById("today-lunar");
    if (solar && display.solar) solar.textContent = fmtSolar(display.solar);
    if (lunar && display.lunar) lunar.textContent = fmtLunar(display.lunar);
  }

  // 月令：这个月是从哪个节开始的（如「立冬」）。是月令名，不是「今天交节」，
  // 所以只作为小标签，不写进「当天」这种措辞里。
  function fillTerm(calc) {
    var term = document.getElementById("today-term");
    if (!term) return;
    var name = (calc.derived && calc.derived.solar_term_month_boundary) || "";
    if (name) {
      term.textContent = name + "后";
      term.hidden = false;
    } else {
      term.hidden = true;
    }
  }

  function fillHero(calc) {
    var day = calc.pillars.day;
    var title = document.getElementById("today-hero");
    if (title && day) {
      var elements = (day.stem_element || "") + (day.branch_element || "");
      title.innerHTML = escapeHtml(day.ganzhi) + "日" + (elements ? "<small>" + escapeHtml(elements) + "</small>" : "");
    }
    var meta = document.getElementById("today-meta");
    if (meta) {
      var bits = [];
      if (calc.pillars.year) bits.push(calc.pillars.year.ganzhi + "年");
      if (calc.pillars.month) bits.push(calc.pillars.month.ganzhi + "月");
      var term = (calc.derived && calc.derived.solar_term_month_boundary) || "";
      if (term) bits.push(term + "后");
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

  // 页面上的日期从「—」开始：只有真的算出来才写，算不出来就留破折号，
  // 不给一个看起来像真日期的假数字（11 月 8 日 周日 那种）。
  function showUnavailable() {
    var solar = document.getElementById("today-solar");
    var lunar = document.getElementById("today-lunar");
    var hero = document.getElementById("today-hero");
    var meta = document.getElementById("today-meta");
    if (solar) solar.textContent = "—";
    if (lunar) lunar.textContent = "—";
    if (hero) hero.textContent = "—";
    if (meta) meta.textContent = "没能连上排盘服务，今天的干支暂时算不出来。";
  }

  fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(todayPayload())
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }).then(function (data) {
    if (data.status !== "ok") {
      showUnavailable();
      return;
    }
    fillDates(data.calculation.calendar_display || {});
    fillTerm(data.calculation);
    fillHero(data.calculation);
  }).catch(showUnavailable);
})();

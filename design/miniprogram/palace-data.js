// 宫位详情：按 ?name=命宫 这类参数，从同一份出生资料重排命盘，展开这一宫。
(function () {
  "use strict";

  var STORE = "mingli.profile.v1";
  var empty = document.getElementById("empty");
  var content = document.getElementById("content");

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

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

  function wantedName() {
    var name = "命宫";
    try {
      var value = new URLSearchParams(location.search).get("name");
      if (value) name = value;
    } catch (e) { /* 用默认 */ }
    return name.indexOf("宫") >= 0 ? name : name + "宫";
  }

  function starRow(star) {
    var bits = [];
    if (star.brightness) bits.push(star.brightness);
    if (star.transformation) bits.push('<span class="hua">' + esc(star.transformation) + "</span>");
    return "<li><b data-term=\"" + esc(star.name) + "\">" + esc(star.name) +
      "</b><span class=\"meta\">" + bits.join(" · ") + "</span></li>";
  }

  if (window.MingliGlossary) window.MingliGlossary.bind(content);

  var profile = loadProfile();
  if (!profile || !profile.profile) {
    empty.hidden = false;
  } else {
    content.hidden = false;
    try {
      var birth = profile.profile;
      var time = birth.time || {};
      var now = new Date();
      var today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var chart = window.MingliZiwei.calculate({
        calendar: birth.calendar,
        date: birth.date,
        time: { precision: time.precision, value: time.value || null, branch: time.branch || null },
        sex_for_calculation: birth.sex_for_calculation
      }, { asOfYear: now.getFullYear(), asOfDate: today, asOfTimeIndex: 6 });

      var name = wantedName();
      var palace = (chart.palaces || []).filter(function (item) { return item.name === name; })[0];
      if (!palace) throw new Error("没有找到「" + name + "」");


      document.getElementById("palace-name").textContent = palace.name;
      document.getElementById("palace-gz").textContent = palace.heavenlyStem + palace.earthlyBranch;
      document.getElementById("palace-topic").textContent = palace.topic ? "主题：" + palace.topic : "";

      var majors = palace.majorStars || [];
      document.getElementById("majors").innerHTML = majors.length
        ? majors.map(starRow).join("")
        : '<li><b style="color:var(--muted)">空宫</b><span class="meta">' +
          (palace.borrowedFromPalace ? "借对宫 " + esc(palace.borrowedFromPalace) : "无主星") + "</span></li>";

      var others = (palace.minorStars || []).concat(palace.auxiliaryStars || []);
      document.getElementById("others").innerHTML = others.length
        ? others.map(starRow).join("")
        : '<li><b style="color:var(--muted)">—</b><span class="meta">没有辅星与杂曜</span></li>';

      var opposite = palace.oppositePalace || "";
      var decadal = palace.decadal || {};
      var birthYear = Number(String(birth.date || "").slice(0, 4));
      var age = birthYear ? now.getFullYear() - birthYear + 1 : null;
      var isNow = decadal.fromAge != null && age != null && age >= decadal.fromAge && age <= decadal.toAge;

      document.getElementById("context").innerHTML = [
        '<div><span>对宫</span><b>' + esc(String(opposite).replace("宫", "") || "—") + "</b></div>",
        '<div><span>大限</span><b>' + (decadal.fromAge != null ? decadal.fromAge + "–" + decadal.toAge + " 岁" : "—") + "</b></div>"
      ].join("");
      document.getElementById("context-note").textContent = [
        isNow ? "当前正走这一宫的大限。" : "",
        decadal.ganzhi ? "大限干支 " + decadal.ganzhi + "。" : "",
        palace.isEmpty ? "本宫无主星，判断要借对宫。" : "",
        "宫位只描述这一块生活面向的盘面结构，不作具体事件的断定。"
      ].filter(Boolean).join("");
    } catch (err) {
      content.hidden = true;
      empty.hidden = false;
      empty.querySelector("b").textContent = "没能排出这一宫";
      var reason = err && err.message ? err.message : String(err);
      var hint = reason.indexOf("时辰") >= 0
        ? "紫微需要出生时辰，回出生信息补充后再排。"
        : "请回出生信息确认日期与时辰，重新保存一次。";
      empty.querySelector("p").textContent = reason + "。" + hint;
    }
  }
})();

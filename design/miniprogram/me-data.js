// 我的：管理本机的几份出生资料（档案）、看报告数量、清除数据。
(function () {
  "use strict";

  var REPORTS = "mingli.reports.v1";
  var LATEST = "mingli.report.v1";

  var listEl = document.getElementById("profiles");
  var emptyEl = document.getElementById("no-profile");
  var reportCount = document.getElementById("report-count");
  var toast = document.getElementById("toast");

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function reports() {
    try { return JSON.parse(read(REPORTS) || "[]"); } catch (e) { return []; }
  }

  function summarize(item) {
    var p = (item.profile && item.profile.profile) || {};
    var time = p.time || {};
    var calendar = p.calendar === "lunar" ? "农历" : "公历";
    var timeText = time.precision === "unknown"
      ? "时辰未知"
      : (time.precision === "branch" ? "时辰 " + (time.branch || "—") : (time.value || "—"));
    return [calendar + " " + (p.date || "—"), timeText, p.sex_for_calculation === "female" ? "女" : "男"]
      .filter(Boolean).join(" · ");
  }

  function render() {
    if (!window.MingliProfile) {
      emptyEl.hidden = false;
      return;
    }
    var items = window.MingliProfile.list();
    var activeId = window.MingliProfile.activeId();

    if (!items.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
      listEl.innerHTML = items.map(function (item) {
        var on = item.id === activeId;
        return '<li class="' + (on ? "on" : "") + '">' +
          '<button class="pick" type="button" data-id="' + esc(item.id) + '">' +
          '<span class="who">' + esc(item.name || "我") + (on ? '<i class="badge">当前</i>' : "") + "</span>" +
          '<span class="sum">' + esc(summarize(item)) + "</span>" +
          "</button>" +
          '<button class="del" type="button" data-del="' + esc(item.id) + '" aria-label="删除 ' + esc(item.name) + '">删除</button>' +
          "</li>";
      }).join("");
    }

    var list = reports();
    reportCount.textContent = list.length ? list.length + " 份报告" : (read(LATEST) ? "1 份报告" : "0 份报告");
  }

  listEl.addEventListener("click", function (event) {
    var pick = event.target.closest(".pick");
    var del = event.target.closest(".del");
    if (del) {
      var id = del.getAttribute("data-del");
      if (!window.confirm("删除这份出生于资料？对应的报告不会删。")) return;
      window.MingliProfile.remove(id);
      render();
      toast.hidden = false;
      toast.textContent = "已删除该档案。";
      return;
    }
    if (pick) {
      window.MingliProfile.setActive(pick.getAttribute("data-id"));
      render();
      toast.hidden = false;
      toast.textContent = "已切换，回到八字或紫微就是这份盘。";
    }
  });

  document.getElementById("clear").addEventListener("click", function () {
    if (!window.confirm("清除后：所有出生资料、已生成的解读报告都会从这台设备删掉，无法恢复。继续？")) return;
    try {
      if (window.MingliProfile) window.MingliProfile.clearAll();
      localStorage.removeItem(REPORTS);
      localStorage.removeItem(LATEST);
      render();
      toast.hidden = false;
      toast.textContent = "已清除，下次排盘会重新让你填写。";
    } catch (e) {
      toast.hidden = false;
      toast.textContent = "清除失败：" + (e && e.message ? e.message : e);
    }
  });

  render();
})();

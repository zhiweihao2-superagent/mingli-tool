// 紫微结果页：用随目录带的 iztro 在浏览器里按填写的资料排盘（不再用固定样例）。
(function () {
  "use strict";

  var STORE = "mingli.profile.v1";
  var SLOTS = {
    "巳": "g-si", "午": "g-wu", "未": "g-wei", "申": "g-shen",
    "辰": "g-chen", "酉": "g-you", "卯": "g-mao", "戌": "g-xu",
    "寅": "g-yin", "丑": "g-chou", "子": "g-zi", "亥": "g-hai"
  };

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");
  var aiButton = document.querySelector(".ai-btn");
  var aiResult = document.getElementById("ai-result");
  var reportLink = document.getElementById("report-link");
  var lastChart = null;
  var saveChartButton = document.getElementById("save-chart");
  var retryButton = document.getElementById("retry");
  var resourceRetried = false;

  // 公网隧道下偶发某个 vendor 文件 502，脚本没加载全时 window.MingliZiwei 就是 undefined。
  // 那种情况不能报「Cannot read properties of undefined」——用户看不懂，也不知道该干什么。
  function engineReady() {
    return !!(
      window.iztro && window.iztro.astro && typeof window.iztro.astro.withOptions === "function" &&
      window.MingliZiwei && typeof window.MingliZiwei.calculate === "function" &&
      window.MingliZiweiFacts && typeof window.MingliZiweiFacts.build === "function"
    );
  }

  function showResourceError() {
    errorText.textContent = "排盘程序没有加载完整——多半是网络中途断了。点下面的按钮重新加载一次就好。";
    errorBox.hidden = false;
    content.hidden = true;
    if (retryButton) retryButton.textContent = "重新加载";
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

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function cellHtml(palace) {
    var branch = palace.earthlyBranch || "";
    var name = String(palace.name || "").replace("宫", "");
    var majors = (palace.majorStars || []).map(function (star) {
      return '<p class="p-star">' + esc(star.name) +
        (star.transformation ? "<i>" + esc(star.transformation) + "</i>" : "") + "</p>";
    }).join("");
    if (!majors) majors = '<p class="p-star" style="color:var(--muted)">' + (palace.name === "命宫" ? "空宫" : "无主星") + "</p>";

    var minors = (palace.minorStars || []).map(function (s) { return s.name; }).join(" ");
    var ads = (palace.auxiliaryStars || []).map(function (s) { return s.name; });
    var adjLines = [];
    for (var i = 0; i < ads.length; i += 2) adjLines.push(ads.slice(i, i + 2).join(" "));

    return '<a class="p ' + (SLOTS[branch] || "") + (palace.name === "命宫" ? " on" : "") +
      '" href="palace.html?name=' + encodeURIComponent(palace.name || "") + '">' +
      '<p class="p-name">' + esc(branch) + " <em>" + esc(name) + "</em></p>" +
      majors +
      (minors ? '<p class="p-line">' + esc(minors) + "</p>" : "") +
      (adjLines.length ? '<p class="p-spacer"></p>' + adjLines.map(function (line) {
        return '<p class="p-line">' + esc(line) + "</p>";
      }).join("") : "") +
      "</a>";
  }

  function centerHtml(astrolabe, palaces) {
    var soul = palaces.filter(function (p) { return p.name === "命宫"; })[0] || {};
    var body = palaces.filter(function (p) { return p.earthlyBranch === astrolabe.earthlyBranchOfBodyPalace; })[0] || {};
    var hua = [];
    palaces.forEach(function (palace) {
      (palace.majorStars || []).concat(palace.minorStars || []).forEach(function (star) {
        if (star.transformation) hua.push(star.name + " " + star.transformation);
      });
    });
    return '<div class="mid">' +
      '<p class="mid-title">' + esc(soul.heavenlyStem || "") + esc(soul.earthlyBranch || "") + " · " +
      (String(astrolabe.gender || "").indexOf("女") >= 0 ? "女" : "男") + "</p>" +
      '<p class="mid-line">命主 ' + esc(astrolabe.soul || "—") + " · 身主 " + esc(astrolabe.body || "—") + "<br>" +
      "命宫 " + esc(soul.heavenlyStem || "") + esc(soul.earthlyBranch || "") +
      " · 身宫 " + esc(String(body.name || "").replace("宫", "") || "—") + "<br>" +
      esc(astrolabe.fiveElementsClass || "") + "</p>" +
      '<div class="hua">' + hua.slice(0, 4).map(function (item) {
        var parts = item.split(" ");
        return "<span>" + esc(parts[0]) + "<i>" + esc(parts[1] || "") + "</i></span>";
      }).join("") + "</div></div>";
  }

  function renderDecadal(palaces, currentAge) {
    var items = palaces.filter(function (p) { return p.decadal; }).map(function (p) {
      return {
        from: p.decadal.fromAge,
        to: p.decadal.toAge,
        name: String(p.name || "").replace("宫", ""),
        now: currentAge != null && currentAge >= p.decadal.fromAge && currentAge <= p.decadal.toAge
      };
    }).sort(function (a, b) { return a.from - b.from; });

    var now = items.filter(function (item) { return item.now; })[0];
    document.getElementById("decadal-meta").textContent = now
      ? "现在 " + now.from + "–" + now.to + " · " + now.name + "宫"
      : "按虚岁排";
    document.getElementById("decadal").innerHTML = items.map(function (item) {
      return '<div class="dec' + (item.now ? " on" : "") + '"><b>' + item.from + "–" + item.to +
        "</b><span>" + esc(item.name) + "</span></div>";
    }).join("");
  }

  function renderKey(palaces) {
    var wanted = ["命宫", "夫妻宫", "官禄宫", "财帛宫"];
    document.getElementById("keypalaces").innerHTML = wanted.map(function (name) {
      var palace = palaces.filter(function (p) { return p.name === name; })[0];
      if (!palace) return "";
      var majors = (palace.majorStars || []).map(function (s) {
        return s.name + (s.brightness ? "（" + s.brightness + "）" : "");
      }).join("、") || "空宫";
      var minors = (palace.minorStars || []).map(function (s) { return s.name; }).join("、");
      return "<li><b>" + esc(String(palace.name).replace("宫", "")) + " · " + esc(majors) + "</b>" +
        '<span class="meta">' + esc(minors || "—") + "</span></li>";
    }).join("");
  }

  function renderAi(palaces, astrolabe) {
    var soul = palaces.filter(function (p) { return p.name === "命宫"; })[0] || {};
    var soulStars = (soul.majorStars || []).map(function (s) { return s.name; }).join("、") || "空宫";
    var spouse = palaces.filter(function (p) { return p.name === "夫妻宫"; })[0] || {};
    var spouseStars = (spouse.majorStars || []).map(function (s) { return s.name; }).join("、") || "空宫";
    document.getElementById("ai-title").textContent = "命宫 " + soulStars + " · 夫妻宫 " + spouseStars;
    document.getElementById("ai-body").innerHTML =
      "命宫在 <strong>" + esc(soul.earthlyBranch || "—") + "</strong>，主星 <strong>" + esc(soulStars) + "</strong>；" +
      "夫妻宫主星 " + esc(spouseStars) + "；五行局 " + esc(astrolabe.fiveElementsClass || "—") +
      "。本页只列盘面事实，具体解读在小程序里调本机模型生成，逐条引用盘面依据。";
    document.getElementById("ai-note").textContent = "12 宫 · 4 化";
  }

  var BRANCHES = [
    ["子", "23:00–01:00"], ["丑", "01:00–03:00"], ["寅", "03:00–05:00"], ["卯", "05:00–07:00"],
    ["辰", "07:00–09:00"], ["巳", "09:00–11:00"], ["午", "11:00–13:00"], ["未", "13:00–15:00"],
    ["申", "15:00–17:00"], ["酉", "17:00–19:00"], ["戌", "19:00–21:00"], ["亥", "21:00–23:00"]
  ];

  // 时辰未知时，直接在本页补一个时辰，不用回出生信息重填一遍
  function renderHourFix() {
    if (document.getElementById("hour-fix")) return;
    var box = document.createElement("div");
    box.id = "hour-fix";
    box.className = "hour-fix";
    box.innerHTML = '<p class="hour-fix-title">大概几点出生？</p><div class="hour-fix-grid">' +
      BRANCHES.map(function (pair) {
        return '<button type="button" data-branch="' + pair[0] + '"><b>' + pair[0] + "时</b><span>" + pair[1] + "</span></button>";
      }).join("") + "</div>";
    errorBox.appendChild(box);

    box.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-branch]");
      if (!button) return;
      var item = window.MingliProfile && window.MingliProfile.active();
      if (!item) return;
      var payload = JSON.parse(JSON.stringify(item.profile));
      payload.profile.time = { precision: "branch", branch: button.getAttribute("data-branch") };
      payload.options = payload.options || {};
      window.MingliProfile.save({ id: item.id, name: item.name, createdAt: item.createdAt, profile: payload });
      location.reload();
    });
  }

  function main() {
    var profile = loadProfile();
    if (!profile) {
      empty.hidden = false;
      return;
    }
    content.hidden = false;

    // 脚本没加载全就先自动补一次（隧道偶发 502），补不上再如实报「网络断了」
    if (!engineReady() && !resourceRetried) {
      resourceRetried = true;
      var ensure = window.MingliBoot && window.MingliBoot.ensureChart;
      if (typeof ensure === "function") {
        ensure().then(function (result) {
          if (result && result.ok) {
            main();
          } else {
            showResourceError();
          }
        });
        return;
      }
      showResourceError();
      return;
    }
    if (!engineReady()) {
      showResourceError();
      return;
    }

    try {
      var birth = profile.profile || {};
      var time = birth.time || {};
      var now = new Date();
      var today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      var chart = window.MingliZiwei.calculate({
        calendar: birth.calendar,
        date: birth.date,
        time: { precision: time.precision, value: time.value || null, branch: time.branch || null },
        sex_for_calculation: birth.sex_for_calculation
      }, { asOfYear: now.getFullYear(), asOfDate: today, asOfTimeIndex: 6 });

      lastChart = chart;
      if (chart && chart.status && chart.status !== "ok") {
        // 排盘层已给出具体原因（缺时辰 / 子时歧义 / 输入非法 / 引擎失败），照实显示，
        // 不要一律说成「缺出生时辰」——那会把引擎问题说成用户问题。
        var code = (chart.error && chart.error.code) || "";
        var msg = (chart.error && chart.error.message) || "紫微排盘失败，请检查出生信息。";
        errorText.textContent = msg;
        errorBox.hidden = false;
        content.hidden = true;
        if (aiButton) {
          aiButton.disabled = true;
          aiButton.textContent = "先补出生时辰";
        }
        if (/TIME_(REQUIRED|INVALID)|RAT_HOUR/.test(code)) renderHourFix();
        return;
      }
      var astrolabe = chart.astrolabe || {};
      var palaces = chart.palaces || [];
      if (!palaces.length) throw new Error("没有生成十二宫");

      var birthYear = Number(String(birth.date || "").slice(0, 4));
      var age = birthYear ? now.getFullYear() - birthYear + 1 : null;

      document.getElementById("idline").textContent = [
        window.MingliProfile && window.MingliProfile.currentName(),
        astrolabe.solarDate || birth.date,
        astrolabe.timeRange || time.value || "时辰未知",
        astrolabe.gender || "",
        astrolabe.lunarDate || ""
      ].filter(Boolean).join(" · ");

      document.getElementById("board").innerHTML =
        palaces.map(cellHtml).join("") + centerHtml(astrolabe, palaces);

      renderAi(palaces, astrolabe);
      renderDecadal(palaces, age);
      renderKey(palaces);
    } catch (err) {
      errorText.textContent = "紫微排盘出错：" + (err && err.message ? err.message : "未知原因") + "。可以点「重试」再排一次。";
      errorBox.hidden = false;
      content.hidden = true;
      if (aiButton) {
        aiButton.disabled = true;
        aiButton.textContent = "排盘出错";
      }
    }
  }

  if (saveChartButton) {
    saveChartButton.addEventListener("click", async function () {
      if (!lastChart || !window.MingliChartImage) return;
      saveChartButton.disabled = true;
      saveChartButton.textContent = "生成中…";
      try {
        var name = window.MingliProfile && window.MingliProfile.currentName();
        var canvas = window.MingliChartImage.drawZiwei(lastChart, { name: name });
        var result = await window.MingliChartImage.save(canvas, window.MingliChartImage.ziweiFile(name));
        saveChartButton.textContent = result.ok ? "已保存" : "导出失败";
      } catch (err) {
        saveChartButton.textContent = "导出失败";
      } finally {
        setTimeout(function () { saveChartButton.textContent = "存盘面图"; saveChartButton.disabled = false; }, 1800);
      }
    });
  }

  if (aiButton) {
    aiButton.addEventListener("click", async function () {
      if (!lastChart || !aiResult) return;
      aiButton.setAttribute("aria-busy", "true");
      aiButton.disabled = true;
      var batches = Math.ceil(window.MingliAi.ZIWEI_TOPICS.length / 2);
      aiResult.innerHTML = '<p class="ai-audit">正在生成 1/' + batches + " 批，整份大约 1–3 分钟…</p>";
      try {
        var report = await window.MingliAi.runZiwei(lastChart, function (done, total) {
          aiResult.innerHTML = '<p class="ai-audit">正在生成 ' + done + "/" + total + " 批…（每批 20–40 秒）</p>";
        });
        window.MingliAi.renderOutput(aiResult, report);
        try {
          report.system = "紫微";
          report.systemLabel = "紫微体系";
          var saved = window.MingliAi.saveReport(report);
          if (reportLink && saved) { reportLink.href = "report.html?id=" + encodeURIComponent(saved.id); }
        } catch (e) { /* 存不下不影响当前展示 */ }
        if (reportLink) reportLink.hidden = false;
      } catch (err) {
        window.MingliAi.renderError(aiResult, "解读失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.removeAttribute("aria-busy");
        aiButton.disabled = false;
      }
    });
  }

  (function () {
    if (!reportLink || !window.MingliAi) return;
    var latest = window.MingliAi.loadReport();
    if (!latest) return;
    if (latest.id) reportLink.href = "report.html?id=" + encodeURIComponent(latest.id);
    reportLink.hidden = false;
  })();

  if (window.MingliGlossary) window.MingliGlossary.bind(content);

  main();

  if (retryButton) {
    retryButton.addEventListener("click", function () {
      retryButton.disabled = true;
      retryButton.textContent = "重试中…";
      location.reload();
    });
  }
})();

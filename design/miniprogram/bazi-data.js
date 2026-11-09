// 八字结果页：读出生信息页存下的资料，调本机排盘服务，按真实结果渲染。
// 服务没起、或还没填资料时给出明确提示，不拿样例数据冒充。
(function () {
  "use strict";

  var API = "http://127.0.0.1:8765/api/v1/bazi/calculate";
  var STORE = "mingli.profile.v1";

  var NAYIN = ["海中金","炉中火","大林木","路旁土","剑锋金","山头火","涧下水","城头土","白蜡金","杨柳木",
    "泉中水","屋上土","霹雳火","松柏木","长流水","砂中金","山下火","平地木","壁上土","金箔金",
    "覆灯火","天河水","大驿土","钗钏金","桑柘木","大溪水","沙中土","天上火","石榴木","大海水"];
  var STEMS = "甲乙丙丁戊己庚辛壬癸";
  var BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
  var ELEMENTS = ["木", "火", "土", "金", "水"];

  var empty = document.getElementById("empty");
  var errorBox = document.getElementById("error");
  var errorText = document.getElementById("error-text");
  var content = document.getElementById("content");
  var aiButton = document.querySelector(".ai-btn");
  var aiResult = document.getElementById("ai-result");
  var reportLink = document.getElementById("report-link");
  var lastCalc = null;
  var saveChartButton = document.getElementById("save-chart");

  function loadProfile() {
    try {
      if (window.MingliProfile) return window.MingliProfile.currentProfile();
      var raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function nayinOf(ganzhi) {
    var s = STEMS.indexOf(ganzhi.charAt(0));
    var b = BRANCHES.indexOf(ganzhi.charAt(1));
    for (var i = 0; i < 60; i += 1) {
      if (i % 10 === s && i % 12 === b) return NAYIN[Math.floor(i / 2)];
    }
    return "";
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function renderPillars(pillars) {
    var order = ["year", "month", "day", "hour"];
    var names = { year: "年柱", month: "月柱", day: "日柱", hour: "时柱" };
    document.getElementById("pillars").innerHTML = order.map(function (key) {
      var p = pillars[key];
      if (!p) {
        return '<div class="pillar"><p class="p-god">' + names[key] + '</p><span class="p-gan">—</span><span class="p-zhi">—</span><p class="p-hide"><span>时辰未知</span></p><p class="p-nayin">—</p></div>';
      }
      var hides = (p.hidden_stems || []).map(function (h) {
        return "<span>" + esc(h.stem) + " " + esc(h.ten_god || "") + "</span>";
      }).join("");
      return '<div class="pillar' + (key === "day" ? " day" : "") + '">' +
        '<p class="p-god"' + (p.ten_god ? ' data-term="' + esc(p.ten_god) + '"' : "") + ">" +
        esc(p.ten_god || names[key]) + "</p>" +
        '<span class="p-gan">' + esc(p.stem) + "</span>" +
        '<span class="p-zhi">' + esc(p.branch) + "</span>" +
        '<p class="p-hide">' + hides + "</p>" +
        '<p class="p-nayin">' + esc(nayinOf(p.ganzhi)) + "</p>" +
        "</div>";
    }).join("");
  }

  function renderElements(inventory) {
    var counts = (inventory && inventory.counts && inventory.counts.hidden_stems) || {};
    var values = ELEMENTS.map(function (name) { return Number(counts[name] || 0); });
    var max = Math.max.apply(null, values.concat([1]));
    var top = Math.max.apply(null, values);
    document.getElementById("wu").innerHTML = ELEMENTS.map(function (name, index) {
      var width = Math.round((values[index] / max) * 100);
      return '<div class="wu-row' + (values[index] === top ? " top" : "") + '"><span>' + name + "</span>" +
        '<div class="wu-bar"><i style="width:' + width + '%"></i></div><b>' + values[index] + "</b></div>";
    }).join("") + '<p class="meta" style="margin-top:var(--space-2);font-size:12px">按藏干计</p>';
  }

  function renderJudge(facts) {
    var rules = (facts && facts.derived_rules) || {};
    var strength = rules.strength || {};
    var pattern = rules.pattern || {};
    var climate = rules.climate_adjustment || {};
    var useful = rules.useful_elements || {};
    var balance = (useful.axes && useful.axes.balance) || {};

    var cells = [
      {
        label: "旺衰",
        value: strength.conclusion || "未判定",
        note: strength.supportRatio != null
          ? "扶 " + strength.supportPoints + " · 抑 " + strength.opposingPoints + " · " + Number(strength.supportRatio).toFixed(2)
          : "候选结论"
      },
      {
        label: "格局",
        value: pattern.primaryCandidate || "无候选",
        note: (pattern.candidates && pattern.candidates.length) ? "候选 " + pattern.candidates.length + " 个" : "未命中公开格局"
      },
      {
        label: "调候",
        value: [climate.temperature, climate.moisture].filter(Boolean).join(" · ") || "未判定",
        note: (climate.primaryElements || []).length ? "主用 " + climate.primaryElements.join("、") : ""
      },
      {
        label: "用神候选",
        value: (balance.primaryElements || []).join("、") || "未判定",
        note: (balance.avoidElements || []).length ? "避 " + balance.avoidElements.join("·") : ""
      }
    ];

    document.getElementById("judge").innerHTML = cells.map(function (cell) {
      return '<div class="jcell"><span>' + cell.label + '</span><b data-term="' + esc(cell.value) + '">' +
        esc(cell.value) + "</b><p>" + esc(cell.note) + "</p></div>";
    }).join("");
  }

  function renderAi(pillars, facts) {
    var rules = (facts && facts.derived_rules) || {};
    var strength = (rules.strength || {}).conclusion || "未判定";
    var pattern = (rules.pattern || {}).primaryCandidate || "无候选格局";
    var day = pillars.day || {};
    var branchCount = ["year", "month", "day", "hour"].filter(function (k) {
      return pillars[k] && pillars[k].ten_god === "比肩";
    }).length;

    document.getElementById("ai-title").textContent = "日主 " + (day.stem || "—") + " · " + strength + " · " + pattern;
    document.getElementById("ai-body").innerHTML =
      "日主 <strong>" + esc(day.stem || "") + esc(day.branch || "") + "</strong>，" +
      esc(strength) + "，" + esc(pattern) + "。" +
      (branchCount > 1 ? "四柱里有 " + branchCount + " 处比肩，自我主张强，先说清规则再谈协作。" : "") +
      "具体解读在小程序里调本机模型生成，结论只依据这张盘的事实。";
    document.getElementById("ai-note").textContent = "结构 " + ((facts && facts.fingerprint) || "—");
  }

  function renderShensha(derived) {
    var list = (derived && derived.shensha) || [];
    document.getElementById("shensha-count").textContent = list.length + " 个 · 按柱位标注";
    document.getElementById("shensha").innerHTML = list.map(function (item) {
      return '<span class="ss" data-term="' + esc(item.name) + '" title="' + esc(item.evidence || "") + '">' +
        esc(item.name) + "</span>";
    }).join("");
  }

  function renderLuck(calc) {
    var cycles = ((calc.luck_cycles || {}).cycles) || [];
    var start = (calc.luck_cycles || {}).start || {};
    var direction = (calc.luck_cycles || {}).direction === "forward" ? "顺行" : "逆行";
    var startText = start.years != null ? "起运 " + start.years + " 岁" + (start.months ? " " + start.months + " 个月" : "") : "";
    document.getElementById("luck-meta").textContent = [startText, direction].filter(Boolean).join(" · ");

    var currentAge = new Date().getFullYear() - 1990;
    document.getElementById("luck").innerHTML = cycles.map(function (cycle, index) {
      var range = String(cycle.age_range || "");
      var ageMatch = range.match(/(\d+)/g);
      var isNow = ageMatch && ageMatch.length >= 2 && currentAge >= Number(ageMatch[0]) && currentAge <= Number(ageMatch[1]) && cycle.sequence !== "起运前";
      return '<a class="luck' + (isNow ? " on" : "") + '" href="cycle.html?type=luck&index=' + index + '">' +
        "<b>" + esc(cycle.ganzhi) + "</b><span>" + esc(range.replace("岁", "")) + "</span></a>";
    }).join("");
  }

  function renderYears(calc) {
    var list = (calc.annual_cycles || []).slice(-6);
    var thisYear = new Date().getFullYear();
    document.getElementById("years").innerHTML = list.map(function (item) {
      var now = item.year === thisYear;
      return '<li' + (now ? ' class="now"' : "") + '><a href="annual.html"><b>' + item.year + " " + esc(item.ganzhi) +
        '</b><span class="meta">' + (now ? "当前" : "") + "</span></a></li>";
    }).join("");
  }

  async function main() {
    var profile = loadProfile();
    if (!profile) {
      empty.hidden = false;
      return;
    }
    content.hidden = false;
    try {
      var response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
      });
      var data = await response.json();
      if (!response.ok || data.status !== "ok") {
        var detail = (data.error && data.error.message) || "排盘失败";
        errorText.textContent = detail;
        errorBox.hidden = false;
        content.hidden = true;
        return;
      }
      lastCalc = data;
      var calc = data.calculation;
      var display = calc.calendar_display || {};
      var sex = (data.normalized_input.profile.sex_for_calculation === "female") ? "女" : "男";
      document.getElementById("idline").textContent =
        [window.MingliProfile && window.MingliProfile.currentName(), display.solar, sex, display.lunar]
          .filter(Boolean).join(" · ");

      renderPillars(calc.pillars);
      renderElements((data.ai_facts || {}).element_inventory || calc.element_inventory);
      renderJudge(data.ai_facts || {});
      renderAi(calc.pillars, data.ai_facts || {});
      renderShensha(calc.derived);
      renderLuck(calc);
      renderYears(calc);
    } catch (err) {
      errorText.textContent = "请求失败：" + (err && err.message ? err.message : err) + "。请确认本机服务在 127.0.0.1:8765 运行。";
      errorBox.hidden = false;
      content.hidden = true;
    }
  }

  if (saveChartButton) {
    saveChartButton.addEventListener("click", async function () {
      if (!lastCalc || !window.MingliChartImage) return;
      saveChartButton.disabled = true;
      saveChartButton.textContent = "生成中…";
      try {
        var sex = lastCalc.normalized_input && lastCalc.normalized_input.profile.sex_for_calculation === "female" ? "女" : "男";
        var canvas = window.MingliChartImage.drawBazi(lastCalc.calculation, {
          name: window.MingliProfile && window.MingliProfile.currentName(),
          sex: sex,
          facts: lastCalc.ai_facts
        });
        var result = await window.MingliChartImage.save(canvas, window.MingliChartImage.baziFile(window.MingliProfile && window.MingliProfile.currentName()));
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
      if (!lastCalc) return;
      if (!aiResult) return;
      aiButton.setAttribute("aria-busy", "true");
      aiButton.disabled = true;
      var batches = Math.ceil(window.MingliAi.BAZI_TOPICS.length / 2);
      aiResult.innerHTML = '<p class="ai-audit">正在生成 1/' + batches + " 批，整份大约 1–3 分钟…</p>";
      try {
        var report = await window.MingliAi.runBazi(lastCalc, function (done, total) {
          aiResult.innerHTML = '<p class="ai-audit">正在生成 ' + done + "/" + total + " 批…（每批 20–40 秒）</p>";
        });
        window.MingliAi.renderOutput(aiResult, report);
        if (reportLink) reportLink.hidden = false;
      } catch (err) {
        window.MingliAi.renderError(aiResult, "解读失败：" + (err && err.message ? err.message : err));
      } finally {
        aiButton.removeAttribute("aria-busy");
        aiButton.disabled = false;
      }
    });
  }

  if (reportLink && window.MingliAi && window.MingliAi.loadReport()) reportLink.hidden = false;

  if (window.MingliGlossary) window.MingliGlossary.bind(content);

  main();
})();

// AI 解读：把排盘结果打包成契约，按主题分批调本机服务，合并成一份完整报告。
// 服务端每次最多接 2 个主题，所以这里自己分批、按顺序跑，跑完存进 localStorage 供报告页使用。
(function (global) {
  "use strict";

  var ENDPOINT = "http://127.0.0.1:8765/api/v1/interpret";
  var CONSENT_VERSION = "2026-10";
  var STORE = "mingli.report.v1";
  var REPORTS = "mingli.reports.v1";
  var BATCH = 2;
  var knowledgeCache = {};

  var BAZI_TOPICS = ["bazi-foundation", "bazi-strength", "bazi-pattern", "bazi-useful", "bazi-climate", "bazi-relations", "bazi-cycles"];
  var ZIWEI_TOPICS = ["overview", "personality", "love", "career", "wealth", "health", "family"];
  var ANNUAL_TOPICS = ["annual-overview", "annual-career", "annual-relationship", "annual-wealth", "annual-wellbeing", "annual-home"];

  function loadJson(url) {
    if (knowledgeCache[url]) return knowledgeCache[url];
    knowledgeCache[url] = fetch(url).then(function (response) {
      if (!response.ok) throw new Error("知识包读取失败：" + url);
      return response.json();
    });
    return knowledgeCache[url];
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  async function post(contract, topics) {
    var response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract: contract, topicIds: topics, consent: true, consentVersion: CONSENT_VERSION })
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var message = (data.error && data.error.message) || "模型调用失败（HTTP " + response.status + "）";
      throw new Error(message);
    }
    return data.output || data;
  }

  function merge(outputs) {
    var sections = [];
    var limitations = [];
    var audit = { status: "pass", evidenceCount: 0 };
    outputs.forEach(function (output) {
      (output.sections || []).forEach(function (section) { sections.push(section); });
      (output.limitations || []).forEach(function (item) {
        if (limitations.indexOf(item) < 0) limitations.push(item);
      });
      if (output.audit && output.audit.evidenceCount) audit.evidenceCount += output.audit.evidenceCount;
    });
    return {
      schema: "mingli.report.v1",
      createdAt: new Date().toISOString(),
      sections: sections,
      limitations: limitations,
      audit: audit
    };
  }

  function save(report) {
    report.id = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      localStorage.setItem(STORE, JSON.stringify(report));
      var list = listReports().filter(function (item) { return item.id !== report.id; });
      list.unshift(report);
      localStorage.setItem(REPORTS, JSON.stringify(list.slice(0, 12)));
    } catch (e) { /* 存不下就让页面自己留着 */ }
    return report;
  }

  function listReports() {
    try {
      var raw = localStorage.getItem(REPORTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function findReport(id) {
    if (!id) return load();
    return listReports().filter(function (item) { return item.id === id; })[0] || null;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async function runBatches(contract, topics, systemLabel, onProgress) {
    var batches = chunk(topics, BATCH);
    var outputs = [];
    var failed = [];
    for (var i = 0; i < batches.length; i += 1) {
      if (onProgress) onProgress(i + 1, batches.length, batches[i]);
      var got = null;
      for (var attempt = 1; attempt <= 3 && !got; attempt += 1) {
        try {
          got = await post(contract, batches[i]);
        } catch (err) {
          if (attempt === 3) {
            // 这一批连续三次没过校验：记下来、接着跑别的，不让整份报告报废
            failed.push({ topics: batches[i], reason: err && err.message ? err.message : String(err) });
          } else {
            await new Promise(function (resolve) { setTimeout(resolve, 1500 * attempt); });
          }
        }
      }
      if (got) outputs.push(got);
    }
    if (!outputs.length) throw new Error((failed[0] && failed[0].reason) || "所有批次都没有通过校验");
    var report = merge(outputs);
    report.failed = failed;
    report.system = systemLabel;
    report.title = systemLabel + "解读报告";
    report.summary = (outputs[0] || {}).summary || {};
    save(report);
    return report;
  }

  async function buildBaziContract(calc) {
    var contract = global.MingliAiContract.build({ bazi: calc, annualYear: new Date().getFullYear() });
    var knowledge = await loadJson("knowledge/knowledge-v1.json");
    if (global.MingliBaziKnowledge) {
      var index = global.MingliBaziKnowledge.createIndex(knowledge);
      contract.knowledge = global.MingliBaziKnowledge.loadForScopes(index, contract.scopeCatalog.supported, {
        maxChars: 12000, excerptChars: 600
      });
    }
    return contract;
  }

  async function buildZiweiContract(chart) {
    var contract = global.MingliAiContract.build({ ziwei: chart, annualYear: new Date().getFullYear() });
    if (global.MingliZiweiKnowledgeDigest) {
      var knowledge = await loadJson("knowledge/knowledge-v7.7.json");
      var digest = global.MingliZiweiKnowledgeDigest.build(knowledge, chart, { maxChars: 9000, excerptChars: 420 });
      if (digest.status !== "unavailable") contract.knowledge = digest;
    }
    return contract;
  }

  function runAnnual(calc, year, onProgress) {
    var contract = global.MingliAiContract.build({ bazi: calc, annualYear: year });
    return loadJson("knowledge/knowledge-v1.json").then(function (knowledge) {
      if (global.MingliBaziKnowledge) {
        var index = global.MingliBaziKnowledge.createIndex(knowledge);
        contract.knowledge = global.MingliBaziKnowledge.loadForScopes(index, contract.scopeCatalog.supported, {
          maxChars: 12000, excerptChars: 600
        });
      }
      return runBatches(contract, ANNUAL_TOPICS, year + " 年度", onProgress);
    });
  }

  function runBazi(calc, onProgress) {
    return buildBaziContract(calc).then(function (contract) {
      return runBatches(contract, BAZI_TOPICS, "八字", onProgress);
    });
  }

  function runZiwei(chart, onProgress) {
    return buildZiweiContract(chart).then(function (contract) {
      return runBatches(contract, ZIWEI_TOPICS, "紫微", onProgress);
    });
  }

  function renderOutput(mount, report) {
    var html = (report.sections || []).map(function (section) {
      var advice = (section.practicalAdvice || []).map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
      return '<article class="ai-section"><h3>' + esc(section.title || section.topic) + "</h3>" +
        (section.oneLineSummary ? '<p class="ai-lead">' + esc(section.oneLineSummary) + "</p>" : "") +
        "<p>" + esc(section.plainLanguage || "") + "</p>" +
        (advice ? '<ul class="ai-advice">' + advice + "</ul>" : "") +
        (section.reflectionQuestion ? '<p class="ai-q">自我核对：' + esc(section.reflectionQuestion) + "</p>" : "") +
        "</article>";
    }).join("");
    mount.innerHTML = html + limitsBlock(report.limitations) +
      '<p class="ai-audit">共 ' + (report.sections || []).length + " 个主题 · 证据 " +
      esc((report.audit && report.audit.evidenceCount) || "—") + " 条</p>";
  }

  // 「资料边界」只把最要紧的几条摆出来，其余收进折叠里
  function limitsBlock(list) {
    var picked = window.MingliLimits
      ? window.MingliLimits.pick(list, 3)
      : { head: (list || []).slice(0, 3), rest: (list || []).slice(3), total: (list || []).length };
    if (!picked.total) return "";
    var head = picked.head.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    var rest = picked.rest.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
    return '<div class="ai-limits"><b>资料边界（这份报告回答什么、不回答什么）</b><ul>' + head + "</ul>" +
      (picked.rest.length
        ? '<details class="ai-limits-more"><summary>还有 ' + picked.rest.length + " 条方法与资料说明</summary><ul>" + rest + "</ul></details>"
        : "") +
      "</div>";
  }

  function renderError(mount, message) {
    mount.innerHTML = '<p class="ai-error">' + esc(message) + "</p>";
  }

  global.MingliAi = Object.freeze({
    runBazi: runBazi,
    runAnnual: runAnnual,
    listReports: listReports,
    findReport: findReport,
    ANNUAL_TOPICS: ANNUAL_TOPICS,
    runZiwei: runZiwei,
    renderOutput: renderOutput,
    renderError: renderError,
    loadReport: load,
    saveReport: save,
    BAZI_TOPICS: BAZI_TOPICS,
    ZIWEI_TOPICS: ZIWEI_TOPICS
  });
})(typeof window !== "undefined" ? window : globalThis);

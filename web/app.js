"use strict";

const form = document.querySelector("#chart-form");

// 页面的 CSP 是 style-src 'self'：HTML 里写的 style="…" 会被浏览器直接丢掉，
// 结果是进度条、条形图这类「按数值给宽度」的元素一律变成 0 宽。
// 通过 CSSOM 赋值不受该指令限制，所以统一在渲染后补一次：
// 只处理 style 属性，不碰别的；观察 childList，新插入的节点也会补上。
function applyDeferredStyles(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("[style]").forEach((node) => {
    const cssText = node.getAttribute("style");
    if (!cssText) return;
    node.removeAttribute("style");
    try {
      node.style.cssText = cssText;
    } catch (_) {
      // 单独一个元素写坏了不影响其它节点
    }
  });
}

applyDeferredStyles(document);
if (typeof MutationObserver === "function" && document.body) {
  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.getAttribute && node.getAttribute("style")) applyDeferredStyles(node.parentNode || node);
        applyDeferredStyles(node);
      });
      if (record.type === "attributes") applyDeferredStyles(record.target);
    });
  }).observe(document.body, { childList: true, subtree: true });
}
const submitButton = document.querySelector("#submit-button");
const resultPanel = document.querySelector(".result-panel");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const resultContent = document.querySelector("#result-content");
const errorSummary = document.querySelector("#error-summary");
const errorList = document.querySelector("#error-list");
const leapField = document.querySelector("#leap-field");
const minuteField = document.querySelector("#minute-field");
const branchField = document.querySelector("#branch-field");
const branchModeToggle = document.querySelector("#branch-mode-toggle");
const systemSwitch = document.querySelector("#system-switch");
const ziweiContent = document.querySelector("#ziwei-content");
const aiReadingSection = document.querySelector("#ai-reading-section");
const aiReadingButton = document.querySelector("#generate-ai-reading");
const aiReadingCacheClear = document.querySelector("#clear-ai-reading-cache");
const aiReadingConsent = document.querySelector("#ai-reading-consent");
const aiReadingStatus = document.querySelector("#ai-reading-status");
const aiReadingResult = document.querySelector("#ai-reading-result");
const aiReportPlan = document.querySelector("#ai-report-plan");
const aiReportPlanContent = document.querySelector("#ai-report-plan-content");
const aiReadingTitle = document.querySelector("#ai-reading-title");
const aiReadingBadge = document.querySelector("#ai-reading-badge");
const openArchiveButton = document.querySelector("#open-archive");
const archiveCount = document.querySelector("#archive-count");
const archiveDialog = document.querySelector("#archive-dialog");
const archiveCloseButton = document.querySelector("#archive-close");
const archiveList = document.querySelector("#archive-list");
const archiveView = document.querySelector("#archive-view");
const archiveStatus = document.querySelector("#archive-status");
const archiveClearButton = document.querySelector("#archive-clear");
const downloadAiReadingButton = document.querySelector("#download-ai-reading");
const archiveDownloadButton = document.querySelector("#archive-download");
const downloadAnnualReadingButton = document.querySelector("#download-annual-reading");
let lastAiRecord = null;
let currentArchiveRecord = null;
let lastAnnualRecord = null;
const focusYearMode = document.querySelector("#focus-year-mode");
const focusYearCustom = document.querySelector("#focus-year-custom");
const annualReadingSection = document.querySelector("#annual-reading-section");
const annualReadingTitle = document.querySelector("#annual-reading-title");
const annualReadingYear = document.querySelector("#annual-reading-year");
const annualReadingButton = document.querySelector("#generate-annual-reading");
const annualReadingStatus = document.querySelector("#annual-reading-status");
const annualYearPick = document.querySelector("#annual-year");
const annualYearNote = document.querySelector("#annual-year-note");
const annualReadingResult = document.querySelector("#annual-reading-result");
const annualTimelineSection = document.querySelector("#annual-timeline-section");
const annualTimelineYear = document.querySelector("#annual-timeline-year");
const annualTimelineSummary = document.querySelector("#annual-timeline-summary");
const annualTimelineMonths = document.querySelector("#annual-timeline-months");
const annualTimelineFingerprints = document.querySelector("#annual-timeline-fingerprints");
const annualTimelineChecks = document.querySelector("#annual-timeline-checks");
let branchMode = false;
let latestAiContract = null;
// 上一次排盘里，各体系 AI 契约没建起来的原因（用于如实说明，而不是静默失败）
let contractNotesState = [];
// 八字与紫微各建一份合同：两套判法不通约，合成一份必然串味。
let aiContracts = { bazi: null, ziwei: null };
const shanghaiYear = Number(new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: "Asia/Shanghai"
}).format(new Date()));
focusYearMode.options[0].textContent = `今年（${shanghaiYear}）`;
focusYearMode.options[1].textContent = `明年（${Math.min(2100, shanghaiYear + 1)}）`;

function selectedFocusYear() {
  if (focusYearMode.value === "next") return Math.min(2100, shanghaiYear + 1);
  if (focusYearMode.value === "custom") return Number(focusYearCustom.value);
  return shanghaiYear;
}

function updateFocusYearField() {
  focusYearCustom.hidden = focusYearMode.value !== "custom";
  if (!focusYearCustom.hidden && !focusYearCustom.value) focusYearCustom.value = String(shanghaiYear + 1);
}

focusYearMode.addEventListener("change", updateFocusYearField);
const shanghaiNowParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  timeZone: "Asia/Shanghai"
}).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
const currentShanghaiDate = `${shanghaiNowParts.year}-${shanghaiNowParts.month}-${shanghaiNowParts.day}`;
const currentShanghaiTimeIndex = Number(shanghaiNowParts.hour) === 0
  ? 0
  : Number(shanghaiNowParts.hour) === 23 ? 12 : Math.floor((Number(shanghaiNowParts.hour) + 1) / 2);

const pillarNames = { year: "年柱", month: "月柱", day: "日柱", hour: "时柱" };

function selected(name) {
  return form.elements[name].value;
}

function parsedBirthDate() {
  return window.MingliDateInput.parse(
    form.elements.birthYear.value,
    form.elements.birthMonth.value,
    form.elements.birthDay.value,
    selected("calendar")
  );
}

function timePrecision() {
  if (branchMode) return "branch";
  return form.elements.birthTime.value ? "minute" : "unknown";
}

function updateConditionalFields() {
  const calendar = selected("calendar");
  leapField.hidden = calendar !== "lunar";
  if (calendar !== "lunar") form.elements.isLeap.checked = false;
  document.querySelector("#date-help").textContent = calendar === "lunar"
    ? "按农历年、月、日填写；年和月填满后会自动跳到下一项。闰月请勾选旁边选项。"
    : "按公历年、月、日填写；年和月填满后会自动跳到下一项。";
  minuteField.hidden = branchMode;
  branchField.hidden = !branchMode;
  branchModeToggle.setAttribute("aria-expanded", String(branchMode));
}

function setFieldError(id, message) {
  const outputId = {
    "birth-date": "date-error",
    "birth-time": "time-error",
    "time-branch": "branch-error",
    "birth-longitude": "longitude-error",
    sex: "sex-error",
    "focus-year": "focus-year-error"
  }[id];
  const inputs = id === "sex"
    ? [...form.querySelectorAll('[name="sex"]')]
    : id === "birth-date"
      ? [...form.querySelectorAll(".date-part input")]
      : id === "focus-year"
        ? [focusYearMode, focusYearCustom]
        : [document.querySelector(`#${id}`)];
  inputs.forEach(input => input.setAttribute("aria-invalid", message ? "true" : "false"));
  const output = document.querySelector(`#${outputId}`);
  output.textContent = message;
}

function validate() {
  const errors = [];
  const date = parsedBirthDate();
  const precision = timePrecision();
  setFieldError("birth-date", "");
  setFieldError("birth-time", "");
  setFieldError("time-branch", "");
  setFieldError("birth-longitude", "");
  setFieldError("sex", "");
  setFieldError("focus-year", "");

  if (date.error) {
    errors.push({ id: date.focusId, message: date.error });
    setFieldError("birth-date", date.error);
  }
  if (precision === "branch" && !form.elements.timeBranch.value) {
    const message = "请选择大概时辰，或改填具体时间。";
    errors.push({ id: "time-branch", message });
    setFieldError("time-branch", message);
  }
  if (!selected("sex")) {
    const message = "请选择排盘性别，用于计算大运顺逆。";
    errors.push({ id: "sex", message });
    setFieldError("sex", message);
  }
  const focusYear = selectedFocusYear();
  const birthYear = Number(form.elements.birthYear.value);
  if (!Number.isInteger(focusYear) || focusYear < birthYear || focusYear > 2100) {
    const message = `重点年份需要在出生年 ${birthYear || ""} 至 2100 年之间。`;
    errors.push({ id: "focus-year-custom", message });
    setFieldError("focus-year", message);
  }
  const longitudeText = form.elements.birthLongitude.value.trim();
  const longitude = Number(longitudeText);
  if (longitudeText && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    const message = "经度需要填写 -180 到 180 之间的数字。";
    errors.push({ id: "birth-longitude", message });
    setFieldError("birth-longitude", message);
  }
  if (longitudeText && precision !== "minute") {
    const message = "真太阳时校正需要具体出生时间，请填写到分钟。";
    errors.push({ id: "birth-time", message });
    setFieldError("birth-time", message);
  }

  errorList.replaceChildren(...errors.map(({ id, message }) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${id}`;
    link.textContent = message;
    link.addEventListener("click", () => {
      const target = id === "sex" ? form.querySelector('[name="sex"]') : document.querySelector(`#${id}`);
      target?.focus();
    });
    item.append(link);
    return item;
  }));
  errorSummary.hidden = errors.length === 0;
  if (errors.length) errorSummary.focus();
  return errors.length === 0;
}

function payload() {
  const precision = timePrecision();
  const longitudeText = form.elements.birthLongitude.value.trim();
  const longitude = longitudeText ? Number(longitudeText) : null;
  return {
    schema_version: "1.0",
    profile: {
      display_name: null,
      calendar: selected("calendar"),
      date: parsedBirthDate().isoDate,
      is_leap_month: form.elements.isLeap.checked,
      time: {
        precision,
        value: precision === "minute" ? form.elements.birthTime.value : null,
        branch: precision === "branch" ? form.elements.timeBranch.value : null
      },
      timezone: "Asia/Shanghai",
      sex_for_calculation: selected("sex"),
      birthplace: {
        label: form.elements.birthplaceLabel.value.trim() || null,
        longitude,
        latitude: null
      }
    },
    rules: {
      profile_id: "engine-default-v1",
      true_solar_time: longitude !== null,
      clock_time_is_dst: Boolean(form.elements.dstClock.checked)
    },
    options: { save_history: false, annual_cycles_through: selectedFocusYear() }
  };
}

function make(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

const quickReadTopics = ["bazi-strength", "bazi-useful", "overview", "career", "love", "wealth", "health"];

function reportTopicMeta(topicId) {
  return latestAiContract?.reportPlan?.topics?.find(topic => topic.id === topicId) || null;
}

function evidenceLabel(pointer) {
  for (const topic of latestAiContract?.reportPlan?.topics || []) {
    const item = topic.evidence?.find(evidence => evidence.pointer === pointer);
    if (item?.label) return item.label;
  }
  return "已校验的盘面依据";
}

function focusReportTopic(topicId) {
  const target = document.querySelector(`#ai-topic-${topicId}`);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
  target?.focus({ preventScroll: true });
}

function renderAiReading(output) {
  aiReadingResult.replaceChildren();
  const summary = make("article", null, "ai-summary-card");
  summary.append(
    make("span", "先看这里", "ai-card-label"),
    make("h4", "这张盘可以怎样读"),
    make("p", output.summary.plainLanguage),
    make("small", `证据 ${output.summary.evidencePaths.length} 条 · 置信等级 ${output.summary.confidence}`)
  );
  const quickRead = make("section", null, "ai-quick-read");
  const quickHeading = make("div", null, "ai-quick-heading");
  quickHeading.append(make("span", "3 分钟先看重点", "ai-card-label"), make("h4", "先抓住最重要的七件事"));
  quickRead.append(quickHeading);
  const quickGrid = make("div", null, "ai-quick-grid");
  quickReadTopics.map(topicId => output.sections.find(section => section.topic === topicId)).filter(Boolean).forEach(section => {
    const item = make("button", null, "ai-quick-item");
    item.type = "button";
    item.append(
      make("span", reportTopicMeta(section.topic)?.system === "bazi" ? "八字" : "紫微"),
      make("strong", section.title),
      make("p", section.oneLineSummary || section.plainLanguage)
    );
    item.addEventListener("click", () => focusReportTopic(section.topic));
    quickGrid.append(item);
  });
  quickRead.append(quickGrid);

  const navigation = make("nav", null, "ai-topic-navigation");
  navigation.setAttribute("aria-label", "二十主题报告目录");
  // 一份合同只有一套体系：只列本体系的主题，避免出现空分组
  [["八字", "bazi"], ["紫微", "ziwei"]].forEach(([label, system]) => {
    const items = output.sections.filter(section => reportTopicMeta(section.topic)?.system === system);
    if (items.length === 0) return;
    const group = make("div", null, "ai-topic-nav-group");
    group.append(make("strong", `${label} ${items.length} 主题`));
    items.forEach(section => {
      const button = make("button", section.title);
      button.type = "button";
      button.addEventListener("click", () => focusReportTopic(section.topic));
      group.append(button);
    });
    navigation.append(group);
  });
  const cards = make("div", null, "ai-reading-cards");
  output.sections.forEach(section => {
    const card = make("article", null, "ai-reading-card");
    card.id = `ai-topic-${section.topic}`;
    card.tabIndex = -1;
    card.append(
      make("span", "传统解释 · 非事实断言", "ai-card-label"),
      make("h4", section.title),
      section.oneLineSummary ? make("p", section.oneLineSummary, "ai-one-line-summary") : document.createTextNode(""),
      make("p", section.plainLanguage)
    );
    if (section.evidenceExplanation) {
      const explanation = make("div", null, "ai-evidence-explanation");
      explanation.append(make("strong", "为什么这样解读"), make("p", section.evidenceExplanation));
      card.append(explanation);
    }
    if (section.practicalAdvice?.length) {
      const advice = make("div", null, "ai-practical-advice");
      advice.append(make("strong", "可以怎么观察和行动"));
      const adviceList = make("ul");
      section.practicalAdvice.forEach(item => adviceList.append(make("li", item)));
      advice.append(adviceList);
      card.append(advice);
    }
    card.append(make("p", section.reflectionQuestion, "ai-reflection-question"));
    const evidence = make("details", null, "ai-evidence");
    evidence.append(make("summary", `查看盘面依据（${section.evidencePaths.length}）`));
    const list = make("ul");
    section.evidencePaths.forEach(pointer => {
      const item = make("li", null, "ai-evidence-item");
      item.append(make("strong", evidenceLabel(pointer)), make("code", pointer));
      list.append(item);
    });
    evidence.append(list);
    card.append(evidence);
    // 逐主题引用：每张卡自己带了哪些资料，就在这里列出来。
    // 解析不到就照实写解析不到，不美化成一个像样的书名。
    const topicCitations = Array.isArray(section.knowledgeCitations) ? section.knowledgeCitations : [];
    if (topicCitations.length > 0) {
      const topicSources = make("details", null, "ai-topic-citations");
      topicSources.append(make("summary", `这个主题引用的资料（${topicCitations.length}）`));
      const topicList = make("ul");
      topicCitations.forEach(anchor => {
        const hit = knowledgeResolve(latestAiContract, anchor);
        const item = make("li", null, "ai-citation-item");
        item.append(
          hit
            ? make("strong", hit.citation || hit.title || anchor)
            : make("strong", `未能在本次知识摘录中定位：${anchor}`),
          make("code", anchor),
        );
        topicList.append(item);
      });
      topicSources.append(topicList);
      card.append(topicSources);
    }
    const refresh = make("button", "重新生成这个主题", "ai-topic-refresh");
    refresh.type = "button";
    refresh.addEventListener("click", async () => {
      if (!aiReadingConsent.checked) {
        aiReadingStatus.textContent = "重新调用模型前，请先勾选数据使用授权。";
        aiReadingConsent.focus();
        return;
      }
      refresh.disabled = true;
      aiReadingStatus.textContent = `正在重新生成“${section.title}”，其他十九个主题保持不变…`;
      try {
        const updated = await window.MingliAiInterpretation.refreshTopic(latestAiContract, section.topic, { consent: true });
        renderAiReading(updated);
        aiReadingStatus.textContent = `“${section.title}”已更新，其他主题继续使用本次会话缓存。`;
        focusReportTopic(section.topic);
      } catch (error) {
        aiReadingStatus.textContent = `主题更新未完成：${error.message || "服务暂时不可用"}`;
        refresh.disabled = false;
      }
    });
    card.append(refresh);
    cards.append(card);
  });
  const limits = make("details", null, "ai-limitations");
  limits.append(make("summary", "查看整份报告的适用边界"));
  const limitList = make("ul");
  output.limitations.forEach(item => limitList.append(make("li", item)));
  limits.append(limitList);
  const citations = Array.isArray(output.knowledgeCitations) ? output.knowledgeCitations : [];
  if (citations.length > 0) {
    const sources = make("details", null, "ai-citations");
    sources.append(make("summary", `查看引用了哪些资料（${citations.length}）`));
    const sourceList = make("ul");
    citations.forEach(anchor => {
      const hit = knowledgeResolve(latestAiContract, anchor);
      const item = make("li", null, "ai-citation-item");
      if (hit) {
        item.append(make("strong", hit.citation || hit.title || anchor), make("code", anchor));
      } else {
        // 解析不到就照实说解析不到，不美化成一个像样的书名
        item.append(make("strong", `未能在本次知识摘录中定位：${anchor}`), make("code", anchor));
      }
      sourceList.append(item);
    });
    sources.append(sourceList);
    aiReadingResult.append(summary, quickRead, navigation, cards, sources, limits);
  } else {
    aiReadingResult.append(summary, quickRead, navigation, cards, limits);
  }
  aiReadingResult.hidden = false;
}

function annualTargetYear(contract) {
  return contract.systems?.ziwei?.facts?.periods?.current?.annual?.year
    || contract.systems?.bazi?.facts?.annual_cycle_coverage?.end_year;
}

function renderAnnualReading(output) {
  annualReadingResult.replaceChildren();
  const summary = make("article", null, "annual-summary-card");
  summary.append(make("span", "先看年度主线", "ai-card-label"), make("p", output.summary.plainLanguage));
  const cards = make("div", null, "annual-reading-cards");
  output.sections.forEach(section => {
    const card = make("article", null, "annual-reading-card");
    card.append(
      make("h4", section.title),
      make("strong", section.oneLineSummary || "年度观察主题", "annual-one-line"),
      make("p", section.plainLanguage)
    );
    if (section.practicalAdvice?.length) {
      const list = make("ul");
      section.practicalAdvice.forEach(item => list.append(make("li", item)));
      card.append(make("h5", "今年可以怎样观察"), list);
    }
    card.append(make("p", section.reflectionQuestion, "ai-reflection-question"));
    const evidence = make("details", null, "ai-evidence");
    evidence.append(make("summary", `查看年度盘面依据（${section.evidencePaths.length}）`));
    const list = make("ul");
    section.evidencePaths.forEach(pointer => {
      const item = make("li", null, "ai-evidence-item");
      item.append(make("strong", evidenceLabel(pointer)), make("code", pointer));
      list.append(item);
    });
    evidence.append(list);
    card.append(evidence);
    cards.append(card);
  });
  const limits = make("details", null, "ai-limitations");
  limits.append(make("summary", "查看年度报告边界"));
  const limitList = make("ul");
  output.limitations.forEach(item => limitList.append(make("li", item)));
  limits.append(limitList);
  annualReadingResult.append(summary, cards, limits);
  annualReadingResult.hidden = false;
}

let annualContract = null;
let lastRequestPayload = null;
const annualYearCache = new Map();

function birthYearOfChart() {
  const solar = overviewState?.bazi?.normalized_input?.profile?.solar_date || "";
  const year = Number(String(solar).slice(0, 4));
  if (Number.isInteger(year) && year > 1800) return year;
  const parsed = parsedBirthDate();
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.getFullYear() : null;
}

// 可选年份上限由 report-structure 里同一个纯函数给出：出生年 → min(2100, 出生年 + 120)。
function annualYearRange() {
  const birth = birthYearOfChart();
  if (!birth) return { years: [], first: null, last: null };
  const years = window.MingliReportStructure.annualYearsFor(birth);
  return { years, first: years[0] ?? null, last: years[years.length - 1] ?? null };
}

function annualYearsOf(contract) {
  const { years } = annualYearRange();
  if (years.length) return years;
  const fallback = new Set();
  for (const cycle of contract?.systems?.bazi?.facts?.annual_cycles || []) {
    const year = Number(cycle?.year);
    if (Number.isInteger(year) && year) fallback.add(year);
  }
  const ziweiYear = Number(contract?.systems?.ziwei?.facts?.periods?.current?.annual?.year);
  if (Number.isInteger(ziweiYear) && ziweiYear) fallback.add(ziweiYear);
  return [...fallback].sort((a, b) => a - b);
}

async function baziContractForYear(year) {
  const key = `bazi:${year}`;
  if (annualYearCache.has(key)) return annualYearCache.get(key);
  const coverage = overviewState?.bazi?.ai_facts?.annual_cycle_coverage || {};
  const covered = Number(coverage.start_year) <= year && year <= Number(coverage.end_year);
  let data = overviewState?.bazi;
  if (!covered) {
    const base = lastRequestPayload;
    if (!base) throw new Error("没有可复用的出生信息，无法按该年重算");
    const response = await fetch("/api/v1/bazi/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...base,
        options: { ...(base.options || {}), save_history: false, annual_cycles_through: year }
      })
    });
    const payloadData = await response.json();
    if (!response.ok || payloadData?.status !== "ok") {
      throw new Error(payloadData?.error?.message || "按该年份重算失败");
    }
    data = payloadData;
  }
  const contract = window.MingliAiContract.build({ bazi: data, annualYear: year });
  annualYearCache.set(key, contract);
  return contract;
}

function ziweiContractForYear(year) {
  const key = `ziwei:${year}`;
  if (annualYearCache.has(key)) return annualYearCache.get(key);
  const profile = overviewState?.ziweiProfile;
  if (!profile) return null;
  const result = window.MingliZiwei.calculate(profile, {
    asOfYear: year,
    asOfDate: `${year}-${currentShanghaiDate.slice(5)}`,
    asOfTimeIndex: currentShanghaiTimeIndex
  });
  if (result?.status && result.status !== "ok") throw new Error("按该年份重算紫微流年失败");
  const contract = window.MingliAiContract.build({ ziwei: result, annualYear: year });
  annualYearCache.set(key, contract);
  return contract;
}

// 只重建「用于年度报告」的合同：本命报告用的合同与缓存原样不动。
// 八字流年在已算范围里直接取；超出范围或紫微换年，都按该年重算一次。
async function annualContractFor(contract, year) {
  const currentYear = Number(contract?.reportPlan?.annualYear) || annualTargetYear(contract);
  if (!year || year === currentYear) return contract;
  if (contract?.systems?.ziwei) {
    const ziwei = ziweiContractForYear(year);
    if (ziwei) return ziwei;
  }
  if (overviewState?.bazi) return baziContractForYear(year);
  return contract;
}

function fillAnnualYearPicker(contract) {
  if (!annualYearPick) return;
  const { years, first, last } = annualYearRange();
  const list = years.length ? years : annualYearsOf(contract);
  const current = Number(contract?.reportPlan?.annualYear) || annualTargetYear(contract);
  annualYearPick.replaceChildren();
  list.forEach(year => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    if (year === Number(current)) option.selected = true;
    annualYearPick.append(option);
  });
  annualYearPick.disabled = list.length <= 1;
  if (annualYearNote) {
    annualYearNote.textContent = list.length <= 1
      ? "这份盘只算得出这一年。"
      : `可看 ${first || list[0]}–${last || list[list.length - 1]} 年；超出已算好范围的年份，会按那年重算一次。`;
  }
}

function systemLabelOf(contract) {
  const names = Object.keys(contract?.systems || {});
  return names.length === 1 && names[0] === "ziwei" ? "紫微" : "八字";
}

function prepareAnnualReading(contract) {
  const year = annualTargetYear(contract);
  annualReadingSection.hidden = !year;
  if (!year) return;
  annualContract = contract;
  const annualLabel = systemLabelOf(contract);
  annualReadingTitle.textContent = `${year} 年年度报告（${annualLabel}体系）`;
  annualReadingYear.textContent = String(year);
  annualReadingButton.textContent = `生成 ${year} 年度专项解读`;
  annualReadingButton.disabled = !aiReadingConsent.checked;
  annualReadingResult.replaceChildren();
  annualReadingResult.hidden = true;
  fillAnnualYearPicker(contract);
  const cached = window.MingliAiInterpretation.getCachedAnnualReport(contract);
  if (cached) {
    renderAnnualReading(cached);
    annualReadingStatus.textContent = `已从本机临时缓存恢复 ${year} 年度报告 · 未再次调用模型`;
  } else {
    annualReadingStatus.textContent = `已准备 ${year} 年的${annualLabel}年度坐标；勾选上方授权后可生成六主题解读。`;
  }
}

// ── 知识包：浏览器侧按需加载，失败只降级为「不带出处」，不阻断解读 ──
let knowledgeReady = Promise.resolve([]);
const knowledgeCache = Object.create(null);
const knowledgeIndexes = Object.create(null);

async function fetchKnowledge(which) {
  if (knowledgeCache[which]) return knowledgeCache[which];
  const url = which === "bazi"
    ? "/knowledge/bazi/knowledge-v1.json"
    : "/knowledge/ziwei/knowledge-v7.7.json";
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`知识包加载失败（HTTP ${response.status}）`);
  knowledgeCache[which] = await response.json();
  return knowledgeCache[which];
}

/**
 * 把知识摘录挂进合同。挂不上的后果只有一个：解读没有出处可引，
 * 所以这里对失败做「记录 + 降级」，绝不因为知识包缺失就让整次解读失败。
 */
async function attachKnowledge(contracts, ziweiResult) {
  const notes = [];
  if (contracts.bazi && window.MingliBaziKnowledge) {
    try {
      const payload = await fetchKnowledge("bazi");
      if (!knowledgeIndexes.bazi) knowledgeIndexes.bazi = window.MingliBaziKnowledge.createIndex(payload);
      const scopes = contracts.bazi.scopeCatalog?.supported || [];
      const digest = window.MingliBaziKnowledge.loadForScopes(
        knowledgeIndexes.bazi, scopes, { maxChars: 12000, excerptChars: 600 },
      );
      if (digest.status === "unavailable") throw new Error(digest.reason || "摘录为空");
      contracts.bazi.knowledge = digest;
      notes.push(`八字知识摘录 ${digest.stats.sectionCount} 节`);
    } catch (error) {
      notes.push(`八字知识未加载：${error.message}（解读将不带出处）`);
    }
  }
  if (contracts.ziwei && window.MingliZiweiKnowledgeDigest) {
    try {
      const payload = await fetchKnowledge("ziwei");
      const digest = window.MingliZiweiKnowledgeDigest.build(payload, ziweiResult, { maxChars: 9000, excerptChars: 420 });
      if (digest.status === "unavailable") throw new Error(digest.reason || "摘录为空");
      contracts.ziwei.knowledge = digest;
      notes.push(`紫微知识摘录 ${digest.stats.entryCount} 条`);
    } catch (error) {
      notes.push(`紫微知识未加载：${error.message}（解读将不带出处）`);
    }
  }
  return notes;
}

function knowledgeResolve(contract, anchor) {
  if (!anchor) return null;
  if (window.MingliBaziKnowledge && knowledgeIndexes.bazi && contract.systems?.bazi) {
    const hit = window.MingliBaziKnowledge.resolve(knowledgeIndexes.bazi, anchor);
    if (hit.status === "ok") return { citation: hit.citation, title: hit.title, text: hit.text };
  }
  if (window.MingliZiweiKnowledgeDigest && contract.systems?.ziwei) {
    const hit = window.MingliZiweiKnowledgeDigest.resolve(contract.knowledge, anchor);
    if (hit.status === "ok") return { citation: hit.citation, title: hit.title, text: hit.text };
  }
  return null;
}

function prepareAiReading(contract) {
  latestAiContract = contract;
  aiReadingConsent.checked = false;
  aiReadingResult.hidden = true;
  aiReadingResult.replaceChildren();
  lastAiRecord = null;
  if (downloadAiReadingButton) downloadAiReadingButton.hidden = true;
  aiReadingSection.hidden = false;
  aiReadingButton.disabled = true;
  const report = contract.reportPlan;
  const activeSystem = contract.systems?.bazi ? "bazi" : "ziwei";
  const systemLabel = activeSystem === "bazi" ? "八字" : "紫微";
  const topicCount = (report?.topics || []).filter(topic => topic.system === activeSystem).length;
  if (aiReadingTitle) {
    aiReadingTitle.textContent = topicCount
      ? `${systemLabel}解读报告 · ${topicCount} 个主题`
      : `${systemLabel}解读报告`;
  }
  if (aiReadingButton) {
    aiReadingButton.textContent = topicCount ? `同意并生成${systemLabel} ${topicCount} 主题报告` : "同意并生成报告";
  }
  const reportText = report
    ? (activeSystem === "bazi"
      ? ` · 八字 ${report.topicCounts?.bazi || 0} 主题（不掺紫微）`
      : ` · 紫微 ${report.topicCounts?.ziwei || 0} 主题 · ${report.patternCandidateCount} 个紫微格局候选（不掺八字）`)
    : "";
  aiReadingStatus.textContent = `事实契约 ${contract.schemaVersion} 已通过 · 只含${activeSystem === "bazi" ? "八字" : "紫微"}一套体系 · ${contract.requestedScopes.length} 个可解释范围${reportText} · 尚未调用真实模型`;
  aiReportPlan.hidden = !report;
  aiReportPlanContent.replaceChildren();
  if (report) {
    // 一份合同只有一套体系，所以只列这一套的主题。
    const heading = activeSystem === "bazi" ? "八字逐证据报告" : "紫微十三主题报告";
    aiReportPlanContent.append(make("h4", heading));
    const topics = make("ol", null, "ai-report-topic-list");
    report.topics.filter(topic => topic.system === activeSystem).forEach(topic => {
      const item = make("li");
      item.append(
        make("strong", topic.title),
        make("span", `${topic.method || `对应 ${topic.palace}`} · ${topic.evidence.length} 条可核对证据`)
      );
      topics.append(item);
    });
    aiReportPlanContent.append(topics);
  }
  if (contract.systems?.ziwei && report) {
    const patternCopy = report.patternCandidateCount
      ? "以下仅表示公开规则已命中候选；生成解读时必须同时显示成立条件、加分项和破格项。"
      : "本盘暂未命中公开格局规则；不会为了让报告更好看而补造格局。";
    aiReportPlanContent.append(make("h4", `紫微格局候选（${report.patternCandidateCount}）`), make("p", patternCopy, "ai-report-plan-copy"));
    if (report.patternCandidateCount) {
      const patterns = make("div", null, "ai-report-patterns");
      report.patternCandidates.forEach(pattern => {
        const card = make("article");
        card.append(make("strong", pattern.name), make("span", `${pattern.evidence.length} 条盘面证据`));
        const conditions = make("ul");
        (pattern.conditions.requiredMatched || []).forEach(text => conditions.append(make("li", `成立：${text}`)));
        (pattern.conditions.bonusMatched || []).forEach(text => conditions.append(make("li", `加分：${text}`)));
        (pattern.conditions.breakingTriggered || []).forEach(text => conditions.append(make("li", `破格：${text}`)));
        card.append(conditions);
        patterns.append(card);
      });
      aiReportPlanContent.append(patterns);
    }
  }
  const cachedReport = window.MingliAiInterpretation.getCachedReport(contract);
  const cacheState = window.MingliAiInterpretation.getCacheState(contract);
  aiReadingCacheClear.hidden = !cachedReport && cacheState.completedBatches === 0;
  if (cachedReport) {
    renderAiReading(cachedReport);
    aiReadingStatus.textContent = `已从当前浏览器会话恢复完整报告 · ${cachedReport.audit.evidenceCount} 条证据引用通过校验 · 未再次调用模型`;
  } else if (cacheState.completedBatches > 0) {
    aiReadingStatus.textContent = `检测到 ${cacheState.completedBatches}/${cacheState.totalBatches} 批已完成内容；勾选授权后会从断点继续，只生成缺失主题。`;
  }
  prepareAnnualReading(contract);
}

// 排盘成功但 AI 契约建不起来时：把原因说清楚，并给出可行的下一步，
// 不要让人看到「没有可供 AI 读取的已校验排盘」这种内部措辞却不知道该干什么。
function renderContractUnavailable(notes) {
  contractNotesState = Array.isArray(notes) ? notes.slice() : [];
  aiReadingTitle.textContent = "解读暂不可用";
  if (aiReadingBadge) aiReadingBadge.hidden = true;
  aiReadingButton.disabled = true;
  aiReadingResult.hidden = true;
  aiReadingResult.replaceChildren();
  aiReportPlan.hidden = true;
  aiReportPlanContent.replaceChildren();
  const lines = ["这次排盘的盘面已经算好、可以照常看，但两套体系的事实都没有通过 AI 解读前的校验，所以不能提交给模型。"];
  if (contractNotesState.length) lines.push(`原因：${contractNotesState.join("；")}`);
  lines.push("可以先用上面的表单重新排一次（确认出生时间与时区），或把这行原因发给我，我按错误码定位。");
  aiReadingStatus.textContent = lines.join("\n");
  aiReadingStatus.classList.add("is-error");
  aiReadingSection.hidden = false;
  if (aiReadingConsent) aiReadingConsent.checked = false;
}

aiReadingButton.addEventListener("click", async () => {
  if (!latestAiContract) return;
  if (!aiReadingConsent.checked) {
    aiReadingStatus.textContent = "请先勾选授权；未授权不会发送资料。";
    return;
  }
  aiReadingButton.disabled = true;
  aiReadingStatus.textContent = "正在准备知识摘录并发送已校验的盘面事实…";
  // 知识摘录可能还在路上：等它就绪再发，否则这批解读会缺出处。
  await knowledgeReady;
  try {
    const output = await window.MingliAiInterpretation.request(latestAiContract, {
      provider: "deepseek",
      consent: true,
      onProgress: ({ completed, total, topicIds, resumed, cached }) => {
        const names = (latestAiContract.reportPlan?.topics || [])
          .filter(topic => topicIds.includes(topic.id))
          .map(topic => topic.title)
          .join("、");
        aiReadingStatus.textContent = cached
          ? "已找到当前会话的完整报告，正在重新校验证据…"
          : resumed
            ? `已恢复第 ${completed + 1}/${total} 批缓存：${names || "已完成主题"}；继续检查后续内容…`
            : completed >= total
          ? "全部主题已生成，正在进行最终证据校验与合并…"
          : `正在分批生成报告（${completed + 1}/${total}）${names ? `：${names}` : ""}`;
      }
    });
    renderAiReading(output);
    aiReadingCacheClear.hidden = false;
    const firstSystem = reportTopicMeta(output.sections[0]?.topic)?.system;
    const system = firstSystem || (latestAiContract?.systems?.bazi ? "bazi" : "ziwei");
    const label = system === "bazi" ? "八字" : "紫微";
    aiReadingStatus.textContent = `${label} ${output.sections.length} 个主题报告 · 输出协议 ${output.schemaVersion} · ${output.audit.evidenceCount} 条证据引用通过校验`;
    rememberReport(output, system, label);
  } catch (error) {
    aiReadingStatus.textContent = error.code === "AI_NOT_CONFIGURED"
      ? "服务端接口已接通，但尚未配置模型密钥；当前没有发送到模型，也未产生费用。"
      : `解读未完成：${error.message || "服务暂不可用"}`;
  } finally {
    aiReadingButton.disabled = !aiReadingConsent.checked;
  }
});

if (annualYearPick) {
  annualYearPick.addEventListener("change", async () => {
    const base = annualContract || latestAiContract;
    if (!base) return;
    const year = Number(annualYearPick.value);
    const previous = Number(base?.reportPlan?.annualYear) || annualTargetYear(base);
    annualYearPick.disabled = true;
    try {
      const next = await annualContractFor(base, year);
      prepareAnnualReading(next);
      if (Number(next?.reportPlan?.annualYear) !== year) {
        annualReadingStatus.textContent = `这一年暂时算不出来，已退回 ${previous} 年。`;
      }
    } catch (error) {
      annualReadingStatus.textContent = `按 ${year} 年重算失败：${error?.message || "未知原因"}；已保留 ${previous} 年。`;
      annualYearPick.value = String(previous || "");
    } finally {
      annualYearPick.disabled = false;
    }
  });
}

annualReadingButton.addEventListener("click", async () => {
  if (!latestAiContract) return;
  if (!aiReadingConsent.checked) {
    annualReadingStatus.textContent = "请先勾选上方的数据使用授权；未授权不会发送资料。";
    aiReadingConsent.focus();
    return;
  }
  const contract = annualContract || latestAiContract;
  const year = annualTargetYear(contract);
  annualReadingButton.disabled = true;
  try {
    const output = await window.MingliAiInterpretation.requestAnnual(contract, {
      provider: "deepseek",
      consent: true,
      onProgress: ({ completed, total, topicIds, resumed, cached }) => {
        const names = (contract.reportPlan?.topics || [])
          .filter(topic => topicIds.includes(topic.id))
          .map(topic => topic.title)
          .join("、");
        annualReadingStatus.textContent = cached
          ? `已找到 ${year} 年完整年度报告，正在重新校验…`
          : resumed
            ? `已恢复年度报告第 ${completed + 1}/${total} 批缓存：${names}`
            : completed >= total
              ? "六个年度主题已生成，正在合并与校验证据…"
              : `正在生成年度报告（${completed + 1}/${total}）：${names}`;
      }
    });
    renderAnnualReading(output);
    rememberReport(output, `annual-${year}`, `${year} 年度`);
    lastAnnualRecord = lastAiRecord;
    if (downloadAnnualReadingButton) downloadAnnualReadingButton.hidden = false;
    aiReadingCacheClear.hidden = false;
    annualReadingStatus.textContent = `${year} 年度六主题报告已完成 · ${output.audit.evidenceCount} 条证据引用通过校验`;
  } catch (error) {
    annualReadingStatus.textContent = `年度解读未完成：${error.message || "服务暂时不可用"}`;
  } finally {
    annualReadingButton.disabled = !aiReadingConsent.checked;
  }
});

aiReadingConsent.addEventListener("change", () => {
  aiReadingButton.disabled = !aiReadingConsent.checked;
  annualReadingButton.disabled = !aiReadingConsent.checked;
  if (!aiReadingConsent.checked) aiReadingStatus.textContent = "未勾选授权，不会发送资料。";
});

aiReadingCacheClear.addEventListener("click", () => {
  if (!latestAiContract) return;
  window.MingliAiInterpretation.clearReportCache(latestAiContract);
  aiReadingResult.replaceChildren();
  aiReadingResult.hidden = true;
  aiReadingCacheClear.hidden = true;
  aiReadingStatus.textContent = "本机临时报告已清除；排盘事实仍在当前页面，未发送新的模型请求。";
  annualReadingResult.replaceChildren();
  annualReadingResult.hidden = true;
  annualReadingStatus.textContent = "本机临时年度报告已清除；需要时可重新生成。";
});

function formatStar(star) {
  return [star.name, star.brightness, star.transformation ? `化${star.transformation}` : null].filter(Boolean).join(" · ");
}

function formatPeriodHua(item, includeDecadal = false) {
  const bindings = [`本命${item.natalPalace}`];
  if (includeDecadal && item.decadalPalace) bindings.push(`大限${item.decadalPalace}`);
  bindings.push(`${includeDecadal ? "流年" : "大限"}${item.periodPalace}`);
  return `化${item.kind} · ${item.star}：${bindings.join(" → ")}`;
}

function formatJiChain(chain) {
  if (!chain?.steps?.length) return `${chain?.startPalace || "未知宫位"}：暂不可追踪`;
  const path = [chain.steps[0].fromPalace, ...chain.steps.map(step => `${step.star}忌→${step.toPalace}`)];
  return `${path.join(" · ")} · ${chain.termination === "loop" ? `回到${chain.loopPalace}形成闭环` : "追踪中止"}`;
}

function renderZiwei(result) {
  ziweiContent.replaceChildren();

  if (result.status !== "ok") {
    const state = make("section", null, `ziwei-state ziwei-state-${result.status}`);
    const message = result.reason?.message || result.error?.message || "紫微排盘暂时不可用。";
    state.append(
      make("h3", result.status === "unavailable" ? "还差出生时辰" : "紫微排盘未完成"),
      make("p", message)
    );
    if (result.status === "unavailable") {
      const action = make("button", "补充具体出生时间", "button button-quiet");
      action.type = "button";
      action.addEventListener("click", () => {
        branchMode = false;
        form.elements.timeBranch.value = "";
        updateConditionalFields();
        form.elements.birthTime.focus();
        form.elements.birthTime.scrollIntoView({ block: "center" });
      });
      state.append(action);
    }
    ziweiContent.append(state);
    return;
  }

  const calendar = make("div", null, "calendar-line ziwei-calendar-line");
  calendar.append(
    make("span", `公历 ${result.calendarDisplay.solar}`),
    make("span", `农历 ${result.calendarDisplay.lunar}`),
    make("span", result.calendarDisplay.time)
  );

  const interpretation = window.MingliZiweiInterpretation?.interpret(result);
  const guide = make("section", null, "reading-guide ziwei-guide");
  guide.append(
    make("h3", "先看白话，再看术语", "reading-guide-title"),
    make("p", interpretation?.introduction || "下面先把宫位翻译成日常问题，专业盘面放在最后供核对。", "reading-guide-copy")
  );

  const plainFacts = make("dl", null, "ziwei-plain-facts");
  (interpretation?.facts || []).forEach(fact => {
    const item = make("div");
    item.append(make("dt", fact.label), make("dd", fact.value), make("p", fact.explanation));
    plainFacts.append(item);
  });

  const plainHeading = make("div", null, "ziwei-plain-heading");
  plainHeading.append(make("h3", interpretation?.heading || "六个生活问题"), make("p", "先读与你有关的问题，再按盘面依据核对。"));

  const themes = make("div", null, "ziwei-theme-list");
  (interpretation?.themes || []).forEach(theme => {
    const article = make("article", null, "ziwei-theme");
    const title = make("div", null, "ziwei-theme-title");
    title.append(make("h4", theme.title), make("span", theme.evidence));
    article.append(
      title,
      make("p", theme.summary, "ziwei-theme-summary"),
      make("p", theme.question, "ziwei-theme-question")
    );
    themes.append(article);
  });

  const boundary = make("p", interpretation?.boundary || result.disclaimer, "ziwei-boundary");
  const currentPeriod = result.aiFacts?.periods?.current;
  let cycleSummary = null;
  let cycleEvidence = null;
  if (currentPeriod?.decadal && currentPeriod?.annual) {
    const decade = currentPeriod.decadal;
    const annual = currentPeriod.annual;
    const annualSoul = annual.palaceOverlay.find(row => row.periodPalace === "命宫");
    cycleSummary = make("section", null, "ziwei-cycle-summary");
    cycleSummary.append(
      make("h3", "现在走到哪一段", "ziwei-cycle-title"),
      make("p", "大限是十年观察坐标，流年是其中一年的观察坐标。这里只说明盘面叠在哪里，不把它直接说成一定会发生的事情。", "ziwei-cycle-intro")
    );
    const cycleRows = make("div", null, "ziwei-cycle-rows");
    const decadeRow = make("article");
    decadeRow.append(
      make("span", "十年阶段"),
      make("h4", `${decade.yearRange[0]}—${decade.yearRange[1]} · 虚岁 ${decade.ageRange[0]}—${decade.ageRange[1]}`),
      make("p", `大限命宫叠在本命${decade.natalAnchorPalace}。这是这十年的排盘读取起点，不等于一定发生某类事件。`)
    );
    const annualRow = make("article");
    annualRow.append(
      make("span", "今年坐标"),
      make("h4", `${annual.year} · ${annual.ganzhi} · 虚岁 ${annual.nominalAge}`),
      make("p", annualSoul
        ? `流年命宫与本命${annualSoul.natalPalace}、大限${annualSoul.decadalPalace}落在同一位置。`
        : "本年度叠宫坐标暂不可用。")
    );
    cycleRows.append(decadeRow, annualRow);
    cycleSummary.append(cycleRows);

    cycleEvidence = make("details", null, "ziwei-cycle-evidence");
    cycleEvidence.append(make("summary", "查看当前大限与流年四化落点"));
    const evidenceList = make("ul");
    decade.fourTransformations.forEach(item => evidenceList.append(make("li", formatPeriodHua(item))));
    annual.fourTransformations.forEach(item => evidenceList.append(make("li", formatPeriodHua(item, true))));
    cycleEvidence.append(evidenceList);
  }

  const professional = make("details", null, "ziwei-professional");
  professional.append(make("summary", "查看专业十二宫盘面（用于核对）"));
  const professionalInner = make("div", null, "ziwei-professional-inner");
  const facts = make("dl", null, "ziwei-facts");
  [
    ["命宫", result.basics.soulPalaceBranch],
    ["身宫", result.basics.bodyPalaceBranch],
    ["五行局", result.basics.fiveElementsClass],
    ["命主", result.basics.soulRuler],
    ["身主", result.basics.bodyRuler]
  ].forEach(([label, value]) => {
    const item = make("div");
    item.append(make("dt", label), make("dd", value));
    facts.append(item);
  });

  const heading = make("div", null, "ziwei-section-heading");
  heading.append(make("h3", "十二宫排盘"), make("p", "宫位、干支与星曜为原始排盘数据；其他星曜按需展开。"));

  let chartBasisEvidence = null;
  if (result.dualFourPillars || result.aiFacts?.periods?.childhood?.length || result.aiFacts?.corrections?.length) {
    chartBasisEvidence = make("details", null, "ziwei-cycle-evidence");
    chartBasisEvidence.append(make("summary", "查看双四柱、童限与排盘口径"));
    const basisBody = make("div", null, "ziwei-flying-body");
    if (result.dualFourPillars) {
      const pillars = make("ul", null, "ziwei-chain-list");
      pillars.append(
        make("li", `节气四柱：${result.dualFourPillars.solarTermPillars.join(" · ")}`),
        make("li", `农历口径四柱：${result.dualFourPillars.lunarCalendarPillars.join(" · ")}（闰月：${result.dualFourPillars.lunarMonthPolicy}）`)
      );
      basisBody.append(pillars);
    }
    const childhood = result.aiFacts?.periods?.childhood || [];
    if (childhood.length) {
      basisBody.append(make("p", `童限：${childhood.map(item => `${item.nominalAge} 岁 ${item.year} 年→${item.natalAnchorPalace}`).join("；")}`, "ziwei-flying-note"));
    }
    const schoolRules = result.ruleProfile.schoolRules || {};
    const ruleList = make("ul", null, "ziwei-chain-list");
    Object.entries(schoolRules).forEach(([name, value]) => ruleList.append(make("li", `${name}：${value}`)));
    basisBody.append(make("p", "当前采用的默认规则档案：", "ziwei-flying-note"), ruleList);
    const corrections = result.aiFacts?.corrections || [];
    if (corrections.length) {
      const correctionList = make("ul", null, "ziwei-chain-list");
      corrections.forEach(item => correctionList.append(make("li", `${item.star}：${item.reason}（${item.toPalace || "未落宫"}）`)));
      basisBody.append(make("p", "本盘实际执行的金标准修正：", "ziwei-flying-note"), correctionList);
    }
    chartBasisEvidence.append(basisBody);
  }

  let flyingEvidence = null;
  if (result.aiFacts?.palaceFlying?.length) {
    flyingEvidence = make("details", null, "ziwei-flying-evidence");
    flyingEvidence.append(make("summary", "查看本命十二宫飞化与化忌链"));
    const body = make("div", null, "ziwei-flying-body");
    body.append(make("p", "这是宫干推导出的结构化落点，只供专业核对：禄、权、科、忌不是简单的好坏标签，不能脱离整盘直接下结论。", "ziwei-flying-note"));
    const flyingList = make("ul", null, "ziwei-flying-list");
    result.palaces.forEach(palace => {
      const rows = result.aiFacts.palaceFlying.filter(item => item.sourcePalace === palace.name);
      const bindings = rows.map(item => `化${item.kind} ${item.star}→${item.targetPalace}`).join(" · ");
      flyingList.append(make("li", `${palace.name}（${palace.heavenlyStem}干）：${bindings}`));
    });
    body.append(flyingList);

    const chainDetails = make("details", null, "ziwei-ji-chains");
    chainDetails.append(make("summary", "查看十二宫化忌链（专业事实）"));
    const chainList = make("ul", null, "ziwei-chain-list");
    result.aiFacts.jiChains.forEach(chain => chainList.append(make("li", formatJiChain(chain))));
    chainDetails.append(chainList);
    body.append(chainDetails);

    const transformations = result.aiFacts.selfTransformations || [];
    const inwardCount = transformations.filter(item => item.direction === "inward").length;
    const outwardCount = transformations.filter(item => item.direction === "outward").length;
    body.append(make(
      "p",
      transformations.length
        ? `已按同宫离心、对宫向心的位置规则识别 ${transformations.length} 条自化：向心 ↑ ${inwardCount} 条，离心 ↓ ${outwardCount} 条。`
        : "当前盘未识别到自化结构。",
      "ziwei-flying-warning"
    ));
    if (transformations.length) {
      const transformList = make("ul", null, "ziwei-chain-list");
      transformations.forEach(item => transformList.append(make("li", `${item.palace}：${item.star}化${item.kind}${item.symbol}（由${item.sourcePalace}宫干触发）`)));
      body.append(transformList);
    }
    flyingEvidence.append(body);
  }

  let fineTimingEvidence = null;
  if (result.aiFacts?.fineTiming?.status === "pass") {
    const fine = result.aiFacts.fineTiming;
    fineTimingEvidence = make("details", null, "ziwei-cycle-evidence");
    fineTimingEvidence.append(make("summary", `查看 ${fine.solarDate} 的流月、流日与流时坐标`));
    const list = make("ul");
    [["流月", fine.current.monthly], ["流日", fine.current.daily], ["流时", fine.current.hourly]].forEach(([label, item]) => {
      list.append(make("li", `${label} ${item.ganzhi}：${item.fourTransformations.map(row => `${row.star}化${row.kind}→本命${row.natalPalace}`).join("；")}`));
    });
    fineTimingEvidence.append(
      make("p", "这是当前时间的五层叠宫与四化坐标，只作为后续解释的可核对证据，不直接等同于事件预测。", "ziwei-flying-note"),
      list
    );
  }

  const grid = make("div", null, "ziwei-palace-grid");
  result.palaces.forEach(palace => {
    const card = make("article", null, "ziwei-palace");
    const title = make("div", null, "ziwei-palace-title");
    const titleText = make("div");
    titleText.append(make("h4", palace.name), make("p", palace.topic));
    const position = make("span", `${palace.heavenlyStem}${palace.earthlyBranch}`, "ziwei-palace-position");
    title.append(titleText, position);
    if (palace.isBodyPalace) title.append(make("span", "身宫在此", "ziwei-body-mark"));

    const major = make("div", null, "ziwei-major-stars");
    if (palace.majorStars.length) {
      palace.majorStars.forEach(star => major.append(make("span", formatStar(star))));
    } else {
      major.append(make("span", "无十四主星", "ziwei-empty-star"));
      if (palace.borrowedMajorStars.length) {
        major.append(make("span", `借对宫${palace.borrowedFromPalace}主星：${palace.borrowedMajorStars.join("、")}`, "ziwei-empty-star"));
      }
    }
    card.append(title, major);

    const supporting = [...palace.minorStars, ...palace.auxiliaryStars];
    if (supporting.length) {
      const details = make("details", null, "ziwei-supporting");
      details.append(
        make("summary", `查看其他星曜（${supporting.length}）`),
        make("p", supporting.map(formatStar).join("、"))
      );
      card.append(details);
    }
    if (palace.minorLimitAges.length) {
      const minorLimit = make("details", null, "ziwei-supporting");
      minorLimit.append(make("summary", "查看小限年龄"), make("p", `虚岁 ${palace.minorLimitAges.join("、")}`));
      card.append(minorLimit);
    }
    grid.append(card);
  });

  const dynamicChecks = result.aiFacts
    ? Object.values(result.aiFacts.periods.validation).flatMap(group => group.checks)
    : [];
  const flyingChecks = result.aiFacts?.flyingValidation?.checks || [];
  const fineTimingChecks = result.aiFacts?.fineTiming
    ? Object.values(result.aiFacts.fineTiming.validation).flatMap(group => group.checks)
    : [];
  const factStatus = result.aiFacts
    ? ` · AI 事实包：${result.aiFacts.schemaVersion} · 本命 ${result.aiFacts.validation.checks.filter(check => check.pass).length}/${result.aiFacts.validation.checks.length}、运限 ${dynamicChecks.filter(check => check.pass).length}/${dynamicChecks.length}、飞化 ${flyingChecks.filter(check => check.pass).length}/${flyingChecks.length}、月日时 ${fineTimingChecks.filter(check => check.pass).length}/${fineTimingChecks.length} 项校验通过 · 指纹 ${result.aiFacts.fingerprint}`
    : " · AI 事实包未生成";
  const solarTimeStatus = result.ruleProfile.trueSolarTime ? "已启用真太阳时" : "未启用真太阳时";
  const source = make("p", `排盘引擎：${result.engine.name} ${result.engine.version} · 规则：${result.ruleProfile.id} · ${solarTimeStatus}${factStatus}`, "ziwei-source");
  professionalInner.append(facts);
  if (chartBasisEvidence) professionalInner.append(chartBasisEvidence);
  if (cycleEvidence) professionalInner.append(cycleEvidence);
  if (fineTimingEvidence) professionalInner.append(fineTimingEvidence);
  if (flyingEvidence) professionalInner.append(flyingEvidence);
  professionalInner.append(heading, grid, source);
  professional.append(professionalInner);
  ziweiContent.append(calendar, guide, plainFacts);
  if (cycleSummary) ziweiContent.append(cycleSummary);
  ziweiContent.append(plainHeading, themes, boundary, professional);
}

function selectSystem(system, options = {}) {
  const isBazi = system === "bazi";
  document.querySelector("#system-bazi").setAttribute("aria-selected", String(isBazi));
  document.querySelector("#system-bazi").tabIndex = isBazi ? 0 : -1;
  document.querySelector("#system-ziwei").setAttribute("aria-selected", String(!isBazi));
  document.querySelector("#system-ziwei").tabIndex = isBazi ? -1 : 0;
  resultContent.hidden = !isBazi;
  ziweiContent.hidden = isBazi;
  document.querySelector("#result-subtitle").textContent = isBazi ? "八字排盘完成 · 北京时间" : "紫微斗数排盘结果";
  // 解读面板跟着当前体系走：切到哪套就只喂哪套合同。
  const contract = aiContracts[system];
  if (contract) prepareAiReading(contract);
  // 页签在页面中部，点了之后如果变化发生在视口之外，看起来就像「没反应」。
  // 只在用户主动切换时滚动，提交后的默认选中不滚动（会打断人看出生信息）。
  if (options.scroll) {
    const panel = isBazi ? resultContent : ziweiContent;
    try {
      panel.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      panel.scrollIntoView();
    }
  }
}

function renderInterpretation(data) {
  const model = window.MingliInterpretation?.describe(data.calculation);
  const section = document.querySelector("#interpretation-section");
  if (!model) {
    section.hidden = true;
    return;
  }

  const dayMaster = document.querySelector("#day-master-summary");
  dayMaster.replaceChildren(
    make("span", "看盘的起点", "day-master-label"),
    make("strong", `${model.dayMaster.stem} · ${model.dayMaster.element}`, "day-master-title"),
    make("p", model.dayMaster.reading)
  );

  const cards = document.querySelector("#interpretation-cards");
  cards.replaceChildren(...model.pillars.map(item => {
    const card = make(item.unknown ? "article" : "details", null, `reading-card${item.unknown ? " reading-card-unknown" : ""}`);
    const heading = make(item.unknown ? "div" : "summary", null, "reading-card-summary");
    const title = make("div", null, "reading-card-title");
    title.append(make("strong", item.title), make("span", item.domain));
    heading.append(title, make("span", item.ganzhi || "未知", "reading-ganzhi"));
    const preview = make("p", item.headline, "reading-preview");
    if (item.unknown) {
      card.append(heading, preview, make("p", item.reading, "reading-copy"));
    } else {
      card.append(heading);
      const detail = make("div", null, "reading-card-detail");
      detail.append(make("p", item.reading, "reading-copy"));
      if (item.hiddenStems.length) {
        detail.append(make("h4", "地支中还藏有"));
        const hidden = make("ul", null, "hidden-stem-list");
        item.hiddenStems.forEach(stem => {
          const relation = stem.tenGod ? `白话参考：${stem.meaning}（传统标签：${stem.tenGod}）` : stem.meaning;
          hidden.append(make("li", `${stem.stem}（${stem.element}） · ${relation}`));
        });
        detail.append(hidden);
      }
      card.append(preview, detail);
    }
    return card;
  }));
  document.querySelector("#interpretation-note").textContent = model.note;
  section.hidden = false;
}

function renderPillars(pillars) {
  const grid = document.querySelector("#pillar-grid");
  grid.replaceChildren(...Object.entries(pillarNames).map(([key, label]) => {
    const item = make("div");
    const pillar = pillars[key];
    item.append(make("span", label), make("strong", pillar ? pillar.ganzhi : "未知"));
    const detail = pillar
      ? [
          pillar.ten_god || "日主",
          `日主十二长生：${pillar.day_master_life_stage}`,
          ...(pillar.hidden_stems || []).map(value => `${value.stem}${value.role}`)
        ].join(" · ")
      : "未提供时刻";
    item.append(make("small", detail));
    return item;
  }));
}

function renderSummary(data) {
  const calculation = data.calculation;
  const derived = calculation.derived;
  const luck = calculation.luck_cycles;
  const panel = document.querySelector("#panel-summary");
  const facts = make("dl", null, "facts");
  [["日主（关系参照点）", derived.day_master], ["大运排序", luck.direction === "forward" ? "顺排" : "逆排"], ["约起运年龄", `${luck.start.years} 岁 ${luck.start.months} 个月`]].forEach(([name, value]) => {
    const wrapper = make("div");
    wrapper.append(make("dt", name), make("dd", value));
    facts.append(wrapper);
  });
  panel.replaceChildren(facts);
  panel.append(make("p", "“日主”是日柱上方的天干，用来计算其他干支与它的传统关系，不是性格总评。“顺排/逆排”只说干支按哪个方向排列，不代表好坏。", "facts-note"));

  const ruleLayer = data.ai_facts?.derived_rules;
  if (ruleLayer?.validation?.status === "pass") {
    const ruleSection = make("section", null, "bazi-rule-layer");
    const ruleHeading = make("div", null, "bazi-rule-heading");
    const headingCopy = make("div");
    headingCopy.append(
      make("h3", "八字规则推导层"),
      make("p", "以下是固定规则计算出的候选结论。分数、成立证据、反证和规则边界都会一起保留，AI只能解释，不能改写。")
    );
    ruleHeading.append(headingCopy, make("span", ruleLayer.rule_profile.id, "bazi-rule-profile"));

    const strength = ruleLayer.strength;
    const pattern = ruleLayer.pattern;
    const climate = ruleLayer.climate_adjustment;
    const useful = ruleLayer.useful_elements;
    const usefulResolution = useful.resolution;
    const usefulStatusLabels = { consensus: "跨轴共识", "context-candidate": "情境候选", "conflict-unresolved": "冲突待定" };
    const usefulBasisLabels = {
      "cross-axis-consensus": "两轴以上同取且无反向意见",
      "profile-priority-climate": "无共识时按调候优先",
      "profile-priority-pattern": "无共识时按格局补位",
      "profile-priority-balance": "无共识时按扶抑补位",
      "no-unconflicted-candidate": "暂无无冲突候选"
    };
    const overview = make("div", null, "bazi-rule-overview");
    const strengthCard = make("article", null, "bazi-rule-card");
    strengthCard.append(
      make("span", "旺衰候选"), make("strong", strength.conclusion),
      make("p", `生扶 ${Math.round(strength.supportRatio * 100)}% · 消耗克制 ${Math.round((1 - strength.supportRatio) * 100)}% · 置信度 ${strength.confidence}`)
    );
    const patternCard = make("article", null, "bazi-rule-card");
    patternCard.append(
      make("span", "首要格局候选"), make("strong", pattern.primaryCandidate || "资料不足"),
      make("p", pattern.candidates[0]
        ? `${pattern.candidates[0].status} · ${pattern.candidates[0].basis}`
        : "月令没有形成可列出的格局候选")
    );
    const climateCard = make("article", null, "bazi-rule-card");
    climateCard.append(
      make("span", "调候候选"),
      make("strong", climate.primaryStems?.length ? `主用 ${climate.primaryStems.join("、")}` : "资料不足"),
      make("p", `${climate.temperature} · ${climate.moisture} · ${climate.status === "full-table-candidate" ? "120 单元速查表已覆盖" : "资料覆盖待核"}`)
    );
    const repeatedCard = make("article", null, "bazi-rule-card");
    repeatedCard.append(
      make("span", "喜用三轴选择层"),
      make("strong", usefulResolution?.selectedCandidateElements?.join("、") || "暂无无冲突候选"),
      make("p", usefulResolution
        ? `${usefulStatusLabels[usefulResolution.status] || usefulResolution.status} · ${usefulBasisLabels[usefulResolution.selectionBasis] || usefulResolution.selectionBasis} · ${useful.conflicts.length} 项冲突保留`
        : (useful.conflicts.length ? `${useful.conflicts.length} 个五行存在取法冲突，需分开阅读` : "扶抑、格局与调候暂未发现直接冲突"))
    );
    overview.append(strengthCard, patternCard, climateCard, repeatedCard);

    const detailGrid = make("div", null, "bazi-rule-details");
    const strengthDetail = make("details", null, "bazi-rule-detail");
    strengthDetail.append(make("summary", "查看身强弱的逐项证据"));
    const factors = make("ul");
    factors.append(
      make("li", `得令：${strength.threeFactors.command.status} · 月令 ${strength.threeFactors.command.monthBranch} · 月令本气 ${strength.threeFactors.command.mainQiTenGod}`),
      make("li", `得地：${strength.threeFactors.roots.status} · 有效根气分 ${strength.threeFactors.roots.effectivePoints}`),
      make("li", `得势：${strength.threeFactors.momentum.status} · 透干印比 ${strength.threeFactors.momentum.visibleSupportCount} 项`),
      make("li", `生扶总分 ${strength.supportPoints}；消耗克制总分 ${strength.opposingPoints}`)
    );
    if (strength.followCandidate) factors.append(make("li", `特殊格局检查：${strength.followCandidate.name}（仅为严格候选）`));
    if (strength.dominantCandidate) factors.append(make("li", `特殊格局检查：${strength.dominantCandidate.name}（仅为严格候选）`));
    strength.uncertainty.forEach(item => factors.append(make("li", `待复核：${item}`)));
    strengthDetail.append(factors, make("p", strength.ruleNote, "bazi-rule-boundary"));

    const patternDetail = make("details", null, "bazi-rule-detail");
    patternDetail.append(make("summary", `查看格局候选（${pattern.candidates.length}）`));
    pattern.candidates.forEach(candidate => {
      const item = make("article", null, "bazi-pattern-candidate");
      item.append(make("strong", candidate.name), make("span", `${candidate.status} · 优先级 ${candidate.priority} · ${candidate.basis}`));
      const list = make("ul");
      candidate.requiredMatched.forEach(evidence => list.append(make("li", `成立：${evidence.label}`)));
      candidate.bonusMatched.forEach(evidence => list.append(make("li", `加分：${evidence.label}`)));
      candidate.breakingTriggered.forEach(evidence => list.append(make("li", `破格：${evidence.label}`)));
      item.append(list);
      patternDetail.append(item);
    });

    const usefulDetail = make("details", null, "bazi-rule-detail");
    usefulDetail.append(make("summary", "查看三类喜用取法与冲突"));
    const axisList = make("dl", null, "bazi-useful-axes");
    const axisLabels = { balance: "扶抑取法", pattern: "格局取法", climate: "调候取法" };
    Object.entries(useful.axes).forEach(([key, axis]) => {
      const values = [
        ...(axis.primaryElements || []), ...(axis.secondaryElements || []),
        ...(axis.coreElement ? [axis.coreElement] : []), ...(axis.supportingElements || []),
        ...(axis.primaryStems || []), ...(axis.secondaryStems || [])
      ];
      axisList.append(make("dt", axisLabels[key]), make("dd", [...new Set(values)].join("、") || "不指定单一五行"));
    });
    usefulDetail.append(axisList, make("p", useful.policy, "bazi-rule-boundary"));
    if (usefulResolution) {
      const selected = usefulResolution.selectedCandidateElements?.join("、") || "暂无";
      usefulDetail.append(make(
        "p",
        `选择层：${selected}；依据：${usefulBasisLabels[usefulResolution.selectionBasis] || usefulResolution.selectionBasis}。${usefulResolution.policy}`,
        "bazi-rule-boundary"
      ));
    }
    useful.conflicts.forEach(conflict => usefulDetail.append(make("p", `${conflict.element}：${conflict.favoredBy.join("、")}取为有利，但${conflict.avoidedBy.join("、")}列为回避，暂不合并。`, "bazi-rule-conflict")));

    const climateDetail = make("details", null, "bazi-rule-detail");
    climateDetail.append(
      make("summary", "查看调候覆盖范围"),
      make("p", climate.reason || climate.reference),
      make("p", climate.boundary, "bazi-rule-boundary")
    );
    if (climate.requestedStemStatus?.length) {
      const stemList = make("ul");
      climate.requestedStemStatus.forEach(item => stemList.append(make(
        "li",
        `${item.role === "primary" ? "主用" : "辅用"} ${item.stem}（${item.element}）· ${item.revealed ? "已透干" : item.hidden ? "藏支未透" : "原局未见"}`
      )));
      climateDetail.append(stemList);
    }
    detailGrid.append(strengthDetail, patternDetail, usefulDetail, climateDetail);
    const transformationItems = (data.ai_facts?.natal_relations || []).filter(item => item.transformation_review);
    const transformationDetail = make("details", null, "bazi-rule-detail bazi-transformation-review");
    transformationDetail.append(make("summary", `查看合化条件审计（${transformationItems.length}）`));
    if (transformationItems.length) {
      const statusLabels = {
        "supported-candidate": "条件较齐候选",
        "pending-candidate": "条件待补候选",
        "blocked-candidate": "存在阻断候选"
      };
      transformationItems.forEach(item => {
        const review = item.transformation_review;
        const row = make("article", null, "bazi-pattern-candidate");
        row.append(
          make("strong", `${item.values.join("、")} → ${review.target_element}`),
          make("span", `${statusLabels[review.status] || review.status} · 不改写原五行`)
        );
        const conditions = make("ul");
        review.supporting_conditions.forEach(value => conditions.append(make("li", `支持：${value}`)));
        review.blocking_conditions.forEach(value => conditions.append(make("li", `阻断：${value}`)));
        row.append(conditions, make("p", review.policy, "bazi-rule-boundary"));
        transformationDetail.append(row);
      });
    } else {
      transformationDetail.append(make("p", "原局没有需要进入成化条件审计的合会组合。", "bazi-rule-boundary"));
    }
    ruleSection.append(ruleHeading, overview, detailGrid, transformationDetail);
    panel.append(ruleSection);
  }

  if (derived.shensha.length) {
    panel.append(make("h3", "神煞（规则命中）", "subsection-title"));
    const tags = make("div", null, "tags");
    derived.shensha.forEach(item => {
      const tag = make("span", item.name, "tag");
      if (item.evidence) tag.title = item.evidence;
      tags.append(tag);
    });
    panel.append(tags);
  }
}

function renderLuck(data) {
  const panel = document.querySelector("#panel-luck");
  const calculation = data.calculation;
  const luck = calculation.luck_cycles;
  const start = `${luck.start.years} 岁${luck.start.months ? ` ${luck.start.months} 个月` : ""}`;
  const guide = make("div", null, "reading-guide");
  guide.append(make("h3", "先看懂这几个词", "reading-guide-title"));
  [
    ["起运", `按当前排盘规则估算，出生后约 ${start} 开始进入第一步大运。它指开始排大运的时间，不是“从这天起就会走好运”。`],
    ["大运", "把人生按约十年一段列出的干支阶段。年龄范围是这套引擎给出的估算段；受起运折算方式影响，不是精确到某月某日的交接时间。"],
    ["顺排 / 逆排", `只表示干支排列方向。本盘为${luck.direction === "forward" ? "顺排" : "逆排"}，不表示顺利或不顺利。`],
    ["下面的解读", "会把每步大运天干相对日主的十神标签翻译成观察主题；这只说明一个传统关系，不预测这十年会发生什么。"]
  ].forEach(([term, meaning]) => {
    const line = make("p", null, "reading-guide-line");
    line.append(make("strong", term), make("span", meaning));
    guide.append(line);
  });

  const list = make("div", null, "cycle-list");
  luck.cycles.forEach(cycle => {
    const beforeStart = cycle.sequence === "起运前";
    const entry = make("article", null, "cycle-entry");
    const heading = make("div", null, "cycle-entry-heading");
    heading.append(
      make("strong", beforeStart ? "起运前 · 小运" : `第 ${cycle.sequence} 步大运`),
      make("span", cycle.age_range, "cycle-age"),
      make("b", cycle.ganzhi, "cycle-ganzhi")
    );
    entry.append(heading);
    const text = beforeStart
      ? `这是出生到约 ${start} 进入第一步大运前的区间。当前引擎在这里沿用月柱${cycle.ganzhi.replace("（小运）", "")}作为“小运”显示；它不是一整步大运。`
      : window.MingliInterpretation.explainCycle(cycle.ganzhi, calculation.derived.day_master, `第 ${cycle.sequence} 步大运`);
    entry.append(make("p", text, "cycle-reading"));
    list.append(entry);
  });
  panel.replaceChildren(guide, list);
}

function renderAnnual(data) {
  const panel = document.querySelector("#panel-annual");
  const calculation = data.calculation;
  const guide = make("div", null, "reading-guide annual-guide");
  guide.append(
    make("h3", "流年是“每一年的干支”", "reading-guide-title"),
    make("p", "下面逐年比较当年天干和你的日主。“十神”就是两者关系的分类标签，不是十位神仙，也不是人物评价。每行只解释天干这一项；传统判断还会结合本命盘、大运等信息，本工具不把它当作具体事件或吉凶预测。", "reading-guide-copy")
  );
  const list = make("div", null, "annual-list");
  const annualCycles = [...calculation.annual_cycles].sort((left, right) => Number(right.year) - Number(left.year));
  annualCycles.forEach(cycle => {
    const item = make("article", null, "annual-reading");
    const year = make("time", cycle.year, "annual-year");
    year.dateTime = String(cycle.year);
    const ganzhi = make("strong", cycle.ganzhi, "annual-ganzhi");
    if (Number(cycle.year) === new Date().getFullYear()) item.append(year, ganzhi, make("span", "今年", "annual-current"));
    else item.append(year, ganzhi);
    item.append(make("p", window.MingliInterpretation.explainCycle(cycle.ganzhi, calculation.derived.day_master, `${cycle.year} 年这一流年`), "annual-reading-copy"));
    list.append(item);
  });
  panel.replaceChildren(guide, list);
}

function renderSource(data) {
  const calculation = data.calculation;
  const rules = calculation.rule_profile;
  const values = [
    ["排盘引擎", calculation.engine.name],
    ["固定提交", calculation.engine.commit],
    ["规则配置", calculation.rule_profile.id],
    ["年界", rules.year_boundary],
    ["月界", rules.month_boundary],
    ["日界", rules.day_boundary],
    ["真太阳时", rules.true_solar_time ? "已启用" : "未启用"],
    ["时区", rules.timezone]
  ];
  const list = make("dl", null, "source-list");
  values.forEach(([name, value]) => {
    const wrapper = make("div");
    wrapper.append(make("dt", name), make("dd", value));
    list.append(wrapper);
  });
  document.querySelector("#panel-source").replaceChildren(list);
}

function renderResult(data) {
  const calculation = data.calculation;
  document.querySelector("#solar-display").textContent = calculation.calendar_display.solar;
  document.querySelector("#lunar-display").textContent = calculation.calendar_display.lunar;
  document.querySelector("#result-subtitle").textContent = "八字排盘完成 · 北京时间";
  document.querySelector("#result-stamp").textContent = "已计算";
  renderPillars(calculation.pillars);
  renderInterpretation(data);
  renderSummary(data);
  renderLuck(data);
  renderAnnual(data);
  renderSource(data);

  const warnings = document.querySelector("#warning-list");
  warnings.replaceChildren(...data.warnings.map(item => make("p", item.message)));
  warnings.hidden = data.warnings.length === 0;
  resultContent.hidden = false;
  requestAnimationFrame(() => resultContent.classList.add("is-revealed"));
}

function renderServerError(error) {
  const message = error?.message || "暂时无法完成计算，请稍后再试。";
  errorList.replaceChildren(make("li", message));
  errorSummary.hidden = false;
  errorSummary.focus();
  document.querySelector("#result-subtitle").textContent = "计算未完成";
  document.querySelector("#result-stamp").textContent = "需修正";
}

function setLoading(loading) {
  submitButton.disabled = loading;
  resultPanel.setAttribute("aria-busy", String(loading));
  submitButton.querySelector("span").textContent = loading ? "正在计算" : "开始排盘";
  if (loading) {
    emptyState.hidden = true;
    systemSwitch.hidden = true;
    resultContent.hidden = true;
    resultContent.classList.remove("is-revealed");
    ziweiContent.hidden = true;
    aiReadingSection.hidden = true;
    clearAnnualTimeline();
    latestAiContract = null;
    aiContracts = { bazi: null, ziwei: null };
    loadingState.hidden = false;
  } else {
    loadingState.hidden = true;
  }
}

// ---------------------------------------------------------------- 年度时间轴
// 只展示确定性事实：八字流月坐标、四层关系条数、逐月大运状态、紫微流月状态。
// 与既有 20 主题报告、6 主题年度报告完全隔离：不复用它们的 DOM、缓存或渲染函数。

function createLine(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function clearAnnualTimeline() {
  annualTimelineSection.hidden = true;
  annualTimelineYear.textContent = "—";
  annualTimelineSummary.textContent = "";
  annualTimelineFingerprints.textContent = "";
  annualTimelineChecks.replaceChildren();
  annualTimelineMonths.replaceChildren();
}

const ZIWEI_STATUS_TEXT = window.MingliAnnualTimeline?.ziweiStatusText || {};

function renderAnnualTimeline(data, ziweiResult) {
  // 时间轴是附加视图：任何失败都不能影响既有报告链路，
  // 所以这里自成一个 try/catch，出错只隐藏本区块。
  try {
    renderAnnualTimelineUnsafe(data, ziweiResult);
  } catch (error) {
    clearAnnualTimeline();
    console.warn("年度时间轴渲染失败，已跳过，不影响其他报告。", error);
  }
}

function renderAnnualTimelineUnsafe(data, ziweiResult) {
  const monthly = data?.monthly_facts;
  if (!monthly || monthly.status !== "ok" || !Array.isArray(monthly.months)) {
    clearAnnualTimeline();
    return;
  }

  const timeline = window.MingliAnnualTimeline;
  const ziweiApi = window.MingliZiweiFacts;
  if (!timeline || !ziweiApi) {
    clearAnnualTimeline();
    return;
  }

  const targetYear = monthly.target_year;
  const specs = timeline.monthSpecsFrom(monthly);

  // 是否计算紫微流月由纯函数判定：未知时辰时不建盘、不猜
  const ziweiPlan = timeline.monthlyZiweiPlan(ziweiResult);
  let ziweiMonthly = { status: "unavailable", months: [] };
  if (ziweiPlan.shouldBuild) {
    ziweiMonthly = ziweiApi.buildMonthlyTiming(
      ziweiResult.astrolabe,
      ziweiResult.palaces,
      specs,
      currentShanghaiTimeIndex
    );
  }
  const ziweiNote = ziweiPlan.note;

  const pkg = timeline.build({
    baziMonthly: monthly,
    ziweiMonthly,
    targetYear,
    ziweiBlockedReason: ziweiNote
  });

  annualTimelineYear.textContent = `${targetYear} 年`;
  annualTimelineSummary.textContent = timeline.describeSummary(pkg, ziweiNote);

  const diagnostics = timeline.describeDiagnostics(pkg);
  annualTimelineFingerprints.textContent = [
    `声明 ${diagnostics.fingerprints.declared || "—"}`,
    `复算 ${diagnostics.fingerprints.recomputed || "—"}`,
    `${diagnostics.fingerprints.matches ? "一致" : "不一致"}`,
    `年度包 ${diagnostics.fingerprints.package || "—"}`
  ].join(" · ");

  annualTimelineChecks.replaceChildren(
    ...diagnostics.checks.map(item => {
      const row = createLine(
        "li",
        item.pass ? "annual-timeline-check is-pass" : "annual-timeline-check is-fail",
        `${item.pass ? "通过" : "未通过"} · ${item.id} — ${item.message}`
      );
      row.dataset.checkId = item.id;
      row.dataset.checkPass = String(item.pass);
      return row;
    })
  );

  annualTimelineMonths.replaceChildren(
    ...timeline.buildMonthlyView(pkg).map(view => {
      const card = createLine("article", "annual-timeline-month");
      card.dataset.monthIndex = String(view.index);
      card.dataset.ziweiStatus = view.ziweiStatus;
      card.append(
        createLine("h4", "annual-timeline-month-title", view.title),
        createLine("p", "annual-timeline-month-span", view.span),
        createLine("p", "annual-timeline-month-facts", view.facts),
        createLine("p", "annual-timeline-month-ziwei", view.ziwei)
      );

      if (view.ziweiDetails) {
        const details = document.createElement("details");
        details.className = "annual-timeline-month-details";
        details.append(createLine("summary", null, "紫微明细"));

        const list = document.createElement("ul");
        view.ziweiDetails.fourTransformations.forEach(row => {
          list.append(createLine(
            "li",
            "annual-timeline-four-hua",
            `四化 ${row.kind || "—"} · ${row.star || "—"} · 本命 ${row.natalPalace || "—"} → 流月 ${row.monthlyPalace || "—"}`
          ));
        });
        view.ziweiDetails.transitStars.forEach(star => {
          list.append(createLine(
            "li",
            "annual-timeline-transit-star",
            `流曜 ${star.name || "—"} · 本命 ${star.natalPalace || "—"} → 流月 ${star.periodPalace || "—"}`
          ));
        });
        view.ziweiDetails.palaceOverlay.forEach(row => {
          list.append(createLine(
            "li",
            "annual-timeline-overlay",
            `叠宫 ${row.branch || "—"} · ${row.natalPalace || "—"} → ${row.monthlyPalace || "—"}`
          ));
        });
        details.append(list);
        card.append(details);
      }

      card.append(
        createLine("p", "annual-timeline-month-evidence", `证据路径 ${view.evidenceCount} 条`)
      );
      return card;
    })
  );

  annualTimelineSection.hidden = false;
}

form.addEventListener("change", updateConditionalFields);
branchModeToggle.addEventListener("click", () => {
  branchMode = true;
  updateConditionalFields();
  document.querySelector("#time-branch").focus();
});
document.querySelector("#minute-mode-toggle").addEventListener("click", () => {
  branchMode = false;
  form.elements.timeBranch.value = "";
  updateConditionalFields();
  form.elements.birthTime.focus();
});
// 提成具名函数：测试可以直接拿到函数对象，不必模拟整个页面的 DOM
// ── 一页速览 ────────────────────────────────────────────────────────────
// 只做汇总与排序：八字看四柱与喜用，紫微看命宫与流年四化，
// 然后按这一年给出六个领域的倾向句。状态留在这里，方便换年份重算。
let overviewState = null;

const overviewSection = document.querySelector("#overview");
const overviewBody = document.querySelector("#overview-body");
const overviewYearTop = document.querySelector("#overview-year-top");

function overviewYears() {
  const cycles = overviewState?.bazi?.ai_facts?.annual_cycles;
  return Array.isArray(cycles) ? cycles.map(item => Number(item.year)).filter(Number.isFinite) : [];
}

function fillYearSelect(select, years, current) {
  if (!select) return;
  // 传进来的年份可能不在算好的范围内；直接丢掉会让 select 自己跳回第一个选项，
  // 用户看到的是「选了 2030 却显示 1990」。所以范围外的年份也补一项，并标注未算。
  const list = years.slice();
  if (Number.isFinite(Number(current)) && !list.includes(Number(current))) list.push(Number(current));
  list.sort((left, right) => left - right);
  select.innerHTML = "";
  list.forEach(year => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = years.includes(Number(year)) ? String(year) : `${year}（未算）`;
    if (Number(year) === Number(current)) option.selected = true;
    select.append(option);
  });
  select.disabled = years.length === 0;
}

function renderOverview(year) {
  if (!overviewSection || !overviewBody) return;
  const Overview = typeof window !== "undefined" ? window.MingliOverview : null;
  if (!Overview || typeof Overview.render !== "function" || !overviewState) {
    overviewSection.hidden = true;
    return;
  }
  const years = overviewYears();
  const target = Number(year) || years[0] || new Date().getFullYear();
  let model;
  try {
    model = Overview.build({ ...overviewState, year: target });
  } catch (error) {
    console.warn("一页速览生成失败（不影响排盘）", error);
    overviewSection.hidden = true;
    return;
  }
  overviewBody.innerHTML = Overview.render(model);
  fillYearSelect(overviewYearTop, years, target);
  fillYearSelect(overviewBody.querySelector("#overview-year"), years, target);
  overviewSection.hidden = model.status !== "ok";
  window.latestMingliOverview = model;
}

function setOverviewYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return;
  renderOverview(year);
}

if (overviewSection) {
  overviewSection.addEventListener("change", event => {
    const target = event.target;
    if (target && target.id === "overview-year") setOverviewYear(target.value);
  });
}
if (overviewYearTop) {
  overviewYearTop.addEventListener("change", event => setOverviewYear(event.target.value));
}

async function handleSubmit(event) {
  event.preventDefault();
  // 新提交一开始就清掉上一轮的年度时间轴：即使校验失败，也不能留着上次的年份
  clearAnnualTimeline();
  if (!validate()) return;
  errorSummary.hidden = true;
  setLoading(true);
  try {
    const requestPayload = payload();
    let data;
    if (typeof window.calculateInBrowser === "function") {
      data = await window.calculateInBrowser(requestPayload);
    } else {
      const response = await fetch("/api/v1/bazi/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      data = await response.json();
      if (!response.ok) throw data.error || new Error("计算失败");
    }
    if (data.status !== "ok") throw data.error || new Error("计算失败");
    renderResult(data);
    const ziweiProfile = {
      ...data.normalized_input.profile,
      calendar: "solar",
      date: data.normalized_input.profile.solar_date,
      is_leap_month: false
    };
    const ziweiResult = window.MingliZiwei.calculate(ziweiProfile, {
      asOfYear: requestPayload.options.annual_cycles_through,
      asOfDate: `${requestPayload.options.annual_cycles_through}-${currentShanghaiDate.slice(5)}`,
      asOfTimeIndex: currentShanghaiTimeIndex
    });
    renderZiwei(ziweiResult);
    renderAnnualTimeline(data, ziweiResult);
    // 一页速览：把两套体系压成「四柱 + 命宫 + 这一年六件事」，
    // 解决「不知道该看哪里」。它只是汇总，不新增任何判据。
    overviewState = {
      bazi: data,
      ziwei: ziweiResult,
      ziweiProfile,
      sex: requestPayload?.profile?.sex_for_calculation || null
    };
    // 换过一遍年份后，旧合同只对旧盘有效；新盘一律从空缓存开始。
    annualYearCache.clear();
    lastRequestPayload = requestPayload;
    // 速览只是读者：渲染失败不能把整次排盘带进错误分支。
    try {
      renderOverview(selectedFocusYear());
    } catch (error) {
      console.warn("一页速览渲染失败（不影响排盘）", error);
    }
    // 两套体系分别建合同：模型每次只看一套，结论不互相污染。
    // 两套体系分别建合同：模型每次只看一套，结论不互相污染。
    // 合同建不起来（事实包没通过校验、或只有一套能建）只影响解读，
    // 不能让整张盘跟着报错——排盘结果本身已经算完并渲染了。
    aiContracts = { bazi: null, ziwei: null };
    const contractNotes = [];
    [
      ["bazi", { bazi: data }, "八字"],
      ["ziwei", { ziwei: ziweiResult }, "紫微"],
    ].forEach(([system, input, label]) => {
      try {
        aiContracts[system] = window.MingliAiContract.build(input);
      } catch (error) {
        const code = error?.code || "CONTRACT_ERROR";
        contractNotes.push(`${label}：${code} ${error?.message || "AI 事实契约未建立"}`);
        console.warn(`AI 契约未建立（${label}）`, code, error);
      }
    });
    // 知识摘录：两套各挂各的，挂不上就降级成「不带出处」，不阻断解读。
    // 知识摘录是「加分项」：不阻塞提交，点解读时再等它（见 knowledgeReady）。
    // 提交路径上不 await，避免知识包慢/挂住时整次排盘卡在这里。
    knowledgeReady = attachKnowledge(aiContracts, ziweiResult);
    knowledgeReady.then((notes) => { window.latestMingliKnowledgeNotes = notes; }).catch(() => {});
    window.latestMingliAiContracts = aiContracts;
    systemSwitch.hidden = false;
    // 哪套能解读就先看哪套；两套都不行则如实说明原因，而不是让人对着一个坏掉的区块猜。
    if (aiContracts.bazi) selectSystem("bazi");
    else if (aiContracts.ziwei) selectSystem("ziwei");
    else renderContractUnavailable(contractNotes);
    // 入口页只是订阅者：它失败（或环境里没有 CustomEvent）不能影响排盘结果
    try {
      if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
        window.dispatchEvent(new window.CustomEvent("mingli:chart-ready", {
          detail: { payload: requestPayload, ziwei: ziweiResult, monthly: data.monthly_facts },
        }));
      }
    } catch (homeError) {
      console.warn("入口页记忆失败（不影响排盘）：", homeError);
    }
  } catch (error) {
    // 先清时间轴再渲染错误：即使错误渲染本身抛错，旧年份也不会留在页面上
    clearAnnualTimeline();
    renderServerError(error);
    emptyState.hidden = false;
  } finally {
    setLoading(false);
  }
}
form.addEventListener("submit", handleSubmit);

document.querySelectorAll(".tab-list [role=\"tab\"]").forEach(tab => {
  tab.addEventListener("click", () => {
    const tabList = tab.closest("[role=\"tablist\"]");
    tabList.querySelectorAll('[role="tab"]').forEach(item => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      document.querySelector(`#${item.getAttribute("aria-controls")}`).hidden = !active;
    });
  });
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const tabs = [...tab.closest("[role=\"tablist\"]").querySelectorAll('[role="tab"]')];
    const offset = event.key === "ArrowRight" ? 1 : -1;
    tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length].click();
    tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length].focus();
  });
});

systemSwitch.querySelectorAll('[role="tab"]').forEach(tab => {
  tab.addEventListener("click", () => selectSystem(tab.id === "system-bazi" ? "bazi" : "ziwei", { scroll: true }));
  tab.addEventListener("keydown", event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = tab.id === "system-bazi" ? document.querySelector("#system-ziwei") : document.querySelector("#system-bazi");
    next.click();
    next.focus();
  });
});

window.MingliDateInput.attachAutoAdvance({
  "birth-year": document.querySelector("#birth-year"),
  "birth-month": document.querySelector("#birth-month"),
  "birth-day": document.querySelector("#birth-day")
});
updateConditionalFields();

// ---------------------------------------------------------------- 入口页
// 第一屏只放「已经算过的东西」：命宫/身宫/五行局 + 今年三条主线。
// 没有记录时不显示摘要，只给一个跳转按钮；不在这里重新排盘。
(function initHome() {
  const homeRoot = document.querySelector("#home");
  const homeStart = document.querySelector("#home-start");
  const homeRecents = document.querySelector("#home-recents");
  const homeRecentList = document.querySelector("#home-recent-list");
  const homeSummary = document.querySelector("#home-summary");
  const homeSummaryHead = document.querySelector("#home-summary-head");
  const homeMainlines = document.querySelector("#home-mainlines");
  const homeMonthsNote = document.querySelector("#home-months-note");
  const homeLimits = document.querySelector("#home-limits");
  if (!homeRoot || !window.MingliHome) return;

  function scrollToForm() {
    document.querySelector("#input-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.birthYear?.focus({ preventScroll: true });
  }

  function renderSummary(record) {
    const summary = record && record.summary;
    if (!summary || summary.status !== "ok") {
      homeSummary.hidden = true;
      return;
    }
    homeSummaryHead.replaceChildren();
    const basics = summary.basics || {};
    const yearInfo = summary.yearInfo || {};
    homeSummaryHead.append(
      make("h3", summary.year ? `${summary.year} 年的盘` : "最近一次排盘"),
      make("p",
        [
          basics.soulPalace ? `命宫 ${basics.soulPalace}` : null,
          basics.bodyPalace ? `身宫 ${basics.bodyPalace}` : null,
          basics.fiveElementsClass ? basics.fiveElementsClass : null,
          yearInfo.ganzhi ? `${yearInfo.ganzhi} · 虚岁 ${yearInfo.nominalAge}` : null
        ].filter(Boolean).join(" · "),
        "home-summary-line")
    );
    if (yearInfo.decadal) {
      homeSummaryHead.append(make("p",
        `大限 ${yearInfo.decadal.range[0]}—${yearInfo.decadal.range[1]}（虚岁 ${yearInfo.decadal.ageRange[0]}—${yearInfo.decadal.ageRange[1]}）`,
        "home-summary-sub"));
    }

    homeMainlines.replaceChildren();
    const lines = summary.mainlines || [];
    if (!lines.length) {
      homeMainlines.append(make("li", summary.mainlinesSkipped || "今年没有触发规则清单里的引动。", "home-line is-empty"));
    } else {
      lines.forEach((line, index) => {
        const item = make("li", null, `home-line is-${line.kind || "neutral"}`);
        item.append(
          make("span", `${index + 1}`, "home-line-rank"),
          make("strong", line.title),
          make("p", line.text),
          make("code", line.basis || "", "home-line-basis")
        );
        homeMainlines.append(item);
      });
    }
    renderMonthGroups(summary.months);
    homeMonthsNote.textContent = summary.monthsNote || "";
    homeLimits.textContent = "第一屏只挑三条：规则来自流年/大限四化落在命宫、身宫、财帛、官禄这类位置，按优先级取前三；它不替代逐宫与年度细读。";
    homeSummary.hidden = false;
  }


  function renderMonthRow(row, kind) {
    const item = make("li", null, `home-month is-${kind}`);
    item.append(
      make("span", `${row.label} ${row.ganzhi}`, "home-month-title"),
      make("span", row.start ? `${row.start} 起` : "", "home-month-span"),
      make("p", row.text, "home-month-text"),
      make("code", row.basis || "", "home-month-basis")
    );
    return item;
  }

  function renderMonthGroups(months) {
    const prepareList = document.querySelector("#home-prepare-list");
    const slowList = document.querySelector("#home-slow-list");
    const monthNote = document.querySelector("#home-month-rules");
    if (!prepareList || !slowList) return;
    prepareList.replaceChildren();
    slowList.replaceChildren();
    if (!months || months.status !== "ok") {
      monthNote.textContent = (months && months.reason) || "没有逐月事实，这一屏不显示月份建议。";
      return;
    }
    months.prepare.forEach(row => prepareList.append(renderMonthRow(row, "prepare")));
    months.slow.forEach(row => slowList.append(renderMonthRow(row, "slow")));
    if (!months.prepare.length) prepareList.append(make("li", "这一年没有落在「提前准备」阈值上的月份。", "home-month is-empty"));
    if (!months.slow.length) slowList.append(make("li", "这一年没有落在「放慢」阈值上的月份。", "home-month is-empty"));
    monthNote.textContent = months.rules;
  }

  function renderHome() {
    const all = window.MingliHome.loadAll();
    homeRecentList.replaceChildren();
    if (!all.records.length) {
      homeRecents.hidden = true;
      homeSummary.hidden = true;
      return;
    }
    all.records.forEach((record, index) => {
      const item = make("li", null, "home-recent-item");
      const when = record.summary?.year ? `${record.summary.year} 年` : "上次排盘";
      const meta = record.input?.profile?.date || "";
      const soul = record.summary?.basics?.soulPalace;
      item.append(
        make("span", `${when}${soul ? ` · 命宫 ${soul}` : ""}${meta ? ` · ${meta}` : ""}`, "home-recent-meta")
      );
      const actions = make("span", null, "home-recent-actions");
      const open = make("button", "继续看", "home-recent-open");
      open.type = "button";
      open.addEventListener("click", () => restoreRecord(record));
      const remove = make("button", "删除", "home-recent-remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        window.MingliHome.removeAt(index);
        renderHome();
      });
      actions.append(open, remove);
      item.append(actions);
      homeRecentList.append(item);
    });
    homeRecents.hidden = false;
    renderSummary(all.records[0]);
    if (!all.available) {
      homeMonthsNote.textContent = "浏览器不允许本地保存，这次的盘刷新后不会留下。";
    }
  }

  function setRadio(name, value) {
    if (!value) return;
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function restoreRecord(record) {
    const profile = record.input?.profile;
    if (!profile) {
      scrollToForm();
      return;
    }
    setRadio("calendar", profile.calendar);
    const parts = String(profile.date || "").split("-");
    if (parts.length === 3) {
      form.elements.birthYear.value = parts[0];
      form.elements.birthMonth.value = parts[1];
      form.elements.birthDay.value = parts[2];
      [form.elements.birthYear, form.elements.birthMonth, form.elements.birthDay]
        .forEach(input => input.dispatchEvent(new Event("input", { bubbles: true })));
    }
    if (form.elements.isLeap) form.elements.isLeap.checked = Boolean(profile.is_leap_month);
    const time = profile.time || {};
    if (time.precision === "branch" && time.branch) {
      if (!branchMode) document.querySelector("#branch-mode-toggle")?.click();
      form.elements.timeBranch.value = time.branch;
    } else {
      if (branchMode) document.querySelector("#branch-mode-toggle")?.click();
      if (time.value) form.elements.birthTime.value = time.value;
    }
    setRadio("sex", profile.sex_for_calculation);
    const year = record.input?.options?.annual_cycles_through;
    if (year) {
      focusYearMode.value = "custom";
      focusYearCustom.value = String(year);
      focusYearMode.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (profile.birthplace?.label) form.elements.birthplaceLabel.value = profile.birthplace.label;
    if (profile.birthplace?.longitude !== null && profile.birthplace?.longitude !== undefined) {
      form.elements.birthLongitude.value = String(profile.birthplace.longitude);
    }
    form.elements.dstClock.checked = Boolean(record.input?.rules?.clock_time_is_dst);
    updateConditionalFields();
    scrollToForm();
  }

  homeStart?.addEventListener("click", scrollToForm);

  window.addEventListener("mingli:chart-ready", event => {
    const detail = event.detail || {};
    if (!detail.ziwei || !window.MingliHome) return;
    const year = detail.payload?.options?.annual_cycles_through;
    const summary = window.MingliHome.summarize(detail.ziwei, { year, monthly: detail.monthly });
    window.MingliHome.save(detail.payload, summary, {
      title: `${summary.basics?.soulPalace || ""}`
    });
    renderHome();
  });

  renderHome();
})();

// ---------------------------------------------------------------- 报告库
// 报告生成一次就不该消失：存进本机浏览器，从页头「报告库」随时翻回来。
// 只存模型输出与已校验的引用，不碰出生资料。

function archiveApi() {
  const api = window.MingliReportArchive;
  return api && typeof api.list === "function" && typeof api.save === "function" ? api : null;
}

function recordsOf(api) {
  try {
    const listed = api.list();
    return Array.isArray(listed && listed.records) ? listed.records : [];
  } catch (error) {
    return [];
  }
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function refreshArchiveBadge() {
  const api = archiveApi();
  if (!api || !openArchiveButton) return;
  const records = recordsOf(api);
  if (archiveCount) archiveCount.textContent = String(records.length);
  openArchiveButton.hidden = records.length === 0;
}

function rememberReport(output, system, systemLabel) {
  const api = archiveApi();
  if (!api || !output?.sections?.length) return;
  const saved = api.save({
    system,
    systemLabel,
    requirementId: output.requirementId || latestAiContract?.requirementId || "",
    title: `${systemLabel}解读报告`,
    sections: output.sections,
    summary: output.summary,
    audit: output.audit,
  });
  // 下载按钮优先用报告库落盘的那一份；落盘失败时退回内存记录，保证「刚生成的」也能导出。
  lastAiRecord = saved?.record || window.MingliReportExport?.recordFromResult(output, { system, systemLabel })
    || { system, systemLabel, title: `${systemLabel}解读报告`, sections: output.sections, summary: output.summary, audit: output.audit, createdAt: new Date().toISOString() };
  if (downloadAiReadingButton) {
    downloadAiReadingButton.hidden = false;
    downloadAiReadingButton.textContent = "下载图片";
  }
  refreshArchiveBadge();
}

function renderArchivedReport(record) {
  if (!archiveView) return;
  currentArchiveRecord = record || null;
  if (archiveDownloadButton) archiveDownloadButton.hidden = !record;
  archiveView.replaceChildren();
  const head = make("div", null, "archive-view-head");
  head.append(
    make("h3", `${record.systemLabel || ""}解读报告${record.sections.length ? ` · ${record.sections.length} 个主题` : ""}`),
    make("p", `${formatWhen(record.createdAt)}${record.audit?.evidenceCount ? ` · ${record.audit.evidenceCount} 条证据引用` : ""} · 保存于本机浏览器`, "archive-view-meta")
  );
  archiveView.append(head);
  if (record.summary?.plainLanguage) {
    const summary = make("div", null, "archive-view-summary");
    summary.append(make("strong", "先看这里"), make("p", record.summary.plainLanguage));
    archiveView.append(summary);
  }
  record.sections.forEach(section => {
    const block = make("section", null, "archive-topic");
    block.append(
      make("h4", section.title || section.topic),
      section.oneLineSummary ? make("p", section.oneLineSummary, "archive-topic-line") : document.createTextNode(""),
      make("p", section.plainLanguage || "")
    );
    if (section.practicalAdvice?.length) {
      const advice = make("ul", null, "archive-topic-advice");
      section.practicalAdvice.forEach(item => advice.append(make("li", item)));
      block.append(advice);
    }
    if (section.evidencePaths?.length) {
      const evidence = make("details", null, "archive-topic-evidence");
      evidence.append(make("summary", `盘面依据（${section.evidencePaths.length}）`));
      const list = make("ul");
      section.evidencePaths.forEach(pointer => list.append(make("li", pointer)));
      evidence.append(list);
      block.append(evidence);
    }
    if (section.knowledgeCitations?.length) {
      block.append(make("p", `引用资料 ${section.knowledgeCitations.length} 条`, "archive-topic-citations"));
    }
    archiveView.append(block);
  });
  archiveView.hidden = false;
}

function renderArchiveList(activeId) {
  const api = archiveApi();
  if (!api || !archiveList) return;
  const result = api.list();
  archiveList.replaceChildren();
  if (archiveStatus) {
    archiveStatus.textContent = result.records.length
      ? "点开任意一份可回看；报告只在本机浏览器保存。"
      : result.reason || "还没有生成过的报告。生成一份后会自动存到这里。";
  }
  if (archiveClearButton) archiveClearButton.hidden = result.records.length === 0;
  result.records.forEach(record => {
    const item = make("li", null, `archive-item${record.id === activeId ? " is-active" : ""}`);
    const open = make("button", null, "archive-open");
    open.type = "button";
    open.append(
      make("strong", record.title || `${record.systemLabel}解读报告`),
      make("span", `${formatWhen(record.createdAt)} · ${record.sections.length} 个主题`)
    );
    open.addEventListener("click", () => {
      renderArchivedReport(record);
      renderArchiveList(record.id);
    });
    const remove = make("button", "删除", "archive-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `删除 ${formatWhen(record.createdAt)} 的报告`);
    remove.addEventListener("click", () => {
      api.remove(record.id);
      if (archiveView) archiveView.hidden = true;
      renderArchiveList(record.id);
      refreshArchiveBadge();
    });
    item.append(open, remove);
    archiveList.append(item);
  });
  if (!activeId && archiveView) archiveView.hidden = true;
}

function openArchive() {
  if (!archiveDialog) return;
  const api = archiveApi();
  const records = recordsOf(api);
  // 打开就显示最近一份，省掉「点一下才知道里面是什么」的一步
  const first = records[0];
  renderArchiveList(first ? first.id : null);
  if (first) renderArchivedReport(first);
  if (typeof archiveDialog.showModal === "function") {
    if (!archiveDialog.open) archiveDialog.showModal();
  } else {
    archiveDialog.setAttribute("open", "");
  }
}

function closeArchive() {
  if (!archiveDialog) return;
  if (typeof archiveDialog.close === "function") archiveDialog.close();
  else archiveDialog.removeAttribute("open");
}

async function exportReport(record, format, statusNode) {
  if (!record) {
    if (statusNode) statusNode.textContent = "还没有可导出的报告。";
    return;
  }
  const notify = message => { if (statusNode) statusNode.textContent = message; };

  // 默认导出 PNG；按住 Shift 仍可导出 JSON 备份。
  if (format === "json") {
    const backup = window.MingliReportExport;
    if (!backup) { notify("导出模块未加载，请刷新页面重试。"); return; }
    const result = backup.download(record, "json");
    notify(result.ok ? `已导出 ${result.name}` : (result.reason || "导出失败。"));
    return;
  }

  const images = window.MingliReportImage;
  if (!images) { notify("图片模块未加载，请刷新页面重试。"); return; }
  notify("正在生成图片…");
  try {
    const result = await images.download(record);
    if (result && result.ok) {
      notify(`已保存 ${result.name}（${result.width}×${result.height}）`);
    } else {
      notify((result && result.reason) || "导出失败。");
    }
  } catch (error) {
    notify(`导出失败：${error && error.message ? error.message : error}`);
  }
}

if (downloadAiReadingButton) {
  downloadAiReadingButton.title = "下载 PNG 图片；按住 Shift 导出 JSON";
  downloadAiReadingButton.addEventListener("click", event => {
    exportReport(lastAiRecord, event.shiftKey ? "json" : "md", aiReadingStatus);
  });
}

if (downloadAnnualReadingButton) {
  downloadAnnualReadingButton.title = "下载 PNG 图片；按住 Shift 导出 JSON";
  downloadAnnualReadingButton.addEventListener("click", event => {
    exportReport(lastAnnualRecord, event.shiftKey ? "json" : "md", annualReadingStatus);
  });
}

if (archiveDownloadButton) {
  archiveDownloadButton.title = "下载 PNG 图片；按住 Shift 导出 JSON";
  archiveDownloadButton.addEventListener("click", event => {
    exportReport(currentArchiveRecord, event.shiftKey ? "json" : "md", archiveStatus);
  });
}

if (openArchiveButton) openArchiveButton.addEventListener("click", openArchive);
if (archiveCloseButton) archiveCloseButton.addEventListener("click", closeArchive);
if (archiveDialog) {
  archiveDialog.addEventListener("click", event => {
    if (event.target === archiveDialog) closeArchive();
  });
}
if (archiveClearButton) {
  archiveClearButton.addEventListener("click", () => {
    archiveApi()?.clear();
    if (archiveView) archiveView.hidden = true;
    renderArchiveList(null);
    refreshArchiveBadge();
  });
}

// 页头「AI 报告」：区块还没准备好时不要跳进空白，先把人带到表单并说明原因。
document.querySelector("#nav-ai-reading")?.addEventListener("click", event => {
  if (!aiReadingSection || aiReadingSection.hidden) {
    event.preventDefault();
    if (aiReadingStatus) aiReadingStatus.textContent = "先完成一次排盘；排好后这里会出现授权与生成入口。";
    if (form) {
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      form.querySelector("input, select, button")?.focus?.({ preventScroll: true });
    }
    return;
  }
  aiReadingSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

refreshArchiveBadge();

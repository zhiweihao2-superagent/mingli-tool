/**
 * §16 逐步骤运行时门禁（plan-chartinfo.json T6）。
 *
 * 职责：把矩阵里每项的 `requiredFacts` 变成**对真实盘的可解析检查**。
 * 只有当一项的全部必需事实都能解析到非空值时，该项才可升级为 `ready`；
 * 否则保持 `conditional`，缺事实的保持 `blocked`，并给出缺什么、缺在哪。
 *
 * 为什么需要门禁：SKILL §16 写明「跳过任一步骤的输出不得交付用户」。
 * 如果门禁只写在文档里，模型忘了一步也没人拦得住；写成代码才拦得住。
 */
(function (root) {
  "use strict";

  var SCHEMA = "section16-gate/v1";

  // 逐步骤事实合同簿（knowledge/ziwei/section16-fact-contracts.json）。
  // 门禁不自己去读文件：谁来跑谁负责装载，跑之前必须先 setContractBook。
  // 没装载 = 不升级 ready，理由写 FACT_CONTRACT_UNDECLARED，而不是默认可信。
  var contractBook = null;

  function setContractBook(book) {
    if (!book || typeof book !== "object" || !book.contracts || typeof book.contracts !== "object") {
      contractBook = null;
      return { ok: false, reason: "合同簿缺少 contracts 对象" };
    }
    contractBook = book;
    return { ok: true, steps: Object.keys(book.contracts).length };
  }

  function getContractBook() {
    return contractBook;
  }

  /**
   * 复核一步的事实合同。
   * 四种不通过各有自己的 code，避免把「没声明」和「声明了但事实缺」混成一类。
   */
  function verifyFactContract(row, chartInfo) {
    if (!contractBook) {
      return {
        declared: false, status: "undeclared", paths: [], coveredBy: [], unsatisfied: [],
        problems: [{
          code: "FACT_CONTRACT_UNDECLARED",
          path: "factContracts." + row.id,
          reason: "未装载逐步骤事实合同，不能升级为 ready"
        }]
      };
    }
    var entry = contractBook.contracts[String(row.id)] || null;
    if (!entry) {
      return {
        declared: false, status: "undeclared", paths: [], coveredBy: [], unsatisfied: [],
        problems: [{
          code: "FACT_CONTRACT_UNDECLARED",
          path: "factContracts." + row.id,
          reason: "合同簿没有声明第 " + row.id + " 步需要哪些事实"
        }]
      };
    }
    var paths = isArray(entry.paths) ? entry.paths.slice() : [];
    if (!paths.length) {
      return {
        declared: true, status: "empty", paths: paths, coveredBy: [], unsatisfied: [],
        problems: [{
          code: "FACT_CONTRACT_EMPTY",
          path: "factContracts." + row.id + ".paths",
          reason: "合同没有列出任何事实路径"
        }]
      };
    }
    var required = isArray(row.requiredFacts) ? row.requiredFacts : [];
    var uncovered = paths.filter(function (path) { return required.indexOf(path) < 0; });
    if (uncovered.length) {
      return {
        declared: true, status: "uncovered", paths: paths, coveredBy: [], unsatisfied: [],
        problems: uncovered.map(function (path) {
          return {
            code: "FACT_CONTRACT_UNCOVERED",
            path: path,
            reason: "合同要求的事实不在矩阵 requiredFacts 里，矩阵没有为它背书"
          };
        })
      };
    }
    var contractChecks = paths.map(function (path) { return checkFact(chartInfo, path); });
    var unsatisfied = contractChecks.filter(function (item) { return !item.satisfied; });
    if (unsatisfied.length) {
      return {
        declared: true, status: "unsatisfied", paths: paths,
        coveredBy: contractChecks.filter(function (item) { return item.satisfied; })
          .map(function (item) { return { path: item.path, resolvedAt: item.resolvedAt }; }),
        unsatisfied: unsatisfied.map(function (item) {
          return { path: item.path, reason: item.reason };
        }),
        problems: unsatisfied.map(function (item) {
          return {
            code: "FACT_CONTRACT_UNSATISFIED",
            path: item.path,
            reason: "合同要求的事实取不到：" + item.reason
          };
        })
      };
    }
    return {
      declared: true, status: "ok", paths: paths,
      coveredBy: contractChecks.map(function (item) {
        return { path: item.path, resolvedAt: item.resolvedAt };
      }),
      unsatisfied: [], problems: []
    };
  }

  function isEmptyValue(value) {
    if (value == null) return true;
    if (isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
  }

  function splitPath(path) {
    // 支持三种写法：
    //   "a.b.c"          点号
    //   "a[0].b" / "a[名]" 下标/命名索引
    //   "/a/b"           JSON Pointer 风格（与事实包的 json_pointer 一致）
    var text = String(path);
    if (text.charAt(0) === "/") {
      text = text.slice(1).replace(/\//g, ".");
    }
    var tokens = [];
    text.replace(/([^.\[\]]+)|\[([^\]]*)\]/g, function (m, plain, bracket) {
      if (plain !== undefined) tokens.push({ kind: "key", value: plain });
      else tokens.push({ kind: "index", value: bracket });
      return m;
    });
    return tokens;
  }

  function resolve(chartInfo, path) {
    var tokens = splitPath(path);
    var node = chartInfo;
    var trail = [];
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (node == null) return { ok: false, at: trail.join("."), reason: "中途为 null" };
      if (token.kind === "index") {
        var index = token.value;
        if (Array.isArray(node)) {
          var numeric = Number(index);
          if (!isNaN(numeric) && /^\d+$/.test(index)) {
            if (numeric >= node.length) {
              return { ok: false, at: trail.join("."), reason: "下标越界" };
            }
            node = node[numeric];
            trail.push("[" + index + "]");
            continue;
          }
          // 命名索引：在数组里按 name 找
          var found = null;
          for (var j = 0; j < node.length; j += 1) {
            if (node[j] && node[j].name === index) { found = node[j]; break; }
          }
          if (!found) {
            return { ok: false, at: trail.join("."), reason: "找不到名为 " + index + " 的项" };
          }
          node = found;
          trail.push("[" + index + "]");
          continue;
        }
        if (node && typeof node === "object") {
          node = node[index];
          trail.push("[" + index + "]");
          continue;
        }
        return { ok: false, at: trail.join("."), reason: "无法按名索引" };
      }
      if (node && typeof node === "object" && token.value in node) {
        node = node[token.value];
        trail.push(token.value);
      } else {
        return { ok: false, at: trail.join("."), reason: "缺少字段 " + token.value };
      }
    }
    return { ok: true, value: node, trail: trail.join(".") };
  }

  function isEmpty(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim().length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  }

  // 结构规则：这些事实不能只判「非空」——数组长度、元素形状、地支唯一性都要对。
  // 目的：拒绝「palaces 有几个元素就算齐备」这类伪证据（见 review r738 blocker 1）。
  var SHAPE_RULES = {
    palaces: function (value) {
      if (!Array.isArray(value) || value.length !== 12) {
        return "palaces 必须是 12 项，实际 " + (Array.isArray(value) ? value.length : typeof value);
      }
      var branches = {};
      for (var i = 0; i < value.length; i += 1) {
        var item = value[i];
        if (!item || typeof item !== "object") return "palaces[" + i + "] 不是对象";
        if (typeof item.name !== "string" || !item.name.trim()) return "palaces[" + i + "] 缺 name";
        if (typeof item.earthlyBranch !== "string") return "palaces[" + i + "] 缺 earthlyBranch";
        if (branches[item.earthlyBranch]) return "地支重复：" + item.earthlyBranch;
        branches[item.earthlyBranch] = true;
      }
      return null;
    },
    "fourLayerDieGong.rows": function (value) {
      return Array.isArray(value) && value.length === 12
        ? null
        : "fourLayerDieGong.rows 必须是 12 项，实际 " + (Array.isArray(value) ? value.length : typeof value);
    },
    "dieGong.decadal": function (value) {
      return Array.isArray(value) && value.length === 12
        ? null
        : "dieGong.decadal 必须是 12 项，实际 " + (Array.isArray(value) ? value.length : typeof value);
    },
    sihua: function (value) { return fourHuaRule(value, "sihua"); },
    daxianSihua: function (value) { return fourHuaRule(value, "daxianSihua"); },
    liunianSihua: function (value) { return fourHuaRule(value, "liunianSihua"); },
    "flyingChains.palaceFlying": function (value) {
      return Array.isArray(value) && value.length === 48
        ? null
        : "flyingChains.palaceFlying 必须是 12 宫×4 化 = 48 条，实际 " +
          (Array.isArray(value) ? value.length : typeof value);
    }
  };

  function fourHuaRule(value, label) {
    if (!Array.isArray(value) || value.length !== 4) {
      return label + " 必须是 4 项，实际 " + (Array.isArray(value) ? value.length : typeof value);
    }
    var kinds = {};
    for (var i = 0; i < value.length; i += 1) {
      var kind = value[i] && value[i].kind;
      if (!kind) return label + "[" + i + "] 缺 kind";
      if (kinds[kind]) return label + " 化类重复：" + kind;
      kinds[kind] = true;
    }
    return null;
  }

  function checkFact(chartInfo, path) {
    var resolved = resolve(chartInfo, path);
    if (!resolved.ok) {
      return { path: path, satisfied: false, reason: resolved.reason, at: resolved.at };
    }
    if (isEmpty(resolved.value)) {
      return { path: path, satisfied: false, reason: "解析到空值", at: resolved.trail };
    }
    var rule = SHAPE_RULES[path];
    if (rule) {
      var shapeError = rule(resolved.value);
      if (shapeError) {
        return { path: path, satisfied: false, reason: "结构不符：" + shapeError, at: resolved.trail };
      }
    }
    return { path: path, satisfied: true, resolvedAt: resolved.trail };
  }

  /**
   * 评审一个步骤。
   * @param {object} row      矩阵中的一行
   * @param {object} chartInfo 适配器输出的 ChartInfo
   * @param {object} options  { topic: 'marriage'|'wealth'|null } 用于判断 not_applicable
   */
  function evaluateStep(row, chartInfo, options) {
    options = options || {};
    var checks = (row.requiredFacts || []).map(function (path) {
      return checkFact(chartInfo, path);
    });
    var failed = checks.filter(function (c) {
      return !c.satisfied;
    });

    var topic = options.topic;
    var notApplicable = false;
    // 婚姻相关项：只有显式声明不涉及婚姻才可标 not_applicable；
    // 主题完全未指定时必须阻断，不能默认"不涉及"。
    var topicMissing = false;
    if (row.id === 11) {
      // 只有**字符串字面量等于 not_married_related** 才算明确不涉婚；
      // null / undefined / 空串 / 未知值 / 其他主题一律阻断。
      if (topic === "not_married_related") notApplicable = true;
      else if (typeof topic !== "string" || topic.trim() !== "marriage") topicMissing = true;
    }

    var declaredMissing = (row.missing || []).length;

    // blocked 项要变 ready，必须由调用方提供**逐条可解析的事实记录**，
    // 每条对应 evidenceModel 的一个要求；数量够、且每条都带可解析指针才算。
    // 不接受单个 verificationPassed 布尔值——那不是证据。
    // 第 6、15 项：事实层结构现已落地（step6ZhuanJi / buildDecadalAnnualTimeline，
    // 见矩阵 evidenceModel 与 acceptanceEvidence），但状态仍为 blocked ——
    // 阻断原因已由"事实层没有该结构"改为"缺 §17 具名审查员独立复核"。
    // 门禁本身仍不提供任何运行时升级入口（含"重复提交同一可解析指针"这类伪证据）；
    // 状态只由矩阵数据决定，不由运行时自证。
    var blockedSatisfied = false;

    // ready 的唯一依据：该项**完整事实合同**已满足。
    // 事实齐备 + 矩阵无未验证条件 + 调用方声明的合同清单里包含该项。
    // A 层不认"调用方声明"。ready 的唯一来源是**矩阵里该步的事实合同
    // 在代码中已实现**（factContractImplemented === true）。
    // 这不是保守，是诚实：结构是否齐备由实现方写死，不由运行时自证。
    var factContractComplete = row.factContractImplemented === true;
    // 矩阵自称 ready 还不够：必须有具名审查记录（当前为自审，独立性如实标注）。
    // 这样「把矩阵第 6 项改成 conditional 再清空 missing」不能反过来伪造 ready，
    // 也不能只改 factContractImplemented 就升级。
    var review = row.section16Review || null;
    var reviewSigned = Boolean(review)
      && typeof review.reviewer === "string" && review.reviewer.trim().length > 0
      && typeof review.reviewerScope === "string" && review.reviewerScope.trim().length > 0;
    // 调用方若传了 factContracts，只作为对照信息记录，不参与升级判定
    var callerClaim = (options.factContracts || {})[row.id] || null;
    // 事实合同：未装载、未声明、未被矩阵覆盖、取不到值，四类都不许 ready
    var contract = verifyFactContract(row, chartInfo);
    var contractOk = contract.status === "ok";

    var status;
    if (notApplicable) status = "not_applicable";
    else if (topicMissing) status = "blocked";
    else if (row.status === "blocked") status = "blocked";
    // 必需事实缺失/结构不符 = 事实层缺口，按 blocked 处理；conditional 只留给
    // 「事实齐备但来源或一致性尚待核验」这一种情形。
    else if (failed.length > 0) status = "blocked";
    else if (contract.status === "uncovered" || contract.status === "unsatisfied") status = "blocked";
    else if (declaredMissing === 0 && factContractComplete && reviewSigned && contractOk) status = "ready";
    else status = "conditional";

    function buildMissing() {
      var items = failed.map(function (c) {
        return {
          code: c.reason === "解析到空值" ? "FACT_EMPTY" : "FACT_UNRESOLVED",
          path: c.path,
          reason: c.reason
        };
      });
      if (status === "blocked" && row.status === "blocked") {
        items.push({
          code: "EVIDENCE_MODEL_UNIMPLEMENTED",
          path: "evidenceModel",
          reason: "该步骤所需事实结构尚未实现，缺口见矩阵 evidenceModel"
        });
      }
      if (status === "blocked" && failed.length && row.status !== "blocked") {
        items.push({
          code: "FACTS_BLOCKING",
          path: "requiredFacts",
          reason: "必需事实缺失或结构不符：" + failed.length + " 项，按 blocked 处理"
        });
      }
      contract.problems.forEach(function (problem) { items.push(problem); });
      if (status === "conditional" && !items.length) {
        items.push({
          code: "FACT_CONTRACT_UNVERIFIED",
          path: "factContracts",
          reason: declaredMissing > 0
            ? "矩阵仍有未核验条件：" + declaredMissing + " 项"
            : "缺少结构化的事实合同记录"
        });
      }
      return items;
    }

    function buildReason() {
      if (notApplicable) return "调用方显式声明本题材不涉及婚姻，按矩阵规则标注 not_applicable";
      if (topicMissing) return "主题未指定或非婚姻主题，婚姻相关项必须阻断";
      if (status === "blocked") {
        return row.status === "blocked"
          ? "该项所需事实结构尚未实现，见 evidenceModel"
          : "缺少必需事实或输入无效";
      }
      if (status === "conditional") {
        if (contract.status !== "ok") {
          return "事实合同未通过（" + contract.status + "），不得升级为 ready";
        }
        return declaredMissing > 0
          ? "事实齐备但矩阵条件未核验，不得升级为 ready"
          : "缺少结构化事实合同记录，不得升级为 ready";
      }
      return null;
    }


    return {
      id: row.id,
      title: row.title,
      declaredStatus: row.status,
      status: status,
      checks: checks,
      missing: buildMissing(),
      knowledgeSections: row.knowledgeSections || [],
      evidence: checks.filter(function (c) { return c.satisfied; })
        .map(function (c) { return { path: c.path, resolvedAt: c.resolvedAt }; }),
      factContractComplete: factContractComplete,
      factContract: contract,
      callerClaimIgnored: callerClaim,
      blockedEvidenceSatisfied: blockedSatisfied,
      topicMissing: topicMissing,
      declaredMissingBlockers: row.missing || [],
      reason: buildReason()
    };
  }

  function evaluateAll(matrix, chartInfo, options) {
    var expected = (options && options.expectedSteps) || 15;
    var rows = matrix && matrix.rows;
    var structural = [];
    if (!isArray(rows)) {
      structural.push({ code: "MATRIX_INVALID", path: "rows", reason: "矩阵缺少 rows 数组" });
      rows = [];
    } else {
      if (rows.length !== expected) {
        structural.push({ code: "MATRIX_ROW_COUNT", path: "rows",
          reason: "应有 " + expected + " 行，实际 " + rows.length });
      }
      var ids = rows.map(function (row) { return row && row.id; });
      for (var i = 0; i < expected; i += 1) {
        if (ids[i] !== i + 1) {
          structural.push({ code: "MATRIX_IDS_NOT_SEQUENTIAL", path: "rows[" + i + "].id",
            reason: "第 " + (i + 1) + " 行 id 应为 " + (i + 1) + "，实际 " + String(ids[i]) });
          break;
        }
      }
      var bad = rows.filter(function (row) {
        return !row || !isArray(row.requiredFacts);
      });
      if (bad.length) {
        structural.push({ code: "MATRIX_ROW_INVALID", path: "rows",
          reason: bad.length + " 行缺少 requiredFacts" });
      }
    }

    if (structural.length) {
      // 结构不成立 = 整份结果无效：先返回，不对残缺行逐条评估（否则 null 行会抛）
      return { schema: SCHEMA, steps: [], summary: null, structural: structural };
    }
    var steps = rows.map(function (row) {
      return evaluateStep(row, chartInfo, options);
    });
    var summary = { ready: 0, conditional: 0, blocked: 0, not_applicable: 0 };
    steps.forEach(function (step) { summary[step.status] += 1; });
    return { schema: SCHEMA, steps: steps, summary: summary };
  }

  /**
   * 交付门禁：SKILL §16 要求跳过任一步骤不得交付。
   * 这里把「能不能交付」变成可判定的结论，而不是靠自觉。
   */
  function assertDeliverable(results, options) {
    options = options || {};
    var steps = (results && results.steps) || [];
    var problems = [];

    var expected = options.expectedSteps == null ? 15 : options.expectedSteps;

    // ID 必须恰为 1..expected，缺项/重复/乱序都不算完整
    var expectedIds = [];
    for (var i = 1; i <= expected; i += 1) expectedIds.push(i);
    // 不排序：要求**原序**就是 1..15，倒序或乱序都不合格
    var actualIds = steps.map(function (step) { return step.id; });
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      problems.push({
        id: null, title: "步骤 ID", status: "incomplete",
        missing: [{ path: "steps[*].id", reason: "步骤 ID 必须恰为 1.." + expected }]
      });
    }

    var KNOWN = ["ready", "conditional", "blocked", "not_applicable"];
    steps.forEach(function (step) {
      if (KNOWN.indexOf(step.status) < 0) {
        problems.push({
          id: step.id, title: step.title, status: "invalid",
          missing: [{ path: "status", reason: "未知状态 " + String(step.status) }]
        });
      }
    });

    // 知识装载状态必须参与判定：某步知识 unavailable 就不能算"按知识执行过"
    // 知识装载记录是**必填证据**：调用方省略不等于检查通过
    var knowledgeStatus = options.knowledgeStatus;
    if (!knowledgeStatus || typeof knowledgeStatus !== "object") {
      problems.push({
        id: null, title: "知识装载", status: "incomplete",
        missing: [{ path: "knowledgeStatus", reason: "未提供逐步知识装载记录" }]
      });
    } else {
      var badKnowledge = steps.filter(function (step) {
        var entry = knowledgeStatus[step.id];
        if (!entry) return true;
        // 光有 status:"ok" 不算——必须给出**实际装载的章节**（source#anchor）
        if (!isArray(entry.sections) || !entry.sections.length) return true;
        return entry.status !== "ok";
      });
      if (badKnowledge.length) {
        problems.push({
          id: null, title: "知识装载", status: "incomplete",
          missing: [{ path: "knowledgeStatus",
            reason: badKnowledge.length + " 步知识装载未达 ok："
              + badKnowledge.map(function (s) { return s.id; }).join(",") }]
        });
      }
    }

    // §17 独立审查必须是**具名审查者 + findings**，不能只有一个 "pass" 字符串
    var section17 = options.section17Audit || {};
    var section17Ok = section17.status === "pass"
      && typeof section17.reviewer === "string" && section17.reviewer.length
      && isArray(section17.findings);
    if (!section17Ok) {
      problems.push({
        id: null, title: "§17 独立审查", status: "incomplete",
        missing: [{ path: "section17Audit", reason: "缺具名审查者或 findings（status=" +
          String(section17.status) + "）" }]
      });
    }

    // 逐步分析记录：每步必须有模型产出文本与可解析引用，否则不算"分析已执行"
    if (!options.chartInfo) {
      problems.push({
        id: null, title: "事实引用核验", status: "incomplete",
        missing: [{ path: "chartInfo", reason: "未提供 ChartInfo，无法核验事实引用是否可解析" }]
      });
    }
    var analysis = options.analysisRecords;
    if (!analysis || typeof analysis !== "object") {
      problems.push({
        id: null, title: "逐步分析记录", status: "incomplete",
        missing: [{ path: "analysisRecords", reason: "未提供逐步分析产出" }]
      });
    } else {
      var badAnalysis = steps.filter(function (step) {
        var rec = analysis[step.id];
        if (!rec) return true;
        if (typeof rec.text !== "string" || !rec.text.trim()) return true;
        if (!isArray(rec.factPointers) || !rec.factPointers.length) return true;
        if (!isArray(rec.knowledgeReferences) || !rec.knowledgeReferences.length) return true;
        // 引用必须能在**调用方提供的 chartInfo** 上真正解析；没给就无法核验，判为不合格
        var root = options.chartInfo;
        if (!root) return true;
        return rec.factPointers.some(function (pointer) {
          var resolved = resolve(root, pointer);
          return !resolved.ok || isEmptyValue(resolved.value);
        });
      });
      if (badAnalysis.length) {
        problems.push({
          id: null, title: "逐步分析记录", status: "incomplete",
          missing: [{ path: "analysisRecords",
            reason: badAnalysis.length + " 步缺文本或引用：" +
              badAnalysis.map(function (s) { return s.id; }).join(",") }]
        });
      }
    }
    if (steps.length !== expected) {
      problems.push({
        id: null, title: "步骤数量",
        status: "incomplete",
        missing: [{ path: "steps", reason: "应有 " + expected + " 项，实际 " + steps.length }]
      });
    }
    var seen = {};
    steps.forEach(function (step) {
      if (seen[step.id]) {
        problems.push({ id: step.id, title: step.title, status: "duplicate", missing: [] });
      }
      seen[step.id] = true;
    });
    if (options.requireKnowledge !== false) {
      var noKnowledge = steps.filter(function (step) {
        return !(step.knowledgeSections || []).length;
      });
      if (noKnowledge.length) {
        problems.push({
          id: null, title: "知识来源", status: "incomplete",
          missing: [{ path: "knowledgeSections", reason: noKnowledge.length + " 项未记录知识章节" }]
        });
      }
    }

    var blocking = steps.filter(function (step) {
      return step.status === "blocked" || step.status === "conditional";
    }).concat(problems);
    return {
      deliverable: blocking.length === 0 && steps.length === expected,
      blockers: blocking.map(function (step) {
        return { id: step.id, title: step.title, status: step.status, missing: step.missing };
      }),
      reason: blocking.length === 0
        ? null
        : "有 " + blocking.length + " 项未达 ready，按 §16「跳过任一步骤不得交付」不可交付"
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    resolve: resolve,
    checkFact: checkFact,
    evaluateStep: evaluateStep,
    evaluateAll: evaluateAll,
    setContractBook: setContractBook,
    getContractBook: getContractBook,
    verifyFactContract: verifyFactContract,
    assertDeliverable: assertDeliverable
  };

  root.MingliSection16 = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

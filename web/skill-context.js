/**
 * 按步骤装载 SKILL 知识（plan-chartinfo.json T4）。
 *
 * 为什么不把 400 KB 一次性拼进提示词：上下文会被事实、系统指令和输出挤爆，
 * 而且 §16 是逐步执行的，把全部 11 份参考资料一次性灌进去既不经济也会稀释重点。
 *
 * 设计要点：
 *   - 按 `stepId` **确定性**选取章节，不靠关键词命中猜覆盖；
 *   - `SKILL.md` 的铁律、§16、§17 **始终装载**（缺了就不能交付）；
 *   - 只按完整章节或规则组边界裁剪，保留定义、前提、例外与来源；
 *   - 预算放不下必需段时返回 `unavailable`，**不静默丢弃**；
 *   - `readText` 由调用方注入：浏览器/Node 都能用，且不把知识包复制进仓库。
 */
(function (root) {
  "use strict";

  var SCHEMA = "skill-context/v1";
  var ALWAYS_ANCHORS = ["铁律", "§16", "§17"];
  // 保守到 1 字符 ≈ 1 token：真实 tokenizer 对中文通常更省，按 1.5 折算会高估容量。
  // 宁愿少装（后续可提预算），也不要装到一半才发现超限。
  var CHARS_PER_TOKEN = 1.0;
  // 给事实、系统指令、输出预留的比例
  var DEFAULT_RESERVE_RATIO = 0.5;

  function diag(code, detail) {
    return { code: code, detail: detail };
  }

  /** 把 markdown 切成「### / ## 」为边界的章节块，保留标题行。 */
  function splitSections(text) {
    var lines = String(text).split(/\r?\n/);
    var sections = [];
    var current = { anchor: "", lines: [], parent: "", ancestors: [] };
    // 标题栈：level -> anchor。四级标题的语境含二级与三级祖先，
    // 否则「选中三级锚点」时它的四级子节会被漏掉（review r738 major 10）。
    var stack = {};
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var heading = /^(#{2,4})\s+(.*)$/.exec(line);
      if (heading) {
        if (current.lines.length) sections.push(current);
        var level = heading[1].length;
        var anchor = heading[2].trim();
        stack[level] = anchor;
        for (var deeper = level + 1; deeper <= 4; deeper += 1) delete stack[deeper];
        var ancestors = [];
        for (var up = 2; up < level; up += 1) {
          if (stack[up]) ancestors.push(stack[up]);
        }
        current = {
          anchor: anchor,
          lines: [line],
          parent: level > 2 ? (stack[2] || "") : "",
          ancestors: ancestors
        };
      } else {
        current.lines.push(line);
      }
    }
    if (current.lines.length) sections.push(current);
    return sections.map(function (section) {
      return {
        anchor: section.anchor,
        parent: section.parent || "",
        ancestors: (section.ancestors || []).slice(),
        text: section.text0 || section.lines.join("\n")
      };
    });
  }

  /**
   * 锚点解析：标题规范化后比较，不做裸包含。
   *  - 去前导序号（一、/〇、/1.）与尾注（（先读）/（钦天核心技法））后**相等**才算命中；
   *  - 「章号式」标题允许「§16 十五项逻辑链」被「§16」命中（其后必须是空白/冒号）；
   *  - 「紫微进阶」不会被「紫微」拉进来（review r738 major 10）。
   * 同一标题在多颗星下重复出现是正常结构，按组全部装载并记诊断。
   */
  function normalizeHeading(text) {
    var value = String(text || "").trim();
    value = value.replace(/^[\s\d一二三四五六七八九十〇]+[、.．]\s*/u, "");
    value = value.replace(/[（(][^（()）]*[)）]\s*$/u, "");
    return value.trim();
  }

  function resolveAnchor(blocks, want) {
    var target = normalizeHeading(want);
    var exact = blocks.filter(function (block) {
      return normalizeHeading(block.anchor) === target;
    });
    if (exact.length) {
      var anchors = [];
      exact.forEach(function (b) {
        if (anchors.indexOf(b.anchor) < 0) anchors.push(b.anchor);
      });
      return { ok: true, anchors: anchors, mode: anchors.length === 1 ? "exact" : "set" };
    }
    // 章号式：§16 / §17 这类引用允许标题以其开头，后面必须是空白或分界符
    var prefixed = blocks.filter(function (block) {
      var anchor = String(block.anchor || "");
      if (!anchor.startsWith(target)) return false;
      var next = anchor.charAt(target.length);
      return next === "" || /[\s:：、]/.test(next);
    });
    if (prefixed.length) {
      var list = [];
      prefixed.forEach(function (b) {
        if (list.indexOf(b.anchor) < 0) list.push(b.anchor);
      });
      return { ok: true, anchors: list, mode: "prefix" };
    }
    return { ok: false, code: "ANCHOR_MISSING", reason: "未找到锚点：" + want };
  }

  function isAlwaysLoaded(item) {
    return item.path === "SKILL.md";
  }

  function appliesToStep(item, stepId) {
    var list = item.appliesTo || [];
    return list.indexOf("*") >= 0 || list.indexOf(stepId) >= 0;
  }

  /** 清单里的相对路径必须落在允许前缀内，禁止 ../ 逃逸。 */
  function isPathAllowed(relPath) {
    if (typeof relPath !== "string" || !relPath.length) return false;
    if (relPath.indexOf("..") >= 0) return false;
    if (relPath.charAt(0) === "/" || /^[A-Za-z]:/.test(relPath)) return false;
    return relPath === "SKILL.md" || relPath.indexOf("references/") === 0;
  }

  /**
   * @param {number} budget   目标模型的**上下文上限（token）**
   * @param {object} options  { reserveRatio } 预留事实/系统指令/输出的比例
   *
   * 预算按 token 计；内部用 chars/CHARS_PER_TOKEN 估算已用量，
   * 并只允许用掉 (1 - reserveRatio) 的部分，避免把上下文塞满后没地方放结果。
   */
  function loadSkillContext(stepId, manifest, readText, budget, options) {
    if (typeof readText !== "function") {
      return {
        status: "unavailable",
        sections: [],
        missing: [],
        budgetUsed: 0,
        diagnostics: [diag("READER_MISSING", "未提供 readText，无法读取本地知识文件")]
      };
    }
    if (!manifest || !Array.isArray(manifest.items)) {
      return {
        status: "unavailable",
        sections: [],
        missing: [],
        budgetUsed: 0,
        diagnostics: [diag("MANIFEST_INVALID", "清单结构不符")]
      };
    }

    var diagnostics = [];
    var chosen = [];

    // 必需项：SKILL.md 永远要（含铁律/§16/§17）
    manifest.items.forEach(function (item) {
      if (isAlwaysLoaded(item)) chosen.push(item);
      else if (item.necessity === "required" && appliesToStep(item, stepId)) chosen.push(item);
    });
    // 支撑项：仅当适用当前步骤
    manifest.items.forEach(function (item) {
      if (chosen.indexOf(item) >= 0) return;
      if (appliesToStep(item, stepId)) chosen.push(item);
    });

    // 预算必须是正数：0 或负数表示"没给预算"，不能当成无限
    if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) {
      return {
        status: "unavailable",
        sections: [],
        missing: [],
        budgetUsed: 0,
        diagnostics: [diag("BUDGET_INVALID", "预算必须是正数（字符数上界），收到 " + String(budget))]
      };
    }
    options = options || {};
    var reserveRatio = typeof options.reserveRatio === "number"
      ? options.reserveRatio
      : DEFAULT_RESERVE_RATIO;
    if (!(reserveRatio >= 0 && reserveRatio < 1)) {
      return {
        status: "unavailable",
        sections: [],
        missing: [],
        budgetUsed: 0,
        diagnostics: [diag("RESERVE_INVALID", "reserveRatio 必须在 [0,1) 内")]
      };
    }
    // 可用于知识的 token 上限
    var limitTokens = Math.floor(budget * (1 - reserveRatio));
    if (limitTokens <= 0) {
      return {
        status: "unavailable",
        sections: [],
        missing: [],
        budgetUsed: 0,
        diagnostics: [diag("BUDGET_TOO_SMALL", "扣除预留后没有可用预算")]
      };
    }
    var usedChars = 0;
    var sections = [];
    var missing = [];

    for (var i = 0; i < chosen.length; i += 1) {
      var item = chosen[i];
      if (!isPathAllowed(item.path)) {
        return {
          status: "unavailable",
          sections: sections,
          missing: missing.concat([{ path: String(item.path), reason: "路径不在白名单内" }]),
          budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
          diagnostics: diagnostics.concat([diag("PATH_NOT_ALLOWED", String(item.path))])
        };
      }
      var required = item.necessity === "required" || isAlwaysLoaded(item);
      var text;
      try {
        text = readText(item.path);
      } catch (err) {
        // 必需文件读不到：整体不可用，不能"别的文件够了就 ok"
        if (required) {
          return {
            status: "unavailable",
            sections: sections,
            missing: missing.concat([{ path: item.path, reason: "必需文件读取失败" }]),
            budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
            diagnostics: diagnostics.concat([diag("REQUIRED_SOURCE_UNREADABLE", item.path)])
          };
        }
        missing.push({ path: item.path, reason: "读取失败：" + String(err && err.message || err) });
        continue;
      }
      if (typeof text !== "string" || !text.length) {
        if (required) {
          return {
            status: "unavailable",
            sections: sections,
            missing: missing.concat([{ path: item.path, reason: "必需文件内容为空" }]),
            budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
            diagnostics: diagnostics.concat([diag("REQUIRED_SOURCE_EMPTY", item.path)])
          };
        }
        missing.push({ path: item.path, reason: "内容为空" });
        continue;
      }

      // SKILL.md 只取必需章节 + 与步骤相关的章节，按完整章节装载
      var blocks = splitSections(text);
      if (isAlwaysLoaded(item)) {
        // 父章节命中（如「§16」）时，其下的子标题（如「第一步…」）必须一并保留，
        // 否则正文会被切掉，只剩一个空标题通过锚点检查。
        var keepParents = {};
        blocks.forEach(function (block) {
          if (!block.anchor) return;
          for (var k = 0; k < ALWAYS_ANCHORS.length; k += 1) {
            if (block.anchor.indexOf(ALWAYS_ANCHORS[k]) >= 0) keepParents[block.anchor] = true;
          }
          if (block.anchor.indexOf(String(stepId)) >= 0) keepParents[block.anchor] = true;
        });
        blocks = blocks.filter(function (block) {
          if (!block.anchor) return false;
          if (keepParents[block.anchor]) return true;
          return Boolean(block.parent && keepParents[block.parent]);
        });
      }

      // 清单里登记了 sectionAnchors 的，必须至少命中一个，否则这份资料对本步
      // 等于没提供可用章节——不能因为"文件里有些字"就算装载成功。
      // SKILL.md 的 sectionAnchors 描述的是**整份文件**的章节骨架（第Ⅰ~Ⅳ部分等），
      // 而实际只装铁律/§16/§17，不能要求全命中；它的完整性由 ALWAYS_ANCHORS 校验覆盖。
      var declaredAnchors = isAlwaysLoaded(item) ? [] : (item.sectionAnchors || []);
      if (declaredAnchors.length) {
        // 声明的锚点必须**全部**唯一命中：歧义（同一标题出现多处）也算不完整，
        // 不能因为"命中了其中一处"就算装载成功。
        var resolvedAnchors = {};
        var anchorFailures = [];
        declaredAnchors.forEach(function (want) {
          var hit = resolveAnchor(blocks, want);
          if (hit.ok) {
            hit.anchors.forEach(function (anchor) { resolvedAnchors[anchor] = true; });
            if (hit.mode === "set" || hit.anchors.length > 1) {
              diagnostics.push(diag("ANCHOR_MULTI_SECTION", item.path + " " + want +
                " 命中 " + hit.anchors.length + " 个同名章节，按组装载"));
            } else if (hit.mode === "prefix") {
              diagnostics.push(diag("ANCHOR_PREFIX_MATCH", item.path + " " + want +
                " 按章号前缀命中：" + hit.anchors.join(" / ")));
            }
          } else {
            anchorFailures.push(hit.reason);
          }
        });
        var anchorHits = declaredAnchors.length - anchorFailures.length;
        var anchorHit = anchorFailures.length === 0;
        if (anchorHit) {
          // 只装入命中锚点的章节及其**所有后代**（祖先链命中即可），不塞无关章节
          blocks = blocks.filter(function (block) {
            if (!block.anchor) return false;
            if (resolvedAnchors[block.anchor]) return true;
            var chain = block.ancestors || [];
            for (var a = 0; a < chain.length; a += 1) {
              if (resolvedAnchors[chain[a]]) return true;
            }
            return Boolean(block.parent && resolvedAnchors[block.parent]);
          });
        }
        if (!anchorHit) {
          if (required) {
            return {
              status: "unavailable",
              schema: SCHEMA,
              stepId: stepId,
              sections: sections,
              missing: missing.concat([{
                path: item.path,
                reason: "锚点未全部命中（" + anchorHits + "/" + declaredAnchors.length +
                  "）：" + anchorFailures.join("；")
              }]),
              budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
              diagnostics: diagnostics.concat([
                diag("REQUIRED_ANCHOR_MISSING", item.path + " 未命中 " + declaredAnchors.join("/"))
              ])
            };
          }
          diagnostics.push(diag("ANCHOR_NOT_FOUND", item.path));
          continue;
        }
      }

      for (var j = 0; j < blocks.length; j += 1) {
        var block = blocks[j];
        var size = block.text.length;
        var projectedTokens = (usedChars + size) / CHARS_PER_TOKEN;
        if (projectedTokens > limitTokens) {
          if (item.necessity === "required" || isAlwaysLoaded(item)) {
            // 必需段放不下：整体判 unavailable，不静默丢弃
            return {
              status: "unavailable",
              sections: sections,
              missing: missing,
              budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
              diagnostics: diagnostics.concat([
                diag(
                  "BUDGET_EXCEEDED",
                  "必需章节放不下：需要拆分步骤或提高预算（可用 token " + limitTokens +
                  "，已用约 " + Math.round(usedChars / CHARS_PER_TOKEN) +
                  "，该章节约 " + Math.round(size / CHARS_PER_TOKEN) + "）"
                )
              ])
            };
          }
          diagnostics.push(diag("TRIMMED", item.path + " 超出预算，已跳过"));
          break;
        }
        sections.push({
          source: item.path,
          anchor: block.anchor,
          parent: block.parent || "",
          text: block.text
        });
        usedChars += size;
      }
    }

    var skillAnchors = sections.filter(function (sec) {
      return sec.source === "SKILL.md";
    }).map(function (sec) { return sec.anchor; });
    for (var a = 0; a < ALWAYS_ANCHORS.length; a += 1) {
      var anchor = ALWAYS_ANCHORS[a];
      var present = skillAnchors.some(function (name) {
        // 空标题或只有符号的不算命中
        return name && name.replace(/[\s§\d.、]/g, "").length > 0
          && name.indexOf(anchor) >= 0;
      });
      if (!present) {
        return {
          status: "unavailable",
          schema: SCHEMA,
          stepId: stepId,
          sections: sections,
          missing: missing,
          budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
          diagnostics: diagnostics.concat([
            diag("REQUIRED_ANCHOR_MISSING", "SKILL.md 缺少必需章节：" + anchor)
          ])
        };
      }
    }

    return {
      status: sections.length ? "ok" : "unavailable",
      schema: SCHEMA,
      stepId: stepId,
      sections: sections,
      missing: missing,
      budgetUsed: Math.round(usedChars / CHARS_PER_TOKEN),
      budgetUsedChars: usedChars,
      budgetTokens: limitTokens,
      reserveRatio: reserveRatio,
      diagnostics: diagnostics
    };
  }

  var api = {
    SCHEMA: SCHEMA,
    ALWAYS_ANCHORS: ALWAYS_ANCHORS.slice(),
    CHARS_PER_TOKEN: CHARS_PER_TOKEN,
    DEFAULT_RESERVE_RATIO: DEFAULT_RESERVE_RATIO,
    splitSections: splitSections,
    resolveAnchor: resolveAnchor,
    loadSkillContext: loadSkillContext
  };

  root.MingliSkillContext = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

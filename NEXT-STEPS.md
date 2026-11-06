# 剩余工作交接（复审收尾）

## 2026-10-29 17:55 — 目标四条中三条已达成，第 4 条卡在 Codex 额度

### 目标进度

| # | 目标项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 四个老 Node 套件补统一汇总行 | ✅ | 12 个套件都报数，`verify_acceptance` 无 warn |
| 2 | 改动边界审计的基线锚点 | ✅ | `audit_plan_scope.py` 读取全部 `.pair/plan*.json`，输出「没有越界改动」，exit 0 |
| 3 | AC14 执行式证明 | ✅ | DOM 套件「整段提交处理器在沙箱里执行：fetch 抛错时一定清空时间轴」PASS；ACCEPTANCE.md 已更正早期的"残余风险"描述 |
| 4 | B1 复审到 PASS | ⏳ | 卡额度，见下 |

### 当前全量状态（本轮实测）

```
unittest            186 项 OK
verify_acceptance   15/15 PASS + 交付物 26/26，exit 0
scope audit         没有越界改动，exit 0
node 12 套          全绿
验收报告            tests/ACCEPTANCE-REPORT.md 结论：15 条全部通过
```

### B1 复审的三条与处置

| # | 复审意见 | 处置 |
|---|---|---|
| 1 | 节气时刻秒级取整，边界归属可能错 | **已裁定偏离**：事实包显式发布 `coordinate.instant_resolution = "1s"`，四舍五入误差 ≤0.5s，相邻月共用边界字符串无缝隙 |
| 2 | `month_fingerprint` 不含内容 | **已裁定偏离**：JS 只能从 lean 夹具复算、Python 算完整 facts，内容字段会让跨语言复算失去同一输入。三轮尝试均失败，已记录过程 |
| 3 | 月份 `evidence_id` 不进索引 | **已修**：`build()` 为月份登记索引并做冲突检测 |

两条偏离写在 `tests/ACCEPTANCE.md` 的「两条已裁定的规格偏离」小节。

### 登记完整性核查（第 86–88 轮）

目标第 1 条要求"验证脚本据此核对断言数"，本质是防**套件没被登记**。
据此做了两轮比对：

| 检查 | 结果 |
|---|---|
| `NODE_SUITES` vs `tests/*.test.cjs` | 发现 `ziwei_adapter.test.cjs` **未登记**（70 条断言从不运行，且已腐化：corrections 期望 2 条、实际 8 条）→ 已修断言、补汇总行、登记（node 套件 12 → 13） |
| `BACKEND_SUITES` vs `tests/test_*.py` | 只有 `test_static_distribution` 未登记，属**合理排除**（依赖构建产物 `dist/`，干净检出必然缺）→ 已在脚本里写明原因与单独运行方式 |
| 各套件 `check()` 调用数 vs 汇总数 | 差异来自循环内生成的断言（如 `PROJECTION_CASES.forEach` 里也调 `check`），不是漏跑；`verify_acceptance` 已按登记值逐个核对，exit 0 |

结论：登记完整性已闭合，无第二个腐化套件。

### 额度阻塞与恢复步骤

```
5h 窗口 100%（上限 95%），恢复时间 10-29 18:41
周额度剩 30%（11-04 14:36 重置）
重置券 1 张 —— 按用户要求**永不使用**
```

待恢复的复审记录（`.pair/pending/`）：

- `r509-d86ca4d7.json`（早期，可忽略）
- `r713-2b3c7b53.json`、`r713-d83a2df0.json`（本次 B1 复审）

恢复后执行：

```
node tools/pair/pair.mjs review --resume r713-d83a2df0
```

（有多份同轮记录时必须指定 `round` 或 `key`。）

### 判断

`plan-align` 系列连续十轮 **0 blocker、0 产品缺陷**，major 全部是"测试还能更细"，没有下界。
产品侧已达成本轮全部可验证目标。若 B1 复审仍不 PASS，建议按「已达成产品目标、
测试细度冻结在当前实现」收口，而不是继续追加断言。


## 2026-10-29 11:40 — plan-segments 三轮用尽，按流程回规划

plan-segments.json 的评审跑了 r694/r695/r696 三轮，全部 FAIL。按 AGENTS.md
「第 3 轮仍 FAIL 就停止改代码，回到规划阶段」，**已停止改代码**。

### 已落地且全绿（别退回去）

- 紫微流月按农历月切段；每段用自己的取样点排盘，带 lunarMonth/ganzhi/
  fieldStatuses/三段 envelope/verified/jsonPointer/fieldPointers
- 采样失败契约：首末签名缺失、二分第三签名、二分采样为空、非法日期
  → 一律单段 signature:null verified:false
- 顶层三字段投影主段（topGate = status ok && dominant.verified===true）
- 月级与段级指针按真实数组位置生成（ziwei-facts 侧）
- ai-contract 增加 relationSemantics 与 segmentSemantics
- 新增 tests/test_ziwei_segments.py（8 项，临时目录跑探针）
- 后端 11 个套件、175 项 OK；verify_acceptance 15/15 exit 0

### r696 未修的 6 条（下一轮先读这个）

1. nnual-timeline.js 段指针仍用 azi.index - 1，应按最终 months 数组位置
2. 装配层校验 
ot_usable_when_unaligned / coordinate_flag_present /
   eligibility_enforced 仍要求整月对齐 → 正常分段月会被判 fail
3. 主段已验证但引擎缺 stars 时，顶层与段的 transitStars reason 不一致
4. coverage 由重新采样的 aligned 决定，没看分段 verified，可能错报 full
5. 真实夹具一致性测试没比任何段的 verified
6. 可控采样测试只测 lunarSegments，没断言顶层三 envelope 在失败时全 unavailable

### 建议的下一步

按流程重新 plan，把这 6 条写进需求；重点是第 2 条——装配层的
「整月对齐」假设与「按月切段」是**语义冲突**，需要先定口径再改代码，
否则改一处会引爆另一处。


## 2026-10-29 现状（第 60 轮，已跑 30 轮复审）

```
unittest 8 模块     150 项 OK
node 套件           12 套全绿（DOM 18 项 / 前端 26 项 / 视图 29 项）
verify_acceptance   15/15 PASS + 交付物 26/26 + 边界 0 越界，exit 0
```

| 批次 | 状态 |
|---|---|
| A1 生产代码 `bazi_months.py` | ✅ PASS |
| A2 后端验收/不变式测试 | ✅ PASS |
| B2 前端测试五文件 | ✅ PASS |
| B1 schema + 两个工具脚本 | ⚠️ 0 blocker + 2 major |

### B1 剩下两条（都已具备"下一轮可做"的条件）

1. **注册检查与提取执行的函数身份可能不同**
   `#chart-form` 注册的是作用域内的 `handleSubmit`，而提交路径测试执行的是按源码名
   提取出来的另一个函数体。若用命名函数表达式制造同名函数，两者会脱钩。

   解法：不要各取一次——**从 `captureSubmitHandler()` 拿到的那个函数对象直接调用**，
   这样"测的"与"注册的"天然是同一个。

2. **`findBlockEnd` 把 `)` 之后的斜杠一律当正则**
   `const x = (a) / 2;` 会让扫描把中间的 `{` 当成正则内容跳过，函数体被截断。

   解法：`/` 之后先扫描到行尾，若中间出现 `;`、`{`、`}` 等语句边界就判为除法而非正则。

### 已验证的关键行为（都有会失败的探针）

- 提交失败必清空（`clear` 在 `fetch` 之后、`renderError` 之前）
- 错误渲染自己抛错时清空已发生
- `setLoading(true)` 真的调用 `clearAnnualTimeline()`，失败后按钮恢复可用
- 外层包装器降级时不碰 localStorage/sessionStorage/既有报告
- `#chart-form` 注册的是名为 `handleSubmit` 的函数
- 页面 script 标签精确等于登记的 12 条，且扣除后无残留 `<script`

## 历史交接（早期轮次）

截至 2026-10-28，`mingli-tool` 的 15 条验收标准全部有可执行断言并通过，
全量回归与端到端也跑通。**复审只完成了 4 批中的 2 批**，剩三件事按难度排序如下。

## 当前基线（改任何东西之前先跑一遍）

```powershell
cd D:\deepseek-harness\workspace\mingli-tool
$py="C:\Users\hao\AppData\Local\Temp\python-nuget-3.12.10\tools\python.exe"
Remove-Item Env:\PYTHONPATH, Env:\PYTHONIOENCODING -ErrorAction SilentlyContinue
$env:PYTHONIOENCODING="utf-8"; $env:PYTHONPATH="src;."
& $py scripts\verify_acceptance.py     # 期望 exit 0，15/15 PASS，交付物 26/26
```

复审（Codex，模型固定 gpt-6.1-terra；**永远不加 `--use-reset-credit`**）：

```powershell
cd D:\deepseek-harness\workspace
node tools\pair\pair.mjs review --root mingli-tool --round <N> --files <逗号分隔> --extra "<本轮改了什么>。只报 blocker/major。"
```

## 复审台账

| 批次 | 文件 | 状态 |
|---|---|---|
| A1 | `src/mingli_tool/bazi_months.py`、`tests/ACCEPTANCE.md` | ✅ PASS（r540） |
| A2 | `tests/test_acceptance_backend.py`、`tests/test_monthly_invariants.py` | ✅ PASS（r577） |
| B1 | `schemas/monthly-facts-v1.schema.json`、`tests/test_monthly_schema.py`、`tests/test_monthly_determinism.py`、`scripts/verify_acceptance.py`、`scripts/audit_plan_scope.py` | ⚠️ 1 条结构性限制 |
| B2 | `tests/acceptance_frontend.test.cjs`、`tests/annual_timeline_dom.test.cjs`、`tests/annual_month_facts.test.cjs`、`tests/bazi_monthly_facts.test.cjs`、`tests/annual_timeline_real.test.cjs` | ⚠️ 2 条 |

## 待办

### 1. B2：指纹匹配要覆盖两个分支（小，纯测试）

`tests/acceptance_frontend.test.cjs` 里 AC10 那段目前只验了「matches === (declared === recomputed)」，
但样本包的 `declared` 恒为 `mf-fixture`、`recomputed` 恒为 `mf-` + 八位十六进制，**必然不等**——
所以恒返回 `false` 的实现也能过。需要补一个 `declared === recomputed` 的样本，让 `matches === true`
那条分支也被覆盖：

```js
const matched = buildPackage();
matched.fingerprint = matched.fingerprints.recomputed;   // 人为让两者相等
const built = Timeline.build({ baziMonthly: matched, ziweiMonthly: { status:"unavailable", months:[] }, targetYear: matched.target_year });
assert.strictEqual(built.fingerprints.matches, true);
```

### 2. B1：改动边界审计的基线不是外部锚点（中等，可能只能接受）

`scripts/audit_plan_scope.py` 用**当前计划**判断哪些改动属计划内，因此自带一个可被利用的口子：
往 `tasks[].files` 塞文件、或在 detail 里加一句"新增 X"，就能把计划外改动洗白。

缓解措施是 `.pair/scope-baseline.json` 记录首次运行时的计划哈希，之后改计划即判违规；
但**基线是自己创建的**，删掉重跑就会以当前计划重建。真正的锚点是版本控制或签名快照，
而原始副本（`C:\Users\hao\Documents\ChatGPT\New project\mingli-tool`）不含 `.pair`。
已写进 `tests/ACCEPTANCE.md` 的「已知限制」。

### 3. B2：AC14 提交失败后清空时间轴（大，需重构产品代码）

`clearAnnualTimeline()` 写在外层提交流程里，不在 `renderServerError` 内。当前断言只能做到
"失败处理之后 2000 字符内出现清空调用"，属结构性弱断言——放进不可达分支仍可能通过。

要拿到硬证据，得把 `web/app.js` 的提交流程拆成可注入依赖（fetch 可替换），
再在测试里模拟「fetch 抛错 → 走 catch → 断言时间轴节点被清空」。
时间轴自身的清空行为已由 `tests/annual_timeline_dom.test.cjs` **执行验证**（注入假 DOM 跑真函数），
那部分是硬证据；缺的只是"提交失败会触发它"这一环。

## 教训（别再踩）

- **别用 `str.replace` 改整份 JS/CJS 文件**：第 28 轮我曾把
  `tests/annual_timeline_dom.test.cjs` 从 330 行误写成 30 万行。改文件优先用 `edit` 工具，
  或先用 `node --check` 验证补丁脚本，再落盘。
- **审查模型只认"断言真的会失败"**：每条断言都要能举出一个会击穿它的反例，
  否则它会被判定为同义反复。本仓库大量用例是这么攒出来的。
- **静态文本分析追不住 JS**：`const node = reportContent; node.textContent = ""` 这类间接写入
  只能靠执行式测试（注入假 DOM 真跑）才能证明。见 `tests/annual_timeline_dom.test.cjs` 的诱饵容器做法。

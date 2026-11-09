"""一条命令验证 15 条验收标准，并生成可审计报告。

前面几轮把断言散在多个套件里：`test_acceptance_backend` 管 AC01–AC07，
`acceptance_frontend.test.cjs` 管 AC05 与 AC08–AC15，`test_monthly_invariants` 与
`test_monthly_determinism` 兜底。散着跑不出「到底达没达到规划要求」这一句话。

这个脚本跑完全部套件，按 AC 编号汇总，写 `tests/ACCEPTANCE-REPORT.md`，
并以退出码表达结论：0 = 15 条全绿且整体回归通过。

用法（仓库根目录）：
    python scripts/verify_acceptance.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "tests" / "ACCEPTANCE-REPORT.md"

# 自己把 src 与仓库根塞进 sys.path / 子进程 PYTHONPATH：
# 脚本应当能直接 `python scripts/verify_acceptance.py` 跑，不必先 export PYTHONPATH，
# 否则少配一个环境变量就会得到一串假的失败。
_PYTHONPATH = os.pathsep.join([str(ROOT / "src"), str(ROOT)])
for _extra in (str(ROOT / "src"), str(ROOT)):
    if _extra not in sys.path:
        sys.path.insert(0, _extra)

# AC 编号 → 关心它的后端测试（套件, 测试名子串）。
# 判定方式：套件退出码为 0（全部通过）且源码里确实存在这些测试。
# 不去解析 unittest -v 的文本——带 docstring 的用例会把测试名和 "... ok" 拆成两行，
# 按行匹配会漏，那种脆弱解析会让报告说假话。
AC_BACKEND = {
    "AC01": [("tests.test_acceptance_backend", "test_ac01"),
             ("tests.test_monthly_invariants", "test_ac01")],
    "AC02": [("tests.test_acceptance_backend", "test_ac02"),
             ("tests.test_monthly_invariants", "test_ac02")],
    "AC03": [("tests.test_acceptance_backend", "test_ac03")],
    "AC04": [("tests.test_acceptance_backend", "test_ac04")],
    "AC06": [("tests.test_acceptance_backend", "test_ac06"),
             ("tests.test_monthly_invariants", "test_ac06")],
    "AC07": [("tests.test_acceptance_backend", "test_ac07"),
             ("tests.test_monthly_invariants", "test_ac07")],
}

# AC 编号 → 前端套件里的标签
AC_FRONTEND = {
    "AC05": "AC5",
    "AC08": "AC8",
    "AC09": "AC9",
    "AC10": "AC10",
    "AC11": "AC11",
    "AC12": "AC12",
    "AC13": "AC13",
    "AC14": "AC14",
    "AC15": "AC15",
}
FRONTEND_SUITE = "tests/acceptance_frontend.test.cjs"
FRONTEND_FILE = ROOT / "tests" / "acceptance_frontend.test.cjs"

AC_TITLES = {
    "AC01": "12 个月且索引恰为 1..12（全范围）",
    "AC02": "相邻相接、start<end、边界来源与时区",
    "AC03": "边界两侧分属不同干支柱",
    "AC04": "关系参与者可解析、成化候选字段齐全",
    "AC05": "紫微字段校验失败时不得标 validated",
    "AC06": "上下半年各 6 月、JSON Pointer 可解析",
    "AC07": "年柱取自目标年份、不依赖数组顺序",
    "AC08": "annual-timeline.js 的引入顺序与 defer",
    "AC09": "12 条月份记录含节气/干支/关系数/大运",
    "AC10": "声明指纹、复算指纹与 match 可读",
    "AC11": "未知时辰不建紫微流月",
    "AC12": "四态展示与非空原因",
    "AC13": "不触碰既有 20/6 主题报告与缓存",
    "AC14": "提交失败/新提交清空旧时间轴",
    "AC15": "回归测试存在且被记录",
}

# 注意：tests/test_static_distribution.py **故意不在此列**。
# 它校验的是构建产物（dist/index.html、dist/python/**），而 dist/ 不在版本控制里，
# 需要先跑构建步骤才有内容。放进验收会让「干净检出」永远红。
# 想验它就先构建，再单独运行：
#   python -m unittest tests.test_static_distribution
BACKEND_SUITES = [
    "tests.test_acceptance_backend",
    "tests.test_monthly_invariants",
    "tests.test_monthly_determinism",
    "tests.test_monthly_schema",
    "tests.test_bazi_months",
    "tests.test_bazi_adapter",
    "tests.test_web_monthly_e2e",
    "tests.test_web_server",
    "tests.test_bazi_hidden_combine",
    "tests.test_bazi_half_combines",
    "tests.test_ziwei_segments",
    # 「AI 能否解读」的最低线断言：四柱十神、性别、大运十神、
    # 辅助盘可用性、岁运诚实性、契约门禁。来历见该文件 docstring。
    "tests.test_interpretability",
    # 神煞 40 条规则的正例/反例断言（plan-fill3 T4/T6）
    "tests.test_shensha_rules",
    # 一份合同只装一套体系：双体系拒绝、单体系证据覆盖、八字判法声明
    "tests.test_ai_split_systems",
    # 输入形态端到端防回归：缺时辰/农历/闰月/立春前后/子时边界/31 日
    "tests.test_bazi_input_shapes",
    # 八字结构报告：九节齐全、数字对得上事实层、无断言词、不混紫微术语
    "tests.test_bazi_report",
]

NODE_SUITES = [
    "tests/acceptance_frontend.test.cjs",
    "tests/annual_timeline_dom.test.cjs",
    "tests/annual_timeline_real.test.cjs",
    "tests/annual_timeline.test.cjs",
    "tests/annual_timeline_view.test.cjs",
    "tests/annual_month_facts.test.cjs",
    "tests/bazi_monthly_facts.test.cjs",
    "tests/date_input.test.cjs",
    "tests/interpretation.test.cjs",
    "tests/ziwei_interpretation.test.cjs",
    "tests/ai_contract.test.cjs",
    "tests/ai_interpretation.test.cjs",
    "tests/ziwei_adapter.test.cjs",
    "tests/ziwei_brightness.test.cjs",
    # ChartInfo 适配器契约（plan-chartinfo T3）：11 个顶层字段、四层叠宫不含日时、
    # laiyinPalace 固定 null、缺时辰如实降级
    "tests/chartinfo_adapter.test.cjs",
    # SKILL 按步骤装载 + §16 证据矩阵（plan-chartinfo T4/T5）
        # 报告库：本机保存已生成的解读报告（纯数据层，不碰 DOM）
        "tests/report_archive.test.cjs",
        "tests/overview.test.cjs",
    "tests/home.test.cjs",
    "tests/skill_context.test.cjs",
    # §16 运行时门禁（plan-chartinfo T6/T7）
    "tests/section16_gate.test.cjs",
    # §16 #15 逐年事实：整个大限每个流年一份事实 + 引动可追溯 + 边界对账
    "tests/decadal_annual_facts.test.cjs",
    # §12 应期四阶梯：禁跳级、单星应象三要素、断言词降级
    "tests/yingqi_ladder.test.cjs",
    # 渲染层：宫位→生活领域译名（逐条锚定 references）、时间落点、倾向语
    "tests/report_render.test.cjs",
    # §16 专题判定：#7 六宫禄打分、#10 破财五法则、#11 离婚四法则
    "tests/specialty_rules.test.cjs",
    # §16 其余九步 + 禄转忌链（#1/#3/#4/#5/#6/#8/#9/#12/#13/#14）+ §17 审查
    "tests/section16_steps.test.cjs",
    # 组合生成：原表未载时用 星性+宫位义+四化结构 现场组合（§12 三要素）
    "tests/knowledge_compose.test.cjs",
        "tests/ziwei_knowledge_digest.test.cjs",
    "tests/bazi_knowledge.test.cjs",
    # 报告导出 / 配图（v0.2 新增）
    "tests/report_export.test.cjs",
    "tests/report_image.test.cjs",
]

PYTHON = sys.executable


def run(cmd: list[str], force_utf8: bool = False) -> tuple[int, str]:
    # 关键：不要继承调用方的 PYTHONIOENCODING。
    # scripts/test_pai_pan.py 在 PYTHONIOENCODING=utf-8 下会以退出码 1 结束
    # （它依赖平台默认编码做输出核对），继承环境会让「引擎自测失败」变成假警报。
    env = {key: value for key, value in os.environ.items() if key != "PYTHONIOENCODING"}
    env["PYTHONPATH"] = _PYTHONPATH
    if force_utf8:
        # 只有需要读子进程**文本输出**的场景才强制 UTF-8，否则 Windows 管道下是 GBK，
        # 我们用 utf-8 解码就成了乱码（报告里会出现一串问号）。
        env["PYTHONIOENCODING"] = "utf-8"
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            capture_output=True,
            env=env,
        )
    except OSError as error:
        # 可执行文件不存在（例如 PATH 里没有 node）也必须留下记录，
        # 否则脚本会在写报告之前就退出，失败信息全丢。
        return 1, f"[error] 无法启动 {cmd[0]}：{error.__class__.__name__}: {error}"
    # 子进程可能按平台默认编码（GBK）输出中文失败信息：
    # 先试 UTF-8，失败再按 GBK 解，只在都失败时才用替换字符。
    def decode(raw: bytes) -> str:
        for encoding in ("utf-8", "gbk"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    return proc.returncode, decode(proc.stdout or b"") + decode(proc.stderr or b"")


def parse_backend(output: str) -> dict[str, bool]:
    """从 unittest -v 输出里抠出「测试名 → 是否通过」。"""
    results: dict[str, bool] = {}
    for match in re.finditer(r"(test_[A-Za-z0-9_]+)\s.*?\.\.\.\s*(ok|FAIL|ERROR|skipped)", output):
        name, verdict = match.group(1), match.group(2)
        results[name] = results.get(name, True) and verdict == "ok"
    return results


def parse_frontend(output: str) -> dict[str, bool]:
    """从 node 套件的 `PASS <label>` 行里抠出 AC 编号。"""
    results: dict[str, bool] = {}
    for match in re.finditer(r"PASS\s+(.*)", output):
        label = match.group(1)
        for ac in re.finditer(r"\bAC(\d{1,2})\b", label):
            results[f"AC{int(ac.group(1)):02d}"] = True
    return results


def suite_file(suite: str) -> Path:
    """tests.test_xxx → tests/test_xxx.py"""
    return ROOT / (suite.replace(".", "/") + ".py")


def discover_backend_test_ids() -> list[str]:
    """用 unittest 加载器枚举真实存在的测试 id。

    不要用「源码里搜测试名」当证据：那会连注释、docstring、甚至计划文本里的一行都算命中，
    一个被注释掉的用例也能让报告显示"断言存在"。加载器给的是可执行的测试 id，骗不了。
    """
    import importlib
    import unittest

    loader = unittest.TestLoader()
    ids: list[str] = []

    def walk(item) -> None:
        if isinstance(item, unittest.TestSuite):
            for child in item:
                walk(child)
        else:
            ids.append(item.id())

    for suite_name in BACKEND_SUITES:
        # 某个测试模块 import 失败时也要继续：否则报告根本写不出来，
        # 而「失败信息没落地」比「模块坏了」更难排查。
        try:
            module = importlib.import_module(suite_name)
            walk(loader.loadTestsFromModule(module))
        except Exception as error:  # noqa: BLE001
            print(f"[warn] 无法导入 {suite_name}：{error.__class__.__name__}: {error}")
    return sorted(ids)


# 前端验收套件的**精确**检查标签集合：删一条再复制另一条会让集合不等而被判失败
FRONTEND_LABELS = frozenset({
    "AC5 校验失败的字段降级且不进入有效事实",
    "AC5 三种引擎校验分别失败时，各自对应的字段都降级",
    "AC8 annual-timeline.js 的 defer 引入在 ziwei-facts.js 之后、app.js 之前",
    "AC9 组装器收到 monthly_facts.target_year 并产出 12 条记录",
    "AC9 组装器真的使用传入的 targetYear（不是写死 2026）",
    "AC9 每条记录含节气起止、干支、关系条数与大运字段",
    "AC10 声明指纹、复算指纹与 match 标记都能从包内读到",
    "AC10 边界被改动时复算指纹与声明值不一致",
    "AC11 未知时辰时 monthlyZiweiPlan 明确不允许建盘",
    "AC11 app.js 只在 shouldBuild 为真时调用 buildMonthlyTiming",
    "AC11 12 个月紫微状态为 unavailable 且原因非空",
    "AC12 unavailable/failed/unverifiable 显示对应状态与非空原因",
    "AC12 ok 月份才携带四态事实",
    "AC13 行为已由 DOM 执行测试覆盖（执行式证明）",
    "AC13 时间轴渲染只写自己的节点，不碰既有报告容器",
    "AC13 外层包装只有 try/catch，不掺渲染逻辑",
    "AC13 既有缓存键未被改写",
    "AC13 清空函数只操作时间轴节点",
    "AC13 既有报告主题数量仍是 20 / 6",
    "AC14 清空行为已由 DOM 执行测试覆盖",
    "AC14 新提交开始时清空时间轴",
    "AC14 失败分支清空时间轴（执行式证明）",
    "AC14 提交入口确实调用 setLoading(true) 且随后发起请求",
    "AC14 clearAnnualTimeline 会隐藏区块并清空内容",
    "AC15 本次运行真的覆盖了 15 条标准，且文档有映射",
    "AC15 验收与回归测试文件齐备且非空壳",
})

# 每个 Node 套件应报出的检查数（只允许在改测评时同步更新）
NODE_SUITE_COUNTS = {    "tests/date_input.test.cjs": 19,
    "tests/interpretation.test.cjs": 56,
    "tests/ziwei_interpretation.test.cjs": 10,
    "tests/ai_contract.test.cjs": 17,
    "tests/ai_interpretation.test.cjs": 97,
    "tests/annual_timeline.test.cjs": 127,
    "tests/ziwei_adapter.test.cjs": 304,
    "tests/ziwei_brightness.test.cjs": 387,
    "tests/annual_timeline_view.test.cjs": 29,
    "tests/annual_timeline_real.test.cjs": 31,
    "tests/annual_timeline_dom.test.cjs": 19,
    "tests/annual_month_facts.test.cjs": 10,
    "tests/bazi_monthly_facts.test.cjs": 11,
    "tests/acceptance_frontend.test.cjs": 26,
    "tests/yingqi_ladder.test.cjs": 19,
    "tests/report_render.test.cjs": 28,
    "tests/specialty_rules.test.cjs": 27,
    "tests/section16_steps.test.cjs": 67,
    "tests/knowledge_compose.test.cjs": 18,
    "tests/ziwei_knowledge_digest.test.cjs": 19,
    "tests/bazi_knowledge.test.cjs": 30,
    "tests/home.test.cjs": 27,
        "tests/report_archive.test.cjs": 50,
    "tests/overview.test.cjs": 85,
    "tests/section16_gate.test.cjs": 34,
    "tests/skill_context.test.cjs": 18,
    "tests/report_export.test.cjs": 17,
    "tests/report_image.test.cjs": 43,

}

# 每个 AC 在前端验收套件里的检查条数（改动测评时要同步更新这里）
DOM_SUITE = "tests/annual_timeline_dom.test.cjs"

FRONTEND_AC_COUNTS = {
    "AC5": 2,
    "AC8": 1,
    "AC9": 3,
    "AC10": 2,
    "AC11": 3,
    "AC12": 2,
    "AC13": 6,
    "AC14": 5,
    "AC15": 2,
}

# 前端验收套件的检查数量下限：只允许增加，删用例会让它下降
FRONTEND_MIN_CHECKS = 26


def _frontend_summary_ok(output: str) -> bool:
    """前端套件必须自己报出「N 项全部通过」，且 PASS 标签数不少于 N。

    只认 `PASS ACn` 字符串是可以伪造的（打印一行就算了），
    要求套件的自查汇总行存在，把「没跑断言就打印标签」这条路堵上。
    """
    # 每个 AC 的检查条数必须**精确**等于登记值：
    # 删一条再补一条，总数不变但覆盖变了，只有逐条计数能抓出来。
    counts: dict[str, int] = {}
    for match in re.finditer(r"^\s*PASS (AC\d+)", output, re.MULTILINE):
        ac = match.group(1)
        counts[ac] = counts.get(ac, 0) + 1
    if counts != FRONTEND_AC_COUNTS:
        return False
    # 数量对不代表"就是那几条"：标签集合必须精确相等
    executed = {
        match.group(1).strip()
        for match in re.finditer(r"^\s*PASS (.+)$", output, re.MULTILINE)
    }
    if executed != FRONTEND_LABELS:
        missing = sorted(FRONTEND_LABELS - executed)[:3]
        extra = sorted(executed - FRONTEND_LABELS)[:3]
        print(f"[warn] 前端检查标签与登记不符：缺 {missing}，多 {extra}")
        return False

    passes = len(re.findall(r"^\s*PASS ", output, re.MULTILINE))
    # 数量下限：删掉某条 check 会让总数下降，这条能抓到
    if passes < FRONTEND_MIN_CHECKS:
        return False
    summaries = [
        int(match)
        for match in re.findall(r"(\d+)\s*项(?:全部)?通过", output)
    ]
    return bool(summaries) and summaries[-1] > 0 and passes >= summaries[-1]


def plan_deliverables() -> tuple[list[str], list[str]]:
    """计划点名的文件（tasks[].files）里，哪些存在、哪些缺失。

    计划文件本身缺失也是"缺失"：否则两个 plan 都不在时，这里会返回空缺口、
    整体判定依然可以是 PASS。
    """
    present: list[str] = []
    missing: list[str] = []
    for plan_name in ("plan.json", "plan-frontend.json"):
        plan_path = ROOT / ".pair" / plan_name
        if not plan_path.exists():
            missing.append(f"(计划文件) {plan_name}")
            continue
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            # 计划损坏时也要写报告：否则「为什么失败」这条信息就丢了
            missing.append(f"(计划文件不可读) {plan_name}: {error.__class__.__name__}")
            continue
        if not isinstance(plan, dict):
            missing.append(f"(计划结构异常) {plan_name}: 顶层不是对象")
            continue
        tasks = plan.get("tasks")
        if not isinstance(tasks, list):
            missing.append(f"(计划结构异常) {plan_name}: tasks 不是数组")
            continue
        for task in tasks:
            if not isinstance(task, dict):
                missing.append(f"(计划结构异常) {plan_name}: tasks 里有非对象元素")
                continue
            task_id = task.get("id", "?")
            files = task.get("files")
            if not isinstance(files, list):
                missing.append(f"(计划结构异常) {plan_name}: {task_id} 的 files 不是数组")
                continue
            for rel in files:
                if not isinstance(rel, str):
                    missing.append(f"(计划结构异常) {plan_name}: {task_id} 的 files 里有非字符串")
                    continue
                target = ROOT / rel
                # 文件必须真的存在；计划也允许点名目录（如 schemas），
                # 但目录里至少要有一个文件，空目录不算交付物
                if target.is_file():
                    present.append(f"{task_id}:{rel}")
                elif target.is_dir() and any(child.is_file() for child in target.rglob("*")):
                    present.append(f"{task_id}:{rel}")
                else:
                    missing.append(f"{task_id}:{rel}")
    return sorted(set(present)), sorted(set(missing))


def format_evidence(names: list[str], limit: int = 3) -> str:
    """证据列只列前几条 + 总数，避免表格被十几条用例名撑爆。"""
    if not names:
        return "—"
    head = "、".join(names[:limit])
    if len(names) > limit:
        return f"{head} 等 {len(names)} 项"
    return head


def main() -> int:
    backend_runs: list[tuple[str, int]] = []
    backend_codes: dict[str, int] = {}
    backend_outputs: dict[str, str] = {}
    for suite in BACKEND_SUITES:
        code, _out = run([PYTHON, "-m", "unittest", suite])
        # ID 出现在加载器里不等于断言真的跑过。三种"看着绿其实没验"的情况都要拦：
        #   1) skipped：用例被跳过；
        #   2) expected failure：断言失败但被标成预期失败，退出码仍是 0；
        #   3) Ran 0 tests：套件被清空，什么都没跑。
        # 只看 unittest 的汇总行（skipped=3 / expected failures=2 …）：
        # 正文里出现 "0 skipped" 这类字样不该误判
        # 只扫结尾的汇总行：正文里出现 "skipped=1" 这种诊断文本不该误判
        tail_lines = [row for row in _out.splitlines() if row.strip()][-6:]
        tail = "\n".join(tail_lines)
        for pattern, label in (
            (r"\bskipped=(\d+)", "skipped"),
            (r"\bexpected failures=(\d+)", "expected failure"),
            (r"\bunexpected successes=(\d+)", "unexpected success"),
        ):
            for match in re.finditer(pattern, tail):
                if int(match.group(1)) > 0:
                    print(f"[warn] {suite} 有 {match.group(1)} 个 {label}")
                    code = code or 1
        ran = [int(m.group(1)) for m in re.finditer(r"Ran (\d+) tests?", _out)]
        if not ran or max(ran) <= 0:
            print(f"[warn] {suite} 没有实际执行任何用例")
            code = code or 1
        backend_runs.append((suite, code))
        backend_codes[suite] = code
        backend_outputs[suite] = _out

    test_ids = discover_backend_test_ids()

    node_runs: list[tuple[str, int]] = []
    node_codes: dict[str, int] = {}
    node_outputs: dict[str, str] = {}
    node_counts: dict[str, int] = {}
    frontend_output = ""
    for suite in NODE_SUITES:
        code, out = run(["node", suite])
        # 用例名里带 FAILURE 不算失败：只认行首的 FAIL
        if re.search(r"^\s*FAIL\b", out, re.MULTILINE):
            print(f"[warn] {suite} 输出里有以 FAIL 开头的结果行")
            code = code or 1
        # 退出码 0 不等于跑了断言。每个 Node 套件都必须自己报出「N 项」，
        # 且 N > 0——只要求"有输出"的话，打印一句 ready 就能骗过。
        # 只看**最后一条**含"项"的行（套件自己报出的汇总），
        # 不能用全文最大值：正文里"处理 15 项数据"会把删掉的用例掩盖过去
        # 汇总行必须同时含"N 项"和"通过/passed"：
        # 否则"处理 15 项数据"这种普通日志会被当成汇总
        summary_lines = [
            row for row in out.splitlines()
            if re.search(r"\d+\s*项", row) and re.search(r"通过|passed", row)
        ]
        declared = (
            [int(match) for match in re.findall(r"(\d+)\s*项", summary_lines[-1])]
            if summary_lines else []
        )
        node_counts[suite] = max(declared) if declared else 0
        expected = NODE_SUITE_COUNTS.get(suite)
        if not declared:
            print(f"[warn] {suite} 最后一行没有报出断言数，无法确认真的跑了断言")
            code = code or 1
        elif expected is not None and max(declared) != expected:
            # 逐套件精确计数：只写一句"1 项"冒充不了，删用例也会被抓
            print(f"[warn] {suite} 报出 {max(declared)} 项，登记值是 {expected}")
            code = code or 1
        node_runs.append((suite, code))
        node_codes[suite] = code
        node_outputs[suite] = out
        if suite == FRONTEND_SUITE:
            frontend_output = out

    engine_code, engine_out = run([PYTHON, "scripts/test_pai_pan.py"])
    # 退出码 0 也可能是「一个用例都没跑」；必须确认 Ran N tests 且 N > 0
    engine_ran = 0
    for match in re.finditer(r"Ran (\d+) tests?", engine_out):
        engine_ran = max(engine_ran, int(match.group(1)))
    # 引擎自测同样要拦 skipped / expected failure / unexpected success
    engine_tail = "\n".join(
        [row for row in engine_out.splitlines() if row.strip()][-6:]
    )
    for pattern, label in (
        (r"\bskipped=(\d+)", "skipped"),
        (r"\bexpected failures=(\d+)", "expected failure"),
        (r"\bunexpected successes=(\d+)", "unexpected success"),
    ):
        for match in re.finditer(pattern, engine_tail):
            if int(match.group(1)) > 0:
                print(f"[warn] 引擎自测有 {match.group(1)} 个 {label}")
                engine_code = engine_code or 1
    if engine_ran <= 0:
        print(f"[warn] 引擎自测没有实际执行任何用例（Ran {engine_ran} tests）")
        engine_code = engine_code or 1
    engine_ran = re.search(r"Ran (\d+) tests?", engine_out)

    frontend_labels = parse_frontend(frontend_output)
    frontend_path = ROOT / FRONTEND_SUITE
    if frontend_path.exists():
        try:
            frontend_source = frontend_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            frontend_source = ""
            print(f"[warn] {FRONTEND_SUITE} 读不出来（{error.__class__.__name__}），前端 AC 一律判失败")
    else:
        frontend_source = ""
        print(f"[warn] 找不到 {FRONTEND_SUITE}，前端 AC 一律判失败")

    verdicts: dict[str, str] = {}
    evidence: dict[str, str] = {}

    for ac, checks in AC_BACKEND.items():
        missing: list[str] = []
        found: list[str] = []
        for suite, needle in checks:
            # 精确到编号边界：`test_ac01` 要能命中 `test_ac01_xxx`，
            # 但不能命中 `test_ac010`（编号后面紧跟数字说明是另一个用例）
            def _matches(test_id: str) -> bool:
                if not test_id.startswith(f"{suite}."):
                    return False
                name = test_id.rsplit(".", 1)[-1]
                if not name.startswith(needle):
                    return False
                rest = name[len(needle):]
                return not (rest[:1].isdigit())

            matched = [test_id for test_id in test_ids if _matches(test_id)]
            if not matched:
                missing.append(f"{suite}::{needle}")
            else:
                found.extend(test_id.rsplit(".", 1)[-1] for test_id in matched)

        if missing:
            verdicts[ac] = "断言缺失"
            evidence[ac] = "加载器里找不到：" + ", ".join(missing)
        elif any(backend_codes.get(suite, 1) != 0 for suite, _ in checks):
            verdicts[ac] = "FAIL"
            evidence[ac] = "套件未通过：" + ", ".join(s for s, _ in checks)
        else:
            verdicts[ac] = "PASS"
            evidence[ac] = format_evidence(found)

    for ac, label in AC_FRONTEND.items():
        key = f"AC{int(label[2:]):02d}"     # AC5 → AC05，与 parse_frontend 的归一化对齐
        in_source = label in frontend_source
        in_output = key in frontend_labels
        if not in_source:
            verdicts[ac] = "断言缺失"
            evidence[ac] = f"源码里找不到 {label}"
        elif node_codes.get(FRONTEND_SUITE, 1) != 0 or not in_output:
            verdicts[ac] = "FAIL"
            evidence[ac] = f"{FRONTEND_SUITE} 未输出 PASS {label}"
        elif not _frontend_summary_ok(frontend_output):
            # 只打印标签不算证据：套件必须自己报出「N 项全部通过」且标签数不少于 N
            verdicts[ac] = "FAIL"
            evidence[ac] = f"{FRONTEND_SUITE} 缺少自查汇总行，标签数无法核对"
        elif ac in ("AC13", "AC14") and node_codes.get(DOM_SUITE, 1) != 0:
            # 这两条的执行证据在 DOM 套件里：那边红了，标签再齐也不算过
            verdicts[ac] = "FAIL"
            evidence[ac] = f"{DOM_SUITE} 未通过，{ac} 的执行证据不成立"
        else:
            verdicts[ac] = "PASS"
            evidence[ac] = f"{FRONTEND_SUITE}::PASS {label}"

    present_files, missing_files = plan_deliverables()

    # 改动边界审计：需要原始工程目录，没给就跳过（不算失败，但要说明）
    origin = os.environ.get("PAIR_ORIGIN_DIR")
    scope_code = None
    scope_output = ""
    if origin:
        scope_code, scope_output = run(
            [PYTHON, "scripts/audit_plan_scope.py", "--origin", origin],
            force_utf8=True,
        )

    overall_ok = (
        len(verdicts) == 15
        and all(verdict == "PASS" for verdict in verdicts.values())
        and all(code == 0 for _, code in backend_runs)
        and all(code == 0 for _, code in node_runs)
        and engine_code == 0
        and not missing_files
        and (scope_code in (None, 0))
    )

    lines = [
        "# 验收执行报告（自动生成）",
        "",
        "由 `python scripts/verify_acceptance.py` 生成，请勿手改。",
        "",
        f"## 结论：{'15 条全部通过，整体回归通过' if overall_ok else '存在未通过项'}",
        "",
        "| 标准 | 内容 | 结果 | 证据 |",
        "| --- | --- | --- | --- |",
    ]
    for ac in sorted(verdicts):
        lines.append(f"| {ac} | {AC_TITLES[ac]} | **{verdicts[ac]}** | {evidence[ac]} |")
    lines += ["", "## 套件执行结果", "", "| 套件 | 退出码 |", "| --- | --- |"]
    failures = []
    if engine_code != 0:
        excerpt = "\n".join(
            row for row in engine_out.splitlines() if row.strip()
        )[-800:]
        failures.append(("scripts/test_pai_pan.py", excerpt))
    for suite, code in backend_runs + node_runs:
        if code != 0:
            output = backend_outputs.get(suite) or node_outputs.get(suite) or ""
            excerpt = "\n".join(row for row in output.splitlines() if row.strip())[-800:]
            failures.append((suite, excerpt))
    for suite, code in backend_runs + node_runs:
        lines.append(f"| `{suite}` | {code} |")
    lines.append(f"| `scripts/test_pai_pan.py` | {engine_code} |")

    if failures:
        lines += ["", "## 失败输出摘录", ""]
        for suite, excerpt in failures:
            lines.extend([f"### {suite}", "", "```", excerpt or "(无输出)", "```", ""])

    lines += ["", "## 计划交付物", ""]
    lines.append(f"- 计划点名的文件：{len(present_files) + len(missing_files)} 个，"
                 f"存在 {len(present_files)}，缺失 {len(missing_files)}")
    if missing_files:
        for item in missing_files:
            lines.append(f"  - **缺失** `{item}`")
    else:
        lines.append("  - 全部存在。")

    lines += ["", "## 改动边界", ""]
    if origin:
        lines.append(f"- 基准：`{origin}`，审计退出码 {scope_code}")
        tail = [row for row in scope_output.splitlines() if row.strip()][-6:]
        lines.extend(f"  - {row.strip()}" for row in tail)
    else:
        lines.append("- 未提供 `PAIR_ORIGIN_DIR`，跳过改动边界审计。")
    lines += [
        "",
        "## 说明",
        "",
        "- 后端 AC 的判定是「测试套件整体退出码为 0」＋「unittest 加载器里确实存在对应测试 id」。",
        "  不用「源码里搜测试名」——那连注释掉或用例名出现在文档里都会算命中。",
        "- 前端 AC 的判定是「套件退出码为 0」＋「输出里出现对应 `PASS ACn` 标签」。",
        f"- 加载器共枚举到 {len(test_ids)} 个后端测试 id。",
    ]
    if engine_ran:
        lines.append(f"- 引擎自测：Ran {engine_ran.group(1)} tests")
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"报告已写入 {REPORT.relative_to(ROOT)}")
    for ac in sorted(verdicts):
        print(f"  {ac}  {verdicts[ac]}  ({evidence[ac]})")
    print(f"后端套件 {len(backend_runs)} 个，Node 套件 {len(node_runs)} 个，引擎自测退出码 {engine_code}")
    print(f"计划交付物：存在 {len(present_files)}，缺失 {len(missing_files)}"
          + (f"（{', '.join(missing_files)}）" if missing_files else ""))
    if origin:
        print(f"改动边界审计退出码 {scope_code}（基准 {origin}）")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

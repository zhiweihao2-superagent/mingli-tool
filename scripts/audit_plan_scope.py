"""审计改动边界：当前工程相对原始工程，改了什么、是否都在计划内。

为什么需要它：计划里有 `out_of_scope`，但"我没越界"这句话只有跑一遍才算数。
把原始工程路径传进来，这个脚本会：

  1. 列出新增 / 修改 / 删除的文件；
  2. 把每个文件对照 `plan.json` 与 `plan-frontend.json` 的 `tasks[].files`；
  3. 只要 `src/` 或 `web/` 下有**计划外**的新增或修改，就以退出码 1 结束。

测试、脚本、夹具、schema 属于实现辅助，允许新增但要列出来供人复核。

用法：
    python scripts/audit_plan_scope.py --origin "C:/path/to/pristine/mingli-tool"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# 不按目录名跳过：__pycache__ 里若被塞了别的文件，那正是要抓的东西。
# 只跳过字节码文件本身（由 .py 决定，单独审计没有意义）。
SKIP_SUFFIXES = (".pyc", ".pyo")
SKIP_DIRS: set[str] = set()
# 这些是根级的工具/依赖目录：只跳过根级，
# src/ 里若出现 node_modules 之类仍然要审（那才是可能藏改动的角落）
ROOT_ONLY_SKIP_DIRS = {".git", "node_modules", "dist", ".pair", ".impeccable", ".openai"}

# 只在这些目录下"计划外改动"才算违规：它们是产品代码
PRODUCT_PREFIXES = ("src/", "web/")
# 允许新增的实现辅助目录
AUXILIARY_PREFIXES = ("tests/", "scripts/", "schemas/")

# 计划文本里出现过的「新增模块」说明。这里只放**出处**，
# 具体是不是豁免，还要看路径确实出现在计划文本里（见 plan_declares_new_module）。
DECLARED_NEW_MODULES = {
    "src/mingli_tool/bazi_months.py": "确定性年度事实构建模块",
}


def collect(root: Path) -> tuple[dict[str, str], list[str]]:
    """递归收集文件哈希。

    自己走目录而不用 os.walk：需要**按分支**判断符号链接环——
    全局按 realpath 去重会把「指向同一目录的另一个逻辑路径」也剪掉，
    那样 web/shared 与 src/shared 里只要一个在计划内，就会漏审另一个。
    """
    digests: dict[str, str] = {}
    unreadable: list[str] = []

    def visit(directory: Path, ancestors: tuple[str, ...]) -> None:
        real = os.path.realpath(directory)
        if real in ancestors:
            unreadable.append(f"{directory}（符号链接成环，已跳过）")
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda item: item.name)
        except OSError as error:
            unreadable.append(f"{directory}（{error.__class__.__name__}）")
            return
        for entry in entries:
            if entry.name in SKIP_DIRS:
                continue
            if entry.name in ROOT_ONLY_SKIP_DIRS and directory == root:
                continue
            if (
                entry.is_file()
                and entry.name.endswith(SKIP_SUFFIXES)
                and entry.parent.name == "__pycache__"
            ):
                # 只有 __pycache__ 里的字节码才由 .py 完全决定；
                # src 下孤立的 .pyc 是可被 import 的产品文件，必须审
                continue
            if entry.is_dir():
                visit(entry, ancestors + (real,))
                continue
            try:
                data = entry.read_bytes()
            except OSError as error:
                unreadable.append(f"{entry}（{error.__class__.__name__}）")
                continue
            digests[entry.relative_to(root).as_posix()] = hashlib.sha256(data).hexdigest()

    visit(root, ())
    return digests, unreadable


def plan_text() -> str:
    """计划的**任务正文**（title/detail），用来判断模块是不是计划点过要做的。

    刻意不扫全文：out_of_scope 或「不得新增 X」这类否定句里也会出现模块名，
    扫全文会把禁止项当成许可项。
    """
    chunks: list[str] = []
    # 计划不止早期那两个：`.pair/plan-*.json` 同样是授权来源，
    # 只看 plan.json / plan-frontend.json 会把后来的计划内改动误判为越界。
    plan_names = sorted(
        path.name for path in (ROOT / ".pair").glob("plan*.json")
    )
    if not plan_names:
        plan_names = ["plan.json", "plan-frontend.json"]
    for plan_name in plan_names:
        plan_path = ROOT / ".pair" / plan_name
        if not plan_path.exists():
            continue
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if not isinstance(plan, dict):
            continue
        tasks = plan.get("tasks")
        if not isinstance(tasks, list):
            UNREADABLE_PLANS.append(f"{plan_name}（tasks 不是数组）")
            continue
        for task in tasks:
            if not isinstance(task, dict):
                UNREADABLE_PLANS.append(f"{plan_name}（tasks 里有非对象元素）")
                continue
            for field in ("title", "detail"):
                value = task.get(field)
                if isinstance(value, str):
                    chunks.append(value)
    return "\n".join(chunks)


def plan_declares_new_module(rel: str) -> bool:
    """新增模块是否被计划明确要求做（而不是被计划禁止）。

    三条匹配路径（完整路径 / 模块名 / 登记的理由原句）都必须落在
    **非否定**的句子里，否则 out_of_scope 里的"不得新增 X"会被当成许可。
    """
    text = plan_text()
    if not text:
        return False

    # 宁可多判否定：只要这一行出现"不/禁/勿/别"这类字眼，就不拿它当许可
    # 双重判据：既要**没否定**，又要**有明确的"新增"动词**。
    # 只靠否定词黑名单永远补不全（不用/未新增/没打算…），
    # 加一条"必须出现肯定动词"的正面要求，把"提到名字"和"要求去做"区分开。
    negative = ("不", "禁", "勿", "别", "无", "毋", "免", "未", "没",
                "取消", "删除", "放弃", "搁置", "暂停", "撤销")
    affirmative = ("新增", "增加", "添加", "引入", "实现", "创建", "编写")
    candidates = [rel, Path(rel).stem, DECLARED_NEW_MODULES.get(rel, "")]
    for sentence in re.split(r"[。；;\n]", text):
        if any(word in sentence for word in negative):
            continue
        if not any(verb in sentence for verb in affirmative):
            continue
        if any(candidate and candidate in sentence for candidate in candidates):
            return True
    return False


BASELINE_PATH = ".pair/scope-baseline.json"
UNREADABLE_PLANS: list[str] = []


def check_plan_baseline() -> list[str]:
    """计划文件的"审计基线"。

    审计用当前计划判断"哪些改动是计划内"，这本身就是可被利用的：
    把计划外文件写进 tasks[].files、或在 detail 里加一句"新增 X"，就能把改动洗白。
    所以首次运行时把**计划哈希**落盘成基线，之后任何对 plan 的改动都算违规。
    原始副本没有 .pair，没法与"上一个版本"比；基线是这里唯一可信的锚点。

    **已知局限**：基线是自己创建的，删掉 `.pair/scope-baseline.json` 再跑一次就会
    以"当前计划"重建基线——想绕开审计的人可以这么干。真正的外部锚点应当是版本控制
    或一份签名的计划快照；本工作区的原始副本不含 `.pair`，拿不到那样的锚点。
    这是工具的边界，不是"已验证没问题"。
    """
    problems: list[str] = []
    baseline_file = ROOT / BASELINE_PATH
    current = {}
    for plan_name in ("plan.json", "plan-frontend.json"):
        plan_path = ROOT / ".pair" / plan_name
        if not plan_path.exists():
            continue
        try:
            current[plan_name] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
        except OSError as error:
            problems.append(f"{plan_name} 读不出来（{error.__class__.__name__}），无法建立基线")
    if problems:
        return problems

    if not baseline_file.exists():
        # 不自建基线：自动建立等于自己给自己背书——首次运行前把计划外文件写进
        # tasks[].files，就能把改动洗成计划内。基线必须由 --init-baseline 显式建立。
        problems.append(
            f"缺少计划基线 {BASELINE_PATH}：先用 --init-baseline 显式建立，再跑审计"
        )
        return problems

    try:
        payload = json.loads(baseline_file.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            problems.append(f"计划基线 {BASELINE_PATH} 顶层不是对象")
            return problems
        recorded = payload.get("plans", {})
        if not isinstance(recorded, dict):
            problems.append(f"计划基线 {BASELINE_PATH} 的 plans 不是对象")
            return problems
    except (OSError, ValueError):
        problems.append(f"计划基线 {BASELINE_PATH} 无法解析")
        return problems

    for plan_name, digest in current.items():
        if plan_name not in recorded:
            problems.append(f"{plan_name} 不在计划基线里（基线之后新增的计划）")
        elif recorded[plan_name] != digest:
            problems.append(f"{plan_name} 在审计基线之后被改动过")
    return problems


def planned_files() -> set[str]:
    unreadable_plans = UNREADABLE_PLANS
    planned: set[str] = set()
    # 所有 `.pair/plan*.json` 都是授权来源（后来的计划同样算数）
    plan_names = sorted(path.name for path in (ROOT / ".pair").glob("plan*.json"))
    if not plan_names:
        plan_names = ["plan.json", "plan-frontend.json"]
    for plan_name in plan_names:
        plan_path = ROOT / ".pair" / plan_name
        if not plan_path.exists():
            continue
        try:
            plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            unreadable_plans.append(f"{plan_name}（{error.__class__.__name__}）")
            continue
        if not isinstance(plan, dict):
            unreadable_plans.append(f"{plan_name}（顶层不是对象）")
            continue
        tasks = plan.get("tasks")
        if not isinstance(tasks, list):
            # tasks 缺失/为对象/为数字时范围无法确定，必须记违规而不是当作"没有文件"
            unreadable_plans.append(f"{plan_name}（tasks 不是数组）")
            continue
        for task in tasks:
            if not isinstance(task, dict):
                unreadable_plans.append(f"{plan_name}（tasks 里有非对象元素）")
                continue
            files = task.get("files")
            if files is None:
                continue
            if not isinstance(files, list) or any(not isinstance(rel, str) for rel in files):
                unreadable_plans.append(f"{plan_name}（files 不是字符串数组）")
                continue
            planned.update(files)
    return planned


def classify(rel: str, planned: set[str]) -> str:
    # 计划可以把**目录**列为交付物（如 web/components），其下文件都算计划内
    if rel in planned:
        return "计划内"
    if any(rel.startswith(f"{entry.rstrip('/')}/") for entry in planned if entry):
        return "计划内"
    if rel.startswith(AUXILIARY_PREFIXES):
        return "实现辅助"
    if rel.startswith(PRODUCT_PREFIXES):
        return "越界"
    return "其它"


def main() -> int:
    parser = argparse.ArgumentParser(description="审计改动是否都在计划范围内")
    parser.add_argument("--origin", required=True, help="原始工程目录（未被改动的那份）")
    parser.add_argument(
        "--init-baseline",
        action="store_true",
        help="显式建立计划基线（只在确认计划本身可信时使用一次）",
    )
    args = parser.parse_args()

    origin = Path(args.origin)
    if not origin.is_dir():
        print(f"原始目录不存在：{origin}", file=sys.stderr)
        return 2
    if args.init_baseline:
        baseline_file = ROOT / BASELINE_PATH
        if baseline_file.exists():
            # 覆盖基线等于把"计划被改过"这件事抹掉：想重建必须先手动删掉，
            # 那一步是有意为之，会留在操作记录里。
            print(
                f"基线已存在：{BASELINE_PATH}\n"
                "如确需重建，请先手动删除该文件再执行 --init-baseline。",
                file=sys.stderr,
            )
            return 2
        current = {}
        for plan_name in ("plan.json", "plan-frontend.json"):
            plan_path = ROOT / ".pair" / plan_name
            if not plan_path.exists():
                continue
            try:
                current[plan_name] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            except OSError as error:
                print(f"{plan_name} 读不出来：{error.__class__.__name__}", file=sys.stderr)
                return 2
        baseline_file.parent.mkdir(parents=True, exist_ok=True)
        baseline_file.write_text(
            json.dumps({"plans": current}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"已建立计划基线：{BASELINE_PATH}（之后任何计划改动都会被判为违规）")
        return 0

    # origin 指到自己就没法比：两边一样，永远"没有越界"
    if os.path.realpath(origin) == os.path.realpath(ROOT):
        print("原始目录与当前工程相同，无法比对", file=sys.stderr)
        return 2

    violations: list[str] = []
    warnings: list[str] = []

    # 计划文件缺失时无法确定范围，不能声称"没有越界"
    for plan_name in ("plan.json", "plan-frontend.json"):
        if not (ROOT / ".pair" / plan_name).exists():
            violations.append(f"缺少计划文件 .pair/{plan_name}，无法确定改动范围")

    before, unreadable_before = collect(origin)
    after, unreadable_after = collect(ROOT)
    planned = planned_files()

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    modified = sorted(name for name in before if name in after and before[name] != after[name])

    print("## 新增")
    for rel in added:
        kind = classify(rel, planned)
        if kind == "越界":
            if rel in DECLARED_NEW_MODULES and plan_declares_new_module(rel):
                kind = "新增模块(已声明)"
                print(f"  [{kind}] {rel}  ← {DECLARED_NEW_MODULES[rel]}")
                continue
            violations.append(f"新增了计划外产品文件：{rel}")
        print(f"  [{kind}] {rel}")

    print("\n## 修改")
    for rel in modified:
        kind = classify(rel, planned)
        print(f"  [{kind}] {rel}")
        if kind == "越界":
            violations.append(f"修改了计划外产品文件：{rel}")

    print("\n## 删除")
    for rel in removed:
        print(f"  {rel}")
        if rel.startswith(PRODUCT_PREFIXES):
            violations.append(f"删除了产品文件：{rel}")

    for label, items in (("原始目录", unreadable_before), ("当前目录", unreadable_after)):
        for item in items:
            violations.append(f"{label}有文件读不出来，审计不完整：{item}")

    # 计划本身被扩充也算越界：原始计划里有、当前没有列的文件被"补进去"，
    # 就能把计划外改动洗成计划内。
    for plan_name in ("plan.json", "plan-frontend.json"):
        current_path = ROOT / ".pair" / plan_name
        origin_path = origin / ".pair" / plan_name
        if not (current_path.exists() and origin_path.exists()):
            continue
        try:
            current_plan = json.loads(current_path.read_text(encoding="utf-8-sig"))
            origin_plan = json.loads(origin_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            violations.append(
                f"{plan_name} 无法读取或解析（{error.__class__.__name__}），无法比对计划范围"
            )
            continue
        def safe_files(plan, label: str) -> set[str]:
            """只收结构合法的 files；不合法的已在 planned_files() 里记成违规。"""
            if not isinstance(plan, dict):
                violations.append(f"{label} 顶层不是对象，无法确定范围")
                return set()
            tasks = plan.get("tasks")
            if not isinstance(tasks, list):
                return set()
            collected: set[str] = set()
            for task in tasks:
                if not isinstance(task, dict):
                    continue
                files = task.get("files")
                if isinstance(files, list) and all(isinstance(rel, str) for rel in files):
                    collected.update(files)
            return collected

        current_files = safe_files(current_plan, f"{plan_name}（当前）")
        origin_files = safe_files(origin_plan, f"{plan_name}（原始）")
        # 变量名不要用 added：后面 added/modified 是文件列表，被这里覆盖会在相加时炸
        for added_rel in sorted(current_files - origin_files):
            violations.append(f"{plan_name} 相对原始计划新增了文件条目：{added_rel}")

        # detail/title 也要比：往任务正文里加一句"新增 X"能给新模块开豁免
        def task_texts(plan, label: str) -> set[str]:
            if not isinstance(plan, dict):
                violations.append(f"{label} 顶层不是对象，无法比对任务正文")
                return set()
            tasks = plan.get("tasks")
            if not isinstance(tasks, list):
                violations.append(f"{label} 的 tasks 不是数组，无法比对任务正文")
                return set()
            texts: set[str] = set()
            for task in tasks:
                if not isinstance(task, dict):
                    continue
                for field in ("title", "detail"):
                    value = task.get(field)
                    if isinstance(value, str):
                        texts.add(value)
            return texts

        for added_text in sorted(task_texts(current_plan, f"{plan_name}（当前）") - task_texts(origin_plan, f"{plan_name}（原始）")):
            violations.append(
                f"{plan_name} 相对原始计划新增了任务正文：{added_text[:40]}"
            )

    violations.extend(check_plan_baseline())
    for item in UNREADABLE_PLANS:
        violations.append(f"计划不可用，无法确定范围：{item}")

    print("\n## 计划文件哈希")
    for plan_name in ("plan.json", "plan-frontend.json"):
        plan_path = ROOT / ".pair" / plan_name
        if plan_path.exists():
            try:
                digest = hashlib.sha256(plan_path.read_bytes()).hexdigest()[:16]
            except OSError as error:
                print(f"  {plan_name}: 读取失败（{error.__class__.__name__}）")
                continue
            origin_path = origin / ".pair" / plan_name
            try:
                origin_digest = (
                    hashlib.sha256(origin_path.read_bytes()).hexdigest()[:16]
                    if origin_path.exists() else "(原始目录无此文件)"
                )
            except OSError as error:
                origin_digest = f"(读取失败 {error.__class__.__name__})"
            print(f"  {plan_name}: 当前 {digest} / 原始 {origin_digest}")

    print("\n## 结论")
    print(f"  原始 {len(before)} 个文件，当前 {len(after)} 个")
    print(f"  新增 {len(added)} / 修改 {len(modified)} / 删除 {len(removed)}")
    print(f"  计划内产品文件改动 {sum(1 for r in added + modified if r in planned)} 个")
    for item in warnings:
        print(f"  需复核：{item}")
    if violations:
        print("  越界项：")
        for item in violations:
            print(f"    - {item}")
        return 1
    print("  没有越界改动。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

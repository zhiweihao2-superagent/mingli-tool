#!/usr/bin/env python3
"""比较两个目录树，输出分类清单（只本地 / 只上游 / 相同 / 不同）。

用途：把 GitHub 上的新版代码（upstream）与本地工作区做逐文件比对，
在合并前先看清「哪些文件只有我们有、哪些只有对方有、哪些两边都改过」。

用法：
    python scripts/compare_trees.py <upstream_dir> <local_dir> [--out report.md]

规则：
- 忽略 .git/、.pair/、.env*、__pycache__/、node_modules/、*.log、.venv/
- 用 sha256 判断是否相同（不看 mtime）
- 输出 Markdown 表格 + 汇总计数，退出码：有差异 0（这是报告工具，不是校验器）
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

IGNORE_DIRS = {
    ".git",
    ".pair",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
}
IGNORE_SUFFIX = (".log", ".pyc", ".pyo")
IGNORE_NAMES = {".DS_Store", "Thumbs.db", ".env"}


def ignored(rel: Path) -> bool:
    if any(part in IGNORE_DIRS for part in rel.parts[:-1] if part):
        return True
    name = rel.name
    if name in IGNORE_NAMES or name.startswith(".env."):
        return True
    if name.endswith(IGNORE_SUFFIX):
        return True
    return False


def digest(path: Path, normalize_eol: bool = True) -> tuple[str, int]:
    """返回 (sha256, 归一化后的字节数)。

    normalize_eol=True 时把 CRLF 折成 LF 再算——Windows 上 clone 出来的工作区
    是 CRLF、本地是 LF，不归一化会把「完全相同的文件」全判成不同。
    """
    h = hashlib.sha256()
    total = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            if normalize_eol:
                chunk = chunk.replace(b"\r\n", b"\n")
            total += len(chunk)
            h.update(chunk)
    return h.hexdigest(), total


def collect(root: Path) -> dict[str, tuple[str, int]]:
    table: dict[str, tuple[str, int]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for filename in filenames:
            full = Path(dirpath) / filename
            rel = full.relative_to(root)
            if ignored(rel):
                continue
            try:
                table[rel.as_posix()] = digest(full)
            except OSError:
                continue
    return table


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    out_path = None
    for index, item in enumerate(argv[1:]):
        if item == "--out" and index + 2 <= len(argv[1:]):
            out_path = argv[1:][index + 1]
    if len(args) < 2:
        print(__doc__)
        return 2

    upstream = Path(args[0]).resolve()
    local = Path(args[1]).resolve()
    if not upstream.is_dir() or not local.is_dir():
        print(f"目录不存在：{upstream} / {local}")
        return 2

    up = collect(upstream)
    loc = collect(local)

    only_up = sorted(set(up) - set(loc))
    only_loc = sorted(set(loc) - set(up))
    both = sorted(set(up) & set(loc))
    differ = [p for p in both if up[p][0] != loc[p][0]]
    same = len(both) - len(differ)

    lines: list[str] = []
    lines.append(f"# 目录比对：`{upstream}` ↔ `{local}`\n")
    lines.append("| 分类 | 数量 |")
    lines.append("| --- | --- |")
    lines.append(f"| 两边都有且相同 | {same} |")
    lines.append(f"| 两边都有但不同 | {len(differ)} |")
    lines.append(f"| 只在上游（新增） | {len(only_up)} |")
    lines.append(f"| 只在本地（我们独有） | {len(only_loc)} |")
    lines.append("")

    if differ:
        lines.append("## 两边都有但内容不同\n")
        lines.append("| 文件 | 上游字节 | 本地字节 |")
        lines.append("| --- | --- | --- |")
        for path in differ:
            lines.append(f"| `{path}` | {up[path][1]} | {loc[path][1]} |")
        lines.append("")

    if only_up:
        lines.append("## 只在上游（会被新增）\n")
        for path in only_up:
            lines.append(f"- `{path}` ({up[path][1]} B)")
        lines.append("")

    if only_loc:
        lines.append("## 只在本地（合并时保留）\n")
        for path in only_loc:
            lines.append(f"- `{path}` ({loc[path][1]} B)")
        lines.append("")

    report = "\n".join(lines)
    if out_path:
        Path(out_path).write_text(report, encoding="utf-8")
        print(f"报告已写入 {out_path}")
    else:
        print(report)
    print(
        f"汇总：相同 {same} / 不同 {len(differ)} / 仅上游 {len(only_up)} / 仅本地 {len(only_loc)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

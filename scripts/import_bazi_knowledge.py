"""把上游 bazi-skill 的 references 解析成可寻址的知识包。

上游：jinchenma94/bazi-skill（MIT），commit 112a5d84cd1a001a0038cafca3be68d93e4c0cc9。
本仓库只搬了排盘脚本，references 一直没进项目；这里把它们转成结构化 JSON，
供解读层按「典籍 / 小节」引用（每句断语都能挂到具体出处）。

用法：
    python scripts/import_bazi_knowledge.py
输出：
    knowledge/bazi/knowledge-v1.json
"""

from __future__ import annotations

import json
import re
from pathlib import Path

SCHEMA = "bazi-knowledge/v1"
SOURCE_REPO = "jinchenma94/bazi-skill"
SOURCE_COMMIT = "112a5d84cd1a001a0038cafca3be68d93e4c0cc9"
SOURCE_LICENSE = "MIT"

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "knowledge" / "bazi" / "source"
OUTPUT = ROOT / "knowledge" / "bazi" / "knowledge-v1.json"

# 文件顺序即文档顺序；title 用于引用时显示
DOCUMENTS = [
    ("classical-texts", "经典命理典籍核心知识摘要", "classical-texts.md"),
    ("wuxing-tables", "五行、天干地支、十神参考表", "wuxing-tables.md"),
    ("shensha-table", "神煞表", "shensha-table.md"),
    ("dayun-rules", "大运规则详解", "dayun-rules.md"),
    ("shichen-table", "时辰对照表", "shichen-table.md"),
]

# 目录型章节没有正文，解析时跳过
SKIP_CHAPTERS = {"目录"}

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")
TABLE_ROW = re.compile(r"^\s*\|")


def _clean(text: str) -> str:
    return text.strip()


def _strip_numbering(title: str) -> str:
    """「一、阳年与阴年」→「阳年与阴年」；「1. 十天干…」→「十天干…」。"""
    return re.sub(r"^(?:[一二三四五六七八九十]+、|\d+[.、]\s*)", "", title).strip()


def parse_markdown(text: str) -> list[dict]:
    """按 ## / ### 切章，收集条目（bullet / 段落 / 表格行），保留源行号。"""
    lines = text.splitlines()
    chapters: list[dict] = []
    chapter: dict | None = None
    section: dict | None = None

    def ensure_section() -> dict:
        nonlocal section
        if section is None:
            section = {"anchor": chapter["anchor"], "title": chapter["title"], "line": chapter["line"], "items": []}
            chapter["subsections"].append(section)
        return section

    for number, raw in enumerate(lines, start=1):
        match = HEADING.match(raw)
        if match:
            level, heading = len(match.group(1)), _clean(match.group(2))
            if level == 1:
                continue
            if level == 2:
                if heading in SKIP_CHAPTERS:
                    chapter, section = None, None
                    continue
                title = _strip_numbering(heading)
                chapter = {
                    "anchor": title,
                    "title": title,
                    "line": number,
                    "lead": [],
                    "subsections": [],
                }
                chapters.append(chapter)
                section = None
                continue
            if level == 3 and chapter is not None:
                title = _strip_numbering(heading)
                section = {
                    "anchor": f"{chapter['anchor']}/{title}",
                    "title": title,
                    "line": number,
                    "items": [],
                }
                chapter["subsections"].append(section)
                continue
            # 更深的标题按普通段落处理
        if chapter is None:
            continue

        stripped = raw.strip()
        if not stripped or stripped == "---":
            continue

        bullet = BULLET.match(raw)
        if bullet:
            ensure_section()["items"].append({"kind": "point", "text": _clean(bullet.group(1)), "line": number})
            continue
        if TABLE_ROW.match(raw):
            ensure_section()["items"].append({"kind": "table-row", "text": stripped, "line": number})
            continue
        ensure_section()["items"].append({"kind": "paragraph", "text": stripped, "line": number})

    # 去掉空小节、把章节级 lead 并入一个小节便于统一引用
    for entry in chapters:
        entry["subsections"] = [item for item in entry["subsections"] if item["items"]]
        entry["lead"] = [item for item in entry["lead"] if item]
    return chapters


def build() -> dict:
    documents = []
    totals = {"documents": 0, "chapters": 0, "subsections": 0, "items": 0}
    missing = []

    for doc_id, title, filename in DOCUMENTS:
        path = SOURCE_DIR / filename
        if not path.exists():
            missing.append(filename)
            continue
        chapters = parse_markdown(path.read_text(encoding="utf-8"))
        documents.append({
            "id": doc_id,
            "title": title,
            "file": filename,
            "chapters": chapters,
        })
        totals["documents"] += 1
        totals["chapters"] += len(chapters)
        for chapter in chapters:
            totals["subsections"] += len(chapter["subsections"])
            totals["items"] += sum(len(item["items"]) for item in chapter["subsections"])

    return {
        "schema": SCHEMA,
        "source": {
            "repo": SOURCE_REPO,
            "commit": SOURCE_COMMIT,
            "license": SOURCE_LICENSE,
            "retrieved": "2026-11-02",
            "note": "上游 references 原文转结构；文字未改写，只做章节切分与行号定位。",
        },
        "documents": documents,
        "stats": totals,
        "missing": missing,
    }


def main() -> int:
    payload = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = payload["stats"]
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    print(
        f"documents={stats['documents']} chapters={stats['chapters']} "
        f"subsections={stats['subsections']} items={stats['items']}"
    )
    if payload["missing"]:
        print("missing:", ", ".join(payload["missing"]))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""把 ziwei-skill 的知识文本抽成结构化查表（一次性导入工具）。

来源：C:\\Users\\hao\\.codex\\skills\\ziwei-skill（钦天门紫微斗数 SKILL v7.7）
许可：工程层 Apache-2.0；知识文本 CC BY-NC-SA 4.0（见该目录 LICENSE / LICENSE-CONTENT）
      因此产出物**保留来源与版本标注**，且仅作查表数据，不在本项目内二次改写知识内容。

抽取目标（只做结构，不改写）：
  - 14 主星：星性段落 + 十二宫逐宫断语
  - 十四主星星曜神学：本义 / 逐宫象意 / 组合判定要点

输出：knowledge/ziwei/knowledge-v7.7.json
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

SKILL = Path(r"C:\Users\hao\.codex\skills\ziwei-skill")
OUT = Path("knowledge/ziwei/knowledge-v7.7.json")

# 源文件用「交友宫」，本项目八字侧用「仆役宫」，指同一宫。
# 归一化到本项目口径，避免查表时两边对不上。
PALACE_ALIASES = {"交友宫": "仆役宫"}

PALACES = (
    "命宫", "兄弟宫", "夫妻宫", "子女宫", "财帛宫", "疾厄宫",
    "迁移宫", "仆役宫", "官禄宫", "田宅宫", "福德宫", "父母宫",
)


def normalize_palace(name: str) -> str:
    return PALACE_ALIASES.get(name, name)


def read(name: str) -> str:
    return io.open(SKILL / "references" / name, encoding="utf-8").read()


def parse_table(lines: list[str]) -> dict[str, str]:
    """解析 markdown 表格：取第一列为键，第二列为值。"""
    rows: dict[str, str] = {}
    for line in lines:
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        key, value = cells[0], cells[1]
        if key in ("宫位", "星", "星曜") or set(key) <= {"-", ":", " "}:
            continue
        key = normalize_palace(key)
        if key and value and key not in rows:
            rows[key] = value
    return rows


def parse_main14(text: str) -> dict[str, dict]:
    """star_main14_palace.md：每颗主星 = 星性段落 + 十二宫象意表。"""
    stars: dict[str, dict] = {}
    blocks = re.split(r"\n##\s+", text)
    for block in blocks[1:]:
        lines = block.split("\n")
        name = lines[0].strip()
        if not name:
            continue
        nature = ""
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("**星性**"):
                nature = stripped.replace("**星性**：", "").replace("**星性**:", "").strip()
                break
        palaces = parse_table(lines)
        stars[name] = {
            "star_nature": nature,
            "palaces": {key: value for key, value in palaces.items() if key in PALACES},
        }
    return stars


def parse_theology(text: str) -> dict[str, dict]:
    """star_theology.md：本义 / 逐宫象意 / 组合与判定要点。"""
    entries: dict[str, dict] = {}
    blocks = re.split(r"\n##\s+", text)
    for block in blocks[1:]:
        lines = block.split("\n")
        title = lines[0].strip()
        name = re.split(r"[：:]", title)[0].strip()
        if not name:
            continue
        sections: dict[str, list[str]] = {}
        current = None
        for line in lines[1:]:
            if line.startswith("### "):
                current = line[4:].strip()
                sections[current] = []
            elif current:
                sections[current].append(line)
        essence = [
            item.lstrip("- ").strip()
            for item in sections.get("一、星曜本义", [])
            if item.strip().startswith("-")
        ]
        combos = [
            item.lstrip("- ").strip()
            for item in sections.get("三、组合与判定要点", [])
            if item.strip().startswith("-")
        ]
        by_palace = parse_table(sections.get("二、逐宫象意", []))
        entries[name] = {
            "title": title,
            "essence": essence,
            "palaces": {key: value for key, value in by_palace.items() if key in PALACES},
            "combinations": combos,
        }
    return entries


def main() -> int:
    main14 = parse_main14(read("star_main14_palace.md"))
    theology = parse_theology(read("star_theology.md"))

    # 合并：同一颗星的两个来源各自保留，不做内容合并（避免改写）
    stars: dict[str, dict] = {}
    for name in sorted(set(main14) | set(theology)):
        stars[name] = {
            "star_nature": main14.get(name, {}).get("star_nature") or "",
            "palace_readings": main14.get(name, {}).get("palaces") or {},
            "essence": theology.get(name, {}).get("essence") or [],
            "palace_notes": theology.get(name, {}).get("palaces") or {},
            "combinations": theology.get(name, {}).get("combinations") or [],
        }

    payload = {
        "schema_version": "ziwei-knowledge/v1",
        "source": {
            "name": "钦天门紫微斗数 SKILL",
            "version": "7.7",
            "origin": "C:/Users/hao/.codex/skills/ziwei-skill",
            "license": "工程层 Apache-2.0；知识文本 CC BY-NC-SA 4.0",
            "note": "仅作查表数据，未在本项目内改写知识内容",
        },
        "palaces": list(PALACES),
        "star_count": len(stars),
        "stars": stars,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n"
    )

    print(f"已导出 {OUT}（{OUT.stat().st_size} 字节）")
    for name, entry in stars.items():
        print(
            f"  {name:<4} 星性={len(entry['star_nature']):>4}字 "
            f"逐宫断语={len(entry['palace_readings']):>2} "
            f"本义={len(entry['essence']):>2} "
            f"逐宫象意={len(entry['palace_notes']):>2} "
            f"组合={len(entry['combinations']):>2}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

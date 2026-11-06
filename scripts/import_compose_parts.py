#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 ziwei-skill 的 references 抽取「组合生成」所需的两块原料。

为什么要单独抽：
    星曜逐宫断语表（star_main14_palace.md）有 36 格写着「—（源未及）」。
    这 36 格不能靠外派补，只能回到钦天门自己的组件重新组合：
        星性（star_theology.md） + 宫位义（palace_fly_all12.md） + 四化结构
    本脚本只做抽取与归一，不做任何改写或补写。

口径约束：
    1. 只收录原文明确存在的段落；缺的记为 unavailable，不猜。
    2. 输出只保存「星性短语 + 要点句 + 宫位领域」，不复制整段正文（版权）。
    3. 每条都带 source（文件 + 标题），可人工核对。
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys

SCHEMA = "ziwei-compose-parts/v1"

# 宫位 → 在 palace_fly_all12.md 里的章节。兄友线 / 父疾线是合并章节，
# 按原文括注拆给两个宫位，拆分口径写在 note 里，不假装原文分列。
PALACE_SECTION = {
    "命宫": ("一", "命宫四化入十二宫（性格倾向层）", "性格倾向层"),
    "兄弟宫": ("二", "兄友线（交友层次 · 员工位）", "交友层次、员工位"),
    "仆役宫": ("二", "兄友线（交友层次 · 员工位）", "交友层次、员工位"),
    "夫妻宫": ("三", "夫妻宫四化入十二宫（配偶职业 · 婚象）", "配偶职业、婚象"),
    "子女宫": ("四", "子女宫（桃花方向 · 生产医疗象 · 合伙）", "桃花方向、生产医疗、合伙"),
    "财帛宫": ("五", "财帛宫四化入十二宫（钱花在哪）", "钱花在哪"),
    "疾厄宫": ("六", "父疾线（文书 · 银行 · 健康 · 教育）", "健康、身体"),
    "父母宫": ("六", "父疾线（文书 · 银行 · 健康 · 教育）", "文书、银行、长辈"),
    "迁移宫": ("七", "迁移宫（出外发展 · 驿马）", "出外发展、驿马"),
    "官禄宫": ("八", "官禄宫四化入十二宫（职业形态 · 外缘提示）", "职业形态、外缘"),
    "田宅宫": ("九", "田宅宫四化入十二宫（置业 · 家运 · 库）", "置业、家运、财库"),
    "福德宫": ("十", "福德宫（享受 · 心性）", "享受、心性"),
}

# 原文件里兄弟宫叫「兄弟宫」、仆役宫在部分源文件写作「交友宫」，统一两键
ALIASES = {"交友宫": "仆役宫"}

MAX_POINTS = 3
MAX_POINT_CHARS = 90


def _read(path: str) -> str:
    return io.open(path, encoding="utf-8").read()


def _strip_md(text: str) -> str:
    return re.sub(r"\*\*|__|`", "", text).strip()


def parse_stars(text: str) -> dict:
    """抽取 12 星的星性与要点。标题形如 `## 天同：主福与家庭和睦，…`。"""
    stars: dict[str, dict] = {}
    lines = text.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^##\s+([^：:]{1,4})[：:]\s*(.+)$", line)
        if not m:
            continue
        name = m.group(1).strip()
        tagline = _strip_md(m.group(2))
        points: list[str] = []
        for j in range(i + 1, len(lines)):
            nxt = lines[j]
            if nxt.startswith("## "):
                break
            if not nxt.strip().startswith("-"):
                continue
            body = _strip_md(nxt.strip()[1:])
            if not body:
                continue
            if len(body) > MAX_POINT_CHARS:
                body = body[:MAX_POINT_CHARS].rstrip("，。；、 ") + "…"
            points.append(body)
            if len(points) >= MAX_POINTS:
                break
        stars[name] = {
            "tagline": tagline,
            # nature 用标题里的定语，句子里直接引用，不再造词
            "nature": tagline,
            "points": points,
            "source": {"file": "references/star_theology.md", "heading": f"## {name}：{tagline}"},
        }
    return stars


def parse_palaces(text: str) -> dict:
    """按固定映射给每个宫位挂上章节与领域短语；章节不存在则记 unavailable。"""
    headings = {m.group(1): _strip_md(m.group(2)) for m in re.finditer(r"^##\s+([^\s、]{1,3})、([^\n]+)$", text, re.M)}
    palaces: dict[str, dict] = {}
    for palace, (section, expected, domain) in PALACE_SECTION.items():
        actual = headings.get(section)
        if actual is None:
            palaces[palace] = {
                "status": "unavailable",
                "reason": f"palace_fly_all12.md 里没有第 {section} 节",
                "domain": None,
                "source": None,
            }
            continue
        # 章节标题必须与预期章节对得上，避免文件改版后静默错位
        if expected.split("（")[0] not in actual:
            palaces[palace] = {
                "status": "mismatch",
                "reason": f"第 {section} 节标题是「{actual}」，预期包含「{expected.split('（')[0]}」",
                "domain": None,
                "source": None,
            }
            continue
        palaces[palace] = {
            "status": "ok",
            "domain": domain,
            "section": section,
            "heading": actual,
            "source": {"file": "references/palace_fly_all12.md", "heading": f"## {section}、{actual}"},
            "note": ("兄友线为合并章节，兄弟宫与仆役宫共用；领域短语按原文括注。"
                     if section == "二" else
                     "父疾线为合并章节，疾厄宫与父母宫共用；领域短语按原文括注拆分。"
                     if section == "六" else None),
        }
    for alias, canonical in ALIASES.items():
        if canonical in palaces and alias not in palaces:
            palaces[alias] = dict(palaces[canonical], aliasOf=canonical)
    return palaces


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill-root", default=os.path.expanduser(r"~\.codex\skills\ziwei-skill"))
    parser.add_argument("--out", default=os.path.join("knowledge", "ziwei", "compose-parts.json"))
    args = parser.parse_args(argv)

    theology = os.path.join(args.skill_root, "references", "star_theology.md")
    palace_file = os.path.join(args.skill_root, "references", "palace_fly_all12.md")
    for path in (theology, palace_file):
        if not os.path.exists(path):
            print(f"缺少源文件：{path}", file=sys.stderr)
            return 2

    stars = parse_stars(_read(theology))
    palaces = parse_palaces(_read(palace_file))

    missing_stars = [n for n, v in stars.items() if not v["points"]]
    bad_palaces = [n for n, v in palaces.items() if v["status"] != "ok"]

    payload = {
        "schema": SCHEMA,
        "generatedFrom": {
            "starNature": "references/star_theology.md",
            "palaceMeaning": "references/palace_fly_all12.md",
            "note": "只抽取星性与宫位领域短语，供 §12 三要素组合用；不复制整段正文。",
        },
        "stars": stars,
        "palaces": palaces,
        "coverage": {
            "starCount": len(stars),
            "starWithoutPoints": missing_stars,
            "palaceCount": sum(1 for v in palaces.values() if v["status"] == "ok"),
            "palaceProblems": bad_palaces,
        },
    }

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with io.open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=False)
        fh.write("\n")

    print(f"星性 {len(stars)} 颗（无要点 {len(missing_stars)}）")
    print(f"宫位 {payload['coverage']['palaceCount']} 个可用（异常 {len(bad_palaces)}）")
    if bad_palaces:
        for name in bad_palaces:
            print(f"  ! {name}: {palaces[name]['reason']}")
    print(f"已写入 {args.out} ({os.path.getsize(args.out)} 字节)")
    return 0 if not bad_palaces else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

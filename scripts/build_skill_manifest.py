"""生成知识来源清单与 §16 证据矩阵（plan-chartinfo.json T4 / T5）。

清单：盘点本地 ziwei-skill 的 SKILL.md 与 11 份 references —— 版本、大小、许可、适用步骤。
矩阵：固定 15 行，逐项标注 状态 / 需要的事实 / 现有指针 / 需要的知识章节 / 缺口 / 验收证据。

原则（来自 Codex 的 T5 要求）：
  - 状态由**实际盘与主题**决定，不把静态预判当实测；
  - 任何未验证条件不得升级为 ready；
  - 六项判断与四项法则不得由模型回忆补齐。

**知识包不复制进仓库**：这里只记录路径与元数据，内容按需从本地安装读取。
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

SKILL_DIR = Path(r"C:\Users\hao\.codex\skills\ziwei-skill")
OUT_DIR = Path("knowledge/ziwei")
MANIFEST = OUT_DIR / "skill-manifest.json"
MATRIX = OUT_DIR / "section16-matrix.json"

LICENSE_CONTENT = "CC BY-NC-SA 4.0"
LICENSE_ENGINE = "Apache-2.0"

# 每份 references 与 §16 步骤的对应关系（依据 SKILL.md 的引用位置）
SECTION_APPLIES = {
    "SKILL.md": ["*"],
    "references/sheng_nian_66.md": [3, 9],
    "references/lu_zhuan_ji.md": [6],
    "references/self_zihua.md": [6, 8],
    "references/palace_fly.md": [3, 7, 8, 10, 12, 13],
    "references/palace_fly_all12.md": [3, 7, 8],
    "references/star_main14_palace.md": [1, 13, 14],
    "references/star_theology.md": [4, 10, 11, 13, 14],
    "references/auxiliary_stars.md": [1, 13, 14],
    "references/shizhan_zhuanlan.md": [5, 8, 10, 11, 12, 15],
    "references/shensha_changsheng.md": [14],
    "references/techniques_deep_clean.md": ["*"],
}

# 每份资料的章节锚点（按 SKILL.md 的引用位置人工登记，装载器按此对齐边界）
SECTION_ANCHORS = {
    # 按各文件**实际的一级/二级标题**登记（用 grep '^#{1,3}' 核对过），
    # 不靠猜测——猜错会让装载器把可用资料判成不可用。
    "SKILL.md": ["§16", "§17"],
    "references/sheng_nian_66.md": ["生年化禄（十二宫）", "生年化权（十二宫）"],
    "references/lu_zhuan_ji.md": ["忌之本性与解忌总纲", "禄转忌 vs 忌转忌"],
    "references/self_zihua.md": ["自化总纲", "自化两两组合断法"],
    "references/palace_fly.md": ["大运盘飞化"],
    "references/palace_fly_all12.md": ["用法与合规", "命宫四化入十二宫"],
    "references/star_main14_palace.md": ["紫微", "天机"],
    "references/star_theology.md": ["星曜本义", "逐宫象意"],
    "references/auxiliary_stars.md": ["星曜本义"],
    "references/shizhan_zhuanlan.md": ["定盘流程", "应期实战细则"],
    "references/shensha_changsheng.md": ["岁前十二神", "将前十二神"],
    "references/techniques_deep_clean.md": ["阴阳两仪法全解"],
}

NECESSITY = {
    "SKILL.md": "required",
    "references/techniques_deep_clean.md": "required",
}


def sha256_text(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_manifest() -> dict:
    items = []
    total = 0
    for path in [SKILL_DIR / "SKILL.md", *sorted((SKILL_DIR / "references").glob("*.md"))]:
        rel = path.relative_to(SKILL_DIR).as_posix()
        size = path.stat().st_size
        total += size
        applies = SECTION_APPLIES.get(rel, [])
        # 只要声明了适用步骤，就视为该步骤的**必需**资料：
        # 否则读取失败或预算不足时能被静默跳过，等于知识不全却能过门禁。
        necessity = NECESSITY.get(rel)
        if necessity is None:
            necessity = "required" if applies and applies != ["*"] else "supporting"
        items.append({
            "id": rel.replace("/", ".").replace(".md", ""),
            "path": rel,
            "version": "7.7",
            "license": LICENSE_CONTENT,
            "bytes": size,
            "sha256": sha256_text(path),
            "appliesTo": applies,
            "necessity": necessity,
            # 章节锚点：装载器据此按完整章节边界选取，而不是靠标题里有没有数字
            "sectionAnchors": SECTION_ANCHORS.get(rel, []),
        })
    return {
        "schema_version": "skill-manifest/v1",
        "source": {
            "name": "钦天门紫微斗数 SKILL",
            "version": "7.7",
            "origin": str(SKILL_DIR).replace("\\", "/"),
            "license": {
                "engine": LICENSE_ENGINE,
                "content": LICENSE_CONTENT,
                "links": [
                    "https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode",
                    "https://creativecommons.org/faq/",
                ],
            },
            "distributed": False,
            "note": (
                "知识内容不复制进仓库，仅记录路径与元数据；运行时从本地安装按需读取。"
                "商业用途需另行授权；对外分享须按条款保留作者、来源、许可链接与修改说明。"
            ),
        },
        "totalBytes": total,
        "items": items,
    }


# §16 十五项的初始状态（Codex 给的预判，落档时保留其"预判"性质）
SECTION16_ROWS = [
    # requiredFacts 必须是**可解析的 ChartInfo 路径**（实跑发现原描述无法解析）
    (1, "排盘对账", "conditional",
     ["palaces", "wuxingJu"],
     ["palaces", "wuxingJu"], [1],
     ["独立金标盘集合未建立", "身宫完整性未独立验证"]),
    (2, "天魁钺校验", "conditional",
     ["palaces"],
     ["palaces"], [1],
     ["ChartInfo 不含 corrections（T1 限定 11 字段）", "缺独立年干表逐宫对账"]),
    (3, "生年四化与逐宫飞化", "conditional",
     ["sihua", "flyingChains.palaceFlying"],
     ["sihua", "flyingChains.palaceFlying"], [3],
     ["四化落宫须过校验", "48 条飞化绑定的正确性未独立核对"]),
    (4, "十六字检查", "conditional",
     ["sihua", "palaces"],
     ["sihua", "palaces"], [4],
     ["禄坐/禄照/忌坐/忌冲 的逐宫规则映射待核对"]),
    (5, "引动检查（大运踩生年、流年踩大运）", "conditional",
     ["daxianSihua", "liunianSihua", "dieGong.decadal"],
     ["daxianSihua", "liunianSihua", "dieGong.decadal"], [5],
     ["引动规则未核对", "同一时间点的一致性未验证"]),
    (6, "忌之四态与禄转忌/忌转忌链", "blocked",
     ["flyingChains.jiChains", "flyingChains.palaceFlying", "selfTransform"],
     ["flyingChains", "selfTransform"], [6],
     ["完整的禄起始链未建立", "四态判定与终止语义未证明"]),
    (7, "六宫禄打分", "conditional",
     ["flyingChains.palaceFlying", "daxianSihua"],
     ["flyingChains.palaceFlying", "daxianSihua"], [7],
     ["六宫定义、计分权重与口径待核对"]),
    (8, "叠宫推算（逐宫写出）", "conditional",
     ["fourLayerDieGong.rows", "dieGong.decadal"],
     ["fourLayerDieGong", "dieGong.decadal"], [8],
     ["四层口径与日期一致性待对账"]),
    (9, "大限四化两步定位", "conditional",
     ["daxianSihua"],
     ["daxianSihua"], [9],
     ["须证明两步（本命宫名/大限宫名）均可由同一条记录追溯"]),
    (10, "破财五法则", "conditional",
     ["palaces", "sihua", "daxianSihua"],
     ["palaces", "sihua", "daxianSihua"], [10],
     ["五法则的条件与有效引用须逐条验证"]),
    (11, "离婚四法则", "conditional",
     ["palaces", "sihua"],
     ["palaces", "sihua"], [11],
     ["婚姻相关时才适用，否则应标注 not_applicable 并记原因"]),
    (12, "财库分析", "conditional",
     ["palaces", "daxianSihua", "dieGong.decadal"],
     ["palaces", "daxianSihua", "dieGong.decadal"], [12],
     ["大限田宅被冲破/禄坐/忌坐 的条件需验证"]),
    (13, "桃花分析", "conditional",
     ["palaces", "sihua"],
     ["palaces", "sihua"], [13],
     ["命、迁、夫、子宫的贪狼廉贞与禄权来源须核验"]),
    (14, "疾厄健康提示", "conditional",
     ["palaces"],
     ["palaces"], [14],
     ["只作倾向性提示，须核验疾厄宫相关事实与知识条款"]),
    (15, "当前大限逐流年关键点", "blocked",
     ["fourLayerDieGong.rows"],
     ["fourLayerDieGong.rows"], [15],
     ["现有当前年事实不足以证明整个大限逐年覆盖"]),
]


# blocked 项的「怎样才能变 ready」——没有证据模型，blocked 就是永久状态
EVIDENCE_MODEL = {
    6: {
        "toReadyRequires": [
            "新增完整禄转忌链事实：由禄起始、逐跳记录 sourcePalace→targetPalace→transformedKind",
            "忌之四态（坐/冲/出/自化）逐项判定字段，且每项可指回 fillingChains 的具体边",
            "链的终止语义（何时停、循环如何判定）写入规则登记并标 approved",
        ],
        "verification": "对同一盘构造正例（已知禄转忌链）与反例（中断链），断言链输出与人工核对一致",
        "blockedBy": "事实层尚无该结构；不是在门禁里放宽就能解决",
    },
    15: {
        "toReadyRequires": [
            "为当前大限覆盖的每个流年各产出一份年度事实（现有仅当前年）",
            "逐年的引动判定可追溯到大限与流年两层的四化",
            "大限起止与流年边界的日期一致性经对账",
        ],
        "verification": "取一个大限跨 10 年的盘，断言 10 个流年条目齐全且首尾年份与 ageRange 一致",
        "blockedBy": "现有 fineTiming 只给当前年，逐年扩产属于新增计算",
    },
}


def build_matrix() -> dict:
    rows = []
    for sid, title, status, required, pointers, sections, missing in SECTION16_ROWS:
        rows.append({
            "id": sid,
            "title": title,
            "status": status,
            "statusBasis": "预判，须以实际盘与主题重判；未验证不得升级为 ready",
            "requiredFacts": required,
            "sourcePointers": pointers,
            "knowledgeSections": [f"§16.{sid}"],
            "missing": missing,
            "evidenceModel": EVIDENCE_MODEL.get(sid),
            "acceptanceEvidence": [],
        })
    return {
        "schema_version": "section16-matrix/v1",
        "source": {"name": "钦天门紫微斗数 SKILL", "version": "7.7"},
        "principles": [
            "状态由实际盘与主题决定，静态预判不等于实测",
            "任何未验证条件不得升级为 ready",
            "六项判断与四项法则不得由模型回忆补齐",
        ],
        "rows": rows,
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    io.open(MANIFEST, "w", encoding="utf-8").write(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n"
    )
    matrix = build_matrix()
    io.open(MATRIX, "w", encoding="utf-8").write(
        json.dumps(matrix, ensure_ascii=False, indent=1) + "\n"
    )

    print(f"清单：{MANIFEST}  {len(manifest['items'])} 项 / {manifest['totalBytes']} 字节")
    for item in manifest["items"]:
        print(f"  {item['path']:<42} {item['bytes']:>7}  {item['necessity']}")
    print()
    counts: dict[str, int] = {}
    for row in matrix["rows"]:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    print(f"矩阵：{MATRIX}  15 行，状态分布 {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

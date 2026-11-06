"""规则登记表与事实包 envelope 约定（plan-ai-complete.json T1 / T2）。

为什么要一张登记表：传统命理里很多项目（神煞、格局成败、紫微组合）各家口径不同。
没有登记就直接输出，会让下游 AI 把「某一派的说法」当成「确定事实」。
所以本模块把每条规则连同来源、输入、边界策略、状态一起登记，
只有 ``status == "approved"`` 的规则才允许产出候选事实；
未裁定的规则一律输出 ``unavailable``，不伪造确定结果。
"""

from __future__ import annotations

from typing import Any, Iterable

RULES_SCHEMA_VERSION = "rule-registry/v1"

STATUS_APPROVED = "approved"
STATUS_UNRESOLVED = "unresolved"

# rule_id -> 元信息。input_paths 用 JSON Pointer 风格，
# boundary_policy 说明边界如何判定，status 决定是否允许产出事实。
RULE_REGISTRY: dict[str, dict[str, Any]] = {
    # ---- 纳音：六十甲子配三十纳音，古法固定表，无流派分歧 ----
    "nayin.60-jiazi": {
        "version": "1",
        "source": "六十甲子纳音表（通行本）",
        "input_paths": ["/pillars/*/ganzhi"],
        "predicate": "六十甲子查表，每两组共用一个纳音",
        "boundary_policy": "只认标准六十甲子组合；非标准组合判 hard failure",
        "status": STATUS_APPROVED,
    },
    # ---- 胎元：月干进一位、月支进三位，口径一致 ----
    "taiyuan.month-shift": {
        "version": "1",
        "source": "胎元起法：月柱天干进一位、地支进三位",
        "input_paths": ["/pillars/month/ganzhi"],
        "predicate": "month.gan+1, month.zhi+3",
        "boundary_policy": "缺月柱则 unavailable；干支均按六十甲子循环",
        "status": STATUS_APPROVED,
    },
    # ---- 命宫 / 身宫：子平通行算法 ----
    "minggong.siping-sum14": {
        "version": "1",
        "source": "子平命宫：月支序 + 时支序，合十四（超则廿六减）",
        "input_paths": ["/pillars/month/branch", "/pillars/hour/branch"],
        "predicate": (
            "月支序 M=寅..丑 1..12；时支序 H 取同序列逆序（寅=12..丑=1）；"
            "S=M+H；P=14-S（S<14）否则 26-S；宫支取寅..丑 第 P 位；"
            "宫干用五虎遁（甲己起丙…）从寅月起"
        ),
        "boundary_policy": "缺年干/月支/时支则 unavailable；闰月不特殊处理，直接取节气月柱",
        "status": STATUS_APPROVED,
    },
    "shengong.siping-sum12": {
        "version": "1",
        "source": "子平身宫：月支序 + 时支序，合十二（超则廿四减）",
        "input_paths": ["/pillars/month/branch", "/pillars/hour/branch"],
        "predicate": (
            "月支序 M（寅=1..丑=12）与身宫时支序 T（子=1..亥=12）；"
            "Q=((M+T-1)%12)+1；宫支取寅..丑 第 Q 位；宫干同命宫五虎遁"
        ),
        "boundary_policy": "缺年干/月支/时支则 unavailable",
        "status": STATUS_APPROVED,
    },
    # ---- 旬空：六十甲子按旬，每旬两支为空 ----
    "xunkong.sixty-cycle": {
        "version": "1",
        "source": "旬空：六十甲子分六旬，每旬两支轮空",
        "input_paths": ["/pillars/*/ganzhi"],
        "predicate": "按所在旬取两个空支",
        "boundary_policy": "只看天干地支组合，不依赖时辰",
        "status": STATUS_APPROVED,
    },
    # ---- 神煞：已有 pai_pan.compute_shensha 的 16 条规则，此处登记为文本→结构化改造 ----
    # 实测 compute_shensha 有 23 次 add()、22 个不同名字（天德分干/支两个分支）。
    # 早先写成 16 条是错的，已按实测订正。
    "shensha.pai-pan-22": {
        "version": "1",
        "source": "references/shensha-table.md 与 scripts/pai_pan.py 的 compute_shensha",
        "input_paths": ["/pillars/*", "/sex_for_calculation"],
        "predicate": (
            "二十二条：天乙贵人/天德/月德/文昌/学堂/词馆/将星/华盖/驿马/天医/禄神/"
            "金舆/羊刃/劫煞/灾煞/亡神/桃花(咸池)/孤辰/寡宿/空亡(旬空)/元辰/血刃"
        ),
        "boundary_policy": (
            "只输出项目查表规则能判定的命中，不宣称覆盖全部神煞；"
            "元辰依赖年干阴阳与性别、红鸾天喜未实现（不在本表内）；"
            "其中「空亡(旬空)」与 auxiliary_chart 的旬空同源，两处必须一致"
        ),
        "status": STATUS_APPROVED,
    },
    # ---- 未裁定：各派口径不一致，必须先裁定才能产出 ----
    "pattern.chengge-baise": {
        "version": "0",
        "source": "格局成败判据（各派差异大）",
        "input_paths": ["/derived_rules/*"],
        "predicate": "待裁定",
        "boundary_policy": "未裁定，仅输出 unavailable",
        "status": STATUS_UNRESOLVED,
    },
    "monthly.timing-candidate": {
        "version": "0",
        "source": "流月吉凶时序（各派差异大）",
        "input_paths": ["/months/*"],
        "predicate": "待裁定",
        "boundary_policy": "未裁定，保持 monthly-timing 在 unsupported_scopes",
        "status": STATUS_UNRESOLVED,
    },
}


def rule_status(rule_id: str) -> str:
    """未登记的规则按 unresolved 处理：不认识的规则不能产出事实。"""
    return (RULE_REGISTRY.get(rule_id) or {}).get("status", STATUS_UNRESOLVED)


def is_approved(rule_id: str) -> bool:
    return rule_status(rule_id) == STATUS_APPROVED


def envelope(
    rule_id: str,
    value: Any,
    *,
    status: str | None = None,
    reason: str | None = None,
    evidence: Iterable[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """统一的字段信封（T2）。

    ``unavailable`` 时 ``value`` 必须为 ``None`` 并给出 ``reason``；
    ``validated`` 时 ``reason`` 必须为 ``None``。未批准的规则一律降级为
    unavailable —— 这是「不把某派说法当确定事实」的执行点。
    """
    evidence_list = list(evidence or [])
    if not is_approved(rule_id):
        return {
            "status": "unavailable",
            "value": None,
            "rule_id": rule_id,
            "rule_version": (RULE_REGISTRY.get(rule_id) or {}).get("version"),
            "evidence": [],
            "reason": f"规则 {rule_id} 尚未裁定，不输出确定事实",
        }
    final_status = status or "validated"
    if final_status == "unavailable":
        return {
            "status": "unavailable",
            "value": None,
            "rule_id": rule_id,
            "rule_version": RULE_REGISTRY[rule_id]["version"],
            "evidence": evidence_list,
            "reason": reason or "不可用",
        }
    return {
        "status": "validated",
        "value": value,
        "rule_id": rule_id,
        "rule_version": RULE_REGISTRY[rule_id]["version"],
        "evidence": evidence_list,
        "reason": None,
    }


def candidate(
    kind: str,
    rule_id: str,
    criteria: Iterable[dict[str, Any]],
    *,
    missing_inputs: Iterable[str] | None = None,
) -> dict[str, Any]:
    """候选结构（T2）：``null`` 表示**无法判定**，不等于 ``false``。

    下游必须据此区分「条件不成立」与「没算出来」，否则会把缺输入当成否定结论。
    """
    if not is_approved(rule_id):
        return {
            "kind": kind,
            "rule_id": rule_id,
            "status": "unavailable",
            "criteria": [],
            "missing_inputs": list(missing_inputs or []),
            "reason": f"规则 {rule_id} 尚未裁定，不输出候选",
        }
    return {
        "kind": kind,
        "rule_id": rule_id,
        "rule_version": RULE_REGISTRY[rule_id]["version"],
        "status": "ok",
        "criteria": list(criteria),
        "missing_inputs": list(missing_inputs or []),
    }


def registry_snapshot() -> dict[str, Any]:
    """给事实包用的规则登记快照：下游据此知道哪些规则参与了、版本是多少。"""
    return {
        "schema_version": RULES_SCHEMA_VERSION,
        "rules": {
            rule_id: dict(meta) for rule_id, meta in sorted(RULE_REGISTRY.items())
        },
        "approved": sorted(r for r in RULE_REGISTRY if is_approved(r)),
        "unresolved": sorted(r for r in RULE_REGISTRY if not is_approved(r)),
    }

"""八字辅助盘：纳音、胎元、旬空（plan-ai-complete.json T3）。

只做**查表可得、无流派分歧**的项目：
  - 纳音：六十甲子配三十纳音，古法固定表
  - 胎元：月干进一位、月支进三位
  - 旬空：六十甲子分六旬，每旬两支轮空

命宫/身宫各派起法不一致（月建序与时支序取值、顺逆、合十四/十六均有分歧），
在 ``declarative_rules`` 里登记为 ``unresolved``，因此这里只输出 unavailable，
不伪造确定结果。神煞见 ``bazi_shensha``（由 pai_pan 的文本行改造为结构化）。
"""

from __future__ import annotations

from typing import Any

from . import declarative_rules as rules

GAN = "甲乙丙丁戊己庚辛壬癸"
ZHI = "子丑寅卯辰巳午未申酉戌亥"

# 三十纳音：每两个六十甲子共用一个
NAYIN_TABLE: tuple[str, ...] = (
    "海中金", "炉中火", "大林木", "路旁土", "剑锋金",
    "山头火", "涧下水", "城头土", "白蜡金", "杨柳木",
    "泉中水", "屋上土", "霹雳火", "松柏木", "长流水",
    "沙中金", "山下火", "平地木", "壁上土", "金箔金",
    "覆灯火", "天河水", "大驿土", "钗钏金", "桑柘木",
    "大溪水", "沙中土", "天上火", "石榴木", "大海水",
)

# 六旬 -> 轮空的两支
XUNKONG_TABLE: dict[str, tuple[str, str]] = {
    "甲子": ("戌", "亥"),
    "甲戌": ("申", "酉"),
    "甲申": ("午", "未"),
    "甲午": ("辰", "巳"),
    "甲辰": ("寅", "卯"),
    "甲寅": ("子", "丑"),
}

PILLAR_ORDER = ("year", "month", "day", "hour")


def _jiazi_index(ganzhi: str) -> int:
    """六十甲子序号 0..59；非法组合抛 ValueError（不静默当成 0）。"""
    if not isinstance(ganzhi, str) or len(ganzhi) != 2:
        # 必须恰好两字：带后缀的 "甲子错误" 不能被当作甲子
        raise ValueError(f"非法干支：{ganzhi!r}")
    gan_index = GAN.find(ganzhi[0])
    zhi_index = ZHI.find(ganzhi[1])
    if gan_index < 0 or zhi_index < 0:
        raise ValueError(f"非法干支：{ganzhi!r}")
    # 六十甲子要求"干支同奇偶"：甲子、乙丑… 不同奇偶的组合不存在
    if gan_index % 2 != zhi_index % 2:
        raise ValueError(f"干支不能相配（奇偶不一致）：{ganzhi!r}")
    # 解 n：n % 10 == gan_index 且 n % 12 == zhi_index
    for n in range(60):
        if n % 10 == gan_index and n % 12 == zhi_index:
            return n
    raise ValueError(f"干支不在六十甲子内：{ganzhi!r}")


def _nayin(ganzhi: str) -> str:
    return NAYIN_TABLE[_jiazi_index(ganzhi) // 2]


def _xunkong(ganzhi: str) -> tuple[str, str]:
    """所在旬轮空的两支。"""
    xun_start = (_jiazi_index(ganzhi) // 10) * 10
    xun_name = next(name for name in XUNKONG_TABLE if _jiazi_index(name) == xun_start)
    return XUNKONG_TABLE[xun_name]


def _taiyuan(month_ganzhi: str) -> str:
    """胎元：月干进一位、月支进三位。"""
    if not isinstance(month_ganzhi, str) or len(month_ganzhi) < 2:
        raise ValueError(f"非法月柱：{month_ganzhi!r}")
    gan_index = GAN.find(month_ganzhi[0])
    zhi_index = ZHI.find(month_ganzhi[1])
    if gan_index < 0 or zhi_index < 0:
        raise ValueError(f"非法月柱：{month_ganzhi!r}")
    return GAN[(gan_index + 1) % 10] + ZHI[(zhi_index + 3) % 12]


def build_auxiliary_chart(pillars: dict[str, Any]) -> dict[str, Any]:
    """返回 auxiliary_chart：每柱纳音、胎元、旬空（含日柱旬空）。

    ``pillars`` 是 calculation 里的四柱字典，值为 None 表示该柱缺失（如时辰未知）。
    缺失柱对应的项输出 unavailable，不用默认值代算。
    """
    nayin: dict[str, Any] = {}
    xunkong: dict[str, Any] = {}
    for name in PILLAR_ORDER:
        pillar = pillars.get(name)
        if not pillar:
            nayin[name] = rules.envelope(
                "nayin.60-jiazi", None, status="unavailable", reason=f"缺{name}柱"
            )
            xunkong[name] = rules.envelope(
                "xunkong.sixty-cycle", None, status="unavailable", reason=f"缺{name}柱"
            )
            continue
        ganzhi = pillar.get("ganzhi") or (pillar.get("stem", "") + pillar.get("branch", ""))
        # 指针必须落在**事实包自身**的根上：包顶层没有 /pillars，
        # 输入柱在 calculation 里，不在 facts 里。这里指向本字段的输出位置。
        nayin[name] = rules.envelope(
            "nayin.60-jiazi",
            _nayin(ganzhi),
            evidence=[{
                "evidence_id": f"aux.nayin.{name}",
                # 证据必须指回**计算依据**（输入的柱），否则无法复算。
                # 事实包顶层没有 /pillars，所以显式声明根为 calculation。
                "pointer_root": "calculation",
                "json_pointer": f"/pillars/{name}/ganzhi",
            }],
        )
        xunkong[name] = rules.envelope(
            "xunkong.sixty-cycle",
            list(_xunkong(ganzhi)),
            evidence=[{
                "evidence_id": f"aux.xunkong.{name}",
                "pointer_root": "calculation",
                "json_pointer": f"/pillars/{name}/ganzhi",
            }],
        )

    month = pillars.get("month")
    if month:
        month_ganzhi = month.get("ganzhi") or (month.get("stem", "") + month.get("branch", ""))
        taiyuan = rules.envelope(
            "taiyuan.month-shift",
            _taiyuan(month_ganzhi),
            evidence=[{
                "evidence_id": "aux.taiyuan",
                "pointer_root": "calculation",
                "json_pointer": "/pillars/month/ganzhi",
            }],
        )
    else:
        taiyuan = rules.envelope(
            "taiyuan.month-shift", None, status="unavailable", reason="缺月柱"
        )

    # 命宫/身宫：按 plan-fill3.json 裁定的口径实算
    from .palaces import compute_palaces

    year_stem = (pillars.get("year") or {}).get("stem")
    month_branch = (pillars.get("month") or {}).get("branch")
    hour_branch = (pillars.get("hour") or {}).get("branch")
    try:
        computed = compute_palaces(year_stem, month_branch, hour_branch)
    except ValueError as exc:
        minggong = rules.envelope(
            "minggong.siping-sum14", None, status="unavailable", reason=str(exc)
        )
        shengong = rules.envelope(
            "shengong.siping-sum12", None, status="unavailable", reason=str(exc)
        )
    else:
        minggong_status, minggong_value, minggong_reason = computed["minggong"]
        shengong_status, shengong_value, shengong_reason = computed["shengong"]
        def _palace_evidence(prefix: str) -> list[dict[str, str]]:
            """两个宫位各自一套 evidence_id，不能共用（否则跨包 ID 重复）。"""
            return [
                {"evidence_id": f"aux.{prefix}.year_stem", "pointer_root": "calculation",
                 "json_pointer": "/pillars/year/stem"},
                {"evidence_id": f"aux.{prefix}.month_branch", "pointer_root": "calculation",
                 "json_pointer": "/pillars/month/branch"},
                {"evidence_id": f"aux.{prefix}.hour_branch", "pointer_root": "calculation",
                 "json_pointer": "/pillars/hour/branch"},
            ]
        minggong = rules.envelope(
            "minggong.siping-sum14", minggong_value,
            status=minggong_status, reason=minggong_reason,
            evidence=_palace_evidence("minggong") if minggong_status == "validated" else [],
        )
        shengong = rules.envelope(
            "shengong.siping-sum12", shengong_value,
            status=shengong_status, reason=shengong_reason,
            evidence=_palace_evidence("shengong") if shengong_status == "validated" else [],
        )

    return {
        "rule_registry": rules.registry_snapshot(),
        "nayin": nayin,
        "taiyuan": taiyuan,
        "minggong": minggong,
        "shengong": shengong,
        "xunkong": xunkong,
        "day_xunkong": xunkong.get("day"),
    }

# 起算依据文本 -> 参照柱。文本由 pai_pan.compute_shensha 的 method 参数产生，
# 是稳定集合；映射不到时返回 None，由调用方降级而不是猜。
# 神煞名称 -> 规则 ID。名称来自 scripts/pai_pan.py 的 add() 调用，
# 规则 ID 是稳定标识，供事实包按版本复算（plan-fill3 T4/T5）。
SHENSHA_RULE_IDS: dict[str, str] = {
    # ---- 原有 22 条 ----
    "天乙贵人": "shensha.tianyi",
    "天德": "shensha.tiande",
    "月德": "shensha.yuede",
    "文昌": "shensha.wenchang",
    "学堂": "shensha.xuetang",
    "词馆": "shensha.ciguan",
    "将星": "shensha.jiangxing",
    "华盖": "shensha.huagai",
    "驿马": "shensha.yima",
    "天医": "shensha.tianyi-doctor",
    "禄神": "shensha.lushen",
    "金舆": "shensha.jinyu",
    "羊刃": "shensha.yangren",
    "劫煞": "shensha.jiesha",
    "灾煞": "shensha.zaisha",
    "亡神": "shensha.wangshen",
    "桃花/咸池": "shensha.taohua",
    "孤辰": "shensha.guchen",
    "寡宿": "shensha.guasu",
    "空亡/旬空": "shensha.kongwang",
    "元辰": "shensha.yuanchen",
    "血刃": "shensha.xueren",
    # ---- 新增 18 条 ----
    "太极贵人": "shensha.taiji",
    "福星贵人": "shensha.fuxing",
    "红鸾": "shensha.hongluan",
    "天喜": "shensha.tianxi",
    "红艳": "shensha.hongyan",
    "阴阳差错": "shensha.yinyang-chacuo",
    "魁罡": "shensha.kuigang",
    "流霞": "shensha.liuxia",
    "岁煞": "shensha.suisha",
    "小耗": "shensha.xiaohao",
    "勾神": "shensha.goushen",
    "绞煞": "shensha.jiaosha",
    "十恶大败": "shensha.shie-dabai",
    "孤鸾": "shensha.guluan",
    "九丑": "shensha.jiuchou",
    "进神": "shensha.jinshen",
    "退神": "shensha.tuishen",
    "三奇贵人": "shensha.sanqi",
    # ---- 新增 4 条（国印 / 德秀 / 丧门 / 童子） ----
    "国印贵人": "shensha.guoyin",
    "德秀": "shensha.dexiu",
    "丧门": "shensha.sangmen",
    "童子": "shensha.tongzi",
}

_ANCHOR_PILLARS = {
    "年干/日干查地支": ["year", "day"],
    "月支查天干": ["month"],
    "月支查地支": ["month"],
    "月支三合": ["month"],
    "日干长生": ["day"],
    "日干临官": ["day"],
    "日干": ["day"],
    "年支/日支三合": ["year", "day"],
    "年支/日支": ["year", "day"],
    "月支前一位": ["month"],
    # 新增 18 条
    "年支三合": ["year"],
    "年支": ["year"],
    "日柱": ["day"],
    "年月日三干": ["year", "month", "day"],
    # 新增 4 条
    "月支季节查日时支": ["month", "day", "hour"],
}


def _anchors_from_method(method: str) -> list[str] | None:
    return _ANCHOR_PILLARS.get(method)


_POSITION_TO_PILLAR = {
    "年干": "year", "年支": "year",
    "月干": "month", "月支": "month",
    "日干": "day", "日支": "day",
    "时干": "hour", "时支": "hour",
    # 日柱类规则（魁罡、十恶大败、孤鸾、九丑、进神、退神…）命中即日柱本身
    "日柱": "day",
    # 三奇贵人命中范围是年月日三干组合，不是单柱
    "年月日三干": "year",
}


def build_shensha(calculation: dict[str, Any]) -> dict[str, Any]:
    """把引擎算出的神煞（中文文本行 + 同源结构化记录）转成可引用事实。

    只做**格式**改造，不新增规则、不改口径：命中与否完全由
    ``scripts/pai_pan.py::compute_shensha`` 决定（22 条，见规则登记）。
    """
    records = calculation.get("shensha_records")
    if not isinstance(records, list):
        return rules.envelope(
            "shensha.pai-pan-22", None,
            status="unavailable",
            reason="引擎未提供结构化神煞记录",
        )

    hits: list[dict[str, Any]] = []
    for position, record in enumerate(records):
        name = str(record.get("name") or "")
        if not name:
            continue
        pillars = []
        for label in record.get("positions") or []:
            # 位置标签形如「年支」「日干」；也兼容直接给出柱名的情形
            pillar = _POSITION_TO_PILLAR.get(str(label))
            if pillar is None and str(label) in ("year", "month", "day", "hour"):
                pillar = str(label)
            if pillar and pillar not in pillars:
                pillars.append(pillar)
        method = str(record.get("anchors") or "")
        anchor_pillars = _anchors_from_method(method)
        if anchor_pillars is None:
            # 映射不到起算依据时不猜：只给文本，并标出无法复算
            anchor_pillars = []
            unresolved = True
        else:
            unresolved = False
        hits.append({
            "name": name,
            "rule_id": SHENSHA_RULE_IDS.get(name),
            "rule_version": rules.RULE_REGISTRY.get("shensha.pai-pan-22", {}).get("version"),
            "anchors": method,
            # 参照柱：由**哪个柱的哪个字段**起算，AI 据此复算命中
            "anchor_pillars": anchor_pillars,
            "anchor_recomputable": not unresolved,
            # 输入指针相对 calculation（事实包里没有 /pillars 根）
            "anchor_input_pointers": [
                {"pointer_root": "calculation", "json_pointer": f"/pillars/{name_}/ganzhi"}
                for name_ in anchor_pillars
            ],
            "positions": list(record.get("positions") or []),
            "pillars": pillars,
            "evidence_id": f"aux.shensha.{position}",
            "json_pointer": f"/auxiliary_chart/shensha/value/{position}",
        })

    envelope = rules.envelope("shensha.pai-pan-22", hits)

    # 逐规则状态：把 40 条都列出来，标出哪些已求值、哪些因缺锚点未求值。
    # 消费者据此知道"没出现"是"没命中"还是"没算"。
    hour_known = bool((calculation.get("pillars") or {}).get("hour"))
    unevaluated_targets = [] if hour_known else ["hour"]
    per_rule = []
    hit_rule_ids = {hit["rule_id"] for hit in hits if hit.get("rule_id")}
    for name, rule_id in SHENSHA_RULE_IDS.items():
        per_rule.append({
            "rule_id": rule_id,
            "name": name,
            "status": "hit" if rule_id in hit_rule_ids else "no-hit",
        })
    envelope["rule_status"] = per_rule
    envelope["unevaluated_targets"] = unevaluated_targets
    if unevaluated_targets:
        # 时柱未知时，只查时支的规则并未真正求值
        envelope["unevaluated_note"] = "时柱未知，涉及时支的目标未评估"
    return envelope

PILLAR_LABELS = {"year": "年", "month": "月", "day": "日", "hour": "时"}
ELEMENT_OF_STEM = {
    "甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
    "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水",
}


def build_stem_root_audit(pillars: dict[str, Any]) -> dict[str, Any]:
    """通根与透干清单（plan-ai-v2 T4）。

    通根：藏干与日主**同干**（比肩根）或**同五行**（同气根），按柱列出。
    透干：每个藏干在可见天干里是否有**相同天干**出现，出现在哪些柱。
    两者都只描述结构，不评判旺衰强弱——强弱由 `derived_rules.strength` 给出。
    """
    day = pillars.get("day") or {}
    day_stem = day.get("stem")
    day_element = day.get("stem_element") or ELEMENT_OF_STEM.get(day_stem or "")

    visible = []
    for name in ("year", "month", "day", "hour"):
        pillar = pillars.get(name) or {}
        stem = pillar.get("stem")
        if stem:
            visible.append({"pillar": name, "stem": stem, "element": ELEMENT_OF_STEM.get(stem)})

    roots: list[dict[str, Any]] = []
    exposure: list[dict[str, Any]] = []
    for name in ("year", "month", "day", "hour"):
        pillar = pillars.get(name) or {}
        for index, hidden in enumerate(pillar.get("hidden_stems") or []):
            stem = hidden.get("stem")
            element = hidden.get("element") or ELEMENT_OF_STEM.get(stem)
            kind = None
            if stem == day_stem:
                kind = "same-stem"
            elif element and element == day_element:
                kind = "same-element"
            if kind:
                roots.append({
                    "pillar": name,
                    "pillar_label": PILLAR_LABELS.get(name),
                    "hidden_index": index,
                    "stem": stem,
                    "element": element,
                    "role": hidden.get("role"),
                    "kind": kind,
                    "json_pointer": f"/pillars/{name}/hidden_stems/{index}",
                })
            matches = [
                {"pillar": item["pillar"], "stem": item["stem"]}
                for item in visible
                if item["stem"] == stem
            ]
            exposure.append({
                "pillar": name,
                "pillar_label": PILLAR_LABELS.get(name),
                "hidden_index": index,
                "stem": stem,
                "role": hidden.get("role"),
                "transparent": bool(matches),
                "visible_matches": matches,
            })

    return {
        "day_master": {"stem": day_stem, "element": day_element},
        "concept": (
            "本清单按**结构口径**：藏干与日主同干为 same-stem、同五行为 same-element。"
            "旺衰层的 roots 按**十神归属**（比劫/印为同党）计分，口径不同，不可互相替代。"
        ),
        "same_stem_roots": [item for item in roots if item["kind"] == "same-stem"],
        "same_element_roots": [item for item in roots if item["kind"] == "same-element"],
        "stem_exposure": exposure,
        "same_stem_root_count": sum(1 for item in roots if item["kind"] == "same-stem"),
        "same_element_root_count": sum(1 for item in roots if item["kind"] == "same-element"),
        "transparent_count": sum(1 for item in exposure if item["transparent"]),
    }

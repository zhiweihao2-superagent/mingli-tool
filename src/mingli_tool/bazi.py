"""Validated JSON adapter around the pinned deterministic bazi engine."""

from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta
from typing import Any

from scripts import pai_pan as engine

from . import __version__
from .bazi_facts import build as build_ai_facts
from .bazi_months import build_monthly_facts
from .errors import ToolError


SCHEMA_VERSION = "1.0"
ENGINE_NAME = "jinchenma94/bazi-skill"
ENGINE_COMMIT = "112a5d84cd1a001a0038cafca3be68d93e4c0cc9"
RULE_PROFILE = "bazi-skill-112a5d84-beijing-v1"
SUPPORTED_RULE_PROFILES = {"engine-default-v1", RULE_PROFILE}
BRANCHES = tuple(engine.ZHI)
STEM_YIN_YANG = dict(zip(engine.GAN, ("阳", "阴") * 5, strict=True))
BRANCH_YIN_YANG = dict(zip(engine.ZHI, ("阳", "阴") * 6, strict=True))
BRANCH_ELEMENT = dict(zip(engine.ZHI, ("水", "土", "木", "木", "土", "火", "火", "土", "金", "金", "土", "水"), strict=True))
LIFE_STAGES = ("长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养")
LIFE_STAGE_BRANCHES = {
    "甲": "亥子丑寅卯辰巳午未申酉戌", "乙": "午巳辰卯寅丑子亥戌酉申未",
    "丙": "寅卯辰巳午未申酉戌亥子丑", "丁": "酉申未午巳辰卯寅丑子亥戌",
    "戊": "寅卯辰巳午未申酉戌亥子丑", "己": "酉申未午巳辰卯寅丑子亥戌",
    "庚": "巳午未申酉戌亥子丑寅卯辰", "辛": "子亥戌酉申未午巳辰卯寅丑",
    "壬": "申酉戌亥子丑寅卯辰巳午未", "癸": "卯寅丑子亥戌酉申未午巳辰",
}
CHINA_DST_SPANS = {
    1935: (5, 1, 9, 30), 1936: (5, 1, 9, 30), 1937: (5, 1, 9, 30), 1938: (5, 1, 9, 30),
    1939: (5, 1, 9, 30), 1940: (5, 1, 9, 30), 1941: (5, 1, 9, 30), 1942: (5, 1, 9, 30),
    1943: (5, 1, 9, 30), 1944: (5, 1, 9, 30), 1945: (5, 1, 9, 30), 1946: (5, 1, 9, 30),
    1947: (5, 1, 9, 30), 1948: (5, 1, 9, 30), 1949: (5, 1, 9, 30), 1950: (5, 1, 9, 30),
    1951: (5, 1, 9, 30), 1952: (3, 1, 10, 31), 1953: (4, 1, 10, 31), 1954: (4, 1, 10, 31),
    1955: (5, 1, 9, 30), 1956: (5, 1, 9, 30), 1957: (4, 1, 9, 30), 1958: (4, 1, 9, 30),
    1959: (4, 1, 9, 30), 1960: (6, 1, 9, 30), 1961: (6, 1, 9, 30), 1974: (4, 1, 10, 31),
    1975: (4, 1, 10, 31), 1979: (7, 1, 9, 30), 1986: (5, 4, 9, 14), 1987: (4, 12, 9, 13),
    1988: (4, 10, 9, 11), 1989: (4, 16, 9, 17), 1990: (4, 15, 9, 16), 1991: (4, 14, 9, 15),
}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(\d{2}):(\d{2})$")


def _object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolError("INVALID_INPUT", f"{path} 必须是 JSON 对象", {"path": path})
    return value


def _parse_date(value: Any, path: str) -> date:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        raise ToolError("INVALID_DATE", f"{path} 必须使用 YYYY-MM-DD", {"path": path})
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ToolError("INVALID_DATE", f"{path} 不是有效日期", {"path": path}) from exc
    if not 1900 <= parsed.year <= 2100:
        raise ToolError(
            "UNSUPPORTED_DATE_RANGE",
            "当前引擎只声明支持 1900 至 2100 年",
            {"path": path, "year": parsed.year},
        )
    return parsed


def _parse_minute(value: Any) -> tuple[int, int]:
    if not isinstance(value, str):
        raise ToolError("INVALID_TIME", "分钟级时间必须是 HH:MM 字符串")
    matched = TIME_RE.fullmatch(value)
    if not matched:
        raise ToolError("INVALID_TIME", "分钟级时间必须使用 HH:MM")
    hour, minute = (int(part) for part in matched.groups())
    if hour > 23 or minute > 59:
        raise ToolError("INVALID_TIME", "时间超出有效范围", {"value": value})
    return hour, minute


def _warning(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _map_engine_warning(message: str) -> dict[str, str]:
    known = {
        "时辰未知": "UNKNOWN_TIME",
        "未提供具体时刻，子时按早子时（当日日柱）处理": "EARLY_ZI_ASSUMPTION",
        "节气交界": "SOLAR_TERM_BOUNDARY",
        "立春前后": "LICHUN_BOUNDARY",
        "校正后可能跨时辰": "POSSIBLE_TIME_BRANCH_CHANGE",
    }
    return _warning(known.get(message, "ENGINE_WARNING"), message)


def _equation_of_time_minutes(value: datetime) -> float:
    days_in_year = 366 if value.year % 4 == 0 and (value.year % 100 != 0 or value.year % 400 == 0) else 365
    day_number = value.timetuple().tm_yday
    fractional_hour = value.hour + value.minute / 60
    gamma = 2 * math.pi / days_in_year * (day_number - 1 + (fractional_hour - 12) / 24)
    return 229.18 * (
        0.000075 + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )


def _true_solar_datetime(solar_date: date, hour: int, minute: int, longitude: float, clock_time_is_dst: bool) -> tuple[datetime, dict[str, Any]]:
    clock = datetime(solar_date.year, solar_date.month, solar_date.day, hour, minute)
    longitude_minutes = (longitude - 120.0) * 4.0
    equation_minutes = _equation_of_time_minutes(clock)
    dst_minutes = -60.0 if clock_time_is_dst else 0.0
    total_minutes = longitude_minutes + equation_minutes + dst_minutes
    corrected = clock + timedelta(minutes=total_minutes)
    if corrected.second >= 30:
        corrected += timedelta(minutes=1)
    corrected = corrected.replace(second=0, microsecond=0)
    return corrected, {
        "applied": True,
        "original_clock": clock.strftime("%Y-%m-%d %H:%M"),
        "corrected_clock": corrected.strftime("%Y-%m-%d %H:%M"),
        "longitude": longitude,
        "longitude_correction_minutes": round(longitude_minutes, 3),
        "equation_of_time_minutes": round(equation_minutes, 3),
        "dst_adjustment_minutes": dst_minutes,
        "total_correction_minutes": round(total_minutes, 3),
        "day_offset": (corrected.date() - clock.date()).days,
    }


def _china_dst_span(value: date) -> tuple[int, int, int, int] | None:
    return CHINA_DST_SPANS.get(value.year)


def _is_china_dst(value: date) -> bool:
    span = _china_dst_span(value)
    if span is None:
        return False
    start_month, start_day, end_month, end_day = span
    return (value.month, value.day) >= (start_month, start_day) and (value.month, value.day) <= (end_month, end_day)


def _hidden_stems(text: str | None, day_stem: str) -> list[dict[str, Any]] | None:
    if not text or text == "未知":
        return None
    values = []
    parts = text.split("、")
    # Each branch is normalized to one point before the month-command
    # multiplier is applied: one hidden stem gets 1.0, two get 0.7/0.3,
    # and three get 0.6/0.3/0.1.
    weights = {1: (1.0,), 2: (0.7, 0.3), 3: (0.6, 0.3, 0.1)}[len(parts)]
    roles = ("本气", "中气", "余气")
    for index, item in enumerate(parts):
        stem = item[0]
        values.append(
            {
                "stem": stem,
                "element": item[1:] or engine.GAN_WUXING[engine.GAN.index(stem)],
                "ten_god": engine.shishen_of(engine.GAN.index(day_stem), engine.GAN.index(stem)),
                "role": roles[index],
                "nominal_weight": weights[index],
            }
        )
    return values


def _life_stage(stem: str, branch: str) -> str:
    return LIFE_STAGES[LIFE_STAGE_BRANCHES[stem].index(branch)]


def _pillar(value: tuple[str, str, str, str], day_stem: str) -> dict[str, Any] | None:
    stem, branch, ten_god, hidden = value
    # 引擎有时不给天干十神（或给占位符）。日主自身为 "—" 是正常的，
    # 其余柱必须补算，否则 AI 拿不到"比肩/劫财/食神"这类关键信息。
    if ten_god in (None, "", "—") and stem != day_stem:
        ten_god = engine.shishen_of(
            engine.GAN.index(day_stem), engine.GAN.index(stem)
        )
    if stem == "未知" or branch == "未知":
        return None
    return {
        "stem": stem,
        "branch": branch,
        "ganzhi": stem + branch,
        "stem_element": engine.GAN_WUXING[engine.GAN.index(stem)],
        "stem_yin_yang": STEM_YIN_YANG[stem],
        "branch_element": BRANCH_ELEMENT[branch],
        "branch_yin_yang": BRANCH_YIN_YANG[branch],
        "ten_god": None if ten_god == "—" else ten_god,
        "hidden_stems": _hidden_stems(hidden, day_stem),
        "stem_life_stage": _life_stage(stem, branch),
        "day_master_life_stage": _life_stage(day_stem, branch),
    }


def _shensha(lines: list[str]) -> list[dict[str, str]]:
    values = []
    for line in lines:
        text = line[2:] if line.startswith("- ") else line
        name, separator, evidence = text.partition(" — ")
        values.append({"name": name.strip(), "evidence": evidence.strip() if separator else ""})
    return values


def _validate(payload: Any) -> dict[str, Any]:
    root = _object(payload, "root")
    if root.get("schema_version") != SCHEMA_VERSION:
        raise ToolError(
            "UNSUPPORTED_SCHEMA_VERSION",
            f"schema_version 必须是 {SCHEMA_VERSION}",
            {"received": root.get("schema_version")},
        )

    profile = _object(root.get("profile"), "profile")
    calendar = profile.get("calendar")
    if calendar not in {"solar", "lunar"}:
        raise ToolError("INVALID_CALENDAR", "profile.calendar 必须是 solar 或 lunar")
    input_date = _parse_date(profile.get("date"), "profile.date")

    leap = profile.get("is_leap_month", False)
    if not isinstance(leap, bool):
        raise ToolError("INVALID_INPUT", "profile.is_leap_month 必须是布尔值")
    if calendar == "solar" and leap:
        raise ToolError("INVALID_INPUT", "公历输入不能设置闰月")

    timezone_name = profile.get("timezone", "Asia/Shanghai")
    if timezone_name != "Asia/Shanghai":
        raise ToolError(
            "UNSUPPORTED_TIMEZONE",
            "当前引擎仅支持 Asia/Shanghai（北京时间）",
            {"received": timezone_name},
        )

    sex = profile.get("sex_for_calculation")
    if sex not in {"male", "female"}:
        raise ToolError("INVALID_SEX", "profile.sex_for_calculation 必须是 male 或 female")

    time_data = _object(profile.get("time"), "profile.time")
    precision = time_data.get("precision")
    if precision not in {"minute", "branch", "unknown"}:
        raise ToolError("INVALID_TIME_PRECISION", "time.precision 必须是 minute、branch 或 unknown")
    hour = minute = branch = None
    if precision == "minute":
        hour, minute = _parse_minute(time_data.get("value"))
        if time_data.get("branch") is not None:
            raise ToolError("INVALID_TIME", "分钟级时间不能同时提供 branch")
    elif precision == "branch":
        branch = time_data.get("branch")
        if branch not in BRANCHES:
            raise ToolError("INVALID_TIME", "时辰 branch 必须是十二地支之一", {"received": branch})
        if time_data.get("value") is not None:
            raise ToolError("INVALID_TIME", "时辰级输入不能同时提供 value")
    else:
        if time_data.get("value") is not None or time_data.get("branch") is not None:
            raise ToolError("INVALID_TIME", "未知时辰的 value 和 branch 必须为 null")

    rules = _object(root.get("rules", {}), "rules")
    profile_id = rules.get("profile_id", "engine-default-v1")
    if profile_id not in SUPPORTED_RULE_PROFILES:
        raise ToolError("UNSUPPORTED_RULE", "不支持所请求的规则配置", {"profile_id": profile_id})
    true_solar_time = rules.get("true_solar_time", False)
    if not isinstance(true_solar_time, bool):
        raise ToolError("INVALID_INPUT", "rules.true_solar_time 必须是布尔值")
    clock_time_is_dst = rules.get("clock_time_is_dst", False)
    if not isinstance(clock_time_is_dst, bool):
        raise ToolError("INVALID_INPUT", "rules.clock_time_is_dst 必须是布尔值")

    options = _object(root.get("options", {}), "options")
    save_history = options.get("save_history", False)
    if not isinstance(save_history, bool):
        raise ToolError("INVALID_INPUT", "options.save_history 必须是布尔值")
    if save_history:
        raise ToolError("UNSUPPORTED_OPTION", "计算核心不会自动保存个人资料", {"option": "save_history"})
    through_year = options.get("annual_cycles_through", datetime.now(engine.BJ).year)
    if isinstance(through_year, bool) or not isinstance(through_year, int):
        raise ToolError("INVALID_INPUT", "options.annual_cycles_through 必须是整数年份")
    if not input_date.year <= through_year <= 2100:
        raise ToolError(
            "INVALID_INPUT",
            "annual_cycles_through 必须不早于出生年且不晚于 2100",
            {"received": through_year},
        )

    birthplace = profile.get("birthplace") or {}
    birthplace = _object(birthplace, "profile.birthplace")
    label = birthplace.get("label")
    if label is not None and not isinstance(label, str):
        raise ToolError("INVALID_INPUT", "birthplace.label 必须是字符串或 null")
    longitude = birthplace.get("longitude")
    if longitude is not None and (isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180):
        raise ToolError("INVALID_INPUT", "birthplace.longitude 必须是 -180 到 180 之间的数字")
    if true_solar_time and (precision != "minute" or longitude is None):
        raise ToolError("INVALID_INPUT", "真太阳时校正需要分钟级出生时间和出生地经度")
    if clock_time_is_dst and not true_solar_time:
        raise ToolError("INVALID_INPUT", "夏令时钟表修正需要同时启用真太阳时校正")

    return {
        "calendar": calendar,
        "input_date": input_date,
        "leap": leap,
        "timezone": timezone_name,
        "sex": sex,
        "hour": hour,
        "minute": minute,
        "branch": branch,
        "precision": precision,
        "birthplace": birthplace,
        "true_solar_time": true_solar_time,
        "clock_time_is_dst": clock_time_is_dst,
        "display_name": profile.get("display_name"),
        "through_year": through_year,
    }


def calculate(payload: Any) -> dict[str, Any]:
    """Validate a v1 request and return a structured deterministic chart."""
    values = _validate(payload)
    input_date = values["input_date"]
    solar_date = input_date
    lunar_text = None

    if values["calendar"] == "lunar":
        try:
            solar_date = engine.lunar_to_solar(
                input_date.year,
                input_date.month,
                input_date.day,
                leap=values["leap"],
            )
            lunar_text = engine.format_lunar(
                input_date.year,
                input_date.month,
                input_date.day,
                values["leap"],
            )
        except ValueError as exc:
            raise ToolError("INVALID_LUNAR_DATE", str(exc)) from exc

    possible_china_dst = _is_china_dst(solar_date)
    china_dst_span = _china_dst_span(solar_date)
    time_correction = {"applied": False, "possible_china_dst": possible_china_dst}
    if values["true_solar_time"]:
        corrected, time_correction = _true_solar_datetime(
            solar_date,
            values["hour"],
            values["minute"],
            float(values["birthplace"]["longitude"]),
            values["clock_time_is_dst"],
        )
        time_correction["possible_china_dst"] = possible_china_dst
        solar_date = corrected.date()
        values["hour"], values["minute"] = corrected.hour, corrected.minute

    place = values["birthplace"].get("label")
    as_of = datetime(values["through_year"], 1, 1, tzinfo=engine.BJ)
    try:
        result = engine.compute(
            solar_date=solar_date,
            hour=values["hour"],
            minute=values["minute"],
            shichen=values["branch"],
            sex="男" if values["sex"] == "male" else "女",
            place=place,
            deceased_year=values["through_year"],
            lunar_display=lunar_text,
            now=as_of,
        )
    except ValueError as exc:
        raise ToolError("ENGINE_FAILURE", str(exc)) from exc

    day_stem = result["pillars"]["day"][0]
    pillars = {
        name: _pillar(result["pillars"][name], day_stem)
        for name in ("year", "month", "day", "hour")
    }
    warnings = [_map_engine_warning(message) for message in result["warnings"]]
    if possible_china_dst and not values["clock_time_is_dst"]:
        start_month, start_day, end_month, end_day = china_dst_span or (0, 0, 0, 0)
        warnings.append(
            _warning(
                "POSSIBLE_CHINA_DST",
                f"该日期处于中国大陆历史夏令时区间（{start_month} 月 {start_day} 日至 {end_month} 月 {end_day} 日）。如出生证明写的是当时钟表时间，请勾选夏令时修正；如已换算成标准时则不要勾选。",
            )
        )
    if values["birthplace"].get("longitude") is not None or values["birthplace"].get("latitude") is not None:
        if values["true_solar_time"]:
            warnings.append(_warning("TRUE_SOLAR_TIME_APPLIED", f'已按经度与均时差校正为 {time_correction["corrected_clock"]}'))
        else:
            warnings.append(_warning("BIRTHPLACE_NOT_USED_FOR_SOLAR_CORRECTION", "出生地坐标已保留，但未启用真太阳时校正"))

    normalized_time = {"precision": values["precision"], "value": None, "branch": None}
    if values["precision"] == "minute":
        normalized_time["value"] = f'{values["hour"]:02d}:{values["minute"]:02d}'
        normalized_time["branch"] = result["shichen_text"].split(" / ", 1)[0]
    elif values["precision"] == "branch":
        normalized_time["branch"] = values["branch"]

    response = {
        "schema_version": SCHEMA_VERSION,
        "status": "ok",
        "normalized_input": {
            "profile": {
                "display_name": values["display_name"],
                "calendar": values["calendar"],
                "date": input_date.isoformat(),
                "solar_date": solar_date.isoformat(),
                "is_leap_month": values["leap"],
                "time": normalized_time,
                "timezone": values["timezone"],
                "sex_for_calculation": values["sex"],
                "birthplace": values["birthplace"],
                "time_correction": time_correction,
            },
            "rules": {"profile_id": RULE_PROFILE, "true_solar_time": values["true_solar_time"], "clock_time_is_dst": values["clock_time_is_dst"]},
            "options": {"save_history": False, "annual_cycles_through": values["through_year"]},
        },
        "calculation": {
            "system": "bazi",
            "engine": {
                "name": ENGINE_NAME,
                "commit": ENGINE_COMMIT,
                "license": "MIT",
                "adapter_version": __version__,
            },
            "rule_profile": {
                "id": RULE_PROFILE,
                "timezone": "UTC+08:00",
                "year_boundary": "exact_lichun",
                "month_boundary": "twelve_jie",
                "day_boundary": "late_zi_next_day_from_23_00",
                "true_solar_time": values["true_solar_time"],
            },
            "calendar_display": {"solar": result["solar_text"], "lunar": result["lunar_text"]},
            "pillars": pillars,
            # 性别：大运顺逆与部分神煞依赖它，解读时 AI 也需要
            "sex_for_calculation": values["sex"],
            # 神煞：引擎算好的结构化记录（与 shensha_lines 同源），
            # 供 ai_facts.auxiliary_chart.shensha 做可引用输出
            "shensha_records": result.get("shensha_records") or [],
            "derived": {
                "day_master": day_stem,
                "solar_term_month_boundary": result["jie_name"],
                "zi_period": result["zishi"],
                "shensha": _shensha(result["shensha_lines"]),
            },
            "luck_cycles": {
                "direction": "forward" if result["forward"] else "reverse",
                # 上游 qiyun_from_days 只产出年/月精度，没有天数；
                # 这里显式写出 days=0 与 precision，避免下游误以为丢失了信息。
                "start": {
                    "years": result["qiyun_years"],
                    "months": result["qiyun_months"],
                    "days": 0,
                    "precision": "months",
                },
                "cycles": [
                    {"sequence": seq, "age_range": age_range, "ganzhi": ganzhi}
                    for seq, age_range, ganzhi in result["dayun_rows"]
                ],
            },
            "annual_cycles": [
                {"year": year, "ganzhi": engine.liunian_gz(year)}
                for year in result["liunian_years"]
            ],
        },
        "warnings": warnings,
        "provenance": {
            "upstream": "https://github.com/jinchenma94/bazi-skill",
            "upstream_commit": ENGINE_COMMIT,
            "verification_scope": [
                "11 upstream regression tests",
                "adapter validation and mapping tests",
                "not an independent validation of every calendrical or traditional rule",
            ],
        },
        "interpretation": None,
    }
    response["ai_facts"] = build_ai_facts(response["calculation"], response["normalized_input"])
    # 重点年份的 12 个流月坐标与四层关系，纯确定性，不含 AI。
    response["monthly_facts"] = build_monthly_facts(
        response["calculation"], values["through_year"], response["normalized_input"]
    )
    return response

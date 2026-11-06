"""用 `schemas/monthly-facts-v1.schema.json` 校验事实包。

环境里没有 `jsonschema` 库，所以这里自带一个最小校验器：
只覆盖**本仓库 schema 实际用到的**关键字（$ref/$defs、type、required、properties、
items、enum、const、minItems/maxItems、minLength/maxLength、pattern、minimum、
exclusiveMinimum）。不是通用实现，但足以让 schema 真的被执行，而不是当摆设。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
import unittest
from pathlib import Path

from mingli_tool.bazi import calculate
from mingli_tool.bazi_months import SCHEMA_VERSION, build_monthly_facts

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "monthly-facts-v1.schema.json"

_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}


def validate(instance, schema, root, path="$") -> list[str]:
    """返回错误列表；空列表表示通过。"""
    errors: list[str] = []

    ref = schema.get("$ref")
    if ref:
        if not ref.startswith("#/$defs/"):
            return [f"{path}: 不支持的 $ref {ref}"]
        name = ref.split("/")[-1]
        if name not in root.get("$defs", {}):
            return [f"{path}: $defs 缺少 {name}"]
        return validate(instance, root["$defs"][name], root, path)

    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: 期望常量 {schema['const']!r}，实际 {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} 不在枚举 {schema['enum']}")

    # if/then/else：条件通过就套 then，否则套 else
    if "if" in schema:
        condition_errors = validate(instance, schema["if"], root, path)
        branch = schema.get("then") if not condition_errors else schema.get("else")
        if isinstance(branch, dict):
            errors.extend(validate(instance, branch, root, path))

    for sub in schema.get("allOf") or []:
        errors.extend(validate(instance, sub, root, path))

    expected_types = schema.get("type")
    if expected_types:
        names = expected_types if isinstance(expected_types, list) else [expected_types]
        if not any(_TYPE_CHECKS[name](instance) for name in names):
            errors.append(f"{path}: 类型应为 {names}，实际 {type(instance).__name__}")
            return errors

    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}: 缺少必需字段 {key}")
        for key, sub in (schema.get("properties") or {}).items():
            if key in instance:
                errors.extend(validate(instance[key], sub, root, f"{path}.{key}"))

    if isinstance(instance, list):
        if schema.get("uniqueItems"):
            seen = []
            for item in instance:
                if item in seen:
                    errors.append(f"{path}: 元素重复 {item!r}（uniqueItems）")
                    break
                seen.append(item)
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: 元素数 {len(instance)} < minItems {schema['minItems']}")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: 元素数 {len(instance)} > maxItems {schema['maxItems']}")
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(instance):
                errors.extend(validate(item, items, root, f"{path}[{index}]"))
        prefix = schema.get("prefixItems")
        if isinstance(prefix, list):
            for index, sub in enumerate(prefix):
                if index < len(instance):
                    errors.extend(validate(instance[index], sub, root, f"{path}[{index}]"))

    if isinstance(instance, str) and schema.get("format") == "date-time":
        # 正则只能保证"长得像"，2026-02-31 这种格式对但不存在的日期要真的解析
        try:
            datetime.fromisoformat(instance)
        except (TypeError, ValueError):
            errors.append(f"{path}: {instance!r} 不是合法日期时间")

    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: 长度 {len(instance)} < minLength {schema['minLength']}")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append(f"{path}: 长度 {len(instance)} > maxLength {schema['maxLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            errors.append(f"{path}: {instance!r} 不匹配 {schema['pattern']}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: {instance} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
            errors.append(f"{path}: {instance} <= exclusiveMinimum {schema['exclusiveMinimum']}")

    return errors


def payload(time_block: dict) -> dict:
    return {
        "schema_version": "1.0",
        "profile": {
            "display_name": None,
            "calendar": "solar",
            "date": "1990-05-15",
            "is_leap_month": False,
            "time": time_block,
            "timezone": "Asia/Shanghai",
            "sex_for_calculation": "male",
            "birthplace": {"label": None, "longitude": None, "latitude": None},
        },
        "rules": {"profile_id": "engine-default-v1", "true_solar_time": False},
        "options": {"save_history": False, "annual_cycles_through": 2026},
    }


class MonthlyFactsSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def assert_valid(self, package: dict, label: str) -> None:
        errors = validate(package, self.schema, self.schema)
        self.assertEqual(errors, [], f"{label} 未通过 schema：\n" + "\n".join(errors[:10]))

    def test_schema_file_is_self_consistent(self):
        self.assertEqual(
            self.schema["$id"],
            "https://mingli.example/schemas/monthly-facts-v1.schema.json",
        )
        self.assertIn(SCHEMA_VERSION, self.schema["properties"]["schema_version"]["enum"])
        for name in ("month", "monthLuck", "relationScope", "relationAudit", "luckLayer"):
            self.assertIn(name, self.schema["$defs"], f"$defs 缺少 {name}")

    def test_plain_package_matches_schema(self):
        self.assert_valid(build_monthly_facts(None, 2026), "纯坐标包")

    def test_audited_package_matches_schema(self):
        result = calculate(payload({"precision": "minute", "value": "12:30"}))
        self.assert_valid(result["monthly_facts"], "带关系审计的包")

    def test_all_precisions_match_schema(self):
        for time_block in (
            {"precision": "minute", "value": "12:30"},
            {"precision": "branch", "branch": "午"},
            {"precision": "branch", "branch": "子"},
            {"precision": "unknown"},
        ):
            with self.subTest(precision=time_block["precision"], branch=time_block.get("branch")):
                package = calculate(payload(time_block))["monthly_facts"]
                self.assert_valid(package, f"精度 {time_block}")

    def test_unsupported_package_matches_schema(self):
        self.assert_valid(build_monthly_facts(None, 1899), "超范围年份")

    def test_validator_rejects_broken_package(self):
        """证明校验器不是永远通过：把包改坏，必须报错。"""
        package = build_monthly_facts(None, 2026)
        package["months"][0]["start_utc_offset"] = "+09:00"
        errors = validate(package, self.schema, self.schema)
        self.assertTrue(errors, "时区被改成 +09:00 却没报错")

        package = build_monthly_facts(None, 2026)
        del package["months"][3]["ganzhi"]
        errors = validate(package, self.schema, self.schema)
        self.assertTrue(any("ganzhi" in error for error in errors), errors)

        package = build_monthly_facts(None, 2026)
        package["fingerprint"] = "not-a-fingerprint"
        errors = validate(package, self.schema, self.schema)
        self.assertTrue(any("fingerprint" in error for error in errors), errors)

        package = build_monthly_facts(None, 2026)
        package["months"] = package["months"][:11]
        errors = validate(package, self.schema, self.schema)
        self.assertTrue(any("months" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()

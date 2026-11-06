"""生成前端测试用的真实 monthly_facts 夹具。

前端测试一直用合成夹具，好处是稳定，坏处是「后端字段改了前端还在按老字段读」这类
契约错位永远测不出来。这里把真实排盘结果落盘，让 `tests/annual_timeline_real.test.cjs`
拿着真数据去跑组装器。

用法（仓库根目录）：
    python scripts/generate_monthly_fixtures.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from mingli_tool.bazi import calculate  # noqa: E402

FIXTURE_DIR = ROOT / "tests" / "fixtures"

CASES = {
    "monthly-real-minute.json": {"precision": "minute", "value": "12:30"},
    "monthly-real-branch.json": {"precision": "branch", "branch": "午"},
    "monthly-real-zishi.json": {"precision": "branch", "branch": "子"},
    "monthly-real-unknown.json": {"precision": "unknown"},
}


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


def main() -> int:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, time_block in CASES.items():
        result = calculate(payload(time_block))
        facts = result["monthly_facts"]
        # 夹具只保留前端真正会读的字段：`relations` / `relation_segments` 里的逐条明细
        # 前端不读（它只读 relation_count），留着会让每个夹具涨到 200KB。
        # 其余字段原样保留，包括 luck / relation_scope 这些正是要验的契约。
        lean = {k: v for k, v in facts.items() if k != "months"}
        lean["months"] = []
        for month in facts["months"]:
            trimmed = {
                key: value
                for key, value in month.items()
                if key not in ("relations", "relation_segments")
            }
            lean["months"].append(trimmed)
        # 把**完整事实包**的哈希写进夹具：测试据此判断夹具是否与当前代码一致。
        # 只比指纹和几个字段的话，改错某月的 luck.ganzhi 也发现不了。
        lean["_package_sha256"] = hashlib.sha256(
            json.dumps(facts, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
        ).hexdigest()
        # 再给夹具自己一个自校验哈希：有人手改夹具内容但没改 _package_sha256 时，
        # 测试也能发现（否则只要伪造来源哈希就能骗过新鲜度检查）。
        payload_for_hash = {
            key: value for key, value in lean.items()
            if key not in ("_package_sha256", "_fixture_sha256")
        }
        lean["_fixture_sha256"] = hashlib.sha256(
            json.dumps(payload_for_hash, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
        ).hexdigest()
        (FIXTURE_DIR / name).write_text(
            json.dumps(lean, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        statuses = sorted({month["luck"]["status"] for month in facts["months"]})
        print(f"{name}: months={len(facts['months'])} luck={statuses} fp={facts['fingerprint']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

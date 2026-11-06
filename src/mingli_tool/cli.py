"""Command line interface for structured calculation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .bazi import SCHEMA_VERSION, calculate
from .errors import ToolError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mingli", description="命理工具")
    systems = parser.add_subparsers(dest="system", required=True)
    bazi = systems.add_parser("bazi", help="八字工具")
    actions = bazi.add_subparsers(dest="action", required=True)
    calculate_parser = actions.add_parser("calculate", help="生成结构化八字排盘")
    calculate_parser.add_argument("--input", required=True, help="JSON 文件路径；- 表示 stdin")
    calculate_parser.add_argument("--pretty", action="store_true", help="缩进输出 JSON")
    return parser


def _load_json(path: str):
    try:
        text = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise ToolError("INPUT_READ_ERROR", "无法读取输入文件", {"path": path, "reason": str(exc)}) from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ToolError(
            "INVALID_JSON",
            "输入不是有效 JSON",
            {"line": exc.lineno, "column": exc.colno},
        ) from exc


def _write(data, pretty=False):
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2 if pretty else None)
    sys.stdout.write("\n")


def main(argv=None) -> int:
    # Windows often defaults redirected console output to a legacy code page.
    # The CLI contract is UTF-8 JSON on every platform.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = _parser().parse_args(argv)
    try:
        if args.system == "bazi" and args.action == "calculate":
            _write(calculate(_load_json(args.input)), pretty=args.pretty)
            return 0
        raise ToolError("UNSUPPORTED_COMMAND", "不支持该命令")
    except ToolError as exc:
        _write({"schema_version": SCHEMA_VERSION, "status": "error", "error": exc.as_dict()}, pretty=True)
        return 2
    except Exception as exc:  # pragma: no cover - last-resort CLI boundary
        _write(
            {
                "schema_version": SCHEMA_VERSION,
                "status": "error",
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "未预期的内部错误",
                    "details": {"type": type(exc).__name__},
                },
            },
            pretty=True,
        )
        return 3

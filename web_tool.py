"""Run the local web workbench directly from a source checkout."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from mingli_tool.web import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())

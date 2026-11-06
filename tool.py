"""Repository-local entry point that works without installation."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from mingli_tool.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())

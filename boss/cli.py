"""Point d'entrée `boss` : démo, attaques, site."""
from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    command = args[0] if args else "demo"
    if command == "demo":
        from .demo import main as run

        return run()
    if command == "attack":
        from .attack import main as run

        return run()
    if command == "web":
        from .webapp import main as run

        return run(args[1:])
    print("usage : boss [demo|attack|web --port 8137]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
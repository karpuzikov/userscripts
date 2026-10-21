"""Verify this investigation kit's bytes; this does not test app parity."""
from pathlib import Path
import hashlib
import json
import sys


def main():
    root = Path(__file__).resolve().parent
    entries = json.loads((root / "file-hashes.json").read_text(encoding="utf-8"))
    failures = []
    for entry in entries:
        path = root / entry["file"]
        if not path.is_file():
            failures.append(f"Missing: {entry['file']}")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            failures.append(f"Changed: {entry['file']}")
    if failures:
        print("\n".join(failures))
        return 1
    golden = json.loads((root / "Reference/droffline-golden.json").read_text(encoding="utf-8"))
    if len(golden["rows"]) != 23:
        print("Reference row count differs from the original 23-row report.")
        return 1
    print(f"Package integrity OK: {len(entries)} files; 23 original reference rows.")
    print("Combined application: not implemented. Replacement parity: NOT RUN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

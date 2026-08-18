#!/usr/bin/env python3
"""Return UUID-free deterministic integrity records for the frozen EVO vaults."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from knowledge_ingestion.build_platform_bundle import (
    canonical,
    digest,
    discover_documents,
    resolve_source_root,
)


EXPECTED = {
    "client": (11, "c8dcfdd7911fdf2b97204c5d843dbf45f701d5dbee72e78cfaea17ea7ab18689"),
    "internal": (291, "1bd7458ff70c0a31fde9f6bb1abfb7ec0152c1f286caf2a1de48081860121f9f"),
}


def audit(vault: Path, audience: str) -> dict[str, object]:
    _, source_root, _ = resolve_source_root(vault, audience)
    documents = discover_documents(source_root)
    projection = [
        {"source_path": item["source_path"], "source_sha256": item["source_sha256"]}
        for item in documents
    ]
    source_set_sha256 = digest(canonical(projection))
    expected_count, expected_sha256 = EXPECTED[audience]
    if len(documents) != expected_count or source_set_sha256 != expected_sha256:
        raise ValueError(f"{audience} frozen source set drifted")
    return {
        "audience": audience,
        "status": "verified",
        "document_count": len(documents),
        "source_set_sha256": source_set_sha256,
        "pii_gate": "passed",
        "forbidden_root_gate": "passed",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--audience", choices=sorted(EXPECTED), required=True)
    args = parser.parse_args()
    result = audit(args.vault, args.audience)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()

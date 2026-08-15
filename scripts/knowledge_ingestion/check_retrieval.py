#!/usr/bin/env python3
"""Deterministic lexical retrieval gate for the two published EVO vaults."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


TOKEN = re.compile(r"[A-Za-zА-Яа-яЁё0-9]+")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
CASE_KEYS = {"vault", "query", "top_k", "expected_paths"}
ROOT_KINDS = {"internal": "evo_internal_knowledge", "client": "evo_client_knowledge"}
FORBIDDEN_PARTS = {"Сырой архив ЭВО", "Секреты и доступы ЭВО"}


def raw_directory(value: str) -> Path:
    path = Path(value).absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            raise ValueError(f"symlink path component is forbidden: {current}")
    if not path.is_dir():
        raise ValueError(f"vault is not a directory: {path}")
    return path.resolve()


def marker(root: Path, kind: str) -> None:
    path = root / ".evo-vault.json"
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"missing regular vault marker: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if set(data) != {"kind", "canonical_path"}:
        raise ValueError("vault marker has an invalid schema")
    if data != {"kind": kind, "canonical_path": str(root)}:
        raise ValueError("vault marker does not match the canonical vault")


def safe_relative(value: str) -> PurePosixPath:
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("expected path must be a POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("unsafe expected path")
    if any(part in FORBIDDEN_PARTS for part in path.parts):
        raise ValueError("raw archive and secrets paths are forbidden")
    if path.suffix.lower() != ".md" or not CYRILLIC.search(value):
        raise ValueError("expected path must be a Russian Markdown path")
    return path


def load_cases(path: Path) -> list[dict]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("cases file must be a regular file")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"version", "cases"} or data["version"] != 1 or not isinstance(data["cases"], list):
        raise ValueError("invalid retrieval cases schema")
    cases = []
    for case in data["cases"]:
        if not isinstance(case, dict) or set(case) != CASE_KEYS:
            raise ValueError("invalid retrieval case schema")
        if case["vault"] not in ROOT_KINDS:
            raise ValueError("unknown vault")
        if not isinstance(case["query"], str) or not case["query"].strip() or not CYRILLIC.search(case["query"]):
            raise ValueError("query must be non-empty Russian text")
        if type(case["top_k"]) is not int or not 1 <= case["top_k"] <= 20:
            raise ValueError("top_k must be between 1 and 20")
        if not isinstance(case["expected_paths"], list) or not case["expected_paths"]:
            raise ValueError("expected_paths must be a non-empty list")
        expected = [str(safe_relative(item)) for item in case["expected_paths"]]
        cases.append({**case, "expected_paths": expected})
    return cases


def scan(root: Path) -> dict[str, str]:
    documents: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in FORBIDDEN_PARTS for part in relative.parts):
            raise ValueError(f"forbidden knowledge boundary inside searchable vault: {relative}")
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"symlink is forbidden in searchable vault: {relative}")
        if path.is_file() and path.suffix.lower() == ".md":
            documents[relative.as_posix()] = path.read_text(encoding="utf-8")
    return documents


def tokens(value: str) -> list[str]:
    return [item.casefold() for item in TOKEN.findall(value)]


def rank(query: str, documents: dict[str, str], top_k: int) -> list[dict]:
    query_tokens = tokens(query)
    query_phrase = " ".join(query_tokens)
    ranked = []
    for path, body in documents.items():
        path_tokens = tokens(path)
        body_tokens = tokens(body)
        score = sum(path_tokens.count(item) * 4 + body_tokens.count(item) for item in query_tokens)
        if query_phrase and query_phrase in " ".join(body_tokens):
            score += len(query_tokens) * 3
        ranked.append({"path": path, "score": score})
    return sorted(ranked, key=lambda item: (-item["score"], item["path"]))[:top_k]


def validate_report(report: Path, internal_root: Path) -> Path:
    expected_parent = internal_root.parent / "Панель управления"
    if report.name != "Отчёт проверки поиска.json" or report.parent.absolute() != expected_parent.absolute():
        raise ValueError("report must use the exact internal control-panel path")
    if report.is_symlink() or report.parent.is_symlink():
        raise ValueError("symlink report path is forbidden")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--internal-vault", required=True)
    parser.add_argument("--client-vault", required=True)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args(argv)

    internal = raw_directory(args.internal_vault)
    client = raw_directory(args.client_vault)
    if internal.name != "Утверждено для внутреннего ИИ" or internal.parent.name != "Внутренняя база знаний ЭВО":
        raise ValueError("internal vault must be the exact approved child")
    marker(internal.parent, ROOT_KINDS["internal"])
    if client.name != "Клиентская база знаний ЭВО":
        raise ValueError("unexpected client vault name")
    marker(client, ROOT_KINDS["client"])
    cases = load_cases(Path(args.cases).absolute())
    report_path = validate_report(Path(args.report), internal)
    docs = {"internal": scan(internal), "client": scan(client)}

    results = []
    for case in cases:
        found = rank(case["query"], docs[case["vault"]], case["top_k"])
        paths = {item["path"] for item in found}
        passed = all(path in paths for path in case["expected_paths"])
        results.append({**case, "results": found, "passed": passed})
    passed_count = sum(item["passed"] for item in results)
    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed_count,
        "failed": len(results) - passed_count,
        "searched_roots": [str(internal), str(client)],
        "forbidden_roots_excluded": True,
        "cases": results,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if payload["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

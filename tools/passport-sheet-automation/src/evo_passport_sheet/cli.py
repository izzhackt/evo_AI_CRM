from __future__ import annotations

import argparse
import concurrent.futures
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .google_io import GoogleWorkspace, StudentRow, authenticate
from .mrz import PassportIdentity, identity_matches, parse_td3
from .ocr import AppleVisionOCR


@dataclass(frozen=True)
class Result:
    row: int
    status: str
    identity: PassportIdentity | None = None


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Extract verified passports into EVO Sheet column X")
    result.add_argument("--spreadsheet-id", required=True)
    result.add_argument("--sheet", default="Студенты EVO")
    result.add_argument("--start-row", type=int, default=3)
    result.add_argument("--end-row", type=int, default=200)
    result.add_argument("--workers", type=int, default=4)
    result.add_argument("--credentials", type=Path, default=Path("credentials.json"))
    result.add_argument("--token", type=Path, default=Path(".private/token.json"))
    result.add_argument("--apply", action="store_true", help="write verified results; default is review-only")
    result.add_argument("--exclusive-writer", action="store_true", help="confirm no other operator/program is writing column X")
    return result


def process_row(workspace: GoogleWorkspace, ocr: AppleVisionOCR, row: StudentRow) -> Result:
    if not row.drive_url:
        return Result(row.row, "missing Drive folder link")
    candidates = workspace.list_passport_candidates(row.drive_url)
    if not candidates:
        return Result(row.row, "no supported passport document")
    with tempfile.TemporaryDirectory(prefix=f"evo-passport-row-{row.row}-") as directory:
        identities: dict[str, PassportIdentity] = {}
        for candidate in candidates:
            target = Path(directory) / f"document{Path(candidate['name']).suffix or '.bin'}"
            workspace.download(candidate["id"], target)
            identity = parse_td3(ocr.extract(target))
            if identity and identity_matches(row.name, identity):
                identities[identity.passport_number] = identity
        if len(identities) != 1:
            return Result(row.row, "ambiguous or unverified MRZ")
        return Result(row.row, "verified", next(iter(identities.values())))


def main() -> int:
    args = parser().parse_args()
    if args.apply and not args.exclusive_writer:
        print("configuration error: --apply requires --exclusive-writer; stop every other column-X writer first", file=sys.stderr)
        return 2
    try:
        workspace = GoogleWorkspace(authenticate(args.credentials, args.token))
    except FileNotFoundError as error:
        print(f"configuration error: {error}", file=sys.stderr)
        return 2
    rows = workspace.student_rows(args.spreadsheet_id, args.sheet, args.start_row, args.end_row)
    helper = Path(__file__).resolve().parents[2] / "vision_ocr.swift"
    ocr = AppleVisionOCR(helper)
    workers = max(1, min(args.workers, 8))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda row: process_row(workspace, ocr, row), rows))
    if args.apply:
        failures = [result for result in results if not result.identity]
        drift = [row for row in rows if workspace.current_passport(args.spreadsheet_id, args.sheet, row.row) != row.existing_passport]
        if failures or drift:
            print(
                f"apply aborted before writes: {len(failures)} unverified rows, {len(drift)} rows changed since extraction",
                file=sys.stderr,
            )
            return 3
    snapshots = {row.row: row.existing_passport for row in rows}
    for result in sorted(results, key=lambda item: item.row):
        if result.identity and args.apply:
            workspace.verified_write(
                args.spreadsheet_id, args.sheet, result.row, snapshots[result.row], result.identity.passport_number
            )
            print(f"row {result.row}: written and verified")
        elif result.identity:
            print(f"row {result.row}: verified; review-only, no write")
        else:
            print(f"row {result.row}: unchanged ({result.status})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

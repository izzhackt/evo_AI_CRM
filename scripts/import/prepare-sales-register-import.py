#!/usr/bin/env python3
"""Prepare a private sales-register payload; never contact or modify a database.

Use the bundled Python with openpyxl. Output and its aggregate manifest must be
new files in an existing owner-only directory outside Git. The XLSX is never
saved. Original attachments, comments, parents and tax IDs stay in that source,
not in this minimized payload. No person matching or automatic deduplication.

Contract: docs/design/v3/sales-report-run-plan.md, import_sales_register_v1.
Official API: https://openpyxl.readthedocs.io/en/stable/api/openpyxl.reader.excel.html
Formula boundary: https://openpyxl.readthedocs.io/en/stable/simple_formulae.html
read_only prevents editing; data_only=False retains formula text. openpyxl does
not evaluate it. Only '=digits' in the phone column is interpreted as a literal.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

import openpyxl


MAX_AMOUNT_MINOR = 1_000_000_000_000  # Same limit as sales_register_fields.
# Explicit source tabs, not inferred from row dates or the time of import.
MONTHS = {
    "ноябрь": (11, None, 1), "декабрь": (12, None, 1),
    "январь 2026": (1, 2026, 1), "февраль 2026": (2, 2026, 1),
    "март 2026": (3, 2026, 1), "апрель 2026": (4, 2026, 1),
    "май 2026": (5, 2026, 1), "июнь 2026": (6, 2026, 10),
    "июль 2026": (7, 2026, 10), "август 2026": (8, 2026, 10),
    "сентябрь 2026": (9, 2026, 10),
}
HEADERS = {
    "фио апликанта": "applicant_name", "фио аппликанта": "applicant_name",
    "фио": "applicant_name", "номер телефона": "phone",
    "номер телефона апликанта": "phone", "номер телефона аппликанта": "phone",
    "стоимость": "service_cost_raw", "дата подписания договора": "signing_date",
    "№ договора": "contract_number", "№": "contract_number",
    "оплачено": "paid_raw", "университет": "university", "программа": "program",
    "страна": "country", "направление": "direction", "интейк": "intake",
    "статус": "status_raw", "менеджер": "manager_label",
}
TEXT_FIELDS = ("applicant_name", "phone", "country", "university", "program",
               "direction", "intake", "contract_number", "manager_label", "status_raw")
TEXT_LIMITS = {"applicant_name": 300, "phone": 100, "country": 200, "university": 500,
               "program": 500, "direction": 500, "intake": 200, "contract_number": 200,
               "manager_label": 300, "status_raw": 2000}
REQUIRED_HEADERS = set(TEXT_FIELDS) - {"direction", "contract_number", "status_raw"}
REQUIRED_HEADERS |= {"service_cost_raw", "paid_raw", "signing_date"}
CURRENCIES = {"$": "USD", "usd": "USD", "доллар": "USD", "доллара": "USD",
              "долларов": "USD", "долл": "USD", "долл.": "USD",
              "€": "EUR", "eur": "EUR", "евро": "EUR",
              "kgs": "KGS", "сом": "KGS", "сома": "KGS", "сомов": "KGS"}
CURRENCY_PATTERN = r"(?:USD|EUR|KGS|долларов|доллара|доллар|долл\.?|евро|сомов|сома|сом|\$|€)"
AMOUNT_PATTERN = r"(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]{1,2})?"
MONEY = re.compile(
    rf"\s*(?P<before>{CURRENCY_PATTERN})?\s*(?P<amount>{AMOUNT_PATTERN})"
    rf"\s*(?P<after>{CURRENCY_PATTERN})?\s*", re.IGNORECASE,
)
KNOWN_CURRENCY_FORMATS = {"[$$]#,##0.00": "USD", '#,##0"€"': "EUR"}
BAD_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class PreparationError(Exception):
    """Messages contain coordinates/reason codes only, never cell values."""


def normalized(value):
    return " ".join(str(value or "").lower().split())


def raw_scalar(value):
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, str) and len(value) <= 2000 and not BAD_CONTROL.search(value):
        return value
    raise PreparationError("unsupported_or_oversized_source_scalar")


def text_value(value):
    value = raw_scalar(value)
    if value is None:
        return None
    if isinstance(value, bool):
        raise PreparationError("boolean_in_business_text")
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip() or None


def parse_money(cell):
    if cell is None or cell.value is None:
        return None, None, "missing"
    value = cell.value
    if cell.data_type == "f":
        return None, None, "formula_not_evaluated"
    currency = None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        currency = KNOWN_CURRENCY_FORMATS.get(cell.number_format)
        if currency is None:
            return None, None, "currency_missing"
        amount = str(value)
    elif isinstance(value, str):
        match = MONEY.fullmatch(value)
        if match is None:
            return None, None, "unresolved_text"
        before, after = match.group("before", "after")
        if bool(before) == bool(after):
            return None, None, "currency_missing_or_repeated"
        currency = CURRENCIES[(before or after).lower()]
        amount = match.group("amount").replace(" ", "").replace("\u00a0", "").replace(",", ".")
    else:
        return None, None, "unsupported_value"
    try:
        minor = Decimal(amount) * 100
        if not minor.is_finite() or minor < 0 or minor != minor.to_integral_value() or minor > MAX_AMOUNT_MINOR:
            return None, None, "amount_out_of_range_or_precision"
        return int(minor), currency, None
    except InvalidOperation:
        return None, None, "invalid_amount"


def parse_date(cell):
    if cell is None or cell.value is None:
        return None, "missing", "blank"
    value = cell.value
    if cell.data_type == "f":
        return None, "formula_not_evaluated", "formula"
    if isinstance(value, datetime):
        if value.time().isoformat() != "00:00:00":
            return None, "unexpected_time", "datetime"
        return value.date().isoformat(), None, "datetime"
    if isinstance(value, date):
        return value.isoformat(), None, "date"
    if isinstance(value, str):
        try:
            if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value.strip()):
                return date.fromisoformat(value.strip()).isoformat(), None, "string"
        except ValueError:
            pass
        return None, "unresolved_text", "string"
    return None, "not_a_date", "number" if isinstance(value, (int, float)) else "other"


def cell_value(cells, row, column):
    cell = cells.get((row, column)) if column is not None else None
    return cell.value if cell else None


def header_map(cells, sheet_key, header_row):
    mapping = {}
    for (row, col), cell in cells.items():
        if row == header_row and isinstance(cell.value, str):
            key = HEADERS.get(normalized(cell.value))
            if key:
                if key in mapping:
                    raise PreparationError("duplicate_business_header")
                mapping[key] = col
    # Two observed malformed headers, not a general positional fallback.
    if "applicant_name" not in mapping:
        first = cell_value(cells, header_row, 1)
        if (sheet_key == "декабрь" and first == 100) or (sheet_key == "февраль 2026" and first is None):
            mapping["applicant_name"] = 1
        else:
            raise PreparationError("applicant_header_missing")
    if REQUIRED_HEADERS - mapping.keys():
        raise PreparationError("required_business_header_missing")
    return mapping


def department_control(cells, sheet, spreadsheet_id, period, header_row, record_count):
    if header_row == 1:
        return None, None
    labels = [(col, cell) for (row, col), cell in cells.items() if row == 2
              and normalized(cell.value) == "план продаж"]
    if len(labels) != 1:
        raise PreparationError("department_target_scope_unverified")
    col = labels[0][0]
    if normalized(cell_value(cells, 1, col + 1)) != "план" or normalized(cell_value(cells, 1, col + 2)) != "факт":
        raise PreparationError("department_control_headers_changed")
    planned, fact = cell_value(cells, 2, col + 1), cell_value(cells, 2, col + 2)
    for value in (planned, fact):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 100000 or int(value) != value:
            raise PreparationError("department_control_not_clean_numeric_count")
    target = {"report_month": period, "manager_label": None, "target_count": int(planned),
              "source_key": f"{spreadsheet_id}:{sheet}:department-target"}
    control = {"target_count": int(planned), "source_fact": int(fact), "record_count": record_count,
               "fact_difference": record_count - int(fact), "scope": "department",
               "unimported_control_rows": sorted({row for row, _ in cells if 3 <= row < header_row})}
    return target, control


def prepare(source_bytes, spreadsheet_id):
    sales, targets, months, orphans = [], [], [], []
    totals = {"service_cost": defaultdict(int), "paid": defaultdict(int)}
    parsed_counts = {"service_cost": Counter(), "paid": Counter()}
    flag_counts = Counter()
    seen_months = set()
    formula_counts = Counter()
    workbook = openpyxl.load_workbook(io.BytesIO(source_bytes), read_only=True, data_only=False, keep_links=False)
    try:
        for sheet in workbook:
            # Sheets exports can omit/misstate dimensions. Read the actual XML
            # stream, bounded here, rather than silently trusting a used range.
            # https://openpyxl.readthedocs.io/en/stable/optimized.html
            sheet.reset_dimensions()
            cells = {}
            for row_number, row_cells in enumerate(sheet.iter_rows(), 1):
                if row_number > 10000 or len(row_cells) > 1000:
                    raise PreparationError("source_sheet_exceeds_preparation_bounds")
                for source_cell in row_cells:
                    if source_cell.value is not None:
                        cells[(source_cell.row, source_cell.column)] = source_cell
            sheet_key = normalized(sheet.title)
            if sheet_key not in MONTHS:
                if sheet_key == "лист11" and not cells:
                    continue
                raise PreparationError("unexpected_source_sheet")
            if len(sheet.title) > 150 or BAD_CONTROL.search(sheet.title):
                raise PreparationError("invalid_source_sheet_name")
            seen_months.add(sheet_key)
            month, year, header_row = MONTHS[sheet_key]
            mapping = header_map(cells, sheet_key, header_row)
            rows = []
            for row in sorted({r for r, _ in cells if r > header_row}):
                name_cell = cells.get((row, mapping["applicant_name"]))
                name = name_cell.value if name_cell else None
                if not isinstance(name, str) or not name.strip() or name_cell.data_type == "f" or normalized(name) in {"итого", "всего", "сумма", "фио"}:
                    populated = sorted(col for r, col in cells if r == row)
                    number = cell_value(cells, row, 1)
                    template_only = (mapping["applicant_name"] == 2 and populated == [1]
                                     and isinstance(number, (int, float)) and not isinstance(number, bool)
                                     and number == row - header_row)
                    orphans.append({"sheet": sheet.title, "row": row,
                                    "reason": "numbered_template_only" if template_only else "no_named_record",
                                    "populated_columns": populated})
                else:
                    rows.append(row)
            votes = Counter(cell_value(cells, row, mapping["signing_date"]).year for row in rows
                            if isinstance(cell_value(cells, row, mapping["signing_date"]), (date, datetime)))
            inferred = year is None
            if inferred:
                if not votes or votes.most_common(1)[0][1] * 2 <= sum(votes.values()):
                    raise PreparationError("report_year_has_no_authoritative_date_majority")
                year = votes.most_common(1)[0][0]
            if not 1900 <= year <= 2100:
                raise PreparationError("report_year_out_of_range")
            period = f"{year:04d}-{month:02d}-01"
            for row in rows:
                def cell(field):
                    return cells.get((row, mapping[field])) if field in mapping else None

                def value(field):
                    selected = cell(field)
                    return selected.value if selected else None

                record = {field: text_value(value(field)) for field in TEXT_FIELDS}
                snapshot = {field: raw_scalar(value(field)) for field in TEXT_FIELDS}
                if any(len(record[field] or "") > limit for field, limit in TEXT_LIMITS.items()):
                    raise PreparationError("business_text_exceeds_import_contract")
                flags = []
                for field in TEXT_FIELDS:
                    selected = cell(field)
                    if selected and selected.data_type == "f":
                        literal = re.fullmatch(r"=([0-9]+)\s*", str(selected.value)) if field == "phone" else None
                        if literal:
                            record[field] = literal.group(1)
                        else:
                            record[field] = None
                            flags.append(f"{field}_formula_not_evaluated")
                record["signing_date"], date_reason, date_type = parse_date(cell("signing_date"))
                if date_reason:
                    flags.append(f"signing_date_{date_reason}")
                elif record["signing_date"][:7] != period[:7]:
                    flags.append("signing_date_outside_report_month")
                if not record["phone"]:
                    flags.append("phone_missing")
                for prefix, raw_field in (("service_cost", "service_cost_raw"), ("paid", "paid_raw")):
                    raw_cell = cell(raw_field)
                    minor, currency, reason = parse_money(raw_cell)
                    record[raw_field] = text_value(value(raw_field))
                    record[f"{prefix}_minor"], record[f"{prefix}_currency"] = minor, currency
                    snapshot[raw_field] = raw_scalar(value(raw_field))
                    snapshot[f"{prefix}_number_format"] = raw_cell.number_format if raw_cell else None
                    if reason:
                        flags.append(f"{prefix}_{reason}")
                    else:
                        totals[prefix][currency] += minor
                        parsed_counts[prefix][currency] += 1
                if record["service_cost_currency"] and record["paid_currency"] and record["service_cost_currency"] != record["paid_currency"]:
                    flags.append("cost_paid_currency_mismatch")
                if normalized(record["status_raw"]) not in {"оплачено", "частично оплачено", "не оплачено"}:
                    flags.append("status_unspecified")
                snapshot.update({"signing_date_raw": raw_scalar(value("signing_date")),
                                 "signing_date_type": date_type, "intake_raw": raw_scalar(value("intake")),
                                 "status_column_present": "status_raw" in mapping,
                                 "source_period_year_inferred": inferred, "review_flags": flags})
                source_key = f"{spreadsheet_id}:{sheet.title}:{row}"
                if len(source_key) > 400:
                    raise PreparationError("source_key_too_long")
                record.update({"source_key": source_key, "source_sheet": sheet.title, "source_row": row,
                               "source_snapshot": snapshot, "report_month": period,
                               "needs_review": bool(flags), "notes": None})
                flag_counts.update(flags)
                sales.append(record)
            target, control = department_control(cells, sheet.title, spreadsheet_id, period, header_row, len(rows))
            if target:
                targets.append(target)
            months.append({"sheet": sheet.title, "report_month": period, "record_count": len(rows),
                           "year_inferred": inferred, "typed_date_year_counts": dict(votes),
                           "department_control": control})
            for c in cells.values():
                if c.data_type == "f":
                    literal = re.fullmatch(r"=[0-9]+\s*", str(c.value))
                    kind = ("phone_literal" if c.column == mapping["phone"] else "excluded_numeric_literal") if literal else "not_evaluated"
                    formula_counts[kind] += 1
    finally:
        workbook.close()
    if seen_months != MONTHS.keys() or not 1 <= len(sales) <= 250:
        raise PreparationError("source_coverage_or_record_count_invalid")
    if len({item["source_key"] for item in sales}) != len(sales):
        raise PreparationError("duplicate_source_row_key")
    checksum = hashlib.sha256(source_bytes).hexdigest()
    payload = {"source_sha256": checksum, "sales": sales, "targets": targets}
    manifest = {"source_sha256": checksum, "record_count": len(sales), "target_count": len(targets),
                "months": months, "orphan_rows": orphans, "review_flag_counts": dict(flag_counts),
                "records_needing_review": sum(item["needs_review"] for item in sales),
                "parsed_counts": {key: dict(value) for key, value in parsed_counts.items()},
                "parsed_totals_minor": {key: dict(value) for key, value in totals.items()},
                "formula_counts": dict(formula_counts), "formulas_executed": 0,
                "attachments_imported": False,
                "source_only_categories": ["parents", "tax_ids", "comments", "receipt_links", "contract_links"],
                "manager_targets_imported": False}
    return payload, manifest


def private_destination(path):
    path = path.absolute()
    if path.is_symlink() or path.exists():
        raise PreparationError("destination_must_be_a_new_file")
    parent = path.parent.resolve(strict=True)
    if any((ancestor / ".git").exists() for ancestor in (parent, *parent.parents)):
        raise PreparationError("private_output_inside_git_forbidden")
    info = parent.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise PreparationError("destination_directory_must_be_owner_only")
    return parent / path.name


def write_private(path, value):
    encoded = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    return hashlib.sha256(encoded).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--spreadsheet-id", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{10,150}", args.spreadsheet_id):
            raise PreparationError("invalid_spreadsheet_id")
        if not re.fullmatch(r"[a-f0-9]{64}", args.expected_sha256):
            raise PreparationError("invalid_expected_sha256")
        output, manifest_path = private_destination(args.output), private_destination(args.manifest)
        if output == manifest_path:
            raise PreparationError("payload_and_manifest_paths_must_differ")
        source_bytes = args.input.read_bytes()
        if hashlib.sha256(source_bytes).hexdigest() != args.expected_sha256:
            raise PreparationError("source_checksum_mismatch")
        payload, manifest = prepare(source_bytes, args.spreadsheet_id)
        output_hash = write_private(output, payload)
        manifest["payload_sha256"] = output_hash
        manifest_hash = write_private(manifest_path, manifest)
        print(json.dumps({"record_count": len(payload["sales"]), "target_count": len(payload["targets"]),
                          "orphan_row_count": sum(row["reason"] == "no_named_record" for row in manifest["orphan_rows"]),
                          "template_row_count": sum(row["reason"] == "numbered_template_only" for row in manifest["orphan_rows"]),
                          "source_sha256": args.expected_sha256,
                          "payload_sha256": output_hash, "manifest_sha256": manifest_hash,
                          "payload_path": str(output), "manifest_path": str(manifest_path)}))
        return 0
    except PreparationError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
    except Exception as error:
        # Parser/library exceptions can include source values. Never print them.
        print(json.dumps({"error": "preparation_failed", "type": type(error).__name__}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

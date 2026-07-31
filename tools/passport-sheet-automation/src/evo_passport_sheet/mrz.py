from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from unidecode import unidecode

WEIGHTS = (7, 3, 1)


@dataclass(frozen=True)
class PassportIdentity:
    passport_number: str
    surname: str
    given_names: str
    nationality: str


def _value(char: str) -> int:
    if char == "<":
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - 55
    raise ValueError(f"invalid MRZ character: {char!r}")


def valid_check_digit(value: str, digit: str) -> bool:
    return digit.isdigit() and sum(_value(c) * WEIGHTS[i % 3] for i, c in enumerate(value)) % 10 == int(digit)


def parse_td3(text: str) -> PassportIdentity | None:
    lines: list[str] = []
    for raw in text.upper().splitlines():
        cleaned = re.sub(r"[^A-Z0-9<]", "", raw)
        if 42 <= len(cleaned) <= 46:
            lines.append(cleaned[:44].ljust(44, "<"))
    for first, second in zip(lines, lines[1:]):
        composite = second[0:10] + second[13:20] + second[21:43]
        if (
            not first.startswith("P<")
            or not valid_check_digit(second[:9], second[9])
            or not valid_check_digit(second[13:19], second[19])
            or not valid_check_digit(second[21:27], second[27])
            or not valid_check_digit(composite, second[43])
        ):
            continue
        parts = first[5:44].split("<<", 1)
        number = second[:9].replace("<", "").strip()
        if number:
            return PassportIdentity(
                number,
                parts[0].replace("<", " ").strip(),
                parts[1].replace("<", " ").strip() if len(parts) == 2 else "",
                second[10:13],
            )
    return None


def identity_matches(student_name: str, identity: PassportIdentity) -> bool:
    def tokens(value: str) -> set[str]:
        normalized = re.sub(r"[^A-Z ]", " ", unidecode(value).upper())
        return set(normalized.split())

    student = tokens(student_name)
    surnames = tokens(identity.surname)
    given_names = tokens(identity.given_names)
    if not student or not surnames or not given_names:
        return False
    surname_match = max(SequenceMatcher(None, a, b).ratio() for a in student for b in surnames)
    given_match = max(SequenceMatcher(None, a, b).ratio() for a in student for b in given_names)
    return surname_match >= 0.82 and given_match >= 0.72

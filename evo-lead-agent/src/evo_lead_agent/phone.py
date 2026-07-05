from __future__ import annotations

import re


CHAT_ID_RE = re.compile(r"^(\d{6,20})@c\.us$")
PHONE_RE = re.compile(r"^\+?[1-9]\d{5,19}$")


def phone_from_waha_chat_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    match = CHAT_ID_RE.match(value)
    if not match:
        return None
    return f"+{match.group(1)}"


def normalize_phone(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = "+" + re.sub(r"\D", "", value)
    if PHONE_RE.match(candidate):
        return candidate
    return None


def waha_chat_id_from_phone(phone: str) -> str | None:
    normalized = normalize_phone(phone)
    if not normalized:
        return None
    return f"{normalized[1:]}@c.us"

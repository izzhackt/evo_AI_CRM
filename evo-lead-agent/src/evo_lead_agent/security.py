from __future__ import annotations

import hashlib
import hmac


def verify_waha_hmac(raw_body: bytes, secret: str, signature: str | None, algorithm: str | None) -> bool:
    if not secret or not signature:
        return False
    if algorithm and algorithm.lower() != "sha512":
        return False

    provided = signature.strip()
    if len(provided) != 128:
        return False
    try:
        provided_bytes = bytes.fromhex(provided)
    except ValueError:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha512).digest()
    return hmac.compare_digest(provided_bytes, expected)


def sign_evo_crm_payload(raw_body: bytes, secret: str, timestamp: int) -> str:
    message = f"{timestamp}.".encode("utf-8") + raw_body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()

import hashlib
import hmac

from evo_lead_agent.security import sign_evo_crm_payload, verify_waha_hmac


def test_verify_waha_hmac_accepts_valid_sha512_signature() -> None:
    body = b'{"event":"message","session":"crm_primary"}'
    secret = "secret"
    signature = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    assert verify_waha_hmac(body, secret, signature, "sha512")


def test_verify_waha_hmac_rejects_bad_signature_and_algorithm() -> None:
    body = b"{}"
    secret = "secret"
    signature = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    assert not verify_waha_hmac(body, secret, "0" * 128, "sha512")
    assert not verify_waha_hmac(body, secret, signature, "sha256")


def test_sign_evo_crm_payload_uses_timestamped_sha256_signature() -> None:
    body = b'{"event":"whatsapp.message"}'
    secret = "crm-secret"
    timestamp = 1780000000
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    assert sign_evo_crm_payload(body, secret, timestamp) == expected

from evo_lead_agent.phone import normalize_phone, phone_from_waha_chat_id, waha_chat_id_from_phone


def test_phone_from_waha_chat_id_accepts_private_chat() -> None:
    assert phone_from_waha_chat_id("996700111222@c.us") == "+996700111222"


def test_phone_from_waha_chat_id_rejects_groups_and_invalid_values() -> None:
    assert phone_from_waha_chat_id("996700111222@g.us") is None
    assert phone_from_waha_chat_id("status@broadcast") is None
    assert phone_from_waha_chat_id(None) is None


def test_normalize_phone_and_chat_id() -> None:
    assert normalize_phone("+996 700 111 222") == "+996700111222"
    assert waha_chat_id_from_phone("+996 700 111 222") == "996700111222@c.us"

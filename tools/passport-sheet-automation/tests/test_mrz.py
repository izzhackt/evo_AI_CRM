from evo_passport_sheet.mrz import PassportIdentity, identity_matches, parse_td3, valid_check_digit


def test_known_icao_td3_example_is_parsed() -> None:
    text = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10"
    identity = parse_td3(text)
    assert identity == PassportIdentity("L898902C3", "ERIKSSON", "ANNA MARIA", "UTO")


def test_invalid_passport_check_digit_is_rejected() -> None:
    text = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C30UTO7408122F1204159ZE184226B<<<<<10"
    assert parse_td3(text) is None
    assert not valid_check_digit("L898902C3", "0")


def test_cyrillic_student_name_matches_latin_mrz() -> None:
    identity = PassportIdentity("REDACTED", "ZAMIRBEKOVA", "MEERIM", "KGZ")
    assert identity_matches("Замирбекова Мээрим Замирбековна", identity)


def test_shared_given_name_does_not_match_wrong_surname() -> None:
    identity = PassportIdentity("REDACTED", "SMITH", "JOHN", "GBR")
    assert not identity_matches("John Doe", identity)


def test_shared_surname_does_not_match_wrong_given_name() -> None:
    identity = PassportIdentity("REDACTED", "BROWN", "BOB", "GBR")
    assert not identity_matches("Alice Brown", identity)

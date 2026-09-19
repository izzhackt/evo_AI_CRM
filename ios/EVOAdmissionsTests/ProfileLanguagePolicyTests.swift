import XCTest

/// Regression tests for the live-found bug: the «Сохранить язык» button's
/// visibility used to compare the picker value to the value loaded AT APP
/// LAUNCH (`profile.portalLanguage`) instead of the LAST-SAVED value, so
/// after a successful save a user could not switch back to the original
/// language without restarting the app. `ProfileLanguagePolicy` is the pure
/// predicate `ProfileViewModel`/`ProfileView` now both defer to (see
/// `PortalProfileModels.swift`), so the fix is testable headlessly.
final class ProfileLanguagePolicyTests: XCTestCase {
    func testHidesButtonWhenSelectionMatchesLastSaved() {
        XCTAssertFalse(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: "ru",
            lastSavedLanguage: "ru",
            isSaving: false
        ))
    }

    func testShowsButtonWhenSelectionDiffersFromLastSaved() {
        XCTAssertTrue(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: "ky",
            lastSavedLanguage: "ru",
            isSaving: false
        ))
    }

    func testHiddenWithoutProfileEvenIfSelectionDiffers() {
        // No profile yet (still loading) — nothing to save against.
        XCTAssertFalse(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: false,
            selectedLanguage: "ky",
            lastSavedLanguage: "ru",
            isSaving: false
        ))
    }

    func testShowsButtonWhileSavingEvenIfSelectionMatches() {
        // In-flight save keeps the (now disabled/progress) button visible.
        XCTAssertTrue(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: "ru",
            lastSavedLanguage: "ru",
            isSaving: true
        ))
    }

    /// The exact regression scenario: load at "ru", switch to "ky" and save
    /// (baseline must move to "ky"), then switch back to "ru" — the button
    /// must reappear immediately, without an app restart.
    func testCanSwitchBackAfterASuccessfulSaveWithoutRestart() {
        let launchLanguage = "ru"
        var lastSavedLanguage = launchLanguage

        // User picks "ky" and saves successfully.
        var selectedLanguage = "ky"
        XCTAssertTrue(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: selectedLanguage,
            lastSavedLanguage: lastSavedLanguage,
            isSaving: false
        ))
        // Simulates ProfileViewModel.saveLanguage() on receipt success: the
        // baseline moves to the newly-saved value, NOT the launch value.
        lastSavedLanguage = "ky"

        // Now the button should be hidden — "ky" is the current baseline.
        XCTAssertFalse(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: selectedLanguage,
            lastSavedLanguage: lastSavedLanguage,
            isSaving: false
        ))

        // User switches back to the original "ru" without restarting.
        selectedLanguage = "ru"
        // Bug: comparing against launchLanguage ("ru") would hide the
        // button here, trapping the user on "ky" until a relaunch.
        XCTAssertTrue(ProfileLanguagePolicy.showsSaveButton(
            hasProfile: true,
            selectedLanguage: selectedLanguage,
            lastSavedLanguage: lastSavedLanguage,
            isSaving: false
        ))
        XCTAssertNotEqual(lastSavedLanguage, launchLanguage) // sanity: baseline did move
    }
}

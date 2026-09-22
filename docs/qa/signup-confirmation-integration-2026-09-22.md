# PR980: main integration and native return to sign-in

This is source integration and a narrow navigation correction. Native runtime
acceptance remains pending; this receipt does not replace the earlier local
web/API receipt or the stopped native logout check.

Inputs:

- Registration branch: `145047927dc14f80bf72bb438f1ce3e652132af1`.
- Main: `ac165cf992ea418c2a11745590a5dadb443e9d6f`.
- Explicit PR1026 dependency: `98d46259072822d4ebe73cd43799504caeb2bec4`.
- The scope was appended to both plan journals in `fcec3a83` before integration
  or UI code changes. Main integration is `b9cbf8b1`; PR1026 integration is
  `c53b52bc`.

## Resulting behavior

The anonymous wizard is presented by SignInView as a full-screen cover. Its
confirmation button previously called signOut while the router was already
signed out, leaving the cover visible. SignInView now supplies an explicit
onSignIn callback that sets its existing presentation binding to false. The
same sign-in form becomes visible, without an extra Auth request.

Callers that do not supply that callback retain the existing router signOut
path. PR1026 keeps its explicit local session scope. The wizard model, draft
persistence, resend capability lifetime, disabled state and 44pt button target
are unchanged. The conflict-hint action and other authenticated callers are
outside this correction and retain their existing behavior.

Impeccable was applied to the action/state transition using the native iOS
guidance. No visual theme, translations, copy, typography or layout was changed
by the navigation fix.

## Integration preservation and checks

- Both append-only journal histories were preserved with the complete main
  prefix, followed by each branch's additions. PR1026's current ledger and
  historical native STOP/contract documents remain intact.
- The localization merge adds all 11 registration keys to main's full catalog.
  Main's 105 new keys and three prep_review corrections are preserved; there
  were no semantic JSON conflicts and no registration edits to prior keys.
- Service and route-contract changes merged together; registration/resend,
  document APIs and the explicit local sign-out dependency are retained.
- `xcrun swiftc -frontend -parse` passed for ApplicationWizardView.swift,
  SignInView.swift and SupabaseService.swift. This checks syntax, not types,
  linking or runtime behavior. JSON union assertions and `git diff --check`
  passed. Independent review and CI must refer to the resulting exact head.

No build, dependency installation, Simulator launch, QA/Auth mutation, email,
database execution or deployment was performed in this slice. No screenshots
or real native interaction are claimed. PR980 remains draft until its separately
authorized native confirmation journey and outstanding acceptance are complete;
ROOT owns merges, the shared QA window and release decisions.


## Отдельный native QA artifact — 22 сентября 2026

Main `8f9391ddc90b7746c0ee576f9beba76201970d8c` интегрирован в commit
`ff0f7bd384b1d9c0b81e86451b35e5c0dd9c4c3e`. Конфликты были только в трёх
документах; оба журнала сохраняют весь входящий main prefix и прежние additions.
Полный iOS tree `e60e67d20fde495216b3c962ced349dc7eee8676` побайтно совпадает
с independently reviewed source `d29997c9` (exact review `bf9a0b8d…`,
наследующий integration review `662396c4…` на `5c518e29`), включая
anonymous wizard → SignInView callback и `.local` dependency #1026.
Product-код, package pins и SDK не менялись. Более новый docs-only main
не добавлялся во время сборки.

В 08:53:44–08:54:08 UTC один app-only `xcodebuild build` завершился exit 0:
Xcode 26.5 / 17F42, Debug, iphonesimulator, scheme `EVO admissions`.
Использованы собственные DerivedData и копии известных кешированных пакетов;
automatic resolution и package updates отключены. Все семь revisions совпадают
с lockfile (`773793d6…`), Supabase Swift остаётся 2.55.2. Новых tests, dependency
install или повторной сборки #1026 не было. Свободное место: 2.49GB до compile,
2.06GB после.

Новый bundle `com.evoadmissions.qa.confirmation20260922` / `EVO QA Email`
отделён от #1026. Local endpoint inputs переиспользованы из проверенного QA
config (`3444833f…`); они не являются свежей runtime/config readiness.
Publishable key не выведен и не включён в Git. Ad-hoc codesign verify exit 0;
generated и embedded XML/DER совпадают и задают единственный application
identifier `FAKETEAMID.com.evoadmissions.qa.confirmation20260922`. Это metadata
namespace proof, не проверка живого Keychain enforcement. Все 19 файлов прежнего
#1026 artifact и executable защищённого приложения сохранили SHA.

Частный пакет: `/private/tmp/evo-signup980-native-build-20260922/`.

| Квитанция | SHA-256 |
|---|---|
| `build.receipt.json` | `c18e5c6d15fada2252b51bd1b14671d960308b301e9ab9ccb478a98aa7160a45` |
| `artifact.receipt.json` | `80137b60eee92820deaba7047323f7005f635e2c4ab74d5a9454e4e794f110f3` |
| `app-files.json` | `04db67bab33e17defba78d750cc48a2f005e9e5d836b325dda2e79d304d35e61` |
| Executable | `2f45e349ece4fe53c35868984b6369f25436c3b98647cbd54072943a5be642a9` |
| Debug dylib | `94f6da8d7ca43beb65538a865fe484fe45f00f12c5452ed9ed0af5c7a671b895` |

Install, Simulator launch/UI, Auth, DB, provider/mail и Keychain queries не
выполнялись. Агент B получил CUA результат Mac locked в 08:21 UTC и сообщил ROOT. Source/build
готовность не закрывает native confirmation/login/logout/relaunch. После
ручной разблокировки и нового назначения ROOT сначала продолжается actual
#1026 на его неизменённом artifact; #980 остаётся отдельным последующим окном.
Независимое review нового source/artifact и exact-head CI следуют отдельно.
PR #980 остаётся draft; merge/release и полный пункт27 не заявляются.

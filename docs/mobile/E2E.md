# E2E-проверки приложения (Maestro)

Потоки лежат в `mobile/.maestro/`, запускаются на iOS-симуляторе и Android-эмуляторе против локального стенда
(`docs/mobile/LOCAL_STACK.md`): настоящие Auth, Postgres, Storage и маршруты портала, только синтетические данные.

| Файл | Что проверяет |
|---|---|
| `01-sign-in.yaml` | неверный пароль показывает ошибку, верный открывает кабинет |
| `02-home.yaml` | главная: герой дела и трек этапов |
| `03-documents-contract.yaml` | «Документы»: скачивание договора, ошибки нет |
| `04-inbox-send.yaml` | «Сообщения»: отправка сообщения куратору, оно появляется в чате |
| `05-universities-favourite.yaml` | страна, вуз, «в избранное» и обратно |
| `06-csca-home.yaml` | раздел CSCA открывается |
| `07-profile-theme-language.yaml` | профиль: язык RU/KY, тема светлая/тёмная |
| `08-sign-out.yaml` | «Выйти» из меню ☰ возвращает экран входа, после перезапуска сессии нет |
| `09-apply-invalid-token.yaml` | `evoadmissions://apply?invite=…` с неверным токеном показывает ошибку |

Каждый поток начинается с `clearState` (локальные данные и Keychain стёрты) и сам входит под `test.assisted`.
Подпотоки: `subflows/` (вход, раздел через меню ☰).

## Подготовка

1. Стенд: `npm run mobile:stack:up` в корне репозитория (Docker/OrbStack).
2. Maestro: `curl -fsSL "https://get.maestro.mobile.dev" | bash`, затем `export PATH="$PATH:$HOME/.maestro/bin"`.
   Нужна Java 17+ (подойдёт JBR из Android Studio: `JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home`).
3. Env приложения: `cp mobile/.env.local-stack mobile/.env` (Metro вшивает значения при сборке, затем `expo start -c`).
   Для Android с `localhost` нужен `adb reverse tcp:46421 tcp:46421 && adb reverse tcp:46430 tcp:46430`
   (и `tcp:<порт Metro>`).
4. Отладочная сборка (http к стенду разрешён только в `__DEV__`): `cd mobile && npx expo run:ios` / `npx expo run:android`
   (или `xcodebuild`/`gradlew assembleDebug`), Metro запущен.
5. Логин и пароль потоки получают из игнорируемого файла `mobile/.local-stack-accounts.json` (его пишет `mobile:stack:up`;
   скопируйте из рабочей копии стенда). Путь можно задать `EVO_E2E_ACCOUNTS`, аккаунт `EVO_E2E_ACCOUNT` (по умолчанию `assisted`).
   Скрипт передаёт их потокам через окружение процесса (`MAESTRO_E2E_LOGIN`, `MAESTRO_E2E_PASSWORD`), в Git их нет.

### Особенности платформ (отладочная сборка)

- **Android.** Сборка читает Metro на `10.0.2.2:8081`: поднимите Metro на своём порту и пробросьте
  `adb reverse tcp:8081 tcp:<порт Metro>` (плюс 46421, 46430). В debug-манифесте есть `ACCESS_LOCAL_NETWORK` (Android 17
  спрашивает его при обращении к Metro); потоки запускают приложение с `permissions: all: allow`. Если на общем AVD остался
  чужой `debug_http_host`, выполните `adb shell pm clear com.evoadmissions.app`. Холодный старт debug-сборки на
  нагруженном Mac занимает до 2 минут, поэтому ожидания входа длинные (120 с).
- **iOS.** Системные окна «Save Password?» и «Open in EVO admissions?» не часть приложения: потоки их закрывают.
- Проверка release-манифеста Android (без `ACCESS_LOCAL_NETWORK`, без cleartext): `npx expo prebuild --platform android`,
  затем `./gradlew :app:processReleaseMainManifest` и просмотр `app/build/intermediates/merged_manifest/release/`.

## Скриншоты для магазинов

`EVO_E2E_OUT=<каталог> npm run e2e:ios -- .maestro/store/screenshots.yaml` (то же для `e2e:android`): Maestro сохраняет PNG
в `<каталог>/<дата>/Скриншоты для магазинов/` (Maestro разрешает `takeScreenshot` только внутри каталога запуска). Готовые файлы
лежат в `docs/mobile/store-screenshots/`.

## Запуск

```
cd mobile
npm run e2e:ios                       # все потоки на загруженном симуляторе
npm run e2e:android                   # все потоки на эмуляторе
npm run e2e:ios -- .maestro/05-universities-favourite.yaml   # один поток
EVO_E2E_DEVICE=<udid> npm run e2e:ios                        # конкретное устройство
```

`appId` везде `com.evoadmissions.app`. Идентификаторы элементов — `testID` в коде (маска-регулярки вроде `tile-.*`),
поэтому потоки не зависят от языка интерфейса.

## Что не покрыто

Загрузка своего документа (нужен ClamAV, его нет в локальном стенде), регистрация по реальной ссылке (одноразовая),
push (не используется), release-сборка (в ней http к стенду запрещён: проверяется на production после выкладки).

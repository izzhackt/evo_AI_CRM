# Ссылки приложения: universal links и Android App Links

Срез M7. Личная ссылка регистрации `https://app.evoadmissions.com/apply?invite=<32 символа>`
должна открывать приложение, а не браузер. Сторона приложения готова в `mobile/app.config.ts`;
**сторона сервера сделана** (ветка `izzhackt/app-links-well-known`): Next.js сам отдаёт оба файла
на хостах кабинета и CRM, без перенаправлений. После выкладки остаётся проверить доставку (раздел
«Как проверить») и добавить отпечаток Google Play App signing, когда появится аккаунт Play Console.

## Что уже сделано в приложении

| Что | Где |
|---|---|
| iOS: `associatedDomains: ["applinks:app.evoadmissions.com"]` | `mobile/app.config.ts`, `ios` |
| Android: `intentFilters` с `autoVerify: true`, `https`, хост `app.evoadmissions.com`, `path: "/apply"` (точное совпадение: `/apply/status` не открывается в приложении) | `mobile/app.config.ts`, `android` |
| Своя схема для проверки без сервера: `evoadmissions://apply?invite=…` | `scheme` в `mobile/app.config.ts` |
| Маршрут `/apply` (параметр `invite`) | `mobile/src/app/(auth)/apply.tsx` |
| Ввод вручную («Вставьте ссылку из письма/WhatsApp») | `mobile/src/features/registration/ApplyScreen.tsx` |
| Разбор ссылки и токена `^[A-Za-z0-9_-]{32}$` | `mobile/src/features/registration/invite-link.ts` |

До выкладки этой ветки файлов на сервере нет, и ссылка `https://app.evoadmissions.com/apply?invite=…` открывается в
браузере (веб-анкета работает как раньше), а приложение открывается по схеме
`evoadmissions://apply?invite=…` или после вставки ссылки вручную.

Проверка схемы на симуляторе iOS:

```
xcrun simctl openurl <UDID> "evoadmissions://apply?invite=<токен>"
```

Android: `adb shell am start -a android.intent.action.VIEW -d "evoadmissions://apply?invite=<токен>"`.

## Что опубликовано на `app.evoadmissions.com` (сторона сервера)

Оба файла отдаются по HTTPS, без перенаправлений, без авторизации, `200`, `Content-Type: application/json`,
`Cache-Control: public, max-age=3600`, только `GET` и `HEAD`. Те же пути отвечают и на хосте CRM (безвредно).

| Что | Где |
|---|---|
| Значения (Team ID, bundle id, отпечатки), чистые данные | `src/lib/app-links.ts` |
| `/.well-known/apple-app-site-association` | `src/app/.well-known/apple-app-site-association/route.ts` |
| `/.well-known/assetlinks.json` | `src/app/.well-known/assetlinks.json/route.ts` |
| Исключение в прокси: до проверки сессии, канонического хоста и закрытых маршрутов | `src/proxy.ts`, `isAppLinksAssociationFile` в `src/lib/platform-route-contract.ts` |
| Тест | `tests/app-links.test.mjs` |

Без исключения прокси отвечал на эти пути `307` (закрытый маршрут или вход). Остальные пути ведут себя как раньше.
Реверс-прокси (Caddy `evo-edge-caddy`) не должен добавлять своих перенаправлений для `/.well-known/*`.

### `/.well-known/apple-app-site-association`

Team ID `4D8W292RKQ` (общедоступный, он же в `mobile/app.config.ts`), bundle id `com.evoadmissions.app`.
Открывается только `/apply` с непустым `invite`. Старое поле `paths` не добавлено: оно открывало бы
приложение и по `/apply` без токена.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["4D8W292RKQ.com.evoadmissions.app"],
        "components": [
          { "/": "/apply", "?": { "invite": "?*" }, "comment": "Личная ссылка регистрации" }
        ]
      }
    ]
  }
}
```

### `/.well-known/assetlinks.json`

Список берётся из `ANDROID_CERT_SHA256_FINGERPRINTS` в `src/lib/app-links.ts`. Сейчас в нём один отпечаток:
сертификат ключа **EAS** (production-сборка `ade0f767-567b-4f16-80aa-b85ad747811c`, серийный номер
`84ac17664dfdcb59`), полученный командой `keytool -printcert -jarfile <файл.aab>` по `.aab` этой сборки.
В репозитории только публичный отпечаток.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.evoadmissions.app",
      "sha256_cert_fingerprints": ["C3:13:F1:59:AC:73:7B:92:66:66:C5:1C:3A:0B:CC:29:C8:77:8F:0C:6C:0B:1C:DA:F8:4D:E8:D2:B8:52:6E:E3"]
    }
  }
]
```

#### Как добавить отпечаток Google Play App signing позже (одна строка)

Приложение из Google Play подписывается ключом Google (App signing), а не ключом EAS, поэтому для
подтверждения ссылок на устройствах из магазина нужен и его отпечаток. После создания приложения в
Play Console: Setup, App signing, «App signing key certificate», строка **SHA-256**. Добавьте её одной
строкой в массив `ANDROID_CERT_SHA256_FINGERPRINTS` в `src/lib/app-links.ts` (место отмечено комментарием);
отпечаток EAS остаётся в списке. Тест проверяет формат (`AA:BB:...`, 32 байта).

## Как проверить после публикации

- Сервер (ожидается `200`, `content-type: application/json`, без `location`):
  `curl -sI https://app.evoadmissions.com/.well-known/apple-app-site-association`
  и `curl -sI https://app.evoadmissions.com/.well-known/assetlinks.json`.
- Apple: `curl -s https://app-site-association.cdn-apple.com/a/v1/app.evoadmissions.com` показывает файл
  (CDN обновляется до суток); на устройстве удалить и поставить сборку заново, открыть ссылку из «Заметок»
  или «Сообщений» (из Safari по ссылке на том же домене universal link не срабатывает).
- Android: `adb shell pm get-app-links com.evoadmissions.app` показывает `verified`;
  Statement List Tester: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.evoadmissions.com&relation=delegate_permission/common.handle_all_urls`.
- Ссылка из письма: открыть на телефоне с установленным приложением, должен открыться экран анкеты;
  без приложения откроется веб-анкета.

## Ограничения и решения

- Открывается только `/apply`. Ссылки подтверждения почты (`/auth/callback`, `/auth/signup-confirmation`)
  остаются в браузере: это решение M7 (письмо подтверждения открывается в вебе, затем студент входит в приложении).
  Если позже подтверждение нужно проводить в приложении, путь добавляется отдельным `path` и в файл Apple.
- Токен приглашения одноразовый и привязан к человеку. В журнал, аналитику и адрес перенаправления он
  не попадает; в приложении он хранится в защищённом хранилище (SecureStore) только до принятия регистрации.

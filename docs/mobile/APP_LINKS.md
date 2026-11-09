# Ссылки приложения: universal links и Android App Links

Срез M7. Личная ссылка регистрации `https://app.evoadmissions.com/apply?invite=<32 символа>`
должна открывать приложение, а не браузер. Сторона приложения готова в `mobile/app.config.ts`;
**сторона сервера в этой ветке не сделана**: нужны Team ID Apple и SHA-256 подписи Android,
которых пока нет (см. «Что нужно от владельца» в `docs/mobile/PLAN.md`).

## Что уже сделано в приложении

| Что | Где |
|---|---|
| iOS: `associatedDomains: ["applinks:app.evoadmissions.com"]` | `mobile/app.config.ts`, `ios` |
| Android: `intentFilters` с `autoVerify: true`, `https`, хост `app.evoadmissions.com`, `pathPrefix: "/apply"` | `mobile/app.config.ts`, `android` |
| Своя схема для проверки без сервера: `evoadmissions://apply?invite=…` | `scheme` в `mobile/app.config.ts` |
| Маршрут `/apply` (параметр `invite`) | `mobile/src/app/(auth)/apply.tsx` |
| Ввод вручную («Вставьте ссылку из письма/WhatsApp») | `mobile/src/features/registration/ApplyScreen.tsx` |
| Разбор ссылки и токена `^[A-Za-z0-9_-]{32}$` | `mobile/src/features/registration/invite-link.ts` |

Пока файлов на сервере нет, ссылка `https://app.evoadmissions.com/apply?invite=…` открывается в
браузере (веб-анкета работает как раньше), а приложение открывается по схеме
`evoadmissions://apply?invite=…` или после вставки ссылки вручную.

Проверка схемы на симуляторе iOS:

```
xcrun simctl openurl <UDID> "evoadmissions://apply?invite=<токен>"
```

Android: `adb shell am start -a android.intent.action.VIEW -d "evoadmissions://apply?invite=<токен>"`.

## Что нужно опубликовать на `app.evoadmissions.com`

Оба файла отдаются по HTTPS, без перенаправлений, без авторизации и с `Content-Type: application/json`.

### 1. `/.well-known/apple-app-site-association` (без расширения)

Подставьте Team ID (developer.apple.com, Membership details). Bundle id `com.evoadmissions.app`.

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAM_ID.com.evoadmissions.app"],
        "components": [
          { "/": "/apply", "?": { "invite": "?*" }, "comment": "Личная ссылка регистрации" }
        ]
      }
    ]
  }
}
```

Старые версии iOS читают поле `paths`; при необходимости добавьте рядом с `components`:
`"appID": "TEAM_ID.com.evoadmissions.app", "paths": ["/apply"]`.

### 2. `/.well-known/assetlinks.json`

Подставьте SHA-256 сертификата подписи. Для Google Play это сертификат **App signing** из
Play Console (Setup, App signing), а для проверки сборкой из EAS ещё и отпечаток из `eas credentials`.
Можно перечислить оба.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.evoadmissions.app",
      "sha256_cert_fingerprints": ["SHA256"]
    }
  }
]
```

## Где это добавить в веб-приложении Next.js

Файлы относятся к хосту `app.evoadmissions.com`, то есть к кабинету студента (`src/`), а не к сайту.

1. Файлы отдаёт сам Next.js:
   - `public/.well-known/assetlinks.json` (статический файл) и
   - `src/app/.well-known/apple-app-site-association/route.ts`: `GET` возвращает JSON выше с
     `Content-Type: application/json` (статический файл без расширения Next отдаст с неверным типом).
   - Team ID и SHA-256 брать из переменных окружения (`EVO_APPLE_TEAM_ID`, `EVO_ANDROID_CERT_SHA256`), в Git их не класть.
2. Прокси `src/proxy.ts` (matcher `/((?!_next/static|_next/image|favicon.ico).*)`) сейчас прогоняет
   `/.well-known/*` через проверку сессии. Нужно добавить оба пути в список публичных в
   `src/lib/platform-route-contract.ts` рядом с `isPublicStudentApplicationPage` и обработать в
   `src/proxy.ts` так же, как публичный `/apply`: без перенаправлений на вход, только `GET` и `HEAD`.
3. Хост: `app.evoadmissions.com` должен отдавать эти пути напрямую (Caddy `evo-edge-caddy`), без редиректа
   `http -> https -> www`. Apple и Google не следуют перенаправлениям.
4. Тест маршрута: ответ 200, `Content-Type: application/json`, JSON разбирается, содержит
   `com.evoadmissions.app`, нет `Set-Cookie`.

## Как проверить после публикации

- Apple: `https://app-site-association.cdn-apple.com/a/v1/app.evoadmissions.com` показывает файл
  (CDN обновляется до суток); на устройстве удалить и поставить сборку заново, открыть ссылку из «Заметок»
  или «Сообщений» (из Safari по ссылке на том же домене universal link не срабатывает).
- Android: `adb shell pm get-app-links com.evoadmissions.app` показывает `verified`;
  Statement List Tester: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.evoadmissions.com&relation=delegate_permission/common.handle_all_urls`.
- Ссылка из письма: открыть на телефоне с установленным приложением, должен открыться экран анкеты;
  без приложения откроется веб-анкета.

## Ограничения и решения

- Открывается только `/apply`. Ссылки подтверждения почты (`/auth/callback`, `/auth/signup-confirmation`)
  остаются в браузере: это решение M7 (письмо подтверждения открывается в вебе, затем студент входит в приложении).
  Если позже подтверждение нужно проводить в приложении, путь добавляется в `pathPrefix` и в файл Apple.
- Токен приглашения одноразовый и привязан к человеку. В журнал, аналитику и адрес перенаправления он
  не попадает; в приложении он хранится в защищённом хранилище (SecureStore) только до принятия регистрации.

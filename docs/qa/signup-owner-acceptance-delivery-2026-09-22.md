# Приёмка #1026/#980 владельцем и доставка

## Решение владельца

22 сентября 2026 владелец подтвердил: «оба работают и код верный, прими и все,
проверки не нужны». Обе функциональности приняты как **OWNER-CONFIRMED**.
Оставшиеся ручные native/mail проверки сняты с условий приёмки. Новые ручные
UI/Auth/native/email прогоны не выполнялись; получение писем и native logout
не объявляются проверенными агентом. Обычный защищённый CI и managed release
остаются включены.

## Объединённый код

- [#1026](https://github.com/izzhackt/evo_AI_CRM/pull/1026): выход iPhone
  с `signOut(scope: .local)`; merge `faf50bef7db53ba48e907f54207643f4dde286f7`
  в 13:04:28 UTC. CI35730782788 SUCCESS на `b40331f6`.
- [#980](https://github.com/izzhackt/evo_AI_CRM/pull/980): общий web/iPhone
  сценарий подтверждения email; merge `0aceda063ab2fb365e554f8bd4cb799f920ccf7f`
  в 13:09:48 UTC. CI35731444298 SUCCESS на `1cae5bb7`.

При последней интеграции #980 runtime bytes совпали с ранее reviewed `cc57c610`;
дерево iOS — `e60e67d20fde495216b3c962ced349dc7eee8676`. Прежние source/build
reviews сохраняют свои ревизии и пределы. Новая установка native binary или
публикация в App Store не выполнялась.

## Применённая конфигурация

Подготовленный и ранее независимо reviewed пакет исполнен ROOT один раз:

- Supabase Auth PATCH изменил только `mailer_templates_confirmation_content`
  и `uri_allow_list`: шаблон использует `RedirectTo` с `Token`, allowlist
  дополнен точным `https://app.evoadmissions.com/auth/signup-confirmation`.
  Свежий GET подтвердил совпадение всей конфигурации с прежней, кроме этих
  двух полей. OTP8/3600, SMTP, Invite/recovery, `disable_signup=true`
  и `mailer_autoconfirm=false` сохранены.
- В `/opt/evo-crm/.env.production` добавлен только
  `EVO_STUDENT_SIGNUP_OTP_LENGTH=8`; остальные байты, владелец и права файла
  сохранены. Само изменение env не перезапускало контейнер.
- Новые письма не отправлялись; миграции не применялись повторно.

## Серверная доставка

На 2026-09-22T13:18:50.617738+00:00 принят exact main `0aceda063ab2fb365e554f8bd4cb799f920ccf7f`:
[upstream35731816901](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35731816901)
и [release35731922596](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35731922596)
завершились SUCCESS. Release ID — `v3-r35731922596-a1-0aceda06`.

Image `sha256:0de9bd01f2c927f8ac3353229c4b18a6603d4bf32dbad3562c10f99a05063be4`, container `7deb8856f7bf1cf54e6857b7cb3a50d03ec55d8dff2da4e43fbb7004475aaef3`:
healthy, restart0, accepted pointer/record совпали с revision, pending отсутствует.
После terminal SUCCESS release-arm установлен в `false` и перечитан.
Штатный authenticated read-only case/Student smoke прошёл; rollback не выполнялся.
Это доставка и штатная техническая приёмка релиза, не дополнительный ручной
native/mail прогон. Schema239 использует прежнюю apply-квитанцию; новых SQL apply нет.

| Квитанция | SHA-256 |
|---|---|
| Accepted server readback | `2e8758b953bab0ce952f5e637ecca0c87cff44e366d7c03e36c7140f24a4cc61` |
| Accepted pointer | `997fe404e741035f5bbcceb4c9c0b3690875313c9d2dc14e5180de359a31753c` |
| Acceptance record | `ae1ef7aa04a6e303795eff9bcacee5ef5b8624d4e13d0fe2ba1b6d9930f8079b` |
| Встроенный browser smoke receipt | `b6cd24bacb88498e71b52a0ea4bac22cb8bdf1e25fe705dfa28130956cb2bded` |
| Auth activation receipt | `c9ac4d575303fdc6cfc77adbc28295ae8462b516f89b48e550d2b49ac9f6130e` |

## Границы

Исторические STOP и независимый audit #1037 сохранены. KB159 остаётся адресным
исключением без применения; решения141/144/145 и согласованные два материала32
не меняются. Пункты37–50, общий финальный E2E, контентная волна и App Store
остаются отложенными. Приёмка этих двух PR не расширяет доказательства других
сценариев, перечисленные в ведомости1–36.

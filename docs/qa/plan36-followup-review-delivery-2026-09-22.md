# Дополнительное ревью1–36 и доставка — 22 сентября 2026

## Изменения

- [#1041](https://github.com/izzhackt/evo_AI_CRM/pull/1041), merge24e0a2eb:
  явное восстановление карточки после stale/request-conflict теперь полностью
  обновляет документ/revision/драфты; обычные записи сохраняют соседний ввод.
  [Реальный локальный сценарий](card-stale-recovery-2026-09-22.md) подтверждён
  в пределах одного Admin/education-card. Независимое final review84663d41
  имеет SHA5f246c6958a3e3bc1a66a3c0414f4f2405abe206bd21dbb61cca4fbc0bb2585b;
  CI35739639854 SUCCESS. Все роли/варианты отдельно не заявляются.
- [#1040](https://github.com/izzhackt/evo_AI_CRM/pull/1040), DRAFT:
  три native learning исправления подготовлены в reviewed/compiled dc5b627f.
  Source/docs review8eb0eb3e PASS0751faa6966b08c451a06d7da0986945991c22ee872e481409ec588984c6d6aa;
  CI35739568236 SUCCESS. Сборка Simulator настоящая, отдельный QA bundle;
  актуальный CUA-доступ заблокирован Mac lock. Merge, установка/Auth, три
  changed-path сценария и iPhone binary delivery не выполнены. Готовый чистый
  TCP relay к существующему local Supabase не запускался и не подменяет ответы.
- [#1039](https://github.com/izzhackt/evo_AI_CRM/pull/1039), merge36277557:
  зависимость расширенного публичного сайта — Czechia/Austria/Cyprus→EU.
  Приёмник/SQL сохраняет guards; подготовка документов остаётся для шести стран.
  Независимое review510bb3d7 PASSc91885cef78f73b0eaf53cde30786ce3aff7e289f75673a48e45820a230dad05;
  CI35738576887 SUCCESS. [36 реальных request contexts и Postgres DDL](../EVO_WEBSITE_COUNTRY_EXTENSION_2026-09-22.md)
  проверены без лидов/форм/контактов. Публичная отправка остаётся у владельца.

## Миграция240

Применена ROOT один раз штатным linked Supabase CLI2.116.0: link, dry-run с ровно
240, push, readback. Реестр001–240; функция совпадает с DDL, проверенным локально;
OID, owner, ACL и signature прежние. Временные CLI login roles отозваны finally.
Ни001–239, ни240 повторно не применялись. Прежние Auth/SMTP настройки не менялись.

- Migration receipt: `1f97d4da94be60b92050b25ffd5698a8bc7d3dac907b520d44354524b5776f47`.
- CLI cleanup: `313a8fd8b2c37565beec945bf6bf78cc75c4c6211ea894daac67f4905ed2f11a`.
- SQL240: `02799c85fc83555a87409c8afdb94b5856d3f24beef1db0e3f5d3a8e766ca131`.

## Первый релизный STOP и диагностика

Upstream35739918216 SUCCESS; release35739964383 на24e0a2eb остановился до
checkout/build/deploy. Static metadata совпали; исходный HTTP/JSON/ref отказ
runner не раскрыт старым generic error. Отдельный Mac403 не выдаётся за его причину.
Старый0aceda06 оставался healthy/restart0, pending отсутствовал, ROOT disarmed.

[#1042](https://github.com/izzhackt/evo_AI_CRM/pull/1042), merge97b27d55,
добавляет stage/http_status в три admission error. Ни одна проверка/permission,
secretless boundary, timeout, redirect или arm/actor guard не ослаблена; токены,
body и exception text не логируются. Независимое review0edbffd9
PASS920aac74b63b245144b2d9349553a85d8eb07916047c613b7e69df7cd2ccd330;
CI35740582357 SUCCESS. Три syntax и шесть статических contracts прошли.
Исходный STOP сохранён; запуск новой ревизии не доказывает устранение неизвестной
первопричины. Более точная диагностика будет сохранена для будущих отказов.

## Серверная доставка

На 2026-09-22T14:37:53.053941+00:00 accepted exact main `97b27d5572fb8dec53a75eb6ea71caaf1b3a780b`:
[upstream35740912046](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35740912046)
и [release35740963950](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35740963950)
SUCCESS. Release ID `v3-r35740963950-a1-97b27d55`. Одна immutable сборка после прежнего
prebuild STOP; новая ревизия исполнила все три изменённых admission шага.

Image `sha256:7cba3e9f1dcee18c92cc21adbd1be21efe394000db64c1c4774fc29be8ae06d5`, container `8578e9da1188a6baffecdc2c832d5d3c0aa6dfde846788de0692685f17628a7d`:
healthy/restart0; accepted pointer/record и реально запущенный контейнер совпадают,
pending отсутствует. ROOT disarmed после terminal SUCCESS, значениеfalse перечитано.
Штатный authenticated read-only case/Student smoke прошёл. Повтор stale в
production и отправка формы сайта не выполнялись; их приёмка не заявляется.

| Квитанция | SHA-256 |
|---|---|
| Accepted server readback | `607fdbc905df333ed764f026c69d298d9e9de09349962c91b263b2a6e90c2702` |
| Accepted pointer | `308e76f70f20a7770c04622ef8825b932dc5aad3b0734ce3a1ac6b09ef2340b8` |
| Acceptance record | `ed0a57718fc07a027226355b7df0cd4884a4911e1614467dad1a0a5cdfb6d23a` |
| Browser smoke | `8da08b5a712141d1df2b981d5b0739038909b5b405e82cdbfc2e7a4da0e02278` |

Приёмка приёмника передана задаче сайта; она самостоятельно выпускает свой
immutable reviewed кандидат. Этой CRM-квитанцией публикация сайта не заявляется.

## Границы и остаток

Приёмка владельцем #1026/#980 сохраняется; отменённые native/mail шаги не
переоткрывались, писем не отправляли. Новый открытый PR1040 ждёт реального
симулятора; его source/build не переименованы в runtime acceptance.
KB159 не применяется; решения31 и пакет двух материалов32 неизменны.
37–50, общий финальный E2E, контентная волна и App Store отложены. Полная
безошибочность продукта и все сочетания ролей/состояний не заявляются.

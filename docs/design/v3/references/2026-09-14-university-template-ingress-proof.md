# Университетские бланки: проверка загрузки и настройки полей

Дата: 2026-09-14. Проверен исходный полный сценарий на
`5833cd77b304b1c1713d7c302748c24de01bb2d5`; это техническая приёмка на
вымышленных документах, **не** выпуск, реальное клиентское дело или полный D4.

## Окружение и воспроизведение

- OrbStack, native Linux arm64; отдельный проект `evo-local-12c6878c9ed28088`.
- Настоящие локальные Supabase Auth/Postgres/Storage, ClamAV и изолированный
  Linux inspector. Рабочий managed-проект и production не менялись.
- Chromium через существующий Playwright: Browser plugin not available.
  Desktop1440×1000 и mobile393×852, loopback-only application origin.
- App image: `sha256:69db72cef0e76e9d7c4b22bf9907b52d58a617cfbf3f4c2ca0955b83b77519bc`.
- Derived acceptance image: `sha256:19663c20bdf3114c5eeed04b3eb702eea5e1fb49434d2015b0fc19fed3c9c0eb`.
- Сборки: `01a09d69ad627b20843b3f8870a32e3a`, `01a09d6a75e67383acff7cb0284c3b65`;
  Docker readback подтвердил architecture, revision и связь images.

На чистом exact checkout команда:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node \
EVO_D3_COMBINED_IMAGE=sha256:69db72cef0e76e9d7c4b22bf9907b52d58a617cfbf3f4c2ca0955b83b77519bc \
EVO_D3_ACCEPTANCE_IMAGE=sha256:19663c20bdf3114c5eeed04b3eb702eea5e1fb49434d2015b0fc19fed3c9c0eb \
bash scripts/test-postgres-v2-foundation.sh --university-template-ingress-only
```

Повтор требует доступности именно этих images или новой проверенной пары;
не подменять source/revision и не считать старый receipt доказательством нового кода.

## Подтверждённый результат

Команда завершилась exit0, `UNIVERSITY_TEMPLATE_INGRESS_VERIFIED`:
`01a09d6cfcdb7621b7ca7f47245ed92d`.

| Проверка | Результат |
|---|---|
| Настоящий Admin-вход и переход к существующему каталогу | PASS |
| Создание бланка, резервирование версии и загрузка PDF через UI | PASS |
| ClamAV, Linux inspection, сохранение и обратное чтение точных байтов | PASS |
| Потерянный ответ после записи Storage, тот же request, явное восстановление | PASS |
| Неизменяемый receipt и защищённое чтение исходного файла | PASS |
| Загрузка DOCX и чтение реальных фрагментов исходника | PASS |
| Сохранение полей, отдельная проверка и явная публикация | PASS |
| Повторное открытие desktop/mobile и история после архивирования | PASS |
| Идентичность страницы, отсутствие framework overlay | PASS |
| Ошибки/предупреждения браузера | 0 / 0 |
| Удаление только проверочных app/project ресурсов | PASS |

Root просмотрел `template-mapping-desktop.png` и `template-mapping-mobile.png`:
существующая EVO-навигация, подписанные поля и кнопки видимы; на mobile блоки
перестраиваются в одну колонку. Скриншоты показывают настройку DOCX, не внешний вид
готового документа. Они не доказывают PDF region editor или screen-reader acceptance.

Локальные артефакты (ignored, без реальных персональных данных):
`output/university-template-ingress/5833cd77b304b1c1713d7c302748c24de01bb2d5/foundation-9718-68170/`.
`acceptance.json` имеет schema `evo-university-template-ingress-acceptance/v1` и
вложенный обязательный `mapping`; `cleanupVerified=true`.
Независимое read-only отсутствие exact containers/network/volumes подтверждено
`01a09d6d6b1d7980aa4b0058921cd67c`. Cleanup не затронул другие локальные stacks.

## Что закрыто и что остаётся

Исправление acceptance-only HTTPS `4e120599` устранило подтверждённый
`insecure_url`/`authUnavailable`: теперь пройден исходный браузерный путь, а не
только TLS unit-проверки. Production Auth/URL guards не ослаблялись.

`businessAcceptance=false`, `providerAcceptance=false`, `fullD4Acceptance=false`,
`mapping.generatedFormAcceptance=false` остаются явными границами receipt.
Далее: PDF page/region UI, сохранённые заполненные DOCX/PDF и пакеты ZIP,
managed schema/bucket/release, D3 provider, D5 перенос и D6 реальная приёмка/retirement.
Эта проверка не разрешает удалять отдельный EVO Docs.

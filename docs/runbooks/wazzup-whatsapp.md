# WhatsApp продаж через Wazzup: приём (этап 1)

Обновлено: 2026-10-27. Статус: **срезы W2 (приложение) и W3 (интерфейс) и дополнения миграции 326 проверены модульными тестами и
сквозным прогоном на одноразовых Postgres (миграции 001–326) и PostgREST, где настоящими были маршрут, команды `wazzup-ops`
(включая `replay` по номерам событий), модуль таймера (чтение пути и все четыре расхождения с env), SQL и Vault, а Wazzup —
локальная подделка (`api.wazzup24.com` не вызывался); на production ничего не включено, живого ключа Wazzup нет.** Слово
«принято» не заявляется, пока строки A0–A14 раздела 7 не пройдены настоящими сообщениями (`AGENTS.md`).

Контракт: [план](../EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md) (§3.1–§3.3, §5, §9, §11–§13); миграции 324–326
(`supabase/migrations/`); решение — [ADR 0036](../adr/0036-receive-sales-whatsapp-via-wazzup-sidecar.md). Если этот документ и
план расходятся, прав план, кроме отличий, названных в разделе 10.

Документ ничего не разрешает. Отдельное «давай» владельца нужно на каждый шаг production: применение миграций, строки в
`.env.production`, правку живого edge, установку таймера, выпуски (после 21:00 по Бишкеку или в воскресенье, пока жива
телефония), передачу ключа, привязку канала, переключение транспорта и `PATCH` вебхуков. Отправки клиентам из EVO нет и в
этом этапе быть не должно: она закрыта в базе (ворота `whatsapp_send_allowed`, миграция 325), а не только в интерфейсе.

## 1. Что где живёт

| Что | Где |
|---|---|
| Маршрут приёма | `POST https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound?token=<64 hex>`, `src/lib/server/platform-wazzup-ingress.ts` |
| Env (`/opt/evo-crm/.env.production`) | `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED` (`0`/`1`, аварийный стоп), `EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN` (64 hex), `EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN_NEXT` (только при ротации); владелец новых бесед — прежний `EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID` |
| Ключ API Wazzup | Supabase Vault (привязка с отпечатком SHA-256); в env, в Git, в чате, в argv, в файлах его нет |
| Рабочие выключатели (без выпуска) | `platform_private.whatsapp_transport_state`: `active_transport` (`none`/`waha`/`wazzup`), `ai_trigger_enabled`, `gemini_enabled`; меняются командой `wazzup-ops transport` |
| Команды оператора | `docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs <команда>` (собрано в образ, `scripts/wazzup-ops.mjs`) |
| Таймер | прежний `evo-whatsapp-health` (раз в 5 минут, `deploy/whatsapp/`), три шага Wazzup после шага WAHA |
| Edge | обработчик и фильтр журнала в `agent-lead2-inbox/deploy/Caddyfile.evo-edge` (в репозитории; живой файл правится отдельным «давай») |
| Клиент Wazzup | `src/lib/server/platform-wazzup-client.ts`: только `GET /v3/channels`, `GET /v3/webhooks`, `PATCH /v3/webhooks`; вызова отправки в коде нет |

Имена, которых нет и не должно быть: переменной с ключом Wazzup в env, команды отправки в `wazzup-ops`, вызова
`POST /v3/message` в приложении.

## 2. Документация Wazzup, прочитано 27.10.2026

Источники: `wazzup24.ru/help/api-ru/webhooks-2/`, `…/rabota-s-kanalami/`, `…/sposoby-podkljucheniya/`,
`…/obshhie-oshibki/`, `…/avtorizaciya/`; английские копии страниц (`wazzup24.com/help/api-en/…`) сохранены в рабочей
папке исследования 26.10 (сайт `.com` с этого окружения отдаёт 403, живая сверка шла по `.ru`).

Подтверждено: `PATCH https://api.wazzup24.com/v3/webhooks` с `webhooksUri` (до 200 знаков, query допускается) и
`subscriptions` (`messagesAndStatuses`, `contactsAndDealsCreation`, `channelsUpdates`, `templateStatus`); при `PATCH`
Wazzup шлёт на адрес `{"test": true}` и ждёт 200, иначе 400 `testPostNotPassed` (в `data` — полученный статус) или
`uriNotValid`; `GET /v3/webhooks` отдаёт адрес и подписки (в примере флаги строками `"true"`); вебхук — `POST` JSON,
`Authorization: Bearer ${crmKey}` бывает только если у Wazzup есть `crmKey`, у Sidecar-ключа подписи нет; ответ ждут 200 за
30 секунд; ключи `messages`, `statuses`, `channelsUpdates`, `createContact`/`createDeal`, `templateStatus`; Sidecar-ключ
работает ровно на `GET /channels`, `POST /message`, `GET /webhooks`, `PATCH /webhooks`, `GET /v3/templates/whatsapp`;
лимит 500 запросов за 5 секунд; `401` — ключ не принят.

Расхождения и пробелы, которые учтены в коде (план §3.1 их не называл или называл иначе):

1. **Написание состояний канала различается между страницами.** Русская «Работа с каналами» даёт `qridle`,
   `openelsewhere`, `blocked`; английская и вебхук `channelsUpdates` — `qr`, `openElsewhere` и без `blocked`. Код сравнивает
   слова без учёта регистра и принимает оба написания (`src/lib/platform-wazzup-health.ts`); незнакомое состояние никогда не
   считается рабочим.
2. **В вебхуке `channelsUpdates` перечислены только семь состояний** (`active`, `disabled`, `qr`, `phoneUnavailable`,
   `openElsewhere`, `notEnoughMoney`, `unauthorized`); остальные (`init`, `foreignphone`, `waitForPassword`, `blocked`,
   `onModeration`, `rejected`) документированы только для `GET /v3/channels`. Опрос таймера покрывает все.
3. **Sidecar-ключ.** Русская страница называет интеграции amo и Битрикс24, английская — Kommo и Bitrix; о том, что ключ
   из «Дополнительно» интеграции amoCRM именно Sidecar, документация прямо не говорит (вывод исследования 26.10). Проверка —
   первый `GET /v3/channels` (шаг 7 раздела 5): `403` значит, что ключ не Sidecar-класса.
4. **`dateTime` — `yyyy-mm-ddThh:mm:ss.ms` без пояса**, часовой пояс не назван. Приложение и база читают его как UTC (это
   влияет только на порядок проекции внутри пакета и на сутки сверки). Проверить на A2: время сообщения в ленте сходится с
   настоящим.
5. **Повторы при не-200 не описаны**, как и подпись, порядок доставки и повтор проверочного POST. Считаем, что повторов нет
   (запись поэлементно, догрузка, суточная сверка, удержание на edge) и спрашиваем поддержку до включения (вопрос 17 плана).
6. **`Content-Type` вебхука написан `application/json; charset-utf-8`** (опечатка в документации). Маршрут тип не
   проверяет, разбирает тело как JSON.
7. **В `messages` статус бывает `inbound`, в `statuses` — `edited`.** Статусы в этапе 1 только считаются.

## 3. Секреты

Правила как в [`telephony-go-live.md`](telephony-go-live.md) §2: `set +o history; umask 077`, ввод секретов только `read -rs`,
значения не печатаются, `.env.production` правится только на диске с копией, вступает в силу только выпуском. Помощники
`backup`, `env_put`, `envfacts`, `envcheck` и процедура **Р** — оттуда.

**Токен вебхука** создаётся на сервере и не печатается:

```bash
backup
T=$(openssl rand -hex 32); env_put "$ENVF" EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN "$T"; unset T
awk -F= '$1=="EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN"{print $1" длина="length($2)}' "$ENVF"     # длина=64
env_put "$ENVF" EVO_PLATFORM_WAZZUP_INGRESS_ENABLED 1
envcheck        # {"ok":true,"code":"valid"}; отказ — вернуть файл из $B и не выпускать
```

Контракт env отказывает, если `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=1` стоит вместе с `EVO_PLATFORM_WAHA_INGRESS_ENABLED=1`
(два приёма на один номер записали бы каждое сообщение дважды), если токен не 64 hex, равен другому значению файла или
`1` стоит без токена и без владельца новых бесед. Перед этим шагом в файле проверить `EVO_PLATFORM_WAHA_INGRESS_ENABLED`:
если `1`, поставить `0` (сессию `crm_primary` не трогать). Копия токена и ключа — в SOPS-архиве «Секреты и доступы ЭВО».

**Ключ API Wazzup** передаёт владелец одним из двух способов (план §5.5):

- **А (рекомендуется).** Владелец копирует «Ключ API» (Wazzup → «Интеграция с CRM» → amoCRM → «Дополнительно»), заходит
  `ssh -t hermes-vps` и выполняет одну строку (`printf` — встроенная команда, значение не попадает в argv и `ps`):
  ```bash
  read -rs K && printf '%s' "$K" | sudo docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs set-key; unset K
  ```
  Либо интерактивно, ввод скрыт: `sudo docker exec -it evo-crm-app-1 node /app/wazzup-ops.mjs set-key`.
- **Б.** Ключ лежит в SOPS-архиве; агент передаёт его конвейером
  `sops -d … | ssh hermes-vps 'sudo docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs set-key'`, не выводя значение.

`set-key` читает ключ только со stdin, проверяет форму (16–4096 печатных знаков без пробелов), **сначала делает чтение
`GET /v3/channels` с этим ключом** и только при ответе 200 пишет его в Vault. Печатает отпечаток (8 знаков SHA-256),
типы каналов, состояние и последние 4 цифры номера. Ключ, написанный аргументом (`set-key <ключ>`), команда отвергает
фиксированным словом `no_arguments_accepted`, не читая его и не повторяя. Ключ в чат, Telegram, WhatsApp, почту, Git,
env-файл, задачи EVO и скриншоты не отправлять; если попал — считать скомпрометированным и спросить поддержку Wazzup,
как выпустить новый.

## 4. Команды `wazzup-ops`

Один вызов — одна строка JSON с безопасными полями; код выхода `0` — сделано, `1` — отказ или сбой, `2` — ошибка вызова
(ничего не сделано). Ни ключа, ни токена, ни полного номера, ни адреса с токеном в выводе нет.

| Команда | Что делает |
|---|---|
| `set-key` | раздел 3 |
| `channels` | `GET /v3/channels` ключом из Vault: `channelId`, тип (`whatsapp` обычный, `wapi` WABA), последние 4 цифры, состояние |
| `webhooks-get` | `GET /v3/webhooks`: адрес `empty` / `ours` (путь и какой токен: `current`/`next`/`other`/`absent`) / `other` (только хост чужого адреса) и подписки |
| `bind-channel <channelId> [--confirm-last4 NNNN]` | без подтверждения печатает кандидата (id, тип, последние 4 цифры) и выходит с `2`; с подтверждением владельца — `platform.wazzup_channel_bind_v1` (SHA-256 номера, сам номер в базу не идёт) |
| `transport <none\|waha\|wazzup> [--ai-trigger on\|off] [--gemini on\|off --owner-approved]` | `platform.whatsapp_transport_configure_v1`, без выпуска; `--gemini on` без `--owner-approved` отвергается (вопрос 13 плана) |
| `webhooks-patch --on [--token current\|next]` | сначала `GET`: чужой занятый адрес — **стоп** (`address_occupied`, вопрос владельцу 4), ничего не меняется; иначе `PATCH` нашего адреса с токеном из env процесса, `messagesAndStatuses` и `channelsUpdates` включены, `contactsAndDealsCreation` и `templateStatus` выключены; затем повторное чтение и `verified` |
| `webhooks-patch --off [--token …]` | те же подписки `false`, адрес остаётся; только на своём адресе (`address_not_ours` иначе) |
| `replay <id события>… [--token current\|next]` | проверка A6: до 100 номеров сохранённых событий (UUID, не секрет); пакет собирает **база** (`platform.whatsapp_intake_events_read_v1`, миграция 326: только события Wazzup этой организации, в порядке запроса), команда шлёт его порциями не больше 50 элементов на `http://127.0.0.1:3000/api/v2/whatsapp/wazzup/inbound` с токеном из env процесса и заголовком `Host: crm.evoadmissions.com`; печатаются только числа (`events`, `missing`, `unrepeatable`, `requests` и сумма ответов маршрута) |

Номера событий оператор берёт чтением, которое выдаёт только идентификаторы (ни текстов, ни номеров чатов):

```bash
docker exec evo-supabase-db psql -U supabase_admin -d postgres -X -A -t -c \
  "select id from platform_private.provider_webhook_events
    where provider = 'wazzup' and event_type = 'message' order by received_at desc limit 2"
```

и подставляет их в команду: `docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs replay <id> <id>`. Ожидается `status 200` и в
`result` — `deduplicated` равен `events`, `stored` и `filtered` равны 0; счётчики за сутки не двигаются (повторяется только
сохранённое, отфильтрованные элементы не сохраняются и не повторяются). `missing` — номера, которых нет у этой организации среди
событий Wazzup; `unrepeatable` — события `unparsed` (их форма неизвестна). Пакет со stdin убран намеренно: он принимал бы любое
содержимое и мог бы занести в приём выдуманные «проверенные» события; без номеров команда отвечает `event_ids_required`.

## 5. Порядок включения (план §11)

1. **PR миграций 324–326** слит и применён в окне (раздел 7 плана); безвредно: строки транспорта нет (= `none`). Приложение
   этого среза зовёт функции 326 (таймер читает путь, `replay` читает события): образ без применённой 326 скажет `failed`.
2. **Env** — раздел 3, затем выпуск (процедура **Р**) вместе с приложением этого среза. С верным токеном маршрут отвечает
   `503 transport_inactive`, с неверным — `401`, на `app.` — `404`, `GET` — `405`.
3. **Edge**: обработчик из `Caddyfile.evo-edge` в живой файл по «давай»; `caddy validate`, `caddy adapt`, `caddy reload`
   (общий edge не перезапускать), зонды раздела 6.
4. **Таймер до включения** (план §11 шаг 6): `systemctl list-timers evo-whatsapp-health.timer`; нет — установка по
   `deploy/whatsapp/README.md`. Один проход вручную: `sudo systemctl start evo-whatsapp-health.service`, в
   `journalctl -u evo-whatsapp-health -n 3` виден блок `wazzup` с `sweep_status`, `health_status`, `reconcile_status`
   (`transport_inactive`, пока путь не Wazzup). **Без таймера приём включать нельзя**: всё, что встроенная проекция не
   успела за 5 с, осталось бы необработанным без тревог.
5. **Ключ** — раздел 3, затем `channels` и `webhooks-get` (адрес `empty`?).
6. **Привязка канала** по подтверждению владельцем последних 4 цифр: `bind-channel <id>` → ответ владельца → то же с
   `--confirm-last4`.
7. **Тестовый клиент для A2**: читаем, сколько клиентов совпадает с номером владельца (только количество); ноль — заводим
   штатно клиента и лид на этот номер (как `telephony-go-live.md`).
8. **Включение** (не выпуск, можно в рабочее время, с «давай»): `transport wazzup --ai-trigger off` (тревоги `crm_primary`
   закрываются причиной `transport_switched`) → `webhooks-patch --on` → A1.
9. **Проверка** A2–A14 раздела 7, наблюдение 48 часов, суточная сверка первые 7 дней.
10. **ИИ Claude** — после A1–A10 и «да» владельца: `transport wazzup --ai-trigger on`. Gemini остаётся закрытым.

## 6. Edge

Обработчик `handle @wazzup` в блоке `crm.evoadmissions.com, app.evoadmissions.com`: на `app.` — `404`; предел тела 1 МиБ;
`X-Evo-Wazzup-Ip` **перезаписывается** адресом клиента (ограничитель неудач приложения верит только этому заголовку);
`lb_try_duration 25s` / `lb_try_interval 500ms` держат запрос, пока приложение пересоздаётся выпуском (Caddy повторяет `POST`
только при неудавшемся соединении; 25 с меньше таймаута Wazzup в 30 с). Путь не входит в `@private`: Wazzup приходит из
интернета. В журнал доступа хоста CRM добавлена замена `token` в `request>uri query`, иначе токен лёг бы в
`docker logs evo-edge-caddy`.

Проверено в репозитории закреплённым образом Caddy v2.11.3 без сети (`caddy validate`: «Valid configuration»; `caddy adapt`:
порядок — общий `request_body`, затем обработчик Wazzup, затем `@private`, затем общий `reverse_proxy`; `max_size 1MiB`
в адаптации — 1048576, равно пределу приложения). Единица `MiB`, а не `MB` из плана, нужна, чтобы предел edge не оказался
меньше предела приложения (1 МБ Caddy — 1 000 000 байт).

Зонды на VPS после правки живого файла (технические, не приёмка; базу не вызывают):

```bash
URL=https://crm.evoadmissions.com/api/v2/whatsapp/wazzup/inbound
curl -sS -m 10 -o /dev/null -w 'GET -> %{http_code}\n' "$URL"                                   # 405
curl -sS -m 10 -o /dev/null -w 'неверный токен -> %{http_code}\n' -X POST -d '{}' "$URL?token=wrong-probe"    # 401 (один раз: неверные считает ограничитель)
curl -sS -m 10 -o /dev/null -w 'app. -> %{http_code}\n' -X POST -d '{}' "https://app.evoadmissions.com/api/v2/whatsapp/wazzup/inbound?token=wrong-probe"   # 404
docker logs --since 2m evo-edge-caddy 2>&1 | grep -c 'token=wrong-probe'                        # 0: в журнале token=REDACTED
```

С верным токеном запросов вручную не слать: `curl` с токеном в командной строке запрещён; проверка с верным токеном — это
`wazzup-ops webhooks-patch --on` (Wazzup сам шлёт `{"test": true}`) и `replay`.

## 7. Проверка на настоящем пути (план §12)

Сообщения пишет владелец со своего телефона (не телефона продаж). Пока A0–A10 не пройдены, в интерфейсе и отчётах приём не
называется рабочим.

| # | Проверка | Ожидается |
|---|---|---|
| A0 | таймер | `systemctl list-timers` показывает `evo-whatsapp-health.timer`; строка прохода содержит `wazzup.sweep_status`, `wazzup.health_status`, `wazzup.reconcile_status` |
| A1 | `webhooks-patch --on` | `ok`, `verified: true`; в журнале приложения `wazzup_inbound … reason test_ok` |
| A2 | «EVO тест 1» на номер продаж | событие `wazzup`/`message`, итог `projected`, чат в «Продажи → WhatsApp»; беседа привязана к тестовому клиенту по номеру, новых клиентов и лидов нет; время сообщения верное (пункт 4 раздела 2) |
| A3 | продавец отвечает из amoCRM | эхо → исходящее в том же чате, чат больше не «неотвечен» |
| A4 | ответ из приложения Wazzup, с телефона продаж, автоответ «Нерабочее время» | для каждого записано, пришло ли эхо и какие поля `authorId`/`sentFromApp`/`type`; ответы продавца — исходящие, автоответ — `ignored_auto_echo`. Правило эха фиксируется до включения ИИ |
| A5 | фото и голосовое | метки ровно в формате 259; файлы не скачиваются |
| A6 | `replay <id событий A2 и A5>` (раздел 4) | `deduplicated`, новых строк нет, счётчики не двигаются; токена нет в argv, истории оболочки и выводе |
| A7 | неверный токен на `crm.`; любой запрос на `app.` | `401` и `404`; в журнале edge `REDACTED` |
| A8 | сутки работы | число входящих за сутки по Бишкеку сходится с amoCRM (количества); шаг `reconcile` таймера дал то же число EVO (`reconcile_evo`) |
| A9 | состояние канала | серия 321 `wazzup` = `WORKING`, `health_word=WORKING`; открытых тревог `crm_primary` нет |
| A10 | запрет отправки | «Отправить» в карточке черновика даёт `receive_only`, в журнале нет вызова WAHA; `POST /api/v3/settings/whatsapp-connect` администратором — `409 transport_wazzup` |
| A11 | чат студента | присоединён к клиенту и лиду дела; при отказе в согласии агент получает `ai_consent_missing` |
| A12 | ИИ (после включения) | не больше одного запуска на агента за 5 минут, расход ≤ $10 в сутки, черновик не отправляется |
| A13 | следующий выпуск при включённом приёме | зонд раз в секунду всё время выпуска не получает `502`: `GET` на путь отвечает `405` (ограничитель его не считает; ответ приходит с задержкой, пока приложение пересоздаётся), `POST` с неверным токеном — `401`, но не чаще раза в 4 секунды: ограничитель неудач после 20 неверных в минуту с адреса отвечает `429` на минуту (это тоже не `502`, но удержание такой зонд уже не проверяет) |
| A14 | WAHA | env WAHA `0`, тревога WAHA молчит, маршрут подключения — `409` |

## 8. Таймер: что пишет отчёт

`docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs` печатает одну строку JSON. Блок `wazzup` появляется,
когда есть что сказать: аварийный стоп открыт (`EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=1`) — идут три шага; либо стоп закрыт, но токен
вебхука в env задан (настройка начата или приём остановлен аварийно) — тогда проход читает путь и молчит, пока путь и env сходятся
(`status: disabled`, `reason: ingress_off`), а при расхождении (таблица ниже) пишет `degraded`. Нет ни стопа, ни токена — блока нет и
база не вызывается. Шаг WAHA не менялся и сам отвечает `transport_conflict` (код выхода 1), если оба приёма включены.

Путь (`none`, `waha` или `wazzup`) и привязанный канал проход читает **одним** вызовом `platform.whatsapp_transport_read_v1`
(миграция 326, только service_role, ничего не пишет; в ответе путь, оба выключателя ИИ и Gemini и канал: id, тип, последние 4 цифры,
состояние и время — ни ключа, ни номера, ни хеша), и слово пути попадает в отчёт (`transport`). **Расхождение переключателей env и
пути в базе** (план §9, таблица состояний) — `status: degraded`, `reason: transport_mismatch`, код выхода 0, слово в
`transport_mismatch`:

| `transport_mismatch` | Env | Путь в базе | Что это значит и что делать |
|---|---|---|---|
| `env_wazzup_on_db_waha` | приём Wazzup `1` | `waha` | строка 3 таблицы §9: маршрут Wazzup отвечает `503 transport_inactive`, приём WAHA по контракту env выключен — **не принимает никто**; вернуть `wazzup-ops transport wazzup` (или довести порядок возврата на WAHA, §9 п. 4 плана) |
| `env_wazzup_off_db_wazzup` | стоп закрыт (`0`) | `wazzup` | строка 4: вебхуки Wazzup получают 503, канал может быть рабочим, ответы закрыты; догрузка и сверка пропущены, здоровье идёт («молчит» сработает через 3 рабочих часа); открыть стоп выпуском или перевести путь командой `transport none` |
| `env_waha_off_db_waha` | приём WAHA не `1` | `waha` | путь WAHA выбран, а приём WAHA выключен: **не принимает никто**; блок видит это только пока в env есть токен Wazzup или стоп открыт |
| `env_waha_on_db_wazzup` | приём WAHA `1` | `wazzup` | два приёма на один номер (контракт env такой выпуск не пропускает; слово ловит ручную правку): выключить приём WAHA выпуском |

Путь `none` расхождением не считается (норма до переключения и после быстрого отката; `transport_inactive` у шагов).

| Ключи | Смысл |
|---|---|
| `sweep_status` (`ok`/`transport_inactive`/`failed`), `sweep_rounds`, `sweep_processed`, `sweep_busy`, `sweep_new_inbound`, `sweep_failed_exhausted`, `oldest_pending_seconds`, `backlog` | **догрузка**: пакеты по 50 событий, не больше 4 за проход; возраст самого старого необработанного; `backlog: degraded` при возрасте старше 30 минут |
| `health_status` (`ok`/`unknown`/`transport_inactive`/`failed`/`skipped`), `health_word`, `health_verdict`, `health_opened`, `health_resolved`, `health_key`, `health_api` | **здоровье**: слово состояния канала (`WORKING`, `PHONE_UNAVAILABLE`, `SCAN_QR_CODE`, `NOT_PAID`, `KEY_REJECTED`, `UNREACHABLE`, `CHANNEL_MISSING` …), решение 321 теми же правилами, что у WAHA; `unknown` — Wazzup «сказать нельзя» (нет ключа, 429, нечитаемый ответ): серия и тревоги не трогаются |
| `reconcile_status` (`not_due`/`evo_only`/`ok`/`transport_inactive`/`failed`), `reconcile_day`, `reconcile_evo`, `reconcile_amo`, `reconcile_verdict` | **сверка** за прошлые сутки по Бишкеку, окно 00:10–06:00; расхождение «в EVO меньше» больше `max(3, 2 %)` открывает тревогу вида `gap` (`COUNTS_GAP`), сошлось — закрывает `counts_match` |
| `transport`, `reason`, `transport_mismatch` | слово пути в базе; `reason: transport_mismatch` и слово расхождения (таблица выше); при `disabled` — `reason: ingress_off` |
| `status` (`ok`/`degraded`/`failed`/`disabled`) | сводка блока; `failed` даёт код выхода 1 |

Состояние `transport_inactive` значит «путь сейчас не Wazzup»: Wazzup не опрашивается и серия не пишется. Если прочитать путь не
удалось (база не ответила или ответ не той формы), закрытый стоп даёт `failed`, а открытый — `failed` у шагов, которым путь нужен
(здоровье и сверка); догрузка от чтения пути не зависит и идёт сама.

`status: degraded` кроме перечисленного ставят: шаг, пропущенный из-за общего бюджета времени (`health_status: skipped`,
`reconcile_status: skipped`; серия 321 за этот проход не записана), и запуск ИИ-агентов, не уложившийся в срок
(`sweep_ai_dispatch: deadline`). Запуск ИИ идёт **после** трёх шагов и ждёт не дольше 15 секунд: медленный Claude API не
отнимает время у здоровья и сверки; события уже спроецированы, агент увидит чат по «неотвеченным».

## 9. Откат (план §13)

- **Быстрый (минуты, без выпуска):** `wazzup-ops webhooks-patch --off`, затем `wazzup-ops transport none`. Маршрут отвечает
  `503 transport_inactive`, ИИ и интерфейс — как до Wazzup, беседы Wazzup остаются неотправляемыми. Если `PATCH` не прошёл,
  приём всё равно закрыт базой; сообщения за это время есть в amoCRM. Ничего не удаляется.
- **Аварийный стоп:** выпуск в окне с `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=0` (процедура **Р**).
- **ИИ:** `wazzup-ops transport wazzup --ai-trigger off`.
- **Приложение:** откат образа возможен только на выпуск шага 2 раздела 5 или новее — см. правило в
  [`deploy/production-release.md`](../../deploy/production-release.md) §7. Перед откатом (только чтение):
  ```sql
  SELECT count(*) AS wazzup_conversations FROM platform.communication_conversations WHERE wazzup_channel_id IS NOT NULL;
  ```
  Больше нуля и цель старше выпуска с Wazzup — **откат запрещён**: образ без поддержки Wazzup не прочитает очередь (строгая
  форма сводки беседы). Обёртка отката к Supabase не обращается и этого не проверит.
- **База:** только вперёд; значение enum не удаляется. `transport none` возвращает агентам и интерфейсу прежнее поведение.

**Ротация токена:** записать `…_TOKEN_NEXT` (раздел 3), выпуск; `webhooks-patch --on --token next`; убедиться в приёме
(`webhooks-get` показывает `token: next`, в журнале идут `wazzup_inbound … slot next`); перенести значение в `…_TOKEN`, убрать
`…_NEXT`, выпуск; `webhooks-patch --on`.

## 10. Отличия от плана и что не сделано

Подробная запись с причинами — `docs/PLAN_CHANGES.md`, «2026-10-27 · WhatsApp через Wazzup: отклонения срезов W1–W3 и дополнения этапа 1
(миграция 326)». Здесь — то, что важно оператору.

1. **`replay`** принимает **номера событий** (раздел 4), как в плане §5.6 и A6; пакет со stdin убран (он мог бы занести в приём
   выдуманные «проверенные» события). Читающая функция — `whatsapp_intake_events_read_v1` (326).
2. **`/metrics` и `/api/readiness`.** Метрика `evo_platform_wazzup_oldest_pending_seconds` и «деградация» в readiness **не
   сделаны**: контракт сигналов `p7b-v1` (`platform_operational_signals_v1`, точный набор ключей в SQL и в
   `platform-operational-signals.ts`) закрыт, а возраст самого старого необработанного событию Wazzup читается только
   из `wazzup_projection_sweep_v1`. Возраст пишется в строку каждого прохода таймера (`oldest_pending_seconds`, `backlog:
   degraded` старше 30 минут). Для readiness нужна новая версия контракта сигналов (отдельная миграция и разбор). До этого
   «деградацию» видит оператор по журналу таймера (`journalctl -u evo-whatsapp-health`).
3. **Сверка с amoCRM.** Сравнение и тревога `gap` готовы и проверены, но чтение числа входящих чатов из amoCRM не
   подключено (нет решения владельца, вопрос 16, и настроенного провайдера только для чтения): шаг пишет только число EVO
   (`reconcile_status: evo_only`), сверку первые 7 дней делает агент вручную.
4. **Состояние «env `0`, транспорт `wazzup`»** (строка 4 таблицы плана §9) отражено в отчёте таймера (`degraded`,
   `transport_mismatch: env_wazzup_off_db_wazzup`, раздел 8) и тревогой «молчит» через 3 рабочих часа; «деградации» в
   `/api/readiness` нет (пункт 2). Условие: токен вебхука остаётся в env (его не удалять при аварийном стопе, а ставить только
   `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=0`).
5. **Расхождение «env Wazzup `1`, путь в базе `waha`»** (строка 3 таблицы §9) теперь называется в отчёте таймера:
   `degraded`, `transport_mismatch: env_wazzup_on_db_waha` (закрыто миграцией 326; раньше `none` и `waha` были неразличимы).
   В `/api/readiness` его по-прежнему нет (пункт 2). Блок молчит, пока в env нет ни открытого стопа, ни токена Wazzup: путь
   `waha` при выключенном приёме WAHA в таком окружении он не назовёт (приём WAHA — забота шага WAHA и «Настроек»).
6. **Повторы пакетов самим Wazzup и счётчики.** Элемент другого канала или группа не сохраняется и ключа дедупа не имеет, поэтому
   повторная доставка того же пакета Wazzup учитывает такой элемент в суточных счётчиках заново (`inboundTotal` чуть больше).
   Допуск суточной сверки `max(3, 2 %)` это переносит; `wazzup-ops replay` (пункт 1) на счётчики не влияет, потому что повторяет
   только сохранённое. Исправление потребовало бы строки на каждый отфильтрованный элемент — не делается без данных о том, повторяет ли Wazzup
   вебхуки вообще (вопрос 17 плана).
7. **Интерфейс** (разбор сводки беседы с `waha_session_name = null`, карточка «Настройки» с последними 4 цифрами номера
   канала, «Скопировать текст») — срез W3 и миграция 326 (`last4` в `staff_whatsapp_transport_v1`).

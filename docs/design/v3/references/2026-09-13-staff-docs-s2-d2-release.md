# S2/D2: принятый выпуск и границы проверки

Проверено13.09.2026,17:25–17:32UTC. Это техническая приёмка общего выпуска,
не подтверждение подключения реальной команды, обработки Gemini или переноса
EVO Docs. Исторический [S1/D1](2026-09-13-staff-docs-release.md) не заменяет этот снимок.

## Что выпущено

Редактируемые роли и назначения с областями доступа S2; частичная анкета,
ручная проверка полей и Student Profile DOCX D2. Managed schema001–161 уже
применена/сверена в34765867429/34765967956; нового SQL в исправлении PR761 нет.

| Доказательство | Значение |
|---|---|
| Точный main / версия | `05585020a411111939a72c4121c66369839a066b` / `r59.1-05585020` |
| Reviewed correction | [PR761](https://github.com/izzhackt/evo_AI_CRM/pull/761), head `a495dce7e089ce9408fc6cd1e7b7ed097bf3dda3` |
| Полный exact-main CI | [34770582933](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34770582933), SUCCESS |
| Выпуск | [34771170873](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34771170873), SUCCESS; `v3-r34771170873-a1-05585020` |
| Образ | `sha256:49543bbc8a1c910fcd33b317c3e8f8ca8e92fbee1a5960b4bd62e93221120fc4` |
| Контейнер приложения | `c3dcb120a66410e77b74557ccfa523848b54c772ee35318684d5466628b4baab` |
| Accepted pointer SHA256 | `9c15d2f20381dfae184b7678ebdb590f81814bfecc72b617d401351846d1a839` |
| Acceptance record SHA256 | `f9259e70b54048a937d9d9bc167b3e22f8bc873b4d1fc56e4d790f47e6aef9e5` |
| Browser receipt SHA256 | `e958e7b54906154a1cc4fe8ec539e8bc67370dc3ae95a018eb4450d7844cc832` |
| Compose snapshot SHA256 | `6cf9d7a609779a457ae19fd3a6cecee20a27fd0353829cc5c96a310474719d35` |
| App env snapshot SHA256 | `52833fe395edc2e1cebbc156044a77506490b3e5bc7355498ab7d4c98d779b0b` |

Independent readback проверил `/opt/evo-crm/release-evidence/current-v3-accepted.json`
и связанный record: ожидаемые schema/revision/run IDs, регулярные файлы0600 без
symlink за пределами evidence root, совпадение хешей env/compose/browser. Short
candidate container ID разрешён через Docker и совпал с полным ID работающего
приложения; revision label/image/health совпали. `pending-current.json` отсутствует,
pointer не изменился за проверку, app healthy/0 restarts/без публичных портов.

Сохранены без пересоздания: `evo-crm-waha-1` (`0d1017e3304d…`, image `dc134637…`,
volume `evo-crm_evo_crm_waha_sessions`) и `evo-crm-clamav-1` (`7242869f04f4…`,
image `6c92171e…`, volume `evo-crm_evo_crm_clamav_signatures`). Это здоровье
контейнеров, не доказательство подключённого WhatsApp. Arm=false подтверждён
отдельным GitHub readback после завершённого выпуска.

## Что проверено в браузере

Полный CI включал настоящие Auth/DB/private Storage/scanner/browser сценарии,
в том числе scoped staff и D2. Сохранены исходные проверки и итоговая P4-сверка;
в основной группе18 PASS и2 существующих условных skip, не «все20 выполнены».
Release smoke отдельно подтвердил настоящий Admin login, dashboard и точную
authenticated `/api/version`; он не проверяет все действия каждой роли.

Дополнительный post-release flow: `http://localhost:3000/v3/settings?section=staff`
→ «Роли и права» → «Создать роль» → поиск разрешений `документ` → «Отмена».
Существующая Admin-сессия открыла список сотрудников; редактор показал шесть
разрешений группы «Документы» после поиска и вернулся в каталог без сохранения.

| UI-проверка | Результат |
|---|---|
| URL/title | PASS: localhost staff/roles; `V3 · Настройки \| EVO Admissions CRM` |
| Содержимое/overlay | PASS: реальные список и редактор, не пустая страница; framework overlay отсутствует |
| Console | Ошибок приложения в полученном журнале нет; два React130 из `chrome-extension://…/toolbar…js` относятся к расширению |
| Изображение | Inline screenshot реального desktop-редактора с отфильтрованными разрешениями просмотрен |
| Взаимодействие | PASS: открыть редактор, фильтровать, отменить; persisted writes не выполнялись |

После этого отдельная попытка перейти обратно к сотрудникам получила timeout
CDP Runtime.evaluate; URL остался roles. Это ограничение следующей проверки,
не доказательство падения приложения или успешного открытия формы приглашения.
Mobile, отправка приглашений и изменение назначений на production здесь не проверялись.
Browser plugin/skill не был доступен; использован документированный CUA Playwright
в существующем Chrome2, без смены профиля или auth bypass.

Туннель PID7065 остаётся loopback-only: `127.0.0.1:3000 → 172.16.8.4:3000` на
Hermes. Он не был перезапущен: адрес нового app остался прежним. Local `/api/health`
и публичный HTTPS health с Hermes вернули200. Локальный curl к HTTPS получил
CA-chain verification error; отключение TLS-проверки не использовалось и причина
локальной проверки сертификатов не установлена.

## Следующие действия

- [Команда](../employee-roles-accounts-run-plan.md): SMTP/отправитель, сверка людей,
  согласованные получатели и права, настоящее письмо и первый вход; затем остальные.
- [Docs](../evo-docs-unification-run-plan.md): D3 isolated runtime/provider и D4
  формы/пакеты, реальный разрешённый документ, D5 import/mapping, D6 приёмка/выключение.
- Не удалять отдельное EVO Docs и исходные данные по факту этого выпуска.
  Не повторять завершённый CI/релиз для prose-only обновления статусов.

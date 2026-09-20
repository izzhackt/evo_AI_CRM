# CRM-02a: настоящая локальная приёмка — 20 сентября 2026

Все перечисленные проверки выполнены в отдельном локальном Auth/PostgREST/
Postgres и Next, с обычными логинами и настоящими продуктовыми командами.
Проверки относятся к schema **001–208**, до последующего применения 209.
Это source/local evidence; managed SQL, production release, native iPhone
и провайдерская приёмка здесь не заявляются.

| Проверка | Результат |
|---|---|
| Разрешения | Sales Manager записывает; Sales/Admin без роли, Admissions и anonymous — отказ |
| Дата и месяц | Август, сентябрь и октябрь определяются датой продажи; UI переходит в фактический месяц |
| Продавец | Владелец лида сохраняется даже при записи другим менеджером |
| Повтор запроса | Та же запись, без дубликата |
| Дата не заполнена | RPC 22023; кнопка сохранения на 390 px недоступна |
| Исправление | Одна новая версия; причина в приватной истории; общий audit без свободного текста |
| Старый handoff | Нормальный путь создаёт одну запись; Admin без manager role получает 42501 |
| Конкурентный отзыв | Оба RPC наблюдались в ожидании блокировки; после отзыва запись отклонена, строка не меняется |
| Интерфейс | Desktop и 390 px; быстрый выбор не оставляет чужой preview; переход в дело работает |

Обычный Admin bootstrap и приглашение двух сотрудников через реальную форму,
local Mailpit и Auth callback проверены. Новые продажи не создавались прямым SQL.
Guarded helper привязал одну опубликованную локальную роль; удалённый Docker,
некорректный UUID и повторное связывание отвергнуты. Временные назначения сняты,
исходные назначения менеджера восстановлены. Одноразовый контур пока сохранён
для отдельной проверки B.

Полная привязка к исходникам, снимкам и ограничениям ниже. Файл — документация
проверки; продукт не загружает и не исполняет эти данные.

```json
{
  "schemaVersion": 1,
  "verifiedAt": "2026-09-20T17:29:46.690Z",
  "scope": "disposable local technical acceptance only",
  "sourceHead": "ebf3bb664fc01157811572c033867d4dfa8dbfe9",
  "runtimeUnchangedSince": "d7067bc3e0c673cc850fb4ec877e7d234b2528e9",
  "projectId": "evo-local-0fd3559d0240c989",
  "migrations": "001-208 inclusive; 207 copied only into disposable stack",
  "runtimeFiles": [
    {
      "path": "src/components/v3/SalesRegisterForms.tsx",
      "sha256": "70ad2580c4fd5d1fca3cf5355e42e6e36a48c355913caefb0e28c5e6144653ab"
    },
    {
      "path": "src/components/v3/SalesRegisterView.tsx",
      "sha256": "8bd1b0ab9ef4c1ec041c57f6e0516f12fa40fa41af5d197903eadf3bad24962d"
    },
    {
      "path": "src/lib/platform-sales-register-actions.ts",
      "sha256": "e3fa1f3641d826b24ed59750c33a29d4d8d8d12be4087f0e5ac135a8a2d63e51"
    },
    {
      "path": "src/lib/v3/sales-register-source.ts",
      "sha256": "f7b6779f3952ed32c3b27b68f2e3c88ae75a79f99f6cf5367e8c3ee61a929fd1"
    },
    {
      "path": "supabase/migrations/208_platform_sales_recording_contract.sql",
      "sha256": "419b3a37c4278c6bdc00ec18fa311f5e06ba78f316e61ae17bbe7e6a3d3f16d7"
    }
  ],
  "managerSetup": {
    "path": "scripts/bind-local-sales-manager.mjs",
    "sha256": "fa81ab569f6d7d1fe36955487eb726cb4ac29935deacbaec4e089766f131bb29",
    "reviewed": true,
    "changedRows": 1,
    "remoteInvalidAndDuplicateGuards": "rejected"
  },
  "checks": {
    "realAdminBootstrap": true,
    "realStaffFormMailAuthOnboarding": 2,
    "roleGates": [
      "Sales Manager allowed",
      "Admin without manager denied",
      "Admissions denied",
      "anonymous denied",
      "Sales without manager denied"
    ],
    "previousMonthUi": "September filter -> August signing date -> August saved report",
    "currentMonthRpc": "August argument -> September signing date -> September report",
    "followingMonthMobileUi": "September filter -> October signing date -> October saved report",
    "seller": "lead owner, different from recording manager",
    "replay": "same record, one row",
    "missingDate": "22023 and disabled mobile Save",
    "history": "one version increment, private reason preserved, shared audit generic",
    "rapidSelection": "final lead and date match",
    "mobile": {
      "viewport": 390,
      "documentWidth": 390,
      "openCase": true
    },
    "legacyHandoff": "normal path, Admin without manager 42501, manager saved one August row",
    "concurrency": "both RPCs observed blocked; earlier role revoke commits; waiting write denied 42501; version/content unchanged",
    "revokedRoleUi": "new form/create link absent for Sales and Admin; baseline restored"
  },
  "screenshots": [
    {
      "name": "sales-admin-denied.png",
      "sha256": "90f9c34aa1103e9118296b841e4615d732692bec0f3e53c96775baf40d4eae20"
    },
    {
      "name": "sales-create-before.png",
      "sha256": "dbb5c0d86849a20ca2ddb5731a3b20abb0a28dae0a9cd5f0c865ae78a40e9b3f"
    },
    {
      "name": "sales-mobile-following-ready.png",
      "sha256": "7b9b2f3120ea349056355e199bcb905dbf3e3a6b3ae313e47b5f8495a7e424f6"
    },
    {
      "name": "sales-mobile-following-saved.png",
      "sha256": "bebcde1f4968bd95e09f9734ff70f56d9df7b2cec813d79f22398d3744a076d6"
    },
    {
      "name": "sales-mobile-missing-date.png",
      "sha256": "e9fae4eaeba20ecd71527776d29ba61a1156b0a8621d5bb0c4ecc846c28e07d3"
    },
    {
      "name": "sales-mobile-open-case.png",
      "sha256": "ff706c0d45e4da4925a1c94a32386ffff5d89e3019dfa1191a45d1bd6a913ca7"
    },
    {
      "name": "sales-previous-ready.png",
      "sha256": "6b3f089d7a9f8d5d37060f37859d8f1e5f7e80b1418a4c40a34b6cd4aace72bd"
    },
    {
      "name": "sales-previous-saved.png",
      "sha256": "c81e22a25deece4dac17ce7e1b9732848e9094424d02a6ad9055140a097ad78d"
    },
    {
      "name": "sales-sales-denied.png",
      "sha256": "1e1c0154a859488a96c8549cf16c843ab21325a388e4840963e8e06543480b6e"
    }
  ],
  "evidenceDirectory": "/private/tmp/evo-database-foundation.WhSt8z",
  "limitations": [
    "No managed SQL or production rollout",
    "No provider transaction or customer acceptance",
    "Next development server; browser 1440px and 390px, not native iPhone",
    "Student public approval scope defect tracked separately for migration 209; no manual repair"
  ],
  "localRuntime": {
    "node": "22.23.1",
    "supabaseCli": "2.116.0",
    "postgresImage": "public.ecr.aws/supabase/postgres:17.6.1.165"
  }
}
```

---
target: ios/EVOAdmissions/Views/UniversityDetailView.swift
total_score: 24
max_score: 36
na_heuristics: 5 unverified
p0_count: 0
p1_count: 0
target_identity: "file:/Users/iskhak.tazhibaev/.codex/worktrees/ios-university-refinement/evo_AI_CRM/ios/EVOAdmissions/Views/UniversityDetailView.swift"
target_fingerprint: "sha256:abe39d4b3ae06f6c9c946db18781ee31e3913e27f4c6f33899add50c8187c0c0"
target_path: /Users/iskhak.tazhibaev/.codex/worktrees/ios-university-refinement/evo_AI_CRM/ios/EVOAdmissions/Views/UniversityDetailView.swift
timestamp: 2026-09-20T01-41-11Z
slug: ios-evoadmissions-views-universitydetailview-swift
closed: true
---
# Impeccable: карточка университета iPhone

Method: dual-agent (A: /root/university_design_a · B: /root/university_evidence_b)

Target: `ios/EVOAdmissions/Views/UniversityDetailView.swift`.
Base: `485f3ce0cca7e2d336306cddde437b20dcf3e1ee`. 2026-09-20.
Evidence: real iPhone 17 Pro / iOS 26.5 Simulator, signed-in EVO QA Student,
AGH University of Krakow; screenshot of the top viewport and source inspection.
The two initial capture files showed the same viewport. Lower program/intake
layout findings are source-derived; no rendered lower-section proof yet.
No synthetic personas or user research. HTML detector is inapplicable to SwiftUI.

## Оценка

| Эвристика | 0–4 | Основание |
|---|---:|---|
| Видимость состояния | 3 | Loading/error/retry в коде, дата проверки видима |
| Соответствие реальному миру | 3 | Предметные данные, но служебная подпись источника |
| Контроль и свобода | 3 | Native back, избранное, консультационный sheet |
| Последовательность | 3 | Native компоненты, вложенные поверхности в коде |
| Предотвращение ошибок | unverified | Записи и отправка не проверены |
| Узнавание | 2 | Основные программы требуют прокрутки |
| Эффективность | 2 | Нет перехода к программам |
| Минимализм | 2 | Повторы, источники перед предметным содержанием |
| Восстановление | 3 | Retry и ошибка обновления предусмотрены кодом |
| Помощь | 3 | Консультация и официальные источники |

24/36, один пункт unverified. Экспертная оценка структуры, не доказательство
готовности продукта. Когнитивная нагрузка умеренная: слабая иерархия,
недостаточное раскрытие деталей по запросу, конкурирующие внешние действия.
Фото вызывает интерес, источники дают уверенность, поздние программы
затрудняют переход к осознанному выбору.

## Сильные стороны

- Реальное фото, авторство/лицензия и проверяемые источники.
- Красный EVO CTA и нативные навигация, избранное, sheet.
- Честные loading/error/empty состояния в коде; предметные даты и статусы.

## Priority Issues

1. P2: программы начинаются у нижнего tab bar после фото, подписей, описания,
   CTA и блока источников. Добавить быстрый переход с реальным количеством,
   перенести источники после программ. Верх подтверждён скриншотом.
2. P2: мелкие бледные подписи и неочевидные ссылки атрибуции. По B оценка
   растра около 3.44:1 для подписи и 2.78:1 для даты на material; это оценка
   пикселей, не сертификация. Собрать атрибуцию в native DisclosureGroup,
   сохранить автора, лицензию, источник, подпись и уведомление о кадрировании;
   использовать читаемый foreground и отдельные ссылки с большими targets.
3. P2: CTA/ссылки не имеют явного минимума 44pt; горизонтальные подписи
   автора и факты программы уязвимы к крупному тексту/длинному KY.
   Добавить полные нажимаемые строки и адаптивное расположение фактов.
   Размеры hit bounds до изменения не измерены; риск переноса из кода.
4. P2: программа и каждый набор имеют отдельные вложенные фоны; заголовки
   без явных accessibility heading traits. Оставить одну поверхность на
   программу, разделители между наборами, heading traits. Не менять расчёт
   дедлайнов, timezone, статуса или предметные данные. Источник: код.

Questions skipped: владелец уже поручил составить план и выполнить точечную
доработку; направление и границы определены контрактом EVO.

## План

1. Зафиксировать контракт до кода: одна карточка, RU/KY, реальные данные.
2. Изменить иерархию, раскрытие атрибуции, 44pt targets, адаптивные факты.
3. Собрать приложение; установить поверх текущего без удаления QA-сессии.
4. Проверить реальный путь каталога и действия чтения, light/dark и крупный
   текст в iPhone Simulator. Запрос консультации не отправлять.
5. Записать ограничения доказательств и провести независимый review PR.

Рекомендованные операции: scope-local polish/clarify по этому snapshot.
Общий E2E, контентная волна и App Store readiness отложены владельцем.

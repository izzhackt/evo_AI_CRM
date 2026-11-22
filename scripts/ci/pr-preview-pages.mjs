// Страницы проверки preview и их якоря (используются scripts/ci/pr-preview.mjs; форму якорей стережёт тест).
// anchor.testIds: хотя бы один из них виден (содержимое страницы, а не скелет loading.tsx).
// finalPath: куда страница обязана привести (старые закладки `/admissions-requests` перенаправляют на `/requests`).
export const STAFF_PAGES = [
  { path: "/main", anchor: { testIds: ["v3-operational-dashboard"] } },
  // «Все в работе · 1»: засеянное дело; запасной вид каталога студентов имеет тот же testid, но не `v3-students-next`.
  { path: "/profile", anchor: { testIds: ["v3-students-next"], text: ["Все в работе · 1"] } },
  { path: "/profile?view=active", anchor: { testIds: ["v3-students-next"], text: ["Тест Сопровождаемый"] } },
  // Устаревшая доска `Pipeline.tsx` тоже называется v3-pipeline-board; карточка и засеянный лид есть только у новой.
  { path: "/pipeline", anchor: { testIds: ["v3-pipeline-card"], text: ["Тест Приглашённый"] } },
  { path: "/admissions-requests", finalPath: "/requests", anchor: { testIds: ["v3-requests", "requests-queue"], text: ["Ждут разбора"] } },
  { path: "/calendar", anchor: { testIds: ["v3-calendar-next", "v3-calendar-week-strip"] } },
  { path: "/tasks", anchor: { testIds: ["v3-tasks-next", "task-queue-next"] } },
  { path: "/finance", anchor: { testIds: ["v3-sales-summary"], text: ["Отчёт продаж"] } },
  { path: "/finance?tab=debts", anchor: { testIds: ["v3-student-debts"], text: ["договоры 1 000 USD, оплачено 400 USD"] } },
  // Каркас страницы (`UniversityFrame`) есть и у пустого списка: проверяем засеянные вузы.
  { path: "/universities", anchor: { testIds: ["v3-universities-next"], text: ["Test University Alpha", "Test University Beta", "Test University Gamma"] } },
];
export const STUDENT_PAGES = [
  { path: "/portal", anchor: { role: "heading", name: /Что сделать сейчас|Ваша анкета|Моё поступление/u } },
  { path: "/portal/documents", anchor: { role: "heading", name: /Список документов пока пуст|Чеклист/u } },
];

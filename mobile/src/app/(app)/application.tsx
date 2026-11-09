import { ApplicationStatusScreen } from "@/features/registration/ApplicationStatus";

/**
 * Своя анкета вошедшего студента, только чтение (веб /apply/status, ссылка «Открыть анкету» на «Главной» у approved).
 * Тот же экран статуса M7, что и в шлюзе, но без «Открыть кабинет», «Выйти» и исправления: кабинет уже открыт.
 */
export default function ApplicationRoute() {
  return <ApplicationStatusScreen application={{ status: "approved" }} readOnly />;
}

import {
  logoutStudentPortalAction,
  refreshStudentPortalAccessAction,
} from "@/lib/student-portal-auth-actions";
import { btnCls, btnGhostCls } from "@/components/ui";

export function StudentAccountPending() {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <form action={refreshStudentPortalAccessAction}>
        <button type="submit" className={`${btnCls} w-full`}>
          Проверить доступ
        </button>
      </form>
      <form action={logoutStudentPortalAction}>
        <button type="submit" className={`${btnGhostCls} w-full`}>
          Выйти
        </button>
      </form>
    </div>
  );
}

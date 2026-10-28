"use client";

import { EyeIcon } from "lucide-react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { selectStaffRolePreviewAction } from "@/lib/staff-auth-actions";
import { roleTitle } from "@/lib/v3/wording";

/** «Посмотреть интерфейс роли»: администратор видит экран «Продаж» или «Поступления», оставаясь собой (тот же `selectStaffRolePreviewAction`). */
export function RolePreview() {
  return (
    <span data-testid="staff-role-preview">
      <DetailSheet
        title="Интерфейс роли"
        help="Меняется только вид. Вы остаётесь Администратором."
        trigger={<Button variant="outline"><EyeIcon aria-hidden="true" />Посмотреть интерфейс роли</Button>}
      >
        <form action={selectStaffRolePreviewAction} className="flex flex-wrap gap-2" data-testid="admin-role-preview">
          {(["sales", "admissions"] as const).map((role) => (
            <Button key={role} type="submit" name="role" value={role} variant="outline" data-testid={`preview-role-${role}`}>{roleTitle(role)}</Button>
          ))}
        </form>
      </DetailSheet>
    </span>
  );
}

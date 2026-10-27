import { Checkbox } from "@/components/ui/checkbox";

/**
 * «Выбрать все» для телефона (<768 px): карточки без шапки, а флажок в шапке таблицы там скрыт. Над карточками стоит флажок с тем же
 * названием для читалки (`label`) и короткой видимой подписью (`text`, часть названия); на широком экране его нет — там флажок шапки таблицы.
 */
export function PhoneSelectAll({ label, text, checked, onChange }: Readonly<{ label: string; text: string; checked: boolean; onChange: (on: boolean) => void }>) {
  return (
    <label className="flex min-h-11 w-fit items-center gap-3 t-label text-fg-2 md:hidden">
      <Checkbox aria-label={label} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      {text}
    </label>
  );
}

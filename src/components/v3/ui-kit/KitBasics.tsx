"use client";

import { useState } from "react";

import { SectionTabs, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Кнопки, поля, выбор, переключатели, окно, меню и подсказка — примитивы shadcn/ui в токенах EVO. */
export function KitBasics() {
  const [on, setOn] = useState(true);
  return (
    <WidgetCard title="Кнопки и поля" help="Красная кнопка — одно главное действие страницы. Остальные нейтральные. Все нажимаемые — не меньше 44 px.">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Главное действие</Button>
          <Button variant="outline">Обычная</Button>
          <Button variant="ghost">Тихая</Button>
          <Button variant="destructive">Удалить</Button>
          <Button disabled>Недоступна</Button>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="outline" size="icon" aria-label="Подсказка по значку">i</Button></TooltipTrigger>
            <TooltipContent>Имя действия у значка без подписи</TooltipContent>
          </Tooltip>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-1"><Label htmlFor="kit-name">Имя</Label><Input id="kit-name" placeholder="Тест Синтетический" /></div>
          <div className="grid gap-1"><Label htmlFor="kit-err">Телефон</Label><Input id="kit-err" aria-invalid defaultValue="+000" /><p className="t-meta text-danger">Не хватает цифр</p></div>
          <div className="grid gap-1">
            <Label htmlFor="kit-stage">Этап</Label>
            <Select defaultValue="work"><SelectTrigger id="kit-stage"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="new">Новая</SelectItem><SelectItem value="work">В работе</SelectItem><SelectItem value="done">Готово</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1"><Label htmlFor="kit-note">Заметка</Label><Textarea id="kit-note" placeholder="Коротко, по делу" /></div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex min-h-11 items-center gap-3 t-body-compact"><Checkbox defaultChecked /> Флажок</label>
          <label className="flex min-h-11 items-center gap-3 t-body-compact"><Switch checked={on} onCheckedChange={setOn} /> Переключатель</label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Окно</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Удалить запись?</DialogTitle><DialogDescription>Действие нельзя отменить.</DialogDescription></DialogHeader>
              <DialogFooter><Button variant="outline">Отмена</Button><Button variant="destructive">Удалить</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline">Меню</Button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem>Открыть</DropdownMenuItem><DropdownMenuItem>Назначить</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive">Удалить</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SectionTabs label="Вкладки на месте" tabs={[{ key: "a", label: "Первая", content: <Skeleton className="h-10 w-full" /> }, { key: "b", label: "Вторая", count: 2, content: <p className="t-body-compact">Содержимое второй вкладки.</p> }]} />
      </div>
    </WidgetCard>
  );
}

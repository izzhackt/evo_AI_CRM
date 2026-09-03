"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/v3/Pill";

import { Card } from "./Card";
import type { DocumentGroup } from "./types";

/**
 * Документы студента: список, который составляет сам сотрудник.
 *
 * Раньше здесь стояли пятнадцать зашитых строк с готовыми именами, и у
 * каждой было только «есть / нет». Знаменатель «15» не значил ничего: чеклиста
 * требуемых документов не существует ни в модели, ни в жизни — набор зависит
 * от страны, программы и вуза, и решает его человек.
 *
 * Поэтому список живой. Со страницы приходит **заготовка** — то, что нужно
 * всем, в трёх группах. Одна на всех: под страну и под программу она не
 * подстраивается, это делает сотрудник, добавляя и убирая пункты руками.
 * Отсюда и честный знаменатель: M — длина текущего списка, а не число,
 * взятое с потолка.
 *
 * СОСТОЯНИЙ РОВНО ДВА: файла нет и файл есть. «Запросили» и «не подошёл» не
 * заводим — годность проверяют в переписке, а в карточку кладут уже то, что
 * подошло.
 *
 * ФАЙЛ НАСТОЯЩИЙ. Загрузка — обычный `input type="file"`, скачивание отдаёт
 * ровно тот файл, который выбрали, через объектный URL. Файл живёт в
 * состоянии страницы и на сервер не уезжает: хранилище догоняет следом.
 * Поэтому заготовка приходит без приложенных файлов — имя файла, к которому
 * не привязан сам файл, было бы нарисованной галочкой.
 */

/** Приложенный файл. Только тот, что выбрали здесь же, в браузере. */
type Attached = Readonly<{ file: File; at: string }>;

type LiveItem = Readonly<{ id: string; name: string; attached: Attached | null }>;
type LiveGroup = Readonly<{ title: string; items: readonly LiveItem[] }>;

/**
 * Список живёт вне компонента и помнится по человеку.
 *
 * Вкладки профиля — ссылки, поэтому уход на «Деньги» размонтирует эту вкладку.
 * Пока список лежал в состоянии компонента, каждый такой уход стирал всё, что
 * сотрудник успел сделать: добавленные пункты, переименования и приложенные
 * файлы. Ключ — человек: у двух студентов списки разные, и открыть второго не
 * должно значить увидеть документы первого.
 *
 * Это по-прежнему состояние страницы, а не хранилище: перезагрузка его не
 * переживает — ровно как сам файл, который никуда не уезжает.
 */
const KEPT = new Map<string, readonly LiveGroup[]>();

/** Счётчик добавленных пунктов — модульный, чтобы id не повторился после
 *  возврата на вкладку с восстановленным списком. */
let added = 0;

function seed(template: readonly DocumentGroup[]): readonly LiveGroup[] {
  return template.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({ id: item.id, name: item.name, attached: null })),
  }));
}

const INPUT =
  "min-h-11 min-w-0 flex-1 basis-40 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg placeholder:text-fg-3";
const SOLID =
  "inline-flex min-h-11 shrink-0 items-center rounded-ctl bg-accent px-3 text-xs font-semibold text-on-accent disabled:opacity-50";
// Граница здесь — единственный признак кнопки, поэтому она контрольного веса
// (≥3:1), а не волосяная рамка панели.
const GHOST =
  "inline-flex min-h-11 shrink-0 items-center rounded-ctl border border-control-edge bg-surface px-3 text-xs text-fg-2 hover:border-fg-2 hover:text-fg";
const ICON_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg-2";

/** Сегодняшнее число «02.09». Считается только по нажатию, не при отрисовке. */
function today() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- форма имени */

/**
 * Поле имени с двумя кнопками — одинаковое у переименования и у добавления.
 *
 * Значение управляемое: `required` пропускал строку из пробелов, и тогда
 * обработчик молча ничего не делал, а форма оставалась открытой без единого
 * признака, почему. Теперь кнопка отправки просто погашена, пока имя пустое.
 */
function NameForm({
  label,
  initial,
  placeholder,
  submit,
  onSubmit,
  onCancel,
  cancelRef,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  submit: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const fieldId = useId();
  const [value, setValue] = useState(initial);
  const clean = value.trim();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (clean) onSubmit(clean);
      }}
      // Escape закрывает форму — так же, как в файловом менеджере.
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <input
        id={fieldId}
        // Поле открылось по нажатию: курсор должен быть уже в нём.
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        className={INPUT}
      />
      <span className="flex shrink-0 items-center gap-2">
        <button type="submit" disabled={!clean} className={SOLID}>
          {submit}
        </button>
        <button ref={cancelRef} type="button" className={GHOST} onClick={onCancel}>
          Отмена
        </button>
      </span>
    </form>
  );
}

/* -------------------------------------------------------------- одна строка */

function Row({
  item,
  onRename,
  onRemove,
  onPickFile,
}: {
  item: LiveItem;
  onRename: (name: string) => void;
  onRemove: () => void;
  onPickFile: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "confirm">("idle");
  const nameRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Возврат фокуса после формы: без него фокус уходит в никуда и человек
  // теряет место в списке. Флаг нужен, чтобы не хватать фокус при первой
  // отрисовке строки.
  const restore = useRef(false);

  useEffect(() => {
    // Нажатая кнопка «Удалить документ» размонтируется вместе с обычным видом
    // строки, поэтому фокус надо перенести руками — иначе он падает в body и
    // читалка молчит о том, что спросили подтверждение.
    if (mode === "confirm") {
      confirmRef.current?.focus();
      return;
    }
    if (mode === "idle" && restore.current) {
      restore.current = false;
      nameRef.current?.focus();
    }
  }, [mode]);

  const back = () => {
    restore.current = true;
    setMode("idle");
  };

  if (mode === "rename") {
    return (
      <li className="border-b border-border px-4 py-2 last:border-b-0">
        <NameForm
          label="Новое название документа"
          initial={item.name}
          submit="Сохранить"
          onSubmit={(name) => {
            onRename(name);
            back();
          }}
          onCancel={back}
        />
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 last:border-b-0"
        onKeyDown={(event) => {
          if (event.key === "Escape") back();
        }}
      >
        {/* Имена не обрезаются: человек должен видеть, что именно удаляет.
            Поэтому перенос по буквам — длинное неразрывное имя файла иначе
            вылезает за карточку и даёт боковую прокрутку на 393px. */}
        <p className="min-w-0 flex-1 basis-40 break-words text-sm text-fg">
          Удалить «{item.name}» вместе с файлом {item.attached?.file.name}?
        </p>
        {/* Пара кнопок переносится целиком: на 393px «Удалить» и «Отмена»
            разъезжались по разным строкам. */}
        <span className="flex shrink-0 items-center gap-2">
          <button ref={confirmRef} type="button" className={SOLID} onClick={onRemove}>
            Удалить
          </button>
          <button type="button" className={GHOST} onClick={back}>
            Отмена
          </button>
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 last:border-b-0">
      {/* Имя уступает последним: сжимаются подпись под ним и кнопки, а не
          название документа. */}
      <div className="min-w-0 flex-1">
        <button
          ref={nameRef}
          type="button"
          title="Переименовать"
          onClick={() => {
            restore.current = true;
            setMode("rename");
          }}
          className="block max-w-full truncate rounded-nav py-1 text-start text-sm text-fg hover:underline"
        >
          <span className="sr-only">Переименовать </span>
          {item.name}
        </button>
        {item.attached ? (
          <p className="truncate font-mono text-2xs text-fg-3">
            {item.attached.file.name} · {item.attached.at}
          </p>
        ) : null}
      </div>

      <Pill tone={item.attached ? "ok" : "neutral"}>{item.attached ? "есть" : "нет"}</Pill>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onPickFile}
          title={item.attached ? "Заменить файл" : "Загрузить файл"}
          className={ICON_BUTTON}
        >
          <span className="sr-only">
            {item.attached ? "Заменить файл у" : "Загрузить файл к"} «{item.name}»
          </span>
          <Icon name="upload" size={15} />
        </button>

        {item.attached ? (
          // Кнопка, а не ссылка: адреса у файла нет, есть действие. Ссылка с
          // `href="#"` притворялась бы переходом и ломала бы средний клик.
          <button
            type="button"
            onClick={() => {
              if (!item.attached) return;
              const url = URL.createObjectURL(item.attached.file);
              const link = document.createElement("a");
              link.href = url;
              link.download = item.attached.file.name;
              document.body.append(link);
              link.click();
              link.remove();
              // Освобождаем после того, как браузер забрал файл: снять URL в
              // том же такте — оборвать скачивание в части браузеров.
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            title="Скачать файл"
            className={ICON_BUTTON}
          >
            <span className="sr-only">Скачать файл «{item.attached.file.name}»</span>
            <Icon name="download" size={15} />
          </button>
        ) : null}

        <button
          type="button"
          // Файл уже приложен — спрашиваем. Пустой пункт удаляется сразу:
          // подтверждать нечего, потерять нечего.
          onClick={() => (item.attached ? setMode("confirm") : onRemove())}
          title="Удалить документ"
          className={ICON_BUTTON}
        >
          <span className="sr-only">Удалить «{item.name}»</span>
          <Icon name="x" size={15} />
        </button>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- группа */

function Group({
  group,
  onAdd,
  onRename,
  onRemove,
  onPickFile,
}: {
  group: LiveGroup;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onPickFile: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  // Запасная цель для фокуса: пока открыта форма добавления, кнопки
  // «Добавить документ» в DOM нет, и уводить фокус было бы некуда.
  const spareRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  useEffect(() => {
    if (!adding && restore.current) {
      restore.current = false;
      addRef.current?.focus();
    }
  }, [adding]);

  const close = () => {
    restore.current = true;
    setAdding(false);
  };

  return (
    <Card title={group.title}>
      <ul>
        {group.items.map((item) => (
          <Row
            key={item.id}
            item={item}
            onRename={(name) => onRename(item.id, name)}
            onRemove={() => {
              // Строка сейчас исчезнет — уводим фокус на кнопку добавления,
              // а если открыта форма, то на её «Отмену»: иначе он падает в
              // никуда.
              (addRef.current ?? spareRef.current)?.focus();
              onRemove(item.id);
            }}
            onPickFile={() => onPickFile(item.id)}
          />
        ))}
      </ul>

      <div className={`px-4 py-2 ${group.items.length > 0 ? "border-t border-border" : ""}`}>
        {adding ? (
          <NameForm
            label={`Название документа в группе «${group.title}»`}
            initial=""
            placeholder="Название"
            submit="Добавить"
            cancelRef={spareRef}
            onSubmit={(name) => {
              onAdd(name);
              close();
            }}
            onCancel={close}
          />
        ) : (
          <button
            ref={addRef}
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-nav px-1 text-sm text-fg-2 hover:text-fg"
          >
            <Icon name="plus" size={15} />
            Добавить документ
            <span className="sr-only">в группу «{group.title}»</span>
          </button>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- вкладка */

export function Documents({
  groups: template,
  personId,
}: {
  groups: readonly DocumentGroup[];
  /** Чей это список. Ключ, по которому он переживает уход на другую вкладку. */
  personId: string;
}) {
  const [groups, setGroups] = useState<readonly LiveGroup[]>(
    () => KEPT.get(personId) ?? seed(template),
  );
  // Действия видны глазами сразу, а читалке — нет: список перерисовывается
  // молча. Одна область на вкладку проговаривает, что произошло.
  const [said, setSaid] = useState("");

  // Один выбор файла на всю вкладку: девять скрытых полей ради одного диалога
  // — девять лишних узлов. Кто именно ждёт файл, помнит ссылка.
  const fileRef = useRef<HTMLInputElement>(null);
  const waiting = useRef<{ group: number; item: string } | null>(null);

  const patch = (index: number, fn: (items: readonly LiveItem[]) => readonly LiveItem[]) =>
    setGroups((prev) => {
      const next = prev.map((group, i) =>
        i === index ? { ...group, items: fn(group.items) } : group,
      );
      KEPT.set(personId, next);
      return next;
    });

  const all = groups.flatMap((group) => group.items);
  const total = all.length;
  const have = all.filter((item) => item.attached !== null).length;
  const missing = total - have;

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {said}
      </p>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const target = waiting.current;
          const file = event.target.files?.[0] ?? null;
          // Сброс — чтобы тот же файл можно было выбрать второй раз.
          event.target.value = "";
          waiting.current = null;
          if (!target || !file) return;
          patch(target.group, (items) =>
            items.map((item) =>
              item.id === target.item ? { ...item, attached: { file, at: today() } } : item,
            ),
          );
          const to = groups[target.group]?.items.find((item) => item.id === target.item)?.name;
          setSaid(`Файл «${file.name}» приложен к «${to ?? ""}».`);
        }}
      />

      <Card
        title="Собрано"
        aside={
          total === 0 ? null : missing > 0 ? (
            <Pill tone="warn">не хватает {missing}</Pill>
          ) : (
            <Pill tone="ok">всё</Pill>
          )
        }
      >
        <p className="px-4 py-3">
          <span className="text-2xl font-bold tracking-[-0.02em] text-fg">{have}</span>
          <span className="text-sm text-fg-3"> из {total}</span>
        </p>
      </Card>

      {groups.map((group, index) => (
        <Group
          key={group.title}
          group={group}
          onAdd={(name) => {
            patch(index, (items) => [
              ...items,
              { id: `added-${added++}`, name, attached: null },
            ]);
            setSaid(`Добавлен документ «${name}» в группу «${group.title}».`);
          }}
          onRename={(id, name) => {
            const was = group.items.find((item) => item.id === id)?.name;
            patch(index, (items) =>
              items.map((item) => (item.id === id ? { ...item, name } : item)),
            );
            setSaid(`«${was ?? ""}» переименован в «${name}».`);
          }}
          onRemove={(id) => {
            const was = group.items.find((item) => item.id === id)?.name;
            patch(index, (items) => items.filter((item) => item.id !== id));
            setSaid(`Документ «${was ?? ""}» удалён из группы «${group.title}».`);
          }}
          onPickFile={(id) => {
            waiting.current = { group: index, item: id };
            fileRef.current?.click();
          }}
        />
      ))}
    </div>
  );
}

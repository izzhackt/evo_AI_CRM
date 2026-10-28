import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SORT_OPTIONS, type InboxView } from "@/components/v3/Inbox";
import { ChatLinkMenu } from "@/components/v3/chats-next/ChatLinkMenu";

/**
 * Поиск и «Сортировка» над списком диалогов. Поиск — обычная форма GET на тот же адрес (без JavaScript работает так же;
 * порядок «Неотвеченные» едет скрытым полем); лупа в поле и есть «Найти». Порядок — не фильтр: меняет порядок, а не состав.
 */
export function InboxNextSearch({ view }: Readonly<{ view: InboxView }>) {
  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      <form action="/v3/inbox" method="get" role="search">
        {view.sort === "unanswered" ? <input type="hidden" name="sort" value="unanswered" /> : null}
        <label htmlFor="v3-inbox-search" className="sr-only">Найти диалог</label>
        <div className="relative">
          <button
            type="submit"
            aria-label="Найти"
            className="absolute inset-y-0 start-0 inline-flex w-11 items-center justify-center rounded-ctl text-fg-3 hover:text-fg focus-visible:-outline-offset-2"
          >
            <SearchIcon aria-hidden="true" className="size-[18px]" />
          </button>
          <Input
            id="v3-inbox-search"
            name="q"
            type="search"
            enterKeyHint="search"
            maxLength={200}
            defaultValue={view.searchQuery ?? ""}
            placeholder="Имя, телефон или тема"
            className="ps-11"
          />
        </div>
      </form>
      <div className="flex" data-testid="v3-inbox-sort">
        <ChatLinkMenu
          label="Сортировка"
          valueLabel={SORT_OPTIONS.find((option) => option.sort === view.sort)?.valueLabel ?? null}
          options={SORT_OPTIONS.map((option) => ({ key: option.sort, label: option.label, href: view.sortHrefs[option.sort], selected: option.sort === view.sort }))}
        />
      </div>
    </div>
  );
}

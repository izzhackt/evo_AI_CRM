import { PortalDefinition, PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import type { PortalOverviewView as PortalOverviewViewModel } from "./types";

export function OverviewView({ view }: { view: PortalOverviewViewModel }) {
  if (view.stage === null && view.nextStep === null && view.curator === null) {
    return (
      <PortalEmptyState
        title="План поступления пока не опубликован"
        description="Здесь появятся текущий этап, следующий шаг и контакт куратора, когда команда EVO закрепит их за вашим делом."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <PortalSection
        title="Что сейчас"
        description="Актуальный этап и ближайшее действие по вашему поступлению."
      >
        <dl className="grid gap-6 px-4 py-5 sm:grid-cols-2 sm:px-5">
          <PortalDefinition term="Текущий этап">
            {view.stage ? (
              <PortalStatus status={view.stage} />
            ) : (
              <span className="text-fg-3">Пока не определён</span>
            )}
          </PortalDefinition>

          <PortalDefinition term="Следующий шаг">
            {view.nextStep ? (
              <span className="block">
                {view.nextStep.label}
                {view.nextStep.dueLabel ? (
                  <span className="mt-1 block text-xs font-normal text-fg-3">
                    Срок: {view.nextStep.dueLabel}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-fg-3">Пока не назначен</span>
            )}
          </PortalDefinition>
        </dl>
      </PortalSection>

      <PortalSection title="Ваш куратор">
        <div className="px-4 py-5 sm:px-5">
          {view.curator ? (
            <p className="text-base font-semibold text-fg">
              {view.curator.displayName}
            </p>
          ) : (
            <p className="text-sm leading-6 text-fg-3">
              Куратор пока не назначен. Контакт появится здесь после назначения.
            </p>
          )}
        </div>
      </PortalSection>
    </div>
  );
}

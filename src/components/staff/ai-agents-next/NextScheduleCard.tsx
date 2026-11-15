"use client";

import { HelpTip, WidgetCard } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cronFromPlan, SCHEDULE_TIMEZONES, SCHEDULE_WEEKDAY_OPTIONS, timezoneLabel } from "@/lib/v3/ai-agents-view";

import { HOURS, MINUTE_STEPS, SCHEDULE_CHOICE_LABELS, type ScheduleChoice, type SettingsValues } from "./next-settings-model";

type Setter = <K extends keyof SettingsValues>(name: K, value: SettingsValues[K]) => void;
const KINDS = ["none", "daily", "weekdays", "weekly", "custom"] as const;

function Field({ id, label, children }: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return <div className="grid min-w-0 gap-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

/**
 * «Расписание и события»: как часто (последний пункт — «Своё…» с полем cron), время (два списка в 24-часовом виде), день
 * недели, часовой пояс, поручение для запуска по расписанию — только когда расписание выбрано (13.11.2026) — и события,
 * на которые агент реагирует. «Запустить сейчас» — в подвале.
 */
export function NextScheduleCard({
  form, set, defaultPrompt, footer,
}: Readonly<{ form: SettingsValues; set: Setter; defaultPrompt: string | null; footer?: React.ReactNode }>) {
  const [hour, minute] = form.time.split(":");
  const minutes = MINUTE_STEPS.includes(minute ?? "") ? MINUTE_STEPS : [...MINUTE_STEPS, minute ?? "00"].sort();
  const setTime = (nextHour: string, nextMinute: string) => set("time", `${nextHour}:${nextMinute}`);
  // «Своё…» с пустым полем стёрло бы расписание при сохранении: поле начинается с того, что было выбрано.
  const choose = (value: string) => {
    if (value === "custom" && form.cron.trim() === "" && form.kind !== "none" && form.kind !== "custom") set("cron", cronFromPlan({ kind: form.kind, time: form.time, weekday: form.weekday }) ?? "");
    set("kind", value as ScheduleChoice);
  };
  const timezones = SCHEDULE_TIMEZONES.includes(form.tz) ? SCHEDULE_TIMEZONES : [form.tz, ...SCHEDULE_TIMEZONES];
  return (
    <WidgetCard title="Расписание и события" footer={footer}>
      <div className="grid gap-5">
        <div className="grid gap-3 @2xl:grid-cols-4">
          <Field id="aia-kind" label="Как часто">
            <Select value={form.kind} onValueChange={choose}>
              <SelectTrigger id="aia-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((kind) => <SelectItem key={kind} value={kind}>{SCHEDULE_CHOICE_LABELS[kind]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {form.kind !== "none" && form.kind !== "custom" ? (
            <div role="group" aria-labelledby="aia-time-label" className="grid min-w-0 gap-1.5">
              <span id="aia-time-label" className="t-label text-fg-2">Время</span>
              <div className="flex items-center gap-1.5">
                <Select value={hour} onValueChange={(value) => setTime(value, minute ?? "00")}>
                  <SelectTrigger aria-label="Часы" data-testid="v3-aia-time-hour"><SelectValue /></SelectTrigger>
                  <SelectContent>{HOURS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
                <span aria-hidden="true" className="t-label text-fg-3">:</span>
                <Select value={minute} onValueChange={(value) => setTime(hour ?? "09", value)}>
                  <SelectTrigger aria-label="Минуты" data-testid="v3-aia-time-minute"><SelectValue /></SelectTrigger>
                  <SelectContent>{minutes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {form.kind === "weekly" ? (
            <Field id="aia-weekday" label="День недели">
              <Select value={String(form.weekday)} onValueChange={(value) => set("weekday", Number(value))}>
                <SelectTrigger id="aia-weekday"><SelectValue /></SelectTrigger>
                <SelectContent>{SCHEDULE_WEEKDAY_OPTIONS.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
          {form.kind !== "none" ? (
            <Field id="aia-tz" label="Часовой пояс">
              <Select value={form.tz} onValueChange={(value) => set("tz", value)}>
                <SelectTrigger id="aia-tz"><SelectValue /></SelectTrigger>
                <SelectContent>{timezones.map((tz) => <SelectItem key={tz} value={tz}>{timezoneLabel(tz)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        {form.kind === "custom" ? (
          <Field id="aia-cron" label="Минута, час, день, месяц, день недели">
            <Input id="aia-cron" className="max-w-xs font-mono" value={form.cron} placeholder="0 9 * * 1" onChange={(event) => set("cron", event.target.value)} />
          </Field>
        ) : null}
        {form.kind === "none" ? null : (
          <div className="grid min-w-0 gap-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="aia-prompt">Поручение для запуска по расписанию</Label>
              <HelpTip label="Пояснение: Поручение по расписанию">{defaultPrompt ? "Пусто — стандартное поручение EVO." : "Пусто — расписание не создаётся."}</HelpTip>
            </div>
            <Textarea id="aia-prompt" rows={4} maxLength={8000} value={form.prompt} placeholder={defaultPrompt ?? "Что агенту делать по расписанию?"} onChange={(event) => set("prompt", event.target.value)} />
          </div>
        )}
        <div role="group" aria-labelledby="aia-events-label" className="grid gap-1 border-t border-border pt-3">
          <span id="aia-events-label" className="t-label text-fg-2">Реагировать на</span>
          {([["website", "Новая заявка с сайта"], ["whatsapp", "Новое входящее сообщение в WhatsApp"]] as const).map(([name, text]) => (
            <div key={name} className="flex min-h-11 items-center gap-3">
              <Checkbox id={`aia-event-${name}`} checked={form[name]} onCheckedChange={(checked) => set(name, checked === true)} />
              <Label htmlFor={`aia-event-${name}`} className="t-body-compact text-fg">{text}</Label>
            </div>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}

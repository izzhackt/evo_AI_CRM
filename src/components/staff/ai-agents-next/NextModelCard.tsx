"use client";

import { HelpTip, WidgetCard } from "@/components/kit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AI_AGENT_MODELS, type AiAgentModelId } from "@/lib/ai-agents/contract";

import type { SettingsValues } from "./next-settings-model";

/** «Модель и расход»: модель, потолок расхода на запуск и строка дневного лимита WhatsApp. Подсказки по моделям — за «?». */
export function NextModelCard({
  form, set, capLine,
}: Readonly<{ form: SettingsValues; set: <K extends keyof SettingsValues>(name: K, value: SettingsValues[K]) => void; capLine: string | null }>) {
  return (
    <WidgetCard title="Модель и расход">
      <div className="grid gap-4 @2xl:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="aia-model">Модель</Label>
            <HelpTip label="Пояснение: Модель">
              <ul className="grid gap-1.5">
                {AI_AGENT_MODELS.map((model) => <li key={model.id}><span className="font-medium text-fg">{model.label}</span> — {model.hint}</li>)}
              </ul>
            </HelpTip>
          </div>
          <Select value={form.model} onValueChange={(value) => set("model", value as AiAgentModelId)}>
            <SelectTrigger id="aia-model" data-testid="v3-aia-model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AI_AGENT_MODELS.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="aia-budget">Потолок расхода на запуск, $</Label>
            <HelpTip label="Пояснение: Потолок расхода">0 — без потолка.</HelpTip>
          </div>
          <Input id="aia-budget" inputMode="decimal" className="max-w-[10rem]" value={form.budget} onChange={(event) => set("budget", event.target.value)} />
        </div>
      </div>
      {capLine ? <p className="mt-3 t-meta text-fg-3" data-testid="v3-aia-wa-cap">{capLine}</p> : null}
    </WidgetCard>
  );
}

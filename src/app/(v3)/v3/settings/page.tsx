import { PartShell } from "@/components/v3/PartShell";
import { Settings } from "@/components/v3/Settings";
import { readCapabilityNames, readIntegrations, readRoles } from "@/lib/v3/settings-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Настройки" };

export default async function SettingsPart() {
  const [roles, capabilityNames, integrations] = [
    readRoles(),
    readCapabilityNames(),
    await readIntegrations(),
  ];

  return (
    <PartShell
      title="Настройки"
      width="narrow"
      lead="Роли и интеграции. Переключателей здесь нет намеренно: роли зашиты в коде и не настраиваются, а состояние интеграций читается по факту работы."
    >
      <Settings roles={roles} capabilityNames={capabilityNames} integrations={integrations} />
    </PartShell>
  );
}

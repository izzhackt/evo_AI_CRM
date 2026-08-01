import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyStaffLayout } = await import("./LegacyStaffLayout");
    return <LegacyStaffLayout>{children}</LegacyStaffLayout>;
  }

  const { default: PlatformStaffLayout } = await import("./PlatformStaffLayout");
  return <PlatformStaffLayout>{children}</PlatformStaffLayout>;
}

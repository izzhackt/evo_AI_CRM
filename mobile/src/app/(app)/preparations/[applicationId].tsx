import { useLocalSearchParams } from "expo-router";

import { PreparationScreen } from "@/features/preparations/PreparationScreen";

// `applicationId`: uuid программы из «Моих программ» (`preparationHref` из `features/preparations/routes.ts`).
export default function PreparationRoute() {
  const { applicationId } = useLocalSearchParams<{ applicationId: string }>();
  return <PreparationScreen applicationId={applicationId} />;
}

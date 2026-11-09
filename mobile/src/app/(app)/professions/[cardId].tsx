import { useLocalSearchParams } from "expo-router";

import { ProfessionCardScreen } from "@/features/learning/professions/ProfessionCardScreen";

export default function ProfessionCardRoute() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  return <ProfessionCardScreen cardId={cardId} />;
}

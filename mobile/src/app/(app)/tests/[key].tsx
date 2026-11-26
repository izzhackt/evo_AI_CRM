import { useLocalSearchParams } from "expo-router";

import { AssessmentScreen } from "@/features/learning/tests/AssessmentScreen";

// `key`: english36 или orvis92; `attempt` открывает результат завершённой попытки; `from=professions` - тест открыт с карточки «Профессий».
export default function AssessmentRoute() {
  const { key, attempt, from } = useLocalSearchParams<{ key: string; attempt?: string; from?: string }>();
  return <AssessmentScreen instrumentKey={key} attemptId={attempt ?? null} from={from ?? null} />;
}

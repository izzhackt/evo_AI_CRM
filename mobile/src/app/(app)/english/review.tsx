import { useLocalSearchParams } from "expo-router";

import { EnglishReviewScreen } from "@/features/learning/english/EnglishReviewScreen";

// `module`: модуль, чьи ошибки повторяются (ссылка со списка и с итога урока); без него первый модуль, как на сайте.
export default function EnglishReviewRoute() {
  const { module } = useLocalSearchParams<{ module?: string }>();
  return <EnglishReviewScreen moduleId={module ?? null} />;
}

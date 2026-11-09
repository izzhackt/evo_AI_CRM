// Тонкая обёртка: тесты экранов подменяют её (jest.setup.ts), потому что expo-router
// целиком в Jest не загружается, а контекста навигации у экрана без навигатора нет.
export { useFocusEffect } from "expo-router";

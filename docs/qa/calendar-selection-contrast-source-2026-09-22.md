# TaskChip: контраст переключения выбора — source checkpoint

Base: `ac165cf992ea418c2a11745590a5dadb443e9d6f` (#1028).
Precode: `483d72e8`, append в EVO_LAUNCH_PLAN/PLAN_CHANGES до кода.

Одна строка TaskChip ограничивает transitionProperty свойством border-color.
Фон и явно окрашенные дочерние title/metadata переключаются без перехода;
глобальные стили и EVO-токены не изменены. Inline приоритет перекрывает
unlayered `.v3-world :where(button, a, summary)`.

Scoped ESLint с Node22.23.1 и git diff --check PASS. Зависимости переиспользованы
из завершённого calendar-panel worktree после точного сравнения package.json
и package-lock.json; install/build/общие тесты не запускались.

Actual UI pending: в будущем выделенном окне на существующей задаче проверить
выбор и снятие выбора, вычисленные цвета/transitionProperty, focus и детали.
Никаких task writes. Сохранённый кадр #1028 показывает промежуточный фон
#e1989f с белым текстом (2.28:1); конечный #d70217 — 5.37:1. Это историческое
наблюдение и source-supported объяснение, не новый runtime PASS и не замер
длительности перехода. Source review/CI и actual acceptance остаются раздельными.

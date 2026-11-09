import { useEffect } from "react";

import { warmMath } from "@/features/learning/math/mathjax-svg";

/** После первой отрисовки: движок TeX создаётся заранее (короткая пауза, чтобы не мешать первому кадру). */
export function useWarmMath(): void {
  useEffect(() => {
    const timer = setTimeout(warmMath, 150);
    return () => clearTimeout(timer);
  }, []);
}

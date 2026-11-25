// Блок сбоя появился - читалка должна его услышать. Веб говорит `role="alert"` сам, а в React Native на iPhone
// `accessibilityRole="alert"` ничего не произносит (UIAccessibilityTraitNone), на Android это лишь описание роли, поэтому блок
// озвучивается явно (`announce`): один раз за появление и только если он появился на виду. Блок, появившийся, пока беседа под другой
// вкладкой, не говорит поверх чужого экрана, и вернувшись, студент его не «догоняет» (как подтверждение отправки). Исчез и появился
// снова - это новое появление.
import { useEffect, useRef } from "react";

import { announce } from "@/ui/a11y";

export function useAnnounceOnAppear(shown: boolean, visible: boolean, message: string): void {
  const handled = useRef(false);
  useEffect(() => {
    if (!shown) {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    if (visible) announce(message);
  }, [shown, visible, message]);
}

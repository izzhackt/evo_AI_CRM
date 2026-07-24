"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function DocumentSubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button {...props} disabled={pending || props.disabled} aria-busy={pending || undefined}>
      {pending ? pendingLabel : children}
    </button>
  );
}

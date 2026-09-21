"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";

type MarkReadAction = (formData: FormData) => void | Promise<void>;

/** Keep action failures beside their form; server receipts still own read state. */
export function PortalNotificationReadForm({ action, errorMessage, children }: {
  action: MarkReadAction;
  errorMessage: string;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const restoreFocusRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    restoreFocusRef.current = formRef.current?.contains(document.activeElement) ?? false;
    setFailed(false);
    try {
      await action(formData);
    } catch (error) {
      // Public Next API: Auth redirects must continue to the router boundary.
      unstable_rethrow(error);
      setFailed(true);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form ref={formRef} action={submit} onSubmit={(event) => {
      if (inFlight.current) event.preventDefault();
    }}>
      {children}
      <ReadFailure failed={failed} message={errorMessage} formRef={formRef} restoreFocusRef={restoreFocusRef} />
    </form>
  );
}

function ReadFailure({ failed, message, formRef, restoreFocusRef }: {
  failed: boolean;
  message: string;
  formRef: RefObject<HTMLFormElement | null>;
  restoreFocusRef: RefObject<boolean>;
}) {
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!failed || pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    // A disabled submit may lose focus. Recover only that loss, never steal
    // focus if the user has already moved to another control while waiting.
    if (document.activeElement === document.body) {
      formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }, [failed, pending, formRef, restoreFocusRef]);

  return failed ? <p role="alert" className="pt-favorite-error">{message}</p> : null;
}

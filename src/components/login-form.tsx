"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { Field, inputCls } from "@/components/action-dialog";
import { PendingButton } from "@/components/spinner";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <Field label="Email"><input name="email" type="email" autoComplete="username" required className={inputCls} /></Field>
      <Field label="Password"><input name="password" type="password" autoComplete="current-password" required className={inputCls} /></Field>
      {state && !state.ok ? <div role="alert" className="rounded-lg bg-[var(--red-50)] px-3 py-2 text-[13px] text-[var(--red)]">{state.message}</div> : null}
      <PendingButton type="submit" pending={pending} pendingText="Memeriksa…" className="rounded-lg bg-[var(--blue)] px-3.5 py-2.5 text-[14px] font-semibold text-white hover:bg-[var(--blue-ink)]">Masuk</PendingButton>
    </form>
  );
}

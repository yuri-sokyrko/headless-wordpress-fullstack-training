'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';

import type { AuthFormState } from '@/actions/auth';
import { Button } from '@/components/ui/button';

// Lives here, not in actions/auth.ts: every export of a 'use server' module must
// be an async function, so a shared `const` is not allowed there.
const IDLE: AuthFormState = { status: 'idle', message: '', fieldErrors: {} };

/**
 * The form shell for /register, /verify and /login.
 *
 * The inputs are passed in as `children` and are rendered on the SERVER — a
 * Server Component may pass children to a Client Component, and only this
 * wrapper ships JavaScript.
 *
 * Errors are shown as one summary region with role="alert", which is announced
 * on change and needs no aria-live of its own. Lesson 16.1 replaces this with
 * per-field aria-describedby plus focus moved to the first invalid input; the
 * summary is honest about being the smaller version of that.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  readonly action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  const fieldErrors = Object.entries(state.fieldErrors);
  const settled = state.status === 'sent' || state.status === 'verified';

  // A settled form has nothing left to submit. Replacing it rather than leaving
  // a re-submittable form is what stops a second registration from the same page.
  if (settled) {
    return (
      <p role="status" className="border-border bg-muted/40 mt-6 rounded-md border p-4 text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state.status === 'error' ? (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          <p>{state.message}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {fieldErrors.map(([name, message]) => (
                <li key={name}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {children}

      {/* `disabled` rather than aria-busy: the button's own label carries the
          state, so there is no extra ARIA to justify in docs/accessibility.md. */}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

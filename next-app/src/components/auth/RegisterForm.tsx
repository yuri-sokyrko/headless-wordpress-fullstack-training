'use client';

import { useActionState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { register as registerAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { registerSchema, type RegisterInput } from '@/lib/validation/schemas';

export function RegisterForm({ locale }: { readonly locale: string }) {
  const [state, formAction, isPending] = useActionState(registerAction, {
    status: 'idle' as const,
    message: '',
    fieldErrors: {},
  });

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // onBlur, not onChange: nobody wants "that is not an email address" after
    // typing the first character of one.
    mode: 'onBlur',
    defaultValues: { email: '', displayName: '', locale: 'en' },
  });

  // The ONE place errors become visible, whichever route they arrived by:
  // the client resolver, the action's safeParse, or a full no-JavaScript POST.
  // Lesson 16.1 §8 — nothing moves focus for you.
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) {
      return;
    }

    let first: keyof RegisterInput | undefined;

    for (const [name, message] of Object.entries(state.fieldErrors)) {
      if ((name === 'email' || name === 'displayName' || name === 'locale') && message) {
        form.setError(name, { type: 'server', message });
        first ??= name;
      }
    }

    if (first) {
      form.setFocus(first);
    }
  }, [state, form]);

  return (
    <Form {...form}>
      {/*
        NO onSubmit. `action` is the whole mechanism: with JavaScript off the
        browser POSTs this form natively and the action's own safeParse is the
        boundary. react-hook-form's handleSubmit would call preventDefault()
        unconditionally and delete that path. Lesson 16.1 §9.
      */}
      <form action={formAction} className="mt-8 space-y-6">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                {/* type="email" for the mobile keyboard AND because the browser's
                    own constraint validation is a free fourth layer that also
                    works with JavaScript off. */}
                <Input type="email" {...field} />
              </FormControl>
              <FormDescription>
                We mail you a confirmation link. It expires in 24 hours.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input autoComplete="nickname" maxLength={80} {...field} />
              </FormControl>
              <FormDescription>Credited on your incidents. 80 characters or fewer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {state.status === 'error' && state.message ? (
          // The form-level message, for failures that belong to no field:
          // the rate limiter, WordPress being unreachable, a bad app token.
          <p role="alert" className="text-destructive text-sm font-medium">
            {state.message}
          </p>
        ) : null}

        {state.status === 'sent' ? <p role="status">{state.message}</p> : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending}>
          {isPending ? 'Registering...' : 'Register'}
        </Button>
      </form>
    </Form>
  );
}

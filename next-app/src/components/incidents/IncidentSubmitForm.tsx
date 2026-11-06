'use client';

import { useActionState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { submitIncident, type IncidentFormState } from '@/actions/incidents';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { incidentSchema, type IncidentInput } from '@/lib/validation/schemas';

export type TermOption = { readonly slug: string; readonly name: string };

const INITIAL: IncidentFormState = { status: 'idle' };

const ENVIRONMENTS: readonly TermOption[] = [
  { slug: 'production', name: 'Production' },
  { slug: 'staging', name: 'Staging' },
  { slug: 'development', name: 'Development' },
  { slug: 'works-on-my-machine', name: 'Works on my machine' },
];

export function IncidentSubmitForm({
  locale,
  scapegoats,
  severities,
  reporterDisplayName,
}: {
  readonly locale: string;
  // The SAME lists the action validates against, fetched by the page. Two
  // fetches, not one: the form's copy is for rendering and the action's copy is
  // for deciding, and a value the browser sends is never the allowlist.
  readonly scapegoats: readonly TermOption[];
  readonly severities: readonly TermOption[];
  readonly reporterDisplayName: string;
}) {
  const [state, formAction, isPending] = useActionState(submitIncident, INITIAL);

  const form = useForm<IncidentInput>({
    resolver: zodResolver(incidentSchema),
    mode: 'onBlur',
    defaultValues: {
      title: '',
      body: '',
      scapegoatSlug: '',
      severitySlug: '',
      occurredAt: '',
      downtimeMinutes: '' as unknown as number,
      estimatedCostUsd: '' as unknown as number,
      environment: 'production',
      resolutionStatus: 'open',
      blameConfidence: '73' as unknown as number,
      stackTrace: '',
      reporterDisplayName,
      locale: locale as IncidentInput['locale'],
    },
  });

  // One path to a visible error, whichever layer produced it (Lesson 16.1 §8).
  useEffect(() => {
    if (state.status !== 'error' || !state.fieldErrors) {
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [
      keyof IncidentInput,
      readonly string[] | undefined,
    ][];

    for (const [name, messages] of entries) {
      if (messages?.[0]) {
        form.setError(name, { type: 'server', message: messages[0] });
      }
    }

    const first = entries.find(([, messages]) => Boolean(messages?.[0]));

    if (first) {
      form.setFocus(first[0]);
    }
  }, [state, form]);

  if (state.status === 'success') {
    return (
      <div className="border-border bg-card mt-8 rounded-lg border p-6">
        <h2 className="text-xl font-semibold tracking-tight">Queued for review</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          “{state.title}” is waiting for a moderator. It is not public yet, and you will get an
          email when its status changes.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      {/* No onSubmit. The browser submits this natively with JavaScript off,
          and step 2 of the action is the boundary either way (16.1 §9). */}
      <form action={formAction} className="mt-8 space-y-6">
        <input type="hidden" name="locale" value={locale} />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What happened</FormLabel>
              <FormControl>
                <Input maxLength={200} {...field} />
              </FormControl>
              <FormDescription>One sentence, 200 characters or fewer.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>The full story</FormLabel>
              <FormControl>
                <textarea
                  className="border-input focus-visible:ring-ring/50 flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="scapegoatSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Who is to blame</FormLabel>
                {/* Radix Select renders a listbox, not a <select>, so it needs a
                    real <input name> beside it for the no-JavaScript POST. */}
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a scapegoat" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {[...scapegoats]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((term) => (
                        <SelectItem key={term.slug} value={term.slug}>
                          {term.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="severitySlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How bad</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose severity" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {severities.map((term) => (
                      <SelectItem key={term.slug} value={term.slug}>
                        {term.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="occurredAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>When it happened</FormLabel>
                <FormControl>
                  <Input type="datetime-local" {...field} />
                </FormControl>
                <FormDescription>Not the future. WordPress checks this too.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Environment</FormLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ENVIRONMENTS.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="downtimeMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Downtime (minutes)</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="numeric" min={0} max={100000} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="estimatedCostUsd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Estimated cost (USD)</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="numeric" min={0} {...field} />
                </FormControl>
                <FormDescription>
                  Optional. Leave it empty if you would rather not guess.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="blameConfidence"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Blame confidence</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={100} {...field} />
                </FormControl>
                <FormDescription>0 to 100. The default is 73.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="stackTrace"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Stack trace</FormLabel>
              <FormControl>
                <textarea
                  rows={5}
                  className="border-input focus-visible:ring-ring/50 flex w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Optional. Rendered escaped inside a codeblock, never as HTML.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <input type="hidden" name="reporterDisplayName" value={reporterDisplayName} />
        <input type="hidden" name="resolutionStatus" value="open" />

        {state.status === 'error' ? (
          <p role="alert" className="text-destructive text-sm font-medium">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" variant="blame" size="xl" disabled={isPending}>
          {isPending ? 'Submitting...' : 'Submit for review'}
        </Button>
      </form>
    </Form>
  );
}

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import type { SeverityLevel } from '@/types/content';

// Total over SeverityLevel: `satisfies` rejects a missing key AND an extra one,
// so a fifth severity term is a compile error here rather than an unstyled badge
// in production. The four slugs are fixed by appendix 03 §2.
const severityVariants = {
  's1-catastrophic': 'border-severity-s1/30 bg-severity-s1/15 text-severity-s1',
  's2-major': 'border-severity-s2/30 bg-severity-s2/15 text-severity-s2',
  's3-minor': 'border-severity-s3/30 bg-severity-s3/15 text-severity-s3',
  's4-cosmetic': 'border-severity-s4/30 bg-severity-s4/15 text-severity-s4',
} satisfies Record<SeverityLevel, string>;

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
        // Spread last so the four slugs sit alongside the stock variants and
        // `variant` accepts either kind.
        ...severityVariants,
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant,
  asChild,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

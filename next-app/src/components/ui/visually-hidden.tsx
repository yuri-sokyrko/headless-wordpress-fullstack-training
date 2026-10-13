import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

/**
 * Visually hidden, available to assistive technology.
 *
 * `sr-only` is Tailwind's name for the clip-rectangle rule WordPress starter
 * themes have shipped as `.screen-reader-text` for a decade:
 *   position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden;
 *   clip:rect(0,0,0,0); white-space:nowrap; border-width:0
 *
 * It is NOT `display:none` (removed from the accessibility tree, so screen
 * readers skip it) and NOT `text-indent:-9999px` (which pushes the text into
 * the viewport in an RTL locale — Module 20 adds locales). See Key Concept 5.
 *
 * `asChild` exists so an existing element can be hidden without adding a
 * wrapper: <VisuallyHidden asChild><h2>Filters</h2></VisuallyHidden>.
 */
function VisuallyHidden({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return <Comp data-slot="visually-hidden" className={cn('sr-only', className)} {...props} />;
}

export { VisuallyHidden };

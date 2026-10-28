// An async Server Component. A block component with its own fetch and its own
// cache policy is a capability a Classic render_callback does not have — it
// shares the page's request and the page's cache entry.
import Link from 'next/link';

import type { BlockComponentProps } from '@/components/blocks/registry';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScapegoatByIdDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { termTag } from '@/lib/graphql/tags';

export async function ScapegoatPicker({
  block,
  locale,
}: BlockComponentProps<'BttScapegoatPicker'>) {
  const termId = block.attributes?.termId;

  // An editor who inserted the block and never opened the inspector. Render
  // nothing rather than fetching term 0 — Key Concept 2.
  if (typeof termId !== 'number') return null;

  const data = await fetchGraphQL(
    ScapegoatByIdDocument,
    { id: String(termId) },
    {
      // 60 s, matching /hobt's segment window. A fetch cached LONGER than the
      // page it sits inside re-renders from stale data and looks like the page
      // cache failing. Key Concept 3.
      revalidate: 60,
      // An ID-keyed tag, because the slug is not known until the response
      // arrives and a tag cannot be attached retroactively. Module 18's webhook
      // owes one extra revalidateTag per term change — recorded in
      // docs/api-contract.md in Step 8. Built by tags.ts, never hand-typed.
      tags: [termTag('scapegoat', String(termId))],
    }
  );

  const term = data.scapegoat;
  if (term == null) return null;

  return (
    <Card data-block={block.__typename} className="my-6">
      <CardHeader>
        <CardTitle className="text-lg">
          <Link href={`/${locale}/scapegoats`} className="underline underline-offset-2">
            {term.name}
          </Link>
        </CardTitle>
        {/* `count` is maintained by WordPress in wp_term_taxonomy, which is why
            `scapegoat` is a taxonomy and not a CPT — Lesson 05.4 proved it with
            EXPLAIN. It is also why the revalidate window is short. */}
        <Badge variant="outline">{term.count ?? 0} incidents blamed on this</Badge>
      </CardHeader>
      {term.scapegoatProfile?.tagline !== null && term.scapegoatProfile?.tagline !== undefined ? (
        <CardContent className="text-muted-foreground text-sm">
          {term.scapegoatProfile.tagline}
        </CardContent>
      ) : null}
    </Card>
  );
}

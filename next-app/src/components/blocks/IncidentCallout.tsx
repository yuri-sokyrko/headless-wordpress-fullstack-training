// The simple case: typed attributes in, JSX out, no fetch.
import Link from 'next/link';

import { RichText } from './RichText';
import type { BlockComponentProps } from './registry';
import { Badge } from '@/components/ui/badge';
import type { SeverityLevel } from '@/types/content';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '@/types/content';

/**
 * `severity` is typed String on the wire — block.json has no enum concept, so the
 * SelectControl from Lesson 13.3 constrains the editor's UI and not the data.
 * `find` rather than a cast: this is a real runtime guard, and `s3-minor` is the
 * block.json default so an unrecognised value degrades to the same thing an
 * unset one does.
 */
function toSeverity(value: string | null | undefined) {
  return SEVERITY_ORDER.find((slug) => slug === value) ?? 's3-minor';
}

/**
 * The SAME rule as Lesson 13.5's deprecated[0].migrate(). Duplicated in two
 * languages on purpose, because the two seeded posts hold v1 markup and nobody
 * re-saved them, so `tone` arrives null and has to be derived. Lesson 23.5 owns
 * the contract test that keeps the two copies honest. Key Concept 2.
 */
function toTone(tone: string | null | undefined, severity: SeverityLevel): 'warning' | 'neutral' {
  if (tone === 'warning' || tone === 'neutral') return tone;

  return severity === 's1-catastrophic' || severity === 's2-major' ? 'warning' : 'neutral';
}

export function IncidentCallout({ block, locale }: BlockComponentProps<'BttIncidentCallout'>) {
  const attributes = block.attributes;
  const severity = toSeverity(attributes?.severity);
  const tone = toTone(attributes?.tone, severity);
  const slug = attributes?.incidentSlug ?? '';

  // A <div>, even though Lesson 13.5's v2 save() emits <aside>. Those are allowed
  // to differ: save() output is what WordPress compares against post_content,
  // while this renders from attributes. The reason to differ is that <aside>
  // inside <main> is a `complementary` LANDMARK, an unnamed landmark is an axe
  // finding in Module 22, and two callouts on one page would need two distinct
  // names that no attribute supplies. A real <h3> says the same thing with no
  // ARIA. If you want the landmark, aria-labelledby on the headline's id is the
  // way — and it costs a row in docs/accessibility.md.
  return (
    <div
      data-block={block.__typename}
      // Symmetric margins, no `first:`/`last:` variants. Key Concept 5.
      className={`my-6 rounded-lg border-l-4 p-4 ${
        tone === 'warning' ? 'border-l-destructive bg-destructive/5' : 'border-l-border bg-muted/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>

        {slug !== '' ? (
          <Link
            href={`/${locale}/incidents/${slug}`}
            className="text-sm underline underline-offset-1"
          >
            {slug}
          </Link>
        ) : null}
      </div>

      {/* `headline` and `body` are source: 'html' attributes in Lesson 13.2, so
          they are rich text and go through the one sanitizer. h3 because the
          route owns h1 and CoreHeading clamps to h2 — Lesson 14.3 Key Concept 7. */}

      <RichText as="h3" html={attributes?.headline} className="mt-3 text-lg font-semibold" />
      <RichText as="p" html={attributes?.body} className="&[_a]:underline mt-1 text-sm" />
    </div>
  );
}

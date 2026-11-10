// NOT a client component. Attribution here is four URL parameters, and URL
// parameters need no JavaScript — which is the whole reason this design was
// chosen over an interstitial redirect route. Lesson 16.4 §7.
import { Button } from '@/components/ui/button';
import type { LEAD_SOURCES } from '@/lib/validation/schemas';

/**
 * Append attribution to an off-site checkout URL.
 *
 * Returns null for an absent or unparseable value rather than rendering a
 * broken link: `startNowUrl` is editor-entered and an editor can type anything.
 * `new URL()` throws on a relative path, which is the check.
 */
function attributed(startNowUrl: string | null, leadSource: string, locale: string): string | null {
  if (startNowUrl === null || startNowUrl === '') {
    return null;
  }

  try {
    const url = new URL(startNowUrl);

    // The SAME vocabulary as wp_btt_leads.source and the btt/hobt-cta block's
    // `leadSource` attribute. One taxonomy for clicks and leads, or the two
    // numbers cannot be compared.
    url.searchParams.set(
      'utm_source',
      new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').host
    );
    url.searchParams.set('utm_medium', 'cta');
    url.searchParams.set('utm_campaign', 'hobt');
    url.searchParams.set('utm_content', leadSource);
    url.searchParams.set('btt_locale', locale);

    return url.toString();
  } catch {
    return null;
  }
}

export function StartNowButton({
  startNowUrl,
  locale,
  leadSource,
  label = 'Start Now',
}: {
  // From `hobtPromo` on src/app/[locale]/hobt/page.tsx. Module 14 made the
  // /hobt BODY block-composed and left the field group PAGE-mounted, because
  // priceUsd and seatsLeft are commerce facts an editor must not be able to
  // reorder away — so this value is still a prop from the page query.
  readonly startNowUrl: string | null;
  readonly locale: string;
  readonly leadSource: (typeof LEAD_SOURCES)[number];
  readonly label?: string;
}) {
  const href = attributed(startNowUrl, leadSource, locale);

  if (href === null) {
    return null;
  }

  return (
    <Button asChild variant="blame" size="xl">
      {/*
        A real <a href>, not next/link: the target is off-site, so there is
        nothing to prefetch and nothing to client-side navigate.

        `noopener` severs window.opener so the destination cannot script this
        page. `noreferrer` also suppresses the Referer header — deliberately.
        The UTM parameters carry the attribution explicitly, so we can afford to
        stop leaking the full URL of the page to a third party. That trade only
        works because the parameters are there. Lesson 16.4 §7.
      */}
      <a href={href} rel="noopener noreferrer">
        {label}
      </a>
    </Button>
  );
}

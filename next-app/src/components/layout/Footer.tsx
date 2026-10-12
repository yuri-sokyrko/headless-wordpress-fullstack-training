import { SiteChromeDocument } from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { siteTag } from '@/lib/graphql/tags';

export async function Footer() {
  const data = await fetchGraphQL(SiteChromeDocument, {}, { revalidate: 3600, tags: [siteTag()] });

  const settings = data.siteSettings?.siteChrome;

  // `social_links` is an SCF repeater, so every row AND every sub-field is
  // independently nullable — appendix 03 §4.5. An editor who adds a row and
  // saves before typing produces exactly this shape.
  const social = settings?.socialLinks ?? [];

  return (
    <footer className="border-border mt-16 border-t">
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 py-10 text-sm">
        {settings?.footerBlurb != null && settings.footerBlurb !== '' ? (
          <p className="max-w-prose">{settings.footerBlurb}</p>
        ) : null}

        {social.length > 0 ? (
          <nav aria-label="Social" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {social.map((link) =>
              link?.url != null && link.url !== '' ? (
                <a
                  key={link.url}
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="focus-visible:ring-ring underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {/* Fall back to the URL rather than rendering an empty link,
                    which would be a control with no accessible name. */}
                  {link.network ?? link.url}
                </a>
              ) : null
            )}
          </nav>
        ) : null}

        <p className="mt-6">{data.generalSettings?.title ?? 'Blame The Tech'}</p>
      </div>
    </footer>
  );
}

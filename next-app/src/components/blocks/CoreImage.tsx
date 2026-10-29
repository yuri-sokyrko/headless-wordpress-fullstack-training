// No `priority` prop, deliberately — Key Concept 5.
import Image from 'next/image';

import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';
import { fetchGraphQL } from '@/lib/graphql/client';
import { MediaItemByIdDocument } from '@/gql/graphql';

/**
 * The prose column is `max-w-3xl` (48 rem) inside the layout's `px-4`, so the
 * image is ~720 px on a large viewport and the viewport minus 2 rem below that.
 * Getting this wrong the other way — `100vw` everywhere — makes a 400 px slot
 * fetch a 750 px file on a 2x phone. Key Concept 4, and the DevTools check there
 * is how you verify it after a layout change.
 */
const SIZES = '(min-width: 1024px) 720px, calc(100vw - 2rem)';

/** No dimensions anywhere. A guess, and the reason this is the fallback. */
const FALLBACK_RATIO = 'aspect-[3/2]';

export async function CoreImage({ block }: BlockComponentProps<'CoreImage'>) {
  const mediaId = block.attributes?.id;

  if (typeof mediaId !== 'number') return null;

  const data = await fetchGraphQL(
    MediaItemByIdDocument,
    { id: String(mediaId) },
    { revalidate: 2678400 /* 31 days. */ }
  );

  const media = data.mediaItem;
  if (media == null) return;

  const attributes = block.attributes;

  // The media library's URL wins over the attribute's. The attribute holds
  // whatever URL was current when the block was inserted, and a re-upload or the
  // Module 24 media-subdomain move leaves it stale. `url` is the fallback for an
  // image inserted from an external source, which has no attachment behind it.
  const src = media?.sourceUrl ?? attributes?.url ?? '';
  if (src === '') return null;

  // INTRINSIC dimensions, from the media library and never from the attributes.
  const width = media?.mediaDetails?.width ?? null;
  const height = media?.mediaDetails?.height ?? null;

  // The block's own alt overrides the library's, because core/image reads it off
  // the <img alt> in the saved markup and an editor may have set it per-insertion.
  // Empty string is CORRECT for a decorative image and is not the same as
  // missing — Key Concept 6. `next/image` makes alt required so it cannot be
  // absent; what it cannot do is stop you passing a filename.
  const alt = attributes?.alt ?? media?.altText ?? '';

  return (
    <figure data-block={block.__typename} className="my-6">
      {width !== null && height !== null ? (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={SIZES}
          className="h-auto w-full rounded-md"
        />
      ) : (
        // No mediaDetails: an external image, or an attachment whose metadata
        // never regenerated. `fill` needs a positioned parent with a ratio, and
        // the ratio is a guess — so this crops. A crop is a worse failure than a
        // tall image, which is why it is the fallback and not the default.
        <div className={`relative w-full ${FALLBACK_RATIO}`}>
          <Image src={src} alt={alt} fill sizes={SIZES} className="rounded-md object-cover" />
        </div>
      )}

      {/* A caption is rich text — an editor can bold a word or link a source —
          so it goes through e sanithe ontizer, and RichText renders nothing when
          the attribute is empty rather than an empty <figcaption>. */}
      <RichText
        as="figcaption"
        html={attributes?.caption}
        className="text-muted-foreground mt-2 text-sm [$_a]:underline"
      />
    </figure>
  );
}

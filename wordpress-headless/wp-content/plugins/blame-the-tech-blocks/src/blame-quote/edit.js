import { __ } from "@wordpress/i18n";
import { InnerBlocks, RichText, useBlockProps } from "@wordpress/block-editor";

// Module scope, not inline: a new array every render would reset the template.
// This is INITIAL STATE, not a constraint — the editor may delete it.
const TEMPLATE = [
  ["core/paragraph", { placeholder: "It worked on my machine." }],
];

export default function Edit({ attributes, setAttributes }) {
  const { attribution } = attributes;
  const blockProps = useBlockProps();

  return (
    <div {...blockProps}>
      <blockquote className="wp-block-quote">
        <InnerBlocks
          template={TEMPLATE}
          // `false`, written out. Omitting it INHERITS the nearest
          // locked ancestor's lock, which is a silent failure inside a
          // locked pattern. Key Concept 2
          templateLock={false}
          // Shown when the inner area is empty, so the editor knows the
          // region is theirs.
          renderAppender={InnerBlocks.ButtonBlockAppender}
        />
      </blockquote>

      {/* INLINE, not the inspector: an attribution you cannot see while
			     writing the quote is an attribution people forget. Key Concept 4. */}
      <RichText
        identifier="attribution"
        value={attribution}
        tagName="figcaption"
        className="btt-blame-quote__attribution"
        onChange={(value) => setAttributes({ attribution: value })}
        allowedFormats={[]}
        placeholder={__("Who said it?", "blame-the-tech-blocks")}
      />
    </div>
  );
}

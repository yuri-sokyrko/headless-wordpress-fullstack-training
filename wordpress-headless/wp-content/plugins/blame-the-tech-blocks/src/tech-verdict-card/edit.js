import { __, sprintf } from "@wordpress/i18n";
import {
  InspectorControls,
  RichText,
  useBlockProps,
} from "@wordpress/block-editor";
import { PanelBody, TextControl } from "@wordpress/components";

export default function Edit({ attributes, setAttributes, context }) {
  const { reviewSlug, verdict } = attributes;
  const blockProps = useBlockProps();

  // `context.postId` arrives because block.json declares usesContext: ['postId'].
  // It is the post this block SITS IN — not the review it points at. The binding
  // source in the plugin bootstrap uses both. Lesson 13.4 Key Concept 8.
  const postId = context?.postId ?? 0;

  return (
    <>
      <InspectorControls>
        <PanelBody title={__("Tech review", "blame-the-tech-blocks")}>
          <TextControl
            __nextHasNoMarginBottom
            label={__("Review slug", "blame-the-tech-blocks")}
            value={reviewSlug}
            onChange={(value) => setAttributes({ reviewSlug: value })}
            placeholder="review-01"
            help={sprintf(
              /* translators: %d: the ID of the post this block is placed in. */
              __("Placed in post %d.", "blame-the-tech-blocks"),
              postId,
            )}
          />
        </PanelBody>
      </InspectorControls>
      <div {...blockProps}>
        <RichText
          identifier="verdict"
          value={verdict}
          onChange={(value) => setAttributes({ verdict: value })}
          allowedFormats={[]}
          placeholder={__(
            "Adopt, Trial, Assess or Hold",
            "blame-the-tech-blocks",
          )}
        />
      </div>
    </>
  );
}

import { RichText, useBlockProps } from "@wordpress/block-editor";

export default function save({ attributes }) {
  const { headline, body } = attributes;

  // NOTHING derived from `severity` or `incidentSlug` goes in here. Both are
  // already in the comment JSON, and adding either to the markup would (a)
  // duplicate state and (b) invalidate every already-published callout.
  //
  // No esc_html(). JSX escapes; RichText.Content deliberately does not.
  return (
    <div {...useBlockProps.save()}>
      <RichText.Content tagName="h3" value={headline} />
      <RichText.Content tagName="p" value={body} />
    </div>
  );
}

import { RichText, useBlockProps } from "@wordpress/block-editor";

export default function save({ attributes }) {
  const { headline, body } = attributes;

  // NOTHING derived from `severity` or `incidentSlug` goes in here. Both are
  // already in the comment JSON, and adding either to the markup would (a)
  // duplicate state and (b) invalidate every already-published callout.
  //
  // No esc_html(). JSX escapes; RichText.Content deliberately does not.

  // v2. `<aside>` rather than `<div>`: an incident callout is tangentially
  // related content, and <aside> is what a screen reader's landmark list
  // should show. `tone` is NOT in the markup — it is a comment attribute, and
  // putting it here would be a second deprecation on the first day.
  return (
    <aside {...useBlockProps.save()}>
      <RichText.Content tagName="h3" value={headline} />
      <RichText.Content tagName="p" value={body} />
    </aside>
  );
}

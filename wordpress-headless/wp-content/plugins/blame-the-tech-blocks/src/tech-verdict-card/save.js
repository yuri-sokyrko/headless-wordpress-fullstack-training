import { RichText, useBlockProps } from "@wordpress/block-editor";

export default function save({ attributes }) {
  // RichText.Content with NO tagName renders the raw value with no wrapping
  // element, so the root <div> is the element `source: 'html'` reads back from.
  // Adding a tagName here would nest an element inside the root and the
  // selector-less source would then include that element's tag in the value.
  return (
    <div {...useBlockProps.save()}>
      <RichText.Content value={attributes.verdict} />
    </div>
  );
}

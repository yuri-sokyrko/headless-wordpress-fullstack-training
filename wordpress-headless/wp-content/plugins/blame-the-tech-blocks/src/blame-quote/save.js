import { InnerBlocks, useBlockProps } from "@wordpress/block-editor";

export default function save() {
  // NO <cite>, and no attribution anywhere in this markup. The attribution is
  // an attribute; Lesson 14.4's BlameQuote renders it. Emitting it here would
  // duplicate state AND invalidate blog-01, blog-02 and the hobt page.
  //
  // <InnerBlocks.Content /> is the placeholder the serialiser swaps for the
  // children. Omit it and the children are deleted from the database with no
  // warning of any kind. Key Concept 3.
  return (
    <blockquote {...useBlockProps.save()}>
      <InnerBlocks.Content />
    </blockquote>
  );
}

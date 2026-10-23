import { RichText, useBlockProps } from "@wordpress/block-editor";

// COPIED, not imported from block.json. The whole point of this object is that it
// describes the schema AS IT WAS. Importing the live schema means the old markup
// gets parsed with new rules, which is the most common deprecation bug there is.
const v1Attributes = {
  severity: { type: "string", default: "s3-minor" },
  incidentSlug: { type: "string", default: "" },
  headline: { type: "string", source: "html", selector: "h3" },
  body: { type: "string", source: "html", selector: "p" },
};

// Also copied. useBlockProps.save()'s output depends on `supports`, so a support
// that changed between versions changes what the old markup looked like.
const v1Supports = {
  className: true,
  customClassName: false,
  html: false,
  anchor: false,
  align: false,
  color: false,
  spacing: false,
  typography: false,
  reusable: true,
  multiple: true,
};

const v1 = {
  attributes: v1Attributes,
  supports: v1Supports,

  // The REAL v1 save(), byte for byte. This function's output is what the
  // parser compares against post_content, so an approximation does not match
  // and the deprecation silently never fires.
  save({ attributes }) {
    const { headline, body } = attributes;

    return (
      <div {...useBlockProps.save()}>
        <RichText.Content tagName="h3" value={headline} />
        <RichText.Content tagName="p" value={body} />
      </div>
    );
  },

  // v2 added `tone`, so the parsed v1 attributes need one more key. The rule
  // below is written down in docs/content-model.md because Lesson 14.4's
  // IncidentCallout implements the SAME expression in TypeScript, for posts
  // nobody ever re-saves.
  migrate: (attributes) => ({
    ...attributes,
    tone: ["s1-catastrophic", "s2-major"].includes(attributes.severity)
      ? "warning"
      : "neutral",
  }),
};

export default [v1];

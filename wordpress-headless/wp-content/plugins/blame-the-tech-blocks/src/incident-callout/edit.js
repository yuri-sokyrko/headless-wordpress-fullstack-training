import { __ } from "@wordpress/i18n";
import {
  InspectorControls,
  RichText,
  useBlockProps,
} from "@wordpress/block-editor";
import { PanelBody, SelectControl, TextControl } from "@wordpress/components";

import { SEVERITY_OPTIONS } from "../severities";

export default function Edit({ attributes, setAttributes }) {
  const { severity, incidentSlug, headline, body } = attributes;

  // `data-severity` is EDITOR ONLY. It is not in save(), so it never reaches
  // post_content and cannot break validation. style.scss keys off it so the
  // editor shows severity at a glance. Key Concept 4.
  const blockProps = useBlockProps({ "data-severity": severity });

  return (
    <>
      <InspectorControls>
        <PanelBody title={__("Incident", "blame-the-tech-blocks")}>
          <SelectControl
            __nextHasNoMarginBottom
            label={__("Severity", "blame-the-tech-blocks")}
            value={severity}
            options={SEVERITY_OPTIONS}
            // setAttributes MERGES. This call leaves the other three alone.
            onChange={(value) => setAttributes({ severity: value })}
            help={__(
              "Four terms, closed set. There is no S5.",
              "blame-the-tech-blocks",
            )}
          />
          <TextControl
            __nextHasNoMarginBottom
            label={__("Incident slug", "blame-the-tech-blocks")}
            value={incidentSlug}
            onChange={(value) => setAttributes({ incidentSlug: value })}
            help={__(
              "The incident this callout refferes to. Nothing validates it here - see the notes.",
              "blame-the-tech-blocks",
            )}
          />
        </PanelBody>
      </InspectorControls>
      <div {...blockProps}>
        <RichText
          identifier="headline"
          tagName="h3"
          value={headline}
          onChange={(value) => setAttributes({ headline: value })}
          // [] = no formatting toolbar at all. A headline is a headline.
          allowedFormats={[]}
          placeholder={__("What broke?", "blame-the-tech-blocks")}
        />
        <RichText
          identifier="body"
          tagName="p"
          value={body}
          onChange={(value) => setAttributes({ body: value })}
          // Three formats, chosen. Every one of them survives Lesson 14.3's
          // DOMPurify allowlist; anything else would be stripped there anyway.
          allowedFormats={["core/bold", "core/italic", "core/link"]}
          placeholder={__(
            "One sentence. Blame something.",
            "blame-the-tech-blocks",
          )}
        />
      </div>
    </>
  );
}

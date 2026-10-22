import { __ } from "@wordpress/i18n";
import {
  InspectorControls,
  RichText,
  useBlockProps,
} from "@wordpress/block-editor";
import { PanelBody, TextControl, SelectControl } from "@wordpress/components";

// Kebab-case, matching wp_btt_leads.source and the SCF select convention.
// The GraphQL enum is SCREAMING_SNAKE and Module 16 maps between them, in one
// place, on the way into submitHobtLead. Key Concept 7.
const LEAD_SOURCES = [
  { value: "hobet-hero", label: __("HOBT hero", "blame-the-tech-blocks") },
  {
    value: "hobt-cta-block",
    label: __("HOBT CTA block", "blame-the-tech-blocks"),
  },
  { value: "hobt-footer", label: __("HOBT footer", "blame-the-tech-blocks") },
  {
    value: "incident-sidebar",
    label: __("Incident sidebar", "blame-the-tech-blocks"),
  },
];

const VARIANTS = [
  { value: "primary", label: __("Primary", "blame-the-tech-blocks") },
  { value: "outline", label: __("Outline", "blame-the-tech-blocks") },
];

export default function Edit({ attributes, setAttributes }) {
  const { label, href, variant, leadSource } = attributes;
  const blockProps = useBlockProps({ "data-variant": variant });

  return (
    <>
      <InspectorControls>
        <PanelBody title={__("Call to action", "blame-the-tech-blocks")}>
          <TextControl
            __nextHasNoMarginBottom
            label={__("Target", "blame-the-tech-blocks")}
            value={href}
            onChange={(value) => setAttributes({ href: value })}
            placeholder="/hobt"
            help={__(
              "A path on this site, or an absolute URL. Nothing validates it here; Module 16 validates on the server.",
              "blame-the-tech-blocks",
            )}
          />
          <SelectControl
            __nextHasNoMarginBottom
            label={__("Variant", "blame-the-tech-blocks")}
            value={variant}
            options={VARIANTS}
            onChange={(value) => setAttributes({ variant: value })}
            help={__(
              'What "primary" looks like is the front end’s decision.',
              "blame-the-tech-blocks",
            )}
          />
          <SelectControl
            __nextHasNoMarginBottom
            label={__("Lead source", "blame-the-tech-blocks")}
            value={leadSource}
            options={LEAD_SOURCES}
            onChange={(value) => setAttributes({ leadSource: value })}
            help={__(
              "Recorded against the lead. Kebab-case, matching wp_btt_leads.source.",
              "blame-the-tech-blocks",
            )}
          />
        </PanelBody>
      </InspectorControls>

      {/* The label is content, so it is inline — Lesson 13.3 Key Concept 4.
			     `allowedFormats: []` keeps it plain text: a button label with a
			     nested <strong> is a styling decision the front end owns. */}
      <div {...blockProps}>
        <RichText
          identifier="label"
          tagName="span"
          value={label}
          onChange={(value) => setAttributes({ label: value })}
          allowedFormats={[]}
        />
      </div>
    </>
  );
}

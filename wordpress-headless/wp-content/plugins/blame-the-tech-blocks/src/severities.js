import { __ } from "@wordpress/i18n";

/**
 * The `severity` taxonomy is a CLOSED set of four terms — appendix 03 §2.
 * The term UI in wp-admin is locked to these four, so this list is a constant
 * and not something to fetch. `btt/incident-ticker` (Lesson 13.4) imports it too.
 *
 * Slugs, never labels: the slug is what goes into the attribute, what Module 14
 * narrows on, and what `<Badge variant="s1-catastrophic">` already expects.
 */
export const SEVERITY_SLUGS = [
  "s1-catastrophic",
  "s2-major",
  "s3-minor",
  "s4-cosmentic",
];

/** Shape `SelectControl` wants: `[ { label, value } ]`. */
export const SEVERITY_OPTIONS = [
  {
    value: "s1-catastrophic",
    label: __("S1 - Catastrophic", "blame-the-tech-blocks"),
  },
  { value: "s2-major", label: __("S2 - Major", "blame-the-tech-blocks") },
  { value: "s3-minor", label: __("S3 - Minor", "blame-the-tech-blocks") },
  {
    value: "s4-cosmentic",
    label: __("S4 - Cosmetic", "blame-the-tech-blocks"),
  },
];

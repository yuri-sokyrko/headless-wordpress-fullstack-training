import { __, sprintf } from "@wordpress/i18n";
import { InspectorControls, useBlockProps } from "@wordpress/block-editor";
import {
  CheckboxControl,
  Notice,
  PanelBody,
  RangeControl,
  Spinner,
} from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { decodeEntities } from "@wordpress/html-entities";
import { useMemo } from "@wordpress/element";

import { SEVERITY_OPTIONS } from "../severities";

// Severity is a closed set: even admins cannot request terms in edit context.
const TERMS_QUERY = {
  context: "view",
  per_page: 100,
  orderby: "slug",
  order: "asc",
};
const TERMS_ARGS = ["taxonomy", "severity", TERMS_QUERY];

export default function Edit({ attributes, setAttributes }) {
  const { count, severities } = attributes;
  const blockProps = useBlockProps();

  // 1. The REST API filters posts by taxonomy using TERM IDS, so the slugs in
  //    the attribute have to be resolved first. render.php does not need this
  //    step, because tax_query accepts slugs directly — one of the small ways
  //    the two implementations differ. Key Concept 6.
  const { terms, termsResolved } = useSelect((select) => {
    const store = select(coreStore);
    return {
      terms: store.getEntityRecords(...TERMS_ARGS),
      termsResolved: store.hasFinishedResolution(
        "getEntityRecords",
        TERMS_ARGS,
      ),
    };
  }, []);

  // 2. MEMOISED. A fresh array here would be a fresh dependency for the
  //    subscription below on every render, and useSelect would churn forever.
  //    Lesson 13.3 Key Concept 7.
  const termIds = useMemo(
    () =>
      (terms ?? []).filter((t) => severities.includes(t.slug)).map((t) => t.id),
    [terms, severities],
  );

  const { incidents, incidentsResolved } = useSelect(
    (select) => {
      if (!termIds.length) {
        return { incidents: [], incidentsResolved: true };
      }
      const store = select(coreStore);
      const args = [
        "postType",
        "incident",
        {
          context: "view",
          per_page: count,
          severity: termIds,
          orderby: "date",
          order: "desc",
          status: "publish",
        },
      ];
      return {
        incidents: store.getEntityRecords(...args),
        incidentsResolved: store.hasFinishedResolution(
          "getEntityRecords",
          args,
        ),
      };
    },
    [count, termIds],
  );

  const isLoading = !termsResolved || !incidentsResolved;
  const hasError =
    (termsResolved && !Array.isArray(terms)) ||
    (incidentsResolved && !Array.isArray(incidents));

  const toggle = (slug, isChecked) =>
    setAttributes({
      // setAttributes merges, but an ARRAY attribute still needs a NEW array.
      severities: isChecked
        ? [...severities, slug]
        : severities.filter((s) => s !== slug),
    });

  return (
    <>
      <InspectorControls>
        <PanelBody title={__("Ticker", "blame-the-tech-blocks")}>
          <RangeControl
            __nextHasNoMarginBottom
            label={__("How many", "blame-the-tech-blocks")}
            value={count}
            min={1}
            max={20}
            onChange={(value) => setAttributes({ count: value })}
          />
          {SEVERITY_OPTIONS.map(({ value, label }) => (
            <CheckboxControl
              __nextHasNoMarginBottom
              key={value}
              label={label}
              checked={severities.includes(value)}
              onChange={(isChecked) => toggle(value, isChecked)}
            />
          ))}
        </PanelBody>
      </InspectorControls>

      <div {...blockProps}>
        {!severities.length && (
          <p>
            {__(
              "No severities selected — this block will render nothing.",
              "blame-the-tech-blocks",
            )}
          </p>
        )}
        {!!severities.length && hasError && (
          <Notice status="error" isDismissible={false}>
            {__(
              "Could not load the incident preview. Reload the editor to try again.",
              "blame-the-tech-blocks",
            )}
          </Notice>
        )}
        {!!severities.length && !hasError && isLoading && <Spinner />}
        {!!severities.length &&
          !hasError &&
          !isLoading &&
          Array.isArray(incidents) &&
          0 === incidents.length && (
            <p>
              {__("No published incidents match.", "blame-the-tech-blocks")}
            </p>
          )}
        {!!severities.length &&
          !hasError &&
          !isLoading &&
          Array.isArray(incidents) &&
          incidents.length > 0 && (
            <ul>
              {incidents.map((incident) => (
                // REST returns `title` as { rendered }, HTML-encoded.
                <li key={incident.id}>
                  {decodeEntities(incident.title.rendered)}
                </li>
              ))}
            </ul>
          )}
        <p>
          {sprintf(
            /* translators: 1: item count, 2: comma-separated severity slugs. */
            __("Showing up to %1$d at severity %2$s", "blame-the-tech-blocks"),
            count,
            severities.join(", ") || "—",
          )}
        </p>
      </div>
    </>
  );
}

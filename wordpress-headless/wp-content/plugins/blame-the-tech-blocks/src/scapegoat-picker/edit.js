import { __, sprintf } from "@wordpress/i18n";
import { InspectorControls, useBlockProps } from "@wordpress/block-editor";
import {
  Notice,
  PanelBody,
  SelectControl,
  Spinner,
} from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";

// MODULE SCOPE. A new object literal per render would be a new dependency per
// render, and useSelect would re-subscribe forever. Key Concept 7.
const QUERY = { per_page: 100, orderby: "name", order: "asc" };

// The SAME value goes to getEntityRecords and to hasFinishedResolution.
// Different values describe different requests and the flag becomes a lie.
const ARGS = ["taxonomy", "scapegoat", QUERY];

export default function Edit({ attributes, setAttributes }) {
  const { termId } = attributes;
  const blockProps = useBlockProps();

  const { terms, hasResolved } = useSelect((select) => {
    const store = select(coreStore);

    return {
      // Synchronous read of a cache. Returns undefined and STARTS a fetch.
      terms: store.getEntityRecords(...ARGS),
      // The selector's NAME, then its arguments.
      hasResolved: store.hasFinishedResolution("getEntityRecords", ARGS),
    };
  }, []);

  // 1. LOADING — unresolved. `terms` is null (not undefined) before the first
  //    request, so hasResolved is the only reliable signal.
  if (!hasResolved) {
    return (
      <div {...blockProps}>
        <Spinner />
        {__("Loading scapegoats…", "blame-the-tech-blocks")}
      </div>
    );
  }

  // 2. GENUINELY EMPTY — resolved, and there is nothing. Say which plugin
  //    creates the terms; "no options" with no explanation is a dead end.
  if (hasResolved && 0 === (terms?.length ?? 0)) {
    return (
      <div {...blockProps}>
        <Notice status="warning" isDismissible={false}>
          {__(
            "No scapegoat terms exist. They are seeded by blame-the-tech-core on activation — see appendix 03 §2.",
            "blame-the-tech-blocks",
          )}
        </Notice>
      </div>
    );
  }

  // 3. LOADED.
  const selected = terms.find((term) => term.id === termId);

  const options = [
    { value: 0, label: __("— Choose a scapegoat —", "blame-the-tech-blocks") },
    ...terms.map((term) => ({ value: term.id, label: term.name })),
  ];

  return (
    <>
      <InspectorControls>
        <PanelBody title={__("Scapegoat", "blame-the-tech-blocks")}>
          <SelectControl
            __nextHasNoMarginBottom
            label={__("Blame", "blame-the-tech-blocks")}
            value={termId}
            options={options}
            // SelectControl hands back a string. The attribute is
            // declared `number`, and nothing coerces for you.
            onChange={(value) => setAttributes({ termId: Number(value) })}
            help={__(
              "Only the term ID is stored. Renaming the term updates every post that points at it.",
              "blame-the-tech-blocks",
            )}
          />
        </PanelBody>
      </InspectorControls>

      {/* save() returns null, so this is the ONLY visible representation of
			     the block anywhere in WordPress. It has to be readable, or the
			     block is an invisible thing an editor cannot select. */}
      <div {...blockProps}>
        {selected
          ? sprintf(
              /* translators: 1: term name, 2: number of incidents. */
              __("Blaming %1$s (%2$d incidents)", "blame-the-tech-blocks"),
              selected.name,
              selected.count ?? 0,
            )
          : __(
              "No scapegoat chosen — pick one in the sidebar.",
              "blame-the-tech-blocks",
            )}
      </div>
    </>
  );
}

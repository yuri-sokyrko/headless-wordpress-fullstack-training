/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server.node";
import { useSelect } from "@wordpress/data";

import Edit from "./edit";

jest.mock(
  "@wordpress/block-editor",
  () => ({
    InspectorControls: () => null,
    useBlockProps: () => ({}),
  }),
  { virtual: true },
);
jest.mock(
  "@wordpress/components",
  () => ({
    CheckboxControl: () => null,
    Notice: ({ children }) => children,
    PanelBody: ({ children }) => children,
    RangeControl: () => null,
    Spinner: () => "Loading preview",
  }),
  { virtual: true },
);
jest.mock("@wordpress/data", () => ({ useSelect: jest.fn() }), {
  virtual: true,
});
jest.mock("@wordpress/core-data", () => ({ store: "core" }), { virtual: true });
jest.mock(
  "@wordpress/html-entities",
  () => ({
    decodeEntities: (value) => value,
  }),
  { virtual: true },
);

const terms = [
  { id: 11, slug: "s1-catastrophic" },
  { id: 22, slug: "s2-major" },
  { id: 33, slug: "s3-minor" },
];
const attributes = {
  count: 5,
  severities: ["s1-catastrophic", "s2-major"],
};

function preview({
  termRecords = terms,
  incidentRecords = [],
  termsResolved = true,
  incidentsResolved = true,
  severities = attributes.severities,
} = {}) {
  const store = {
    getEntityRecords: jest.fn((kind) =>
      kind === "taxonomy" ? termRecords : incidentRecords,
    ),
    hasFinishedResolution: jest.fn((selector, [kind]) =>
      kind === "taxonomy" ? termsResolved : incidentsResolved,
    ),
  };
  useSelect.mockImplementation((callback) => callback(() => store));
  const markup = renderToStaticMarkup(
    <Edit
      attributes={{ ...attributes, severities }}
      setAttributes={jest.fn()}
    />,
  );
  return { markup, store };
}

it("reads public severity terms and only published incidents with matching IDs", () => {
  const { markup, store } = preview({
    incidentRecords: [{ id: 1, title: { rendered: "DNS incident" } }],
  });

  expect(store.getEntityRecords).toHaveBeenCalledWith("taxonomy", "severity", {
    context: "view",
    per_page: 100,
    orderby: "slug",
    order: "asc",
  });
  expect(store.getEntityRecords).toHaveBeenCalledWith("postType", "incident", {
    context: "view",
    per_page: 5,
    severity: [11, 22],
    orderby: "date",
    order: "desc",
    status: "publish",
  });
  for (const args of store.getEntityRecords.mock.calls) {
    expect(store.hasFinishedResolution).toHaveBeenCalledWith(
      "getEntityRecords",
      args,
    );
  }
  expect(markup).toContain("<li>DNS incident</li>");
});

it.each([
  { termRecords: null, termsResolved: false },
  { incidentRecords: null, incidentsResolved: false },
])("shows loading while a request is unresolved: %o", (state) => {
  const { markup } = preview(state);
  expect(markup).toContain("Loading preview");
  expect(markup).not.toContain("No published incidents match.");
  expect(markup).not.toContain("Could not load");
});

it.each([{ termRecords: null }, { incidentRecords: null }])(
  "reports failed requests instead of an empty result: %o",
  (state) => {
    const { markup } = preview(state);
    expect(markup).toContain("Could not load the incident preview.");
    expect(markup).not.toContain("No published incidents match.");
    expect(markup).not.toContain("Loading preview");
  },
);

it("shows an empty result after a successful request", () => {
  expect(preview().markup).toContain("No published incidents match.");
});

it("does not query incidents when no severity terms match", () => {
  const { markup, store } = preview({ termRecords: [] });
  expect(store.getEntityRecords).toHaveBeenCalledTimes(1);
  expect(markup).toContain("No published incidents match.");
});

it("preserves the intentionally empty state when all severities are unchecked", () => {
  const { markup, store } = preview({ severities: [] });
  expect(store.getEntityRecords).toHaveBeenCalledTimes(1);
  expect(markup).toContain("No severities selected");
  expect(markup).not.toContain("No published incidents match.");
});

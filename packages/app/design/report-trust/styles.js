// Prototype 3 — how an exposed runtime control is drawn, who writes its words,
// and what happens when a tile has more of them than fit.
//
// The chip is the shape. What it says is the author's: a runtime control
// already carries a `label` (InsightRuntimeDeclaration.filters[].label, which
// DashboardControlBar already reads as `control.label ?? control.field`), so
// the tile shows what the author wrote, not a sentence derived from the field
// and its operator. Derived text is both verbose and wrong as often as not —
// only the author knows that `Channel is not Partner` is better read as
// "Direct only".

import { chart, h, shell } from "./shared.js";

const state = { style: "twotone", icon: "none", count: 3, narrow: false };

const SALES = [42, 58, 35, 71, 49, 63, 38];

// Glyphs for the three kinds a runtime control can be. Hand-drawn here: the
// design system has no funnel — ArrowUpDownIcon and ListIcon are the closest —
// so adopting a filter icon is a change to stdui, not a change to this app.
const GLYPH = {
  filter: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 2h9L7 6.2V10L5 9V6.2L1.5 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  sort: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.5 2v8M3.5 10 1.8 8.3M3.5 10l1.7-1.7M8.5 10V2M8.5 2 6.8 3.7M8.5 2l1.7 1.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  limit: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
};

/**
 * The glyph a chip carries, if any. A filter is the ordinary kind, so repeating
 * a funnel down a line of them is noise; the glyph earns its place marking what
 * is *not* a filter. Two readings of that, and they disagree on one case: a
 * tile holding exactly one filter.
 */
function glyphFor(control, controls) {
  if (state.icon === "none") return "";
  const glyph = GLYPH[control.kind] ?? "";
  if (control.kind !== "filter") return glyph;
  if (state.icon === "exceptions") return "";
  if (state.icon === "repeats") {
    const filters = controls.filter((c) => c.kind === "filter").length;
    return filters > 1 ? "" : glyph;
  }
  return glyph;
}

// A runtime control is not always a filter: an Insight declares any number of
// filters, one sort and one limit. All three take an authored label.
const CONTROLS = [
  {
    kind: "filter",
    pinned: true,
    label: "Region",
    value: "EMEA",
    field: "Region",
    derived: "Region is EMEA",
  },
  {
    kind: "sort",
    pinned: false,
    label: "Ranked by",
    value: "Revenue",
    field: "Sort",
    derived: "Sorted by Revenue, high to low",
  },
  {
    kind: "limit",
    pinned: true,
    label: "",
    value: "Top 10",
    field: "Limit",
    derived: "Top 10",
  },
  {
    kind: "filter",
    pinned: true,
    label: "Period",
    value: "Last 12 months",
    field: "Date",
    derived: "Date in last 12 months",
  },
  {
    kind: "filter",
    pinned: false,
    label: "Direct only",
    value: "Yes",
    field: "Channel",
    derived: "Channel is not Partner",
  },
  {
    kind: "filter",
    pinned: false,
    label: "Segment",
    value: "Enterprise",
    field: "Segment",
    derived: "Segment is Enterprise",
  },
];

const active = () => CONTROLS.slice(0, state.count);

/* -------------------------------------------------------------- styles -- */

const STYLES = {
  twotone: {
    name: "Label + value",
    note: "Two tones in one chip, the label quiet and the value strong. An unlabelled control is just its value, which is the shortest a chip gets.",
    render: (c, all) =>
      h(
        `<span class="chip">${glyphFor(c, all)}${c.label ? `<span class="field">${c.label}</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  colon: {
    name: "Colon",
    note: "The same pairing punctuated. Reads as a key and a value, and needs the label to be present.",
    render: (c, all) =>
      h(
        `<span class="chip">${glyphFor(c, all)}${c.label ? `<span class="field">${c.label}:</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  divided: {
    name: "Divided",
    note: "Label and value in their own halves. Easiest to scan down a column of chips, widest per chip.",
    render: (c, all) =>
      h(
        `<span class="chip divided">${glyphFor(c, all)}${c.label ? `<span class="field">${c.label}</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  derived: {
    name: "Derived sentence",
    note: "What the tile would say with no authored label: field plus operator plus value. Kept here as the thing to compare against.",
    render: (c) =>
      h(`<span class="chip"><span class="value">${c.derived}</span></span>`),
  },
};

/* ----------------------------------------------------------- collapsed -- */

/**
 * The collapsed group: everything the author exposed but did not pin. Drawn
 * three ways, because the only question left is how a reader is invited to
 * open it.
 */
const COLLAPSED = {
  count: {
    name: "Count",
    note: "How many are behind it, and nothing else. Shortest, and says nothing about what they are.",
    render: (rest) => `<span class="value">+${rest.length}</span>`,
  },
  worded: {
    name: "Worded",
    note: "Names what the group is. Widest, and the only one that reads as a sentence next to the pinned chips.",
    render: (rest) =>
      `<span class="field">and</span><span class="value">${rest.length} more</span>`,
  },
  kinds: {
    name: "Kinds",
    note: "One glyph per kind hidden in the group, then the count. Says what sort of thing is behind it without naming values.",
    render: (rest) => {
      const kinds = [...new Set(rest.map((c) => c.kind))];
      return `${kinds.map((kind) => GLYPH[kind]).join("")}<span class="value">${rest.length}</span>`;
    },
  },
};

function showList(tile, title, controls) {
  const open = tile.querySelector(".pop");
  if (open) {
    open.remove();
    return;
  }
  tile.append(
    h(
      `<div class="pop"><div class="pop-title">${title}</div><ul>${controls
        .map((c) => `<li>${c.label ? `${c.label} · ` : ""}${c.value}</li>`)
        .join("")}</ul></div>`,
    ),
  );
}

/* -------------------------------------------------------------- render -- */

function tile(controls, { style, collapsed = "count" }) {
  const element = h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">Revenue</span></div>
    <div class="tile-body">${chart(SALES)}</div>
  </div>`);

  // Pinned controls are on the face because the author put them there. What is
  // merely visible collapses into one chip, whatever the width — the reader
  // sees the same thing on a phone and on a wall display.
  const pinned = controls.filter((control) => control.pinned);
  const rest = controls.filter((control) => !control.pinned);

  const line = h(`<div class="line"></div>`);
  for (const control of pinned) {
    line.append(STYLES[style].render(control, controls));
  }
  if (rest.length > 0) {
    const chip = h(
      `<button type="button" class="chip pressable collapsed">${COLLAPSED[collapsed].render(rest)}</button>`,
    );
    chip.onclick = () => showList(element, "Also applied", rest);
    line.append(chip);
  }

  element.querySelector(".tile-head").after(line);
  return element;
}

/** The workbench row where the author writes what the reader will see. */
function authorRow(control, onChange) {
  const row = h(`<div class="pane-row">
    <div class="pane-field">${control.field}</div>
    <label class="pane-label">Label
      <input class="pane-input" value="${control.label}" placeholder="No label" />
    </label>
    <div class="pane-pins"></div>
  </div>`);
  row.querySelector("input").oninput = (event) => {
    control.label = event.target.value;
    onChange();
  };

  // Visible and pinned are the same decision at two strengths: both are on the
  // tile, only one is on its face.
  const pins = row.querySelector(".pane-pins");
  for (const [value, label] of [
    [false, "Visible"],
    [true, "Pinned"],
  ]) {
    const button = h(
      `<button type="button" class="pin" aria-pressed="${control.pinned === value}">${label}</button>`,
    );
    button.onclick = () => {
      control.pinned = value;
      for (const sibling of pins.children) {
        sibling.setAttribute("aria-pressed", String(sibling === button));
      }
      onChange();
    };
    pins.append(button);
  }
  return row;
}

function section(title, blurb) {
  const node = h(`<div></div>`);
  node.append(h(`<div class="section">${title}</div>`));
  if (blurb) node.append(h(`<div class="caption">${blurb}</div>`));
  return node;
}

function render(page) {
  page.classList.toggle("narrow", state.narrow);
  page.replaceChildren();

  page.append(
    section(
      "Style · four ways to draw an authored control",
      "The label is the author's words, not the field name. Turn the count up to see a sort, a limit and a negated filter join the filters — each one labelled by whoever built the report.",
    ),
  );
  const styleGrid = h(`<div class="grid"></div>`);
  for (const [key, style] of Object.entries(STYLES)) {
    const cell = h(`<div></div>`);
    cell.append(
      h(`<div class="caption"><b>${style.name}</b> — ${style.note}</div>`),
      tile(active(), { style: key }),
    );
    styleGrid.append(cell);
  }
  page.append(styleGrid);

  page.append(
    section(
      "Authoring · where the words come from",
      "The item pane in the workbench. Type a label, and pin what a reader should see without asking. Pinned controls are always on the face; merely visible ones collapse into one chip at every width. Clear a label to see a control fall back to its value alone.",
    ),
  );
  const authoring = h(`<div class="authoring"></div>`);
  const preview = h(`<div class="authoring-preview"></div>`);
  const pane = h(`<div class="pane"></div>`);
  const refresh = () => {
    preview.replaceChildren(tile(active(), { style: state.style }));
  };
  for (const control of active()) pane.append(authorRow(control, refresh));
  refresh();
  authoring.append(pane, preview);
  page.append(authoring);

  page.append(
    section(
      "Collapsed · what the reader is invited to open",
      "Everything the author exposed but did not pin, in one chip. Three ways to draw it. Click one to see what is behind it.",
    ),
  );
  const collapsedGrid = h(`<div class="grid"></div>`);
  for (const [key, mode] of Object.entries(COLLAPSED)) {
    const cell = h(`<div></div>`);
    cell.append(
      h(`<div class="caption"><b>${mode.name}</b> — ${mode.note}</div>`),
      tile(active(), { style: state.style, collapsed: key }),
    );
    collapsedGrid.append(cell);
  }
  page.append(collapsedGrid);
}

const { page } = shell("Control styles", [
  {
    label: "Style",
    value: "twotone",
    options: Object.entries(STYLES).map(([value, style]) => ({
      label: style.name,
      value,
    })),
    onChange: (value) => {
      state.style = value;
      render(page);
    },
  },
  {
    label: "Icon",
    value: "none",
    options: [
      { label: "None", value: "none" },
      { label: "Every kind", value: "kind" },
      { label: "Non-filters", value: "exceptions" },
      { label: "Lone filter too", value: "repeats" },
    ],
    onChange: (value) => {
      state.icon = value;
      render(page);
    },
  },
  {
    label: "Settings",
    value: 3,
    options: [1, 3, 6].map((n) => ({ label: String(n), value: n })),
    onChange: (value) => {
      state.count = value;
      render(page);
    },
  },
  {
    label: "Width",
    value: false,
    options: [
      { label: "Wide", value: false },
      { label: "Narrow", value: true },
    ],
    onChange: (value) => {
      state.narrow = value;
      render(page);
    },
  },
]);

render(page);

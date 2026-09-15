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

/** The glyph a chip carries, if any, under the current icon setting. */
function glyphFor(control) {
  if (state.icon === "none") return "";
  return GLYPH[control.kind] ?? "";
}

/** The label a chip shows: dropped entirely when an icon stands in for it. */
function labelFor(control) {
  if (state.icon === "replace") return "";
  return control.label;
}

// A runtime control is not always a filter: an Insight declares any number of
// filters, one sort and one limit. All three take an authored label.
const CONTROLS = [
  {
    kind: "filter",
    label: "Region",
    value: "EMEA",
    field: "Region",
    derived: "Region is EMEA",
  },
  {
    kind: "sort",
    label: "Ranked by",
    value: "Revenue",
    field: "Sort",
    derived: "Sorted by Revenue, high to low",
  },
  {
    kind: "limit",
    label: "",
    value: "Top 10",
    field: "Limit",
    derived: "Top 10",
  },
  {
    kind: "filter",
    label: "Period",
    value: "Last 12 months",
    field: "Date",
    derived: "Date in last 12 months",
  },
  {
    kind: "filter",
    label: "Direct only",
    value: "Yes",
    field: "Channel",
    derived: "Channel is not Partner",
  },
  {
    kind: "filter",
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
    render: (c) =>
      h(
        `<span class="chip">${glyphFor(c)}${labelFor(c) ? `<span class="field">${labelFor(c)}</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  colon: {
    name: "Colon",
    note: "The same pairing punctuated. Reads as a key and a value, and needs the label to be present.",
    render: (c) =>
      h(
        `<span class="chip">${glyphFor(c)}${labelFor(c) ? `<span class="field">${labelFor(c)}:</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  divided: {
    name: "Divided",
    note: "Label and value in their own halves. Easiest to scan down a column of chips, widest per chip.",
    render: (c) =>
      h(
        `<span class="chip divided">${glyphFor(c)}${labelFor(c) ? `<span class="field">${labelFor(c)}</span>` : ""}<span class="value">${c.value}</span></span>`,
      ),
  },
  derived: {
    name: "Derived sentence",
    note: "What the tile would say with no authored label: field plus operator plus value. Kept here as the thing to compare against.",
    render: (c) =>
      h(`<span class="chip"><span class="value">${c.derived}</span></span>`),
  },
};

/* ------------------------------------------------------------ overflow -- */

/** Hide what doesn't fit on one line and append a +N that reveals the rest. */
function truncate(line, controls) {
  requestAnimationFrame(() => {
    const items = [...line.querySelectorAll(":scope > *")];
    const more = h(`<button type="button" class="more"></button>`);
    line.append(more);
    let hidden = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (line.scrollWidth <= line.clientWidth) break;
      items[index].hidden = true;
      hidden += 1;
    }
    if (hidden === 0) {
      more.remove();
      return;
    }
    more.textContent = `+${hidden}`;
    const rest = controls.slice(controls.length - hidden);
    more.onclick = () => showList(line.closest(".tile"), "Also applied", rest);
  });
}

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

const OVERFLOW = {
  truncate: {
    name: "Truncate",
    note: "Show what fits, then +N. The chart keeps its height; the reader has to click for the rest.",
  },
  wrap: {
    name: "Wrap",
    note: "Every control stays readable, and the chart loses a row of height for each extra line.",
  },
  summary: {
    name: "Summarise",
    note: "One chip with the count, the list on click. Constant width at any number.",
  },
  scroll: {
    name: "Scroll",
    note: "One line that scrolls sideways. Cheap to build, and what is off-screen is easy to miss.",
  },
};

/* -------------------------------------------------------------- render -- */

function tile(controls, { style, overflow }) {
  const element = h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">Revenue</span></div>
    <div class="tile-body">${chart(SALES)}</div>
  </div>`);

  const line = h(`<div class="line ${overflow}"></div>`);
  if (overflow === "summary") {
    const chip = h(
      `<button type="button" class="chip pressable"><span class="field">Showing</span><span class="value">${controls.length} settings</span></button>`,
    );
    chip.onclick = () => showList(element, "Applied", controls);
    line.append(chip);
  } else {
    for (const control of controls) line.append(STYLES[style].render(control));
  }

  element.querySelector(".tile-head").after(line);
  if (overflow === "truncate") truncate(line, controls);
  return element;
}

/** The workbench row where the author writes what the reader will see. */
function authorRow(control, onChange) {
  const row = h(`<div class="pane-row">
    <div class="pane-field">${control.field}</div>
    <label class="pane-label">Label
      <input class="pane-input" value="${control.label}" placeholder="No label" />
    </label>
  </div>`);
  row.querySelector("input").oninput = (event) => {
    control.label = event.target.value;
    onChange();
  };
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
      tile(active(), { style: key, overflow: "wrap" }),
    );
    styleGrid.append(cell);
  }
  page.append(styleGrid);

  page.append(
    section(
      "Authoring · where the words come from",
      "The item pane in the workbench. Type a label and the tile above it changes. Clear one to see the control fall back to its value alone — which is often enough, and is how a limit should read.",
    ),
  );
  const authoring = h(`<div class="authoring"></div>`);
  const preview = h(`<div class="authoring-preview"></div>`);
  const pane = h(`<div class="pane"></div>`);
  const refresh = () => {
    preview.replaceChildren(
      tile(active(), { style: state.style, overflow: "wrap" }),
    );
  };
  for (const control of active()) pane.append(authorRow(control, refresh));
  refresh();
  authoring.append(pane, preview);
  page.append(authoring);

  page.append(
    section(
      "Overflow · when they don't fit",
      "The chosen style at the current width and count. Turn the count up to 6 and narrow the page to push each strategy past its limit.",
    ),
  );
  const overflowGrid = h(`<div class="grid"></div>`);
  for (const [key, mode] of Object.entries(OVERFLOW)) {
    const cell = h(`<div></div>`);
    cell.append(
      h(`<div class="caption"><b>${mode.name}</b> — ${mode.note}</div>`),
      tile(active(), { style: state.style, overflow: key }),
    );
    overflowGrid.append(cell);
  }
  page.append(overflowGrid);
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
      { label: "Kind", value: "kind" },
      { label: "Instead of label", value: "replace" },
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

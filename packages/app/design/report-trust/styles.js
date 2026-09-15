// Prototype 3 — how an exposed filter is drawn, and what happens when a tile
// has more of them than fit.
//
// Only filters the author deliberately exposed appear here. Hidden ones are
// absent from the tile entirely, so nothing on this page counts or hints at
// them. A count over *visible* filters is fair game: the author already chose
// to disclose those.

import { chart, h, shell } from "./shared.js";

const state = { count: 3, narrow: false };

const SALES = [42, 58, 35, 71, 49, 63, 38];

// A runtime control is not always a filter. An Insight declares three kinds
// (InsightRuntimeDeclaration): any number of filters, one sort, one limit.
// They read differently and they matter differently — a limit changes what a
// reader concludes about magnitude, and unlike a filter value it is rarely
// confidential, so the argument for hiding it by default is weaker.
const CONTROLS = [
  { kind: "filter", field: "Region", verb: "is", value: "EMEA" },
  { kind: "sort", field: "Revenue", value: "high to low" },
  { kind: "limit", value: "10" },
  { kind: "filter", field: "Date", verb: "in", value: "last 12 months" },
  { kind: "filter", field: "Segment", verb: "is", value: "Enterprise" },
  { kind: "filter", field: "Channel", verb: "is not", value: "Partner" },
];

/** How each kind reads as a fact: a lead-in, and the value that carries it. */
function phrase(control) {
  if (control.kind === "sort") {
    return { lead: `Sorted by ${control.field},`, value: control.value };
  }
  if (control.kind === "limit") {
    return { lead: "Top", value: control.value };
  }
  return { lead: `${control.field} ${control.verb}`, value: control.value };
}

/** How each kind reads as a control: a field label, and its value. */
function pair(control) {
  if (control.kind === "sort") {
    return { label: "Sort", value: `${control.field} ${control.value}` };
  }
  if (control.kind === "limit") {
    return { label: "Limit", value: `Top ${control.value}` };
  }
  return { label: control.field, value: control.value };
}

const active = () => CONTROLS.slice(0, state.count);

/* ------------------------------------------------------------- styles -- */

const STYLES = {
  chip: {
    name: "Sentence chip",
    note: "A flat chip read as a statement. Most legible, widest.",
    render: (control) => {
      const { lead, value } = phrase(control);
      return h(
        `<span class="chip ${control.kind}"><span class="field">${lead}</span><span class="value">${value}</span></span>`,
      );
    },
  },
  text: {
    name: "Plain text",
    note: "No container at all — a caption under the title. Lightest, and the least likely to be mistaken for a control.",
    render: (control) => {
      const { lead, value } = phrase(control);
      return h(
        `<span class="run"><span class="field">${lead}</span> <span class="value">${value}</span></span>`,
      );
    },
  },
  twotone: {
    name: "Label + value",
    note: "The well's two-tone pairing without the box. Scans as a list of fields — and drops the operator, so `is not Partner` reads as `Channel Partner`.",
    render: (control) => {
      const { label, value } = pair(control);
      return h(
        `<span class="pair"><span class="field">${label}</span><span class="value">${value}</span></span>`,
      );
    },
  },
  grouped: {
    name: "One chip",
    note: "Every setting in a single container. Reads as one fact about the chart, costs the least width each, and is the first to run out of room as a whole.",
    render: null,
    renderAll: (controls) =>
      h(
        `<span class="chip group"><span class="field">Showing</span>${controls
          .map((control) => {
            const { lead, value } = phrase(control);
            return `<span class="value">${lead} ${value}</span>`;
          })
          .join(`<span class="sep">·</span>`)}</span>`,
      ),
  },
};

/* ----------------------------------------------------------- overflow -- */

/** Hide what doesn't fit on one line and append a +N that reveals the rest. */
function truncate(line, filters) {
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
    const rest = filters.slice(filters.length - hidden);
    more.onclick = () => {
      const open = line.querySelector(".pop");
      if (open) {
        open.remove();
        return;
      }
      line.closest(".tile").append(
        h(
          `<div class="pop"><div class="pop-title">Also applied</div><ul>${rest
            .map((control) => {
              const { lead, value } = phrase(control);
              return `<li>${lead} ${value}</li>`;
            })
            .join("")}</ul></div>`,
        ),
      );
    };
  });
}

const OVERFLOW = {
  truncate: {
    name: "Truncate",
    note: "Show what fits, then +N. The chart keeps its height; the reader has to click for the rest.",
  },
  wrap: {
    name: "Wrap",
    note: "Every setting stays readable, and the chart loses a line of height for each extra row.",
  },
  summary: {
    name: "Summarise",
    note: "One chip with the count, the list on click. Constant width no matter how many there are.",
  },
  scroll: {
    name: "Scroll",
    note: "One line that scrolls sideways. Cheap to build, and what is off-screen is easy to miss.",
  },
};

/* -------------------------------------------------------------- render -- */

function tile(filters, { style, overflow }) {
  const element = h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">Revenue</span></div>
    <div class="tile-body">${chart(SALES)}</div>
  </div>`);

  const line = h(`<div class="line ${overflow}"></div>`);

  if (overflow === "summary") {
    const chip = h(
      `<button type="button" class="chip pressable"><span class="field">Showing</span><span class="value">${filters.length} settings</span></button>`,
    );
    chip.onclick = () => {
      const open = element.querySelector(".pop");
      if (open) {
        open.remove();
        return;
      }
      element.append(
        h(
          `<div class="pop"><div class="pop-title">Applied</div><ul>${filters
            .map((control) => {
              const { lead, value } = phrase(control);
              return `<li>${lead} ${value}</li>`;
            })
            .join("")}</ul></div>`,
        ),
      );
    };
    line.append(chip);
  } else if (STYLES[style].renderAll) {
    line.append(STYLES[style].renderAll(filters));
  } else {
    for (const filter of filters) line.append(STYLES[style].render(filter));
  }

  element.querySelector(".tile-head").after(line);
  if (overflow === "truncate" && !STYLES[style].renderAll) {
    truncate(line, filters);
  }
  return element;
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
      "Style · the same settings, four ways",
      "All four are read-only facts, not controls. A runtime control is not always a filter — the set below is a filter, a sort and a limit, which read differently. Compare them at both widths and with the count turned up.",
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
      "Overflow · when they don't fit",
      "The sentence chip at the current width and count. Turn the count up to 6 and narrow the page to push each strategy past its limit.",
    ),
  );
  const overflowGrid = h(`<div class="grid"></div>`);
  for (const [key, mode] of Object.entries(OVERFLOW)) {
    const cell = h(`<div></div>`);
    cell.append(
      h(`<div class="caption"><b>${mode.name}</b> — ${mode.note}</div>`),
      tile(active(), { style: "chip", overflow: key }),
    );
    overflowGrid.append(cell);
  }
  page.append(overflowGrid);
}

const { page } = shell("Filter styles", [
  {
    label: "Settings",
    value: 3,
    options: [1, 2, 3, 6].map((n) => ({ label: String(n), value: n })),
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

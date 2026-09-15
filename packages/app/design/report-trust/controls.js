// Prototype 1 — what a filter looks like on a tile, per cell of the model.
//
// visible and changeable are independent props. Three cells are legal on an
// item; the fourth (hidden + changeable) is only ever produced by a
// report-level control absorbing the item's knob.

import { CARET, FUNNEL, chart, h, shell } from "./shared.js";

const state = { narrow: false, mark: true };

const SALES = [42, 58, 35, 71, 49, 63, 38];

function markEl(count, filters) {
  const wrap = h(
    `<span class="mark" tabindex="0" role="button" aria-label="${count} filters applied">${FUNNEL}${count}</span>`,
  );
  let pop = null;
  const show = () => {
    if (pop) return;
    pop = h(
      `<div class="pop"><div class="pop-title">Filtered by</div><ul>${filters
        .map((filter) => `<li>${filter}</li>`)
        .join("")}</ul></div>`,
    );
    wrap.closest(".tile").append(pop);
  };
  const hide = () => {
    pop?.remove();
    pop = null;
  };
  wrap.onmouseenter = show;
  wrap.onmouseleave = hide;
  wrap.onfocus = show;
  wrap.onblur = hide;
  return wrap;
}

function tile({ title, line = [], filters = [], highlight = -1 }) {
  const element = h(`<div class="tile">
    <div class="tile-head">
      <span class="tile-title">${title}</span>
      <span class="spacer"></span>
    </div>
    <div class="tile-body">${chart(SALES, { highlight })}</div>
  </div>`);

  if (state.mark && filters.length > 0) {
    element.querySelector(".tile-head").append(markEl(filters.length, filters));
  }
  if (line.length > 0) {
    const lineEl = h(`<div class="line"></div>`);
    for (const item of line) lineEl.append(item);
    element.querySelector(".tile-head").after(lineEl);
  }
  return element;
}

/** Variant A — the same well as a changeable control, disabled. */
function disabledWell(label) {
  return h(
    `<span class="well" disabled aria-disabled="true" title="Region">${label}${CARET}</span>`,
  );
}

/** Variant B — a flat chip. A fact about the chart, not a control. */
function readonlyChip(label) {
  return h(`<span class="chip" title="Region">${label}</span>`);
}

/** A changeable control: a well the reader can open. */
function liveWell(label, options) {
  const well = h(
    `<button type="button" class="well" title="Region">${label}${CARET}</button>`,
  );
  well.onclick = () => {
    const current = well.firstChild.textContent;
    const next = options[(options.indexOf(current) + 1) % options.length];
    well.firstChild.textContent = next;
  };
  return well;
}

function unsetWell(label) {
  return h(
    `<button type="button" class="well unset">${label}${CARET}</button>`,
  );
}

function render(page) {
  page.classList.toggle("narrow", state.narrow);
  page.replaceChildren();

  page.append(
    h(`<div class="section">Item level · the three legal cells</div>`),
  );

  const grid = h(`<div class="grid"></div>`);

  const wrap = (caption, node) => {
    const cell = h(`<div></div>`);
    cell.append(h(`<div class="caption">${caption}</div>`), node);
    return cell;
  };

  grid.append(
    wrap(
      `<b>hidden + fixed</b> — the default. Six filters are applied and none of them are on the face. The mark is the only route to them.`,
      tile({
        title: "Revenue",
        filters: [
          "Status is Completed",
          "Region is EMEA",
          "Channel is not Internal",
          "Amount is not null",
          "Order date in last 12 months",
          "Top 7 by revenue",
        ],
      }),
    ),
  );

  grid.append(
    wrap(
      `<b>visible + fixed · A</b> — the changeable control's shape, disabled. Reads as "a control you can't use", and a reader asks why not.`,
      tile({
        title: "Revenue",
        line: [
          disabledWell("EMEA"),
          disabledWell("Last 12 months"),
          disabledWell("Enterprise"),
        ],
        filters: [
          "Region is EMEA",
          "Order date in last 12 months",
          "Segment is Enterprise",
        ],
      }),
    ),
  );

  grid.append(
    wrap(
      `<b>visible + fixed · B</b> — a flat chip. Reads as a fact about the chart. Nothing suggests it could have been otherwise.`,
      tile({
        title: "Revenue",
        line: [
          readonlyChip("EMEA"),
          readonlyChip("Last 12 months"),
          readonlyChip("Enterprise"),
        ],
        filters: [
          "Region is EMEA",
          "Order date in last 12 months",
          "Segment is Enterprise",
        ],
      }),
    ),
  );

  grid.append(
    wrap(
      `<b>visible + changeable</b> — a well, because it takes a value. Click to change it. The dashed one has no value yet.`,
      tile({
        title: "Revenue",
        line: [
          liveWell("EMEA", ["EMEA", "APAC", "Americas", "All regions"]),
          unsetWell("Segment"),
        ],
        filters: ["Region is EMEA"],
        highlight: 3,
      }),
    ),
  );

  page.append(grid);

  page.append(
    h(
      `<div class="section">Report level · where the fourth cell comes from</div>`,
    ),
  );
  page.append(
    h(
      `<div class="caption">A report control bound to this item absorbs its knob. The filter is still <b>changeable</b> — the control just lives one level up, where it fans out to every tile bound to it. That is the only way <b>hidden + changeable</b> is ever produced, and the reader can still see the control.</div>`,
    ),
  );

  const controlBar = h(`<div class="line" style="padding-bottom:14px"></div>`);
  controlBar.append(
    liveWell("EMEA", ["EMEA", "APAC", "Americas", "All regions"]),
    liveWell("Last 12 months", [
      "Last 12 months",
      "Last quarter",
      "Year to date",
    ]),
  );
  page.append(controlBar);

  const grid2 = h(`<div class="grid"></div>`);
  grid2.append(
    wrap(
      `Bound to the Region control above. No knob of its own.`,
      tile({ title: "Revenue", filters: ["Region is EMEA (report control)"] }),
    ),
  );
  grid2.append(
    wrap(
      `Not bound. Its own filters stay hidden.`,
      tile({
        title: "Orders",
        filters: ["Status is Completed", "Amount is not null"],
        highlight: 5,
      }),
    ),
  );
  page.append(grid2);
}

const { page } = shell("Filter exposure", [
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
  {
    label: "Filtered mark",
    value: true,
    options: [
      { label: "On", value: true },
      { label: "Off", value: false },
    ],
    onChange: (value) => {
      state.mark = value;
      render(page);
    },
  },
]);

render(page);

// Prototype 1 — what a filter looks like on a tile, per cell of the model.
//
// visible and changeable are independent props. Three cells are legal on an
// item; the fourth (hidden + changeable) is only ever produced by a
// report-level control absorbing the item's knob.

import { CARET, chart, h, shell } from "./shared.js";

const state = { narrow: false };

const SALES = [42, 58, 35, 71, 49, 63, 38];

function tile({ title, line = [], highlight = -1 }) {
  const element = h(`<div class="tile">
    <div class="tile-head">
      <span class="tile-title">${title}</span>
      <span class="spacer"></span>
    </div>
    <div class="tile-body">${chart(SALES, { highlight })}</div>
  </div>`);

  if (line.length > 0) {
    const lineEl = h(`<div class="line"></div>`);
    for (const item of line) lineEl.append(item);
    element.querySelector(".tile-head").after(lineEl);
  }
  return element;
}

// A value on its own ("EMEA") says nothing about what it filters. Every
// exposed control names its field; only the shape of the naming differs,
// because a fact and a control are read differently.

/** Variant A — the same well as a changeable control, disabled. */
function disabledWell(field, value) {
  return h(
    `<span class="well" disabled aria-disabled="true"><span class="field">${field}</span><span class="value">${value}</span>${CARET}</span>`,
  );
}

/** Variant B — a flat chip, read as a sentence. A fact, not a control. */
function readonlyChip(field, verb, value) {
  return h(
    `<span class="chip"><span class="field">${field} ${verb}</span><span class="value">${value}</span></span>`,
  );
}

/** A changeable control: a well the reader can open. */
function liveWell(field, options) {
  const well = h(
    `<button type="button" class="well"><span class="field">${field}</span><span class="value">${options[0]}</span>${CARET}</button>`,
  );
  well.onclick = () => {
    const value = well.querySelector(".value");
    const index = options.indexOf(value.textContent);
    value.textContent = options[(index + 1) % options.length];
  };
  return well;
}

/** A changeable control with no value yet. Dashed means choose. */
function unsetWell(field) {
  return h(
    `<button type="button" class="well unset"><span class="field">${field}</span><span class="value">Any</span>${CARET}</button>`,
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
      `<b>hidden + fixed</b> — the default. Six filters are applied and the reader is told nothing: no values, no count, no hint that any exist. A filter value can be confidential.`,
      tile({
        title: "Revenue",
      }),
    ),
  );

  grid.append(
    wrap(
      `<b>visible + fixed · A</b> — the changeable control's shape, disabled. Reads as "a control you can't use", and a reader asks why not.`,
      tile({
        title: "Revenue",
        line: [
          disabledWell("Region", "EMEA"),
          disabledWell("Date", "Last 12 months"),
          disabledWell("Segment", "Enterprise"),
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
          readonlyChip("Region", "is", "EMEA"),
          readonlyChip("Date", "in", "last 12 months"),
          readonlyChip("Segment", "is", "Enterprise"),
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
          liveWell("Region", ["EMEA", "APAC", "Americas", "All regions"]),
          unsetWell("Segment"),
        ],
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
    liveWell("Region", ["EMEA", "APAC", "Americas", "All regions"]),
    liveWell("Date", ["Last 12 months", "Last quarter", "Year to date"]),
  );
  page.append(controlBar);

  const grid2 = h(`<div class="grid"></div>`);
  grid2.append(
    wrap(
      `Bound to the Region control above. No knob of its own.`,
      tile({ title: "Revenue" }),
    ),
  );
  grid2.append(
    wrap(
      `Not bound. Its own filters stay hidden.`,
      tile({
        title: "Orders",
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
]);

render(page);

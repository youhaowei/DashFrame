// Prototype 4 — the control line as three categories with their own buttons,
// the way a Notion database toolbar reads: Filter and Sort are buttons you
// open, not chips you decode.
//
// The decided model says filter, sort, and limit are three separate
// categories, that pinned controls are always on the chart, and that visible
// ones appear when the reader opens the category. This page draws that and
// leaves the four things it did not settle switchable from the top bar:
// group ORDER, what SEPARATES one group from the next, the BUTTON form, and
// whether all three kinds get a button or only filters do.

import { CARET, chart, h, shell } from "./shared.js";

const SALES = [42, 58, 35, 71, 49, 63, 38];

const state = {
  order: "shape-first",
  separator: "gap",
  button: "word",
  scope: "all",
  narrow: false,
};

// The author's disclosure. `pin` puts a control on the face; a visible control
// without a pin lives behind its category button. Hidden controls are absent
// from this list entirely — the reader is never told they exist.
const MODEL = {
  sort: { label: "Sort", value: "Revenue, high to low", pin: true, changeable: true },
  limit: { label: "Rows", value: "Top 10", pin: false, changeable: true },
  filters: [
    { label: "Region", value: "EMEA", pin: true, changeable: true },
    { label: "Segment", value: "Enterprise", pin: true, changeable: false },
    { label: "Period", value: "Last 12 months", pin: false, changeable: true },
    { label: "Channel", value: "Direct only", pin: false, changeable: true },
  ],
};

// Reader turns, session-local. Keyed by label; never written anywhere.
const turned = new Map();

const GLYPH = {
  // The design system has no funnel. These stand in so the axis can be judged;
  // adopting one is a libs/stdui change with its own repo and gate.
  Filter: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 2.5h9L7 6.8v3L5 10.8V6.8L1.5 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  Sort: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3.5 2v8M3.5 10 2 8.5M3.5 10 5 8.5M8.5 10V2M8.5 2 7 3.5M8.5 2 10 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  Rows: `<svg class="glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 3h9M1.5 6h9M1.5 9h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
};

/** A fact: flat chip, terse, no copula. Label quiet, value strong. */
function chip(label, value) {
  return h(
    `<span class="chip"><span class="field">${label}</span><span class="value">${value}</span></span>`,
  );
}

/**
 * A knob: a well the reader can open. Turning it is session-local.
 *
 * Inside a popover the row already names the field, so the well carries only
 * its value — repeating the label there is the verbosity the chip decision
 * removed from the face.
 */
function well(label, value, onTurn, { bare = false } = {}) {
  const shown = turned.get(label) ?? value;
  const name = bare ? "" : `<span class="field">${label}</span>`;
  const element = h(
    `<button type="button" class="well"><span class="value">${shown}</span>${CARET}</button>`,
  );
  if (name) element.prepend(h(name));
  element.onclick = () => onTurn(label);
  return element;
}

/** A category button. Its form is the axis under test. */
function categoryButton(kind, members, onOpen) {
  const exposed = members.length;
  const set = members.some((m) => turned.has(m.label));
  const inner =
    state.button === "glyph"
      ? GLYPH[kind]
      : state.button === "word"
        ? kind
        : `${GLYPH[kind]}<span>${kind}</span>`;
  // A count reflects only EXPOSED controls. A hidden one must never widen it.
  const count =
    state.button === "count" && exposed > 1
      ? `<span class="count">${exposed}</span>`
      : "";
  const button = h(
    `<button type="button" class="cat${set ? " set" : ""}" aria-expanded="false" aria-label="${kind}">${inner}${count}</button>`,
  );
  button.onclick = (event) => {
    event.stopPropagation();
    onOpen(button, kind, members);
  };
  return button;
}

/** The popover for one category: every exposed control of that kind. */
function categoryPopover(kind, members, onTurn) {
  const pop = h(`<div class="pop cat-pop"></div>`);
  pop.append(h(`<div class="pop-title">${kind}</div>`));
  for (const member of members) {
    const row = h(`<div class="row"></div>`);
    row.append(h(`<span class="field">${member.label}</span>`));
    row.append(
      member.changeable
        ? well(member.label, member.value, onTurn, { bare: true })
        : h(
            `<span class="chip"><span class="value">${turned.get(member.label) ?? member.value}</span></span>`,
          ),
    );
    pop.append(row);
  }
  pop.append(
    h(
      `<div class="foot">${members.some((m) => m.changeable) ? "Changes last for this visit only." : "Fixed by the author."}</div>`,
    ),
  );
  return pop;
}

function separator() {
  if (state.separator === "rule") return h(`<span class="rule"></span>`);
  if (state.separator === "gap") return h(`<span class="gap"></span>`);
  return null; // "none" — one flat line, which is what the branch shipped.
}

function buildLine(rerender) {
  const line = h(`<div class="line wrap"></div>`);

  const openPopover = (button, kind, members) => {
    const existing = line.querySelector(".cat-pop");
    const wasMine = existing?.dataset.kind === kind;
    for (const b of line.querySelectorAll(".cat"))
      b.setAttribute("aria-expanded", "false");
    existing?.remove();
    if (wasMine) return;
    const pop = categoryPopover(kind, members, (label) => {
      const member = members.find((m) => m.label === label);
      const options = [member.value, "— any —", "Changed by reader"];
      const current = turned.get(label) ?? member.value;
      const next = options[(options.indexOf(current) + 1) % options.length];
      if (next === member.value) turned.delete(label);
      else turned.set(label, next);
      rerender();
    });
    pop.dataset.kind = kind;
    button.setAttribute("aria-expanded", "true");
    button.parentElement.append(pop);
  };

  // One category becomes: its pinned controls drawn on the face, then a button
  // if anything exposed is not pinned. A category with nothing exposed at all
  // contributes nothing — not a button, not a gap.
  const group = (kind, members) => {
    const parts = [];
    for (const member of members.filter((m) => m.pin)) {
      parts.push(
        member.changeable
          ? well(member.label, member.value, (label) => {
              const current = turned.get(label) ?? member.value;
              if (current === member.value) turned.set(label, "Changed by reader");
              else turned.delete(label);
              rerender();
            })
          : chip(member.label, turned.get(member.label) ?? member.value),
      );
    }
    const unpinned = members.filter((m) => !m.pin);
    const wantsButton =
      unpinned.length > 0 && (state.scope === "all" || kind === "Filter");
    if (wantsButton) {
      const wrap = h(`<span class="pop-wrap"></span>`);
      wrap.append(categoryButton(kind, unpinned, openPopover));
      parts.push(wrap);
    } else {
      // No button for this kind: an unpinned control has nowhere to go, so it
      // falls back onto the face. This is the "filters only" case showing its
      // cost — the shape groups stop being fixed-width.
      for (const member of unpinned) {
        parts.push(
          member.changeable
            ? well(member.label, member.value, (label) => {
                if (turned.has(label)) turned.delete(label);
                else turned.set(label, "Changed by reader");
                rerender();
              })
            : chip(member.label, member.value),
        );
      }
    }
    return parts;
  };

  const sort = group("Sort", [MODEL.sort]);
  const rows = group("Rows", [MODEL.limit]);
  const filters = group("Filter", MODEL.filters);

  const order =
    state.order === "shape-first"
      ? [sort, rows, filters]
      : state.order === "limit-first"
        ? [rows, sort, filters]
        : [filters, sort, rows];

  let first = true;
  for (const parts of order) {
    if (parts.length === 0) continue;
    if (!first) {
      const sep = separator();
      if (sep) line.append(sep);
    }
    for (const part of parts) line.append(part);
    first = false;
  }
  document.addEventListener("click", () => {
    const pop = line.querySelector(".cat-pop");
    if (!pop) return;
    pop.remove();
    for (const b of line.querySelectorAll(".cat"))
      b.setAttribute("aria-expanded", "false");
  });
  return line;
}

function tile(rerender) {
  const element = h(`<div class="tile">
    <div class="tile-head">
      <span class="tile-title">Revenue</span>
      <span class="spacer"></span>
    </div>
    <div class="tile-body">${chart(SALES, { highlight: 3 })}</div>
    <div class="tile-foot">Updated 4 minutes ago</div>
  </div>`);
  element.querySelector(".tile-head").after(buildLine(rerender));
  return element;
}

function note(html) {
  return h(`<p class="tile-note">${html}</p>`);
}

function render(page) {
  page.classList.toggle("narrow", state.narrow);
  page.replaceChildren();
  const rerender = () => render(page);

  page.append(
    h(`<div class="section">Reader's tile</div>`),
    note(
      `Pinned controls are on the face. Everything else exposed sits behind its category button — <b>open Filter</b>. Turn something and the button carries that it is set.`,
    ),
  );
  const grid = h(`<div class="grid"></div>`);
  grid.append(tile(rerender));
  page.append(grid);

  page.append(
    h(`<div class="section">What the author hid</div>`),
    note(
      `Two filters on this chart are <b>hidden</b> and appear nowhere above: not as a chip, not in a popover, not as a number on the Filter button. A count that included them would be the passive "this chart is filtered" mark, wearing a button.`,
    ),
  );
}

const { page } = shell("CATEGORIES", [
  {
    label: "ORDER",
    value: state.order,
    options: [
      { label: "Sort · Rows · Filter", value: "shape-first" },
      { label: "Rows · Sort · Filter", value: "limit-first" },
      { label: "Filter first", value: "filters-first" },
    ],
    onChange: (value) => {
      state.order = value;
      render(page);
    },
  },
  {
    label: "SEPARATOR",
    value: state.separator,
    options: [
      { label: "Gap", value: "gap" },
      { label: "Rule", value: "rule" },
      { label: "None", value: "none" },
    ],
    onChange: (value) => {
      state.separator = value;
      render(page);
    },
  },
  {
    label: "BUTTON",
    value: state.button,
    options: [
      { label: "Word", value: "word" },
      { label: "Glyph", value: "glyph" },
      { label: "Both", value: "both" },
      { label: "Word + count", value: "count" },
    ],
    onChange: (value) => {
      state.button = value;
      render(page);
    },
  },
  {
    label: "BUTTONS FOR",
    value: state.scope,
    options: [
      { label: "All three", value: "all" },
      { label: "Filters only", value: "filters" },
    ],
    onChange: (value) => {
      state.scope = value;
      render(page);
    },
  },
  {
    label: "WIDTH",
    value: state.narrow,
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

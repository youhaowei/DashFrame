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
  order: "filters-first",
  filterAt: "right",
  button: "glyph",
  affordance: "caret",
  scope: "all",
  narrow: false,
};

// The author's disclosure. `pin` puts a control on the face; a visible control
// without a pin lives behind its category button. Hidden controls are absent
// from this list entirely — the reader is never told they exist.
const MODEL = {
  sort: {
    label: "Sort",
    value: "Revenue, high to low",
    keys: ["Revenue, high to low"],
    pin: true,
    changeable: true,
  },
  limit: { label: "Rows", value: "10", pin: false, changeable: true },
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

/**
 * A fact: flat chip, terse, no copula. Label quiet, value strong.
 *
 * `kind` marks what is NOT a filter. A filter is the ordinary runtime control,
 * so a funnel down a line of them is noise; a sort and a limit are the
 * exceptions and lead with their glyph instead of a kind word. That keeps
 * `Sort` and `Rows` out of the text, which is the same word the category
 * grouping already establishes.
 */
function chip(label, value, kind) {
  const mark = kind && kind !== "Filter" ? GLYPH[kind] : "";
  const name = label ? `<span class="field">${label}</span>` : "";
  return h(
    `<span class="chip">${mark}${name}<span class="value">${value}</span></span>`,
  );
}

/**
 * A knob: a well the reader can open. Turning it is session-local.
 *
 * Inside a popover the row already names the field, so the well carries only
 * its value — repeating the label there is the verbosity the chip decision
 * removed from the face.
 */
function well(label, value, onTurn, { bare = false, kind } = {}) {
  const shown = turned.get(label) ?? value;
  const mark = kind && kind !== "Filter" ? GLYPH[kind] : "";
  const name = bare ? "" : `<span class="field">${label}</span>`;
  const element = h(
    `<button type="button" class="well">${mark}${name}<span class="value">${shown}</span>${CARET}</button>`,
  );
  element.onclick = () => onTurn(label);
  return element;
}

/**
 * A non-filter control on the face: glyph, no container.
 *
 * Sort and limit are the marked kinds, so they are drawn flat like their
 * category button rather than as a pill — the pill is what says "filter". They
 * are still controls, so a changeable one is a real button with hover, focus,
 * and a caret; a fixed one is the same shape, inert and without one.
 *
 * **Sort shows no value.** An order is a mechanism, not a claim the chart
 * makes: a reader does not need "Revenue, high to low" spelled out to read the
 * bars, because the bars already show it. It is the glyph alone, plus a count
 * when the sort carries more than one key — the only case where the face
 * cannot be inferred from the chart. The keys are in the popover.
 *
 * **A limit shows its number, bare.** A limit hides the tail, which changes
 * what a reader concludes and cannot be recovered by looking at the chart — so
 * unlike a sort it has to be on the face. `Top` is the kind word the glyph
 * already carries, so it goes the way `Sort` and `Rows` did: `≡ 10`.
 *
 * A limit's number is a VALUE and a sort's is a COUNT, so they are not drawn
 * alike: the limit is a bare bold numeral, the sort's key count a tag. Same
 * digits, different claim.
 */
function flat(member, kind, onTurn) {
  const shown = turned.get(member.label) ?? member.value;
  const set = turned.has(member.label);
  const keys = member.keys?.length ?? 0;
  const body =
    kind === "Sort"
      ? keys > 1
        ? `<span class="count">${keys}</span>`
        : ""
      : `<span class="value">${shown}</span>`;
  if (!member.changeable) {
    return h(
      `<span class="flat" aria-disabled="true" aria-label="${kind}">${GLYPH[kind]}${body}</span>`,
    );
  }
  const element = h(
    `<button type="button" class="flat${set ? " set" : ""}" aria-label="${kind}">${GLYPH[kind]}${body}${CARET}</button>`,
  );
  element.onclick = () => onTurn(member.label);
  return element;
}

/** A category button. Its form is the axis under test. */
function categoryButton(kind, members, onOpen, exposedTotal) {
  const exposed = exposedTotal ?? members.length;
  const set = members.some((m) => turned.has(m.label));
  const inner =
    state.button === "glyph"
      ? GLYPH[kind]
      : state.button === "word"
        ? kind
        : `${GLYPH[kind]}<span>${kind}</span>`;
  // The count is EVERY exposed control of this kind, not just the ones behind
  // the button. Counting only what is hidden reads as a count of what is shown
  // the moment the glyph sits beside its own pills — "2" next to two pills
  // looks like it labels them. Counting the whole group is unambiguous in both
  // placements: the glyph heads the category, and the number is how big the
  // category is.
  //
  // A hidden control is still not in it. It must never widen the count, appear
  // in the popover, or raise the tag — that is the rule the button carries.
  //
  // It is only ever informative for filters. A declaration carries exactly one
  // sort and one limit, so those buttons would read "1" forever: a tag that
  // never varies is furniture. Sort is the arguable case, since a sort may
  // carry up to maxKeys fields, but this model has one.
  // What tells a reader this glyph opens? A caret says it plainly and says
  // nothing else — the same caret a well uses, so "openable" has one mark
  // across the tile. A count says how many as well, at the price of a second
  // shape and of being informative for filters only.
  const informative = exposed > 1;
  const affordance =
    state.affordance === "caret"
      ? CARET
      : state.affordance === "count" && informative
        ? `<span class="count">${exposed}</span>`
        : "";
  const button = h(
    `<button type="button" class="cat${set ? " set" : ""}" aria-expanded="false" aria-label="${kind}">${inner}${affordance}</button>`,
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

function buildLine(rerender, model = MODEL) {
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
      // A sort or limit leads with its glyph, drops its kind word, and is
      // drawn flat — the pill belongs to filters. A filter keeps its field
      // name, takes no mark, and keeps its pill.
      const isFilter = kind === "Filter";
      const turn = (label) => {
        const current = turned.get(label) ?? member.value;
        if (current === member.value) turned.set(label, "Changed by reader");
        else turned.delete(label);
        rerender();
      };
      parts.push(
        isFilter
          ? member.changeable
            ? well(member.label, member.value, turn, { kind })
            : chip(member.label, turned.get(member.label) ?? member.value, kind)
          : flat(member, kind, turn),
      );
    }
    const unpinned = members.filter((m) => !m.pin);
    const wantsButton =
      unpinned.length > 0 && (state.scope === "all" || kind === "Filter");
    if (wantsButton) {
      const wrap = h(`<span class="pop-wrap"></span>`);
      wrap.append(categoryButton(kind, unpinned, openPopover, members.length));
      parts.push(wrap);
    } else {
      // No button for this kind: an unpinned control has nowhere to go, so it
      // falls back onto the face. This is the "filters only" case showing its
      // cost — the shape groups stop being fixed-width.
      for (const member of unpinned) {
        const isFilter = kind === "Filter";
        const turn = (label) => {
          if (turned.has(label)) turned.delete(label);
          else turned.set(label, "Changed by reader");
          rerender();
        };
        parts.push(
          isFilter
            ? member.changeable
              ? well(member.label, member.value, turn, { kind })
              : chip(member.label, member.value, kind)
            : flat(member, kind, turn),
        );
      }
    }
    return parts;
  };

  const sort = group("Sort", [model.sort]);
  const rows = group("Rows", [model.limit]);
  const filters = group("Filter", model.filters);

  const order =
    state.order === "filters-first"
      ? [filters, sort, rows]
      : state.order === "shape-first"
        ? [sort, rows, filters]
        : [rows, sort, filters];

  // Pills left, glyphs right. A pill carries a value the reader reads as part
  // of the chart's claim; a glyph is a way in. Splitting them by alignment is
  // what a Notion toolbar does, and it separates the two kinds of thing more
  // firmly than a gap between three same-looking groups ever did.
  const pills = [];
  const glyphs = [];
  let filterGlyph = null;
  for (const parts of order) {
    for (const part of parts) {
      const element = part.classList.contains("pop-wrap")
        ? part.firstElementChild
        : part;
      if (
        element.classList.contains("chip") ||
        element.classList.contains("well")
      ) {
        pills.push(part);
      } else if (element.getAttribute("aria-label") === "Filter") {
        filterGlyph = part;
      } else {
        glyphs.push(part);
      }
    }
  }

  // Where the filter glyph goes is the question. On the RIGHT it joins the
  // other ways-in, and the clusters split cleanly by kind: values left,
  // mechanisms right. At the BEGINNING it leads the pills it owns — the pills
  // are filters and the glyph opens more of them — and the right cluster then
  // holds only the mechanisms that have no pills of their own.
  // Two columns, not one wrapping flow. The pills wrap among themselves on the
  // left; the glyph cluster is its own column and stays at the top right. In
  // one shared flow the cluster lands wherever the wrap happens to leave it —
  // beside whichever pill ends the last row — which reads as a relationship
  // that is not there.
  const pillColumn = h(`<span class="pills"></span>`);
  if (state.filterAt === "left" && filterGlyph) pillColumn.append(filterGlyph);
  for (const pill of pills) pillColumn.append(pill);
  line.append(pillColumn);

  const cluster = h(`<span class="glyphs"></span>`);
  if (state.filterAt === "right" && filterGlyph) cluster.append(filterGlyph);
  for (const glyph of glyphs) cluster.append(glyph);
  if (cluster.childElementCount > 0) line.append(cluster);

  document.addEventListener("click", () => {
    const pop = line.querySelector(".cat-pop");
    if (!pop) return;
    pop.remove();
    for (const b of line.querySelectorAll(".cat"))
      b.setAttribute("aria-expanded", "false");
  });
  return line;
}

function tile(rerender, { title = "Revenue", model = MODEL } = {}) {
  const element = h(`<div class="tile">
    <div class="tile-head">
      <span class="tile-title">${title}</span>
      <span class="spacer"></span>
    </div>
    <div class="tile-body">${chart(SALES, { highlight: 3 })}</div>
    <div class="tile-foot">Updated 4 minutes ago</div>
  </div>`);
  element.querySelector(".tile-head").after(buildLine(rerender, model));
  return element;
}

/**
 * Nothing pinned: every exposed control sits behind its category. This is the
 * case that shows all three buttons at once, and the one where a count tag has
 * to justify itself on a sort and a limit that can only ever hold one.
 */
const NOTHING_PINNED = {
  sort: { ...MODEL.sort, pin: false },
  limit: { ...MODEL.limit, pin: false },
  filters: MODEL.filters.map((f) => ({ ...f, pin: false })),
};

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
    h(`<div class="section">Nothing pinned — all three categories</div>`),
    note(
      `The same chart with every exposed control behind its category. Three buttons, and the count tag only appears on <b>Filter</b>: a declaration carries exactly one sort and one limit, so a tag on those would read "1" forever.`,
    ),
  );
  const grid2 = h(`<div class="grid"></div>`);
  grid2.append(tile(rerender, { title: "Revenue", model: NOTHING_PINNED }));
  page.append(grid2);

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
      { label: "Filter · Sort · Rows", value: "filters-first" },
      { label: "Sort · Rows · Filter", value: "shape-first" },
      { label: "Rows · Sort · Filter", value: "limit-first" },
    ],
    onChange: (value) => {
      state.order = value;
      render(page);
    },
  },
  {
    label: "FILTER GLYPH",
    value: state.filterAt,
    options: [
      { label: "With the others", value: "right" },
      { label: "Leading its pills", value: "left" },
    ],
    onChange: (value) => {
      state.filterAt = value;
      render(page);
    },
  },
  {
    label: "BUTTON",
    value: state.button,
    options: [
      { label: "Glyph", value: "glyph" },
      { label: "Word", value: "word" },
      { label: "Both", value: "both" },
    ],
    onChange: (value) => {
      state.button = value;
      render(page);
    },
  },
  {
    label: "OPENS",
    value: state.affordance,
    options: [
      { label: "Caret", value: "caret" },
      { label: "Count", value: "count" },
      { label: "Nothing", value: "none" },
    ],
    onChange: (value) => {
      state.affordance = value;
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

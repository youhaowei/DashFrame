// Prototype 2 — the report's trust line.
//
// One place at the top of the report answers "how much of this can I trust?".
// It carries how current the data is, whether a refresh failed, and whether
// any item can't render. Author and reader see the same line with different
// vocabulary: the author gets the cause, the reader gets the consequence.

import { chart, h, shell } from "./shared.js";

const state = { audience: "reader", condition: "fresh" };

const SALES = [42, 58, 35, 71, 49, 63, 38];
const ORDERS = [22, 31, 44, 28, 51, 36, 40];

const LINES = {
  fresh: {
    tone: "",
    reader: { text: "Refreshed 2 hours ago" },
    author: { text: "Refreshed 2 hours ago" },
  },
  // Old on purpose and old because something broke are different facts.
  failed: {
    tone: "warn",
    reader: {
      text: "Couldn't refresh — showing data from 2 days ago",
      action: "Try again",
    },
    author: {
      text: "Couldn't refresh — Postgres connection refused. Showing data from 2 days ago.",
      action: "Open connector",
    },
  },
  broken: {
    tone: "bad",
    reader: { text: "Part of this report isn't showing", action: "Show me" },
    author: {
      text: "Revenue by region can't render — its filter isn't offered by the question behind it",
      action: "Fix the item",
    },
  },
};

function trustLine() {
  const line = LINES[state.condition];
  const copy = line[state.audience];
  const element = h(
    `<div class="trust ${line.tone}"><span class="dot"></span><span>${copy.text}</span><span class="spacer"></span></div>`,
  );
  if (copy.action) {
    element.append(
      h(`<button type="button" class="link">${copy.action}</button>`),
    );
  }
  return element;
}

function tile(title, values) {
  return h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">${title}</span></div>
    <div class="tile-body">${chart(values)}</div>
  </div>`);
}

function brokenTile() {
  // The reader is told the item is broken, not why. Reader-facing text never
  // echoes a field name or a filter value: a filter can be confidential, and a
  // failure is not a reason to disclose one.
  const why =
    state.audience === "author"
      ? "The Region filter isn't offered by the question behind this chart. Remove it, or add it to the question."
      : "The person who built this report needs to fix it.";
  return h(`<div class="tile broken">
    <div class="broken-title">Revenue by region can't be shown</div>
    <div class="broken-why">${why}</div>
  </div>`);
}

function render(page) {
  page.replaceChildren();
  page.append(
    h(
      `<div class="report-head"><span class="report-title">Q3 performance</span></div>`,
    ),
  );
  page.append(trustLine());

  const grid = h(`<div class="grid"></div>`);
  grid.append(tile("Revenue", SALES));
  grid.append(
    state.condition === "broken"
      ? brokenTile()
      : tile("Revenue by region", ORDERS),
  );
  page.append(grid);

  page.append(
    h(
      `<div class="caption" style="padding-top:16px">The line sits above the numbers because a reader who scrolls past a broken tile has already drawn a conclusion from an incomplete report. Publishing isn't blocked — the author may leave it broken; the reader is owed the fact.</div>`,
    ),
  );
}

const { page } = shell("Report trust line", [
  {
    label: "Seen by",
    value: "reader",
    options: [
      { label: "Reader", value: "reader" },
      { label: "Author", value: "author" },
    ],
    onChange: (value) => {
      state.audience = value;
      render(page);
    },
  },
  {
    label: "Condition",
    value: "fresh",
    options: [
      { label: "Fresh", value: "fresh" },
      { label: "Refresh failed", value: "failed" },
      { label: "Item broken", value: "broken" },
    ],
    onChange: (value) => {
      state.condition = value;
      render(page);
    },
  },
]);

render(page);

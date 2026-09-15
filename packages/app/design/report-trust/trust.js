// Prototype 2 — where a report tells the truth about its own state.
//
// Every tile loads on its own: its own query, its own source, its own timing.
// So freshness and failure are properties OF A TILE and are only true there. A
// report-level line that claims "refreshed 2 hours ago" is false the moment two
// tiles read frames of different ages, and it flickers while they arrive.
//
// What survives at report level is not a state of its own but a roll-up: a
// pointer to tiles that failed, so one below the fold is not missed. It counts
// and points; it never asserts a freshness.

import { chart, h, shell } from "./shared.js";

const state = { audience: "reader", condition: "mixed" };

const SERIES = {
  revenue: [42, 58, 35, 71, 49, 63, 38],
  orders: [22, 31, 44, 28, 51, 36, 40],
  margin: [18, 24, 21, 30, 27, 33, 29],
};

/**
 * Each scenario is a list of tiles in their own states. Nothing here is
 * synchronised, because nothing in the real report is.
 */
const SCENARIOS = {
  fresh: [
    { title: "Revenue", series: "revenue", age: "2 hours ago" },
    { title: "Orders", series: "orders", age: "2 hours ago" },
    { title: "Margin", series: "margin", age: "2 hours ago" },
  ],
  mixed: [
    { title: "Revenue", series: "revenue", age: "2 hours ago" },
    { title: "Orders", series: "orders", age: "6 days ago", stale: true },
    { title: "Margin", series: "margin", loading: true },
  ],
  failed: [
    { title: "Revenue", series: "revenue", age: "2 hours ago" },
    {
      title: "Orders",
      series: "orders",
      age: "6 days ago",
      stale: true,
      refreshFailed: true,
    },
    { title: "Margin", series: "margin", age: "2 hours ago" },
  ],
  broken: [
    { title: "Revenue", series: "revenue", age: "2 hours ago" },
    { title: "Orders", series: "orders", broken: true },
    { title: "Margin", series: "margin", broken: true },
  ],
};

/* ---------------------------------------------------------------- tile -- */

function ageLine(tile) {
  // Freshness is quiet when it is ordinary and loud when it is not. Only the
  // tile can say this, because only the tile knows when its own data arrived.
  if (tile.refreshFailed) {
    return h(`<div class="tile-foot bad">Couldn't refresh · ${tile.age}</div>`);
  }
  if (tile.stale) {
    return h(`<div class="tile-foot warn">${tile.age}</div>`);
  }
  return h(`<div class="tile-foot">${tile.age}</div>`);
}

function brokenTile(tile) {
  // Reader-facing text never echoes a field name or a filter value: a filter
  // can be confidential, and a failure is not a reason to disclose one.
  const why =
    state.audience === "author"
      ? "The Region filter isn't offered by the question behind this chart. Remove it, or add it to the question."
      : "The person who built this report needs to fix it.";
  return h(`<div class="tile broken">
    <div class="broken-title">${tile.title} can't be shown</div>
    <div class="broken-why">${why}</div>
  </div>`);
}

function loadingTile(tile) {
  return h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">${tile.title}</span></div>
    <div class="tile-body"><div class="skeleton"></div></div>
    <div class="tile-foot">Loading…</div>
  </div>`);
}

function renderTile(tile) {
  if (tile.broken) return brokenTile(tile);
  if (tile.loading) return loadingTile(tile);
  const element = h(`<div class="tile">
    <div class="tile-head"><span class="tile-title">${tile.title}</span></div>
    <div class="tile-body">${chart(SERIES[tile.series])}</div>
  </div>`);
  element.append(ageLine(tile));
  return element;
}

/* --------------------------------------------------------- the roll-up -- */

/**
 * Only appears when tiles are actually wrong, and says only what is true of
 * the set: how many, and where. Never a freshness — the report does not have
 * one.
 */
function rollup(tiles) {
  const broken = tiles.filter((tile) => tile.broken);
  const failed = tiles.filter((tile) => tile.refreshFailed);
  if (broken.length === 0 && failed.length === 0) return null;

  const parts = [];
  if (broken.length > 0) {
    parts.push(
      `${broken.length} ${broken.length === 1 ? "chart" : "charts"} can't be shown`,
    );
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} couldn't refresh`);
  }
  const tone = broken.length > 0 ? "bad" : "warn";
  const element = h(
    `<div class="trust ${tone}"><span class="dot"></span><span>${parts.join(" · ")}</span><span class="spacer"></span></div>`,
  );
  element.append(
    h(
      `<button type="button" class="link">${state.audience === "author" ? "Fix them" : "Show me"}</button>`,
    ),
  );
  return element;
}

/* -------------------------------------------------------------- render -- */

function render(page) {
  const tiles = SCENARIOS[state.condition];
  page.replaceChildren();
  page.append(
    h(
      `<div class="report-head"><span class="report-title">Q3 performance</span></div>`,
    ),
  );

  const summary = rollup(tiles);
  if (summary) page.append(summary);

  const grid = h(`<div class="grid"></div>`);
  for (const tile of tiles) grid.append(renderTile(tile));
  page.append(grid);

  page.append(
    h(
      `<div class="caption" style="padding-top:16px">Freshness sits on the tile, because only the tile has one — three charts can read three sources of three different ages, and a line at the top would have to pick one and be wrong about the others. The roll-up appears only when something is broken, counts only what is broken, and exists so a failure below the fold is not missed.</div>`,
    ),
  );
}

const { page } = shell("Report trust", [
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
    value: "mixed",
    options: [
      { label: "All fresh", value: "fresh" },
      { label: "Mixed ages", value: "mixed" },
      { label: "Refresh failed", value: "failed" },
      { label: "Items broken", value: "broken" },
    ],
    onChange: (value) => {
      state.condition = value;
      render(page);
    },
  },
]);

render(page);

/**
 * Shared engine for the report canvas prototypes: one fake report, a grid that
 * reflows by frame width, token-drawn charts that respond to their cell size,
 * and the workbench shell around them. All state is local; nothing persists,
 * and every string rendered is a fixture in this file.
 */

export const ROW = 36;
export const GAP = 12;

// Breakpoints for the prototypes. The app today uses one 12-column layout down
// to 480px and stacks below it; a tablet tier is added here so per-size layouts
// have something to diverge on.
export const SIZES = [
  { key: "lg", label: "Desktop", min: 996, cols: 12 },
  { key: "md", label: "Tablet", min: 600, cols: 6 },
  { key: "sm", label: "Phone", min: 0, cols: 1 },
];

export function sizeFor(width) {
  return SIZES.find((size) => width >= size.min);
}

/** Replaces an element's children with parsed fixture markup. */
export function setMarkup(element, markup) {
  const range = document.createRange();
  range.selectNodeContents(element);
  element.replaceChildren(range.createContextualFragment(markup));
}

const KIND_LABEL = { kpi: "Number", bar: "Bar", line: "Line", table: "Table" };
const NEW_KINDS = ["bar", "line", "kpi", "table"];

const START_ITEMS = [
  {
    id: "rev",
    kind: "kpi",
    title: "Revenue",
    source: "q3-revenue",
    value: "$4.2M",
    delta: "+12%",
  },
  {
    id: "orders",
    kind: "kpi",
    title: "Orders",
    source: "q3-orders",
    value: "18,402",
    delta: "+4%",
  },
  {
    id: "aov",
    kind: "kpi",
    title: "Average order",
    source: "q3-orders",
    value: "$228",
    delta: "−2%",
  },
  {
    id: "region",
    kind: "bar",
    title: "Revenue by region",
    source: "q3-revenue",
  },
  { id: "trend", kind: "line", title: "Monthly revenue", source: "q3-revenue" },
  { id: "top", kind: "table", title: "Top products", source: "q3-products" },
];

const START_LAYOUT = {
  rev: { x: 0, y: 0, w: 4, h: 3 },
  orders: { x: 4, y: 0, w: 4, h: 3 },
  aov: { x: 8, y: 0, w: 4, h: 3 },
  region: { x: 0, y: 3, w: 7, h: 8 },
  trend: { x: 7, y: 3, w: 5, h: 8 },
  top: { x: 0, y: 11, w: 12, h: 7 },
};

const STACKED_HEIGHT = { kpi: 3, bar: 8, line: 7, table: 8 };
// Narrowest tablet width (of 6 columns) an item keeps before it takes a full row.
const MIN_TABLET_COLS = { kpi: 2, bar: 3, line: 3, table: 6 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const bottomOf = (layout) =>
  Math.max(0, ...Object.values(layout).map((box) => box.y + box.h));
const byPosition = (layout) => (a, b) =>
  layout[a].y - layout[b].y || layout[a].x - layout[b].x;
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Floats items up; a pinned item keeps its spot and pushes colliders down. */
function compact(layout, pinnedId) {
  const placed = [];
  const out = {};
  if (pinnedId) {
    out[pinnedId] = { ...layout[pinnedId] };
    placed.push(out[pinnedId]);
  }
  for (const id of Object.keys(layout).sort(byPosition(layout))) {
    if (id === pinnedId) continue;
    const box = { ...layout[id] };
    while (
      box.y > 0 &&
      !placed.some((p) => overlaps({ ...box, y: box.y - 1 }, p))
    )
      box.y--;
    while (placed.some((p) => overlaps(box, p))) box.y++;
    out[id] = box;
    placed.push(box);
  }
  return out;
}

/** Arranges a narrower size from the desktop layout, row by row. */
function deriveLayout(desktop, items, cols) {
  const kindOf = Object.fromEntries(items.map((item) => [item.id, item.kind]));
  const ids = items
    .map((item) => item.id)
    .filter((id) => desktop[id])
    .sort(byPosition(desktop));
  const out = {};
  let y = 0;
  if (cols === 1) {
    for (const id of ids) {
      const h = STACKED_HEIGHT[kindOf[id]];
      out[id] = { x: 0, y, w: 1, h };
      y += h;
    }
    return out;
  }
  const rows = [];
  for (const id of ids) {
    const row = rows.at(-1);
    if (row && desktop[row[0]].y === desktop[id].y) row.push(id);
    else rows.push([id]);
  }
  for (const row of rows) {
    const fits =
      row.reduce((sum, id) => sum + MIN_TABLET_COLS[kindOf[id]], 0) <= cols;
    if (!fits) {
      for (const id of row) {
        out[id] = { x: 0, y, w: cols, h: desktop[id].h };
        y += desktop[id].h;
      }
      continue;
    }
    const base = Math.floor(cols / row.length);
    let x = 0;
    let height = 0;
    row.forEach((id, index) => {
      const w = index === 0 ? cols - base * (row.length - 1) : base;
      out[id] = { x, y, w, h: desktop[id].h };
      x += w;
      height = Math.max(height, desktop[id].h);
    });
    y += height;
  }
  return out;
}

/**
 * `mode: "linked"` keeps one hand-arranged layout (desktop) and derives the
 * rest. `mode: "per-size"` lets tablet and phone fork into their own layout
 * the first time they are edited.
 */
export function createStore({ mode }) {
  const listeners = new Set();
  const state = {
    items: structuredClone(START_ITEMS),
    desktop: structuredClone(START_LAYOUT),
    custom: { md: null, sm: null },
    selected: "region",
    activeKey: "lg",
    nextId: 1,
  };
  const emit = () => listeners.forEach((listener) => listener());

  const store = {
    mode,
    get items() {
      return state.items;
    },
    get selected() {
      return state.selected;
    },
    get activeKey() {
      return state.activeKey;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isLocked: (key) => mode === "linked" && key !== "lg",
    isCustom: (key) => Boolean(state.custom[key]),
    layoutFor(key) {
      if (key === "lg") return state.desktop;
      const cols = SIZES.find((size) => size.key === key).cols;
      const derived = deriveLayout(state.desktop, state.items, cols);
      const custom = state.custom[key];
      if (!custom) return derived;
      // Items added after the fork land at the bottom of the custom layout.
      const out = {};
      let bottom = bottomOf(
        Object.fromEntries(
          Object.entries(custom).filter(([id]) => derived[id]),
        ),
      );
      for (const { id } of state.items) {
        if (custom[id]) {
          out[id] = custom[id];
        } else {
          out[id] = { ...derived[id], x: 0, y: bottom };
          bottom += derived[id].h;
        }
      }
      return out;
    },
    setActiveKey(key) {
      state.activeKey = key;
    },
    select(id, key = state.activeKey) {
      state.selected = id;
      state.activeKey = key;
      emit();
    },
    beginGesture: (key) =>
      store.isLocked(key) ? null : structuredClone(store.layoutFor(key)),
    applyGesture(key, snapshot, id, box) {
      const next = compact(compact({ ...snapshot, [id]: box }, id));
      if (key === "lg") state.desktop = next;
      else state.custom[key] = next;
      emit();
    },
    resetCustom(key) {
      state.custom[key] = null;
      emit();
    },
    add() {
      const kind = NEW_KINDS[(state.nextId - 1) % NEW_KINDS.length];
      const id = `new-${state.nextId++}`;
      state.items.push({
        id,
        kind,
        title: `New ${KIND_LABEL[kind].toLowerCase()} chart`,
        source: "q3-revenue",
        value: "1,204",
        delta: "+3%",
      });
      state.desktop = {
        ...state.desktop,
        [id]: {
          x: 0,
          y: bottomOf(state.desktop),
          w: kind === "kpi" ? 4 : 6,
          h: kind === "kpi" ? 3 : 8,
        },
      };
      state.selected = id;
      emit();
    },
    remove(id) {
      state.items = state.items.filter((item) => item.id !== id);
      const drop = (layout) =>
        layout &&
        compact(
          Object.fromEntries(
            Object.entries(layout).filter(([key]) => key !== id),
          ),
        );
      state.desktop = drop(state.desktop);
      state.custom = { md: drop(state.custom.md), sm: drop(state.custom.sm) };
      state.selected = null;
      emit();
    },
  };
  return store;
}

// ── Report rendering ───────────────────────────────────────────────────────

function gridGeometry(width) {
  const size = sizeFor(width);
  const pad = width < 600 ? 16 : 24;
  const colWidth = (width - pad * 2 - GAP * (size.cols - 1)) / size.cols;
  return {
    size,
    pad,
    stepX: colWidth + GAP,
    rect: (box) => ({
      left: box.x * (colWidth + GAP),
      top: box.y * (ROW + GAP),
      width: box.w * colWidth + (box.w - 1) * GAP,
      height: box.h * ROW + (box.h - 1) * GAP,
    }),
  };
}

/**
 * Renders the report at `width` into `page` (created on first call and reused
 * after, so cells animate between positions). `interactive: false` is the
 * reader's view.
 */
export function renderReport(page, options) {
  if (!page) {
    page = document.createElement("div");
    page.className = "report";
    setMarkup(
      page,
      `<div class="report-head"><h2>Q3 revenue review</h2><p>Sales · refreshed hourly</p></div><div class="report-grid"></div>`,
    );
    page
      .querySelector(".report-grid")
      .addEventListener("pointerdown", (event) => startGesture(event, page));
  }
  const { store, width, interactive } = options;
  const geometry = gridGeometry(width);
  page._options = options;
  page._geometry = geometry;
  page.classList.toggle("interactive", interactive);
  page.classList.toggle(
    "editable",
    interactive && !store.isLocked(geometry.size.key),
  );
  page.style.width = `${width}px`;
  page.style.setProperty("--pad", `${geometry.pad}px`);

  const grid = page.querySelector(".report-grid");
  const layout = store.layoutFor(geometry.size.key);
  const seen = new Set();
  for (const item of store.items) {
    const box = layout[item.id];
    if (!box) continue;
    seen.add(item.id);
    let cell = grid.querySelector(`[data-id="${item.id}"]`);
    if (!cell) {
      cell = document.createElement("article");
      cell.className = "cell";
      cell.dataset.id = item.id;
      setMarkup(
        cell,
        `<header><div class="cell-title">${item.title}</div><div class="cell-source">from ${item.source}</div></header><div class="cell-body"></div><span class="resize" aria-hidden="true"></span>`,
      );
      grid.append(cell);
    }
    const rect = geometry.rect(box);
    cell.style.left = `${rect.left}px`;
    cell.style.top = `${rect.top}px`;
    cell.style.width = `${rect.width}px`;
    cell.style.height = `${rect.height}px`;
    cell.classList.toggle(
      "selected",
      interactive && store.selected === item.id,
    );
    const drawn = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (cell.dataset.drawn !== drawn) {
      setMarkup(
        cell.querySelector(".cell-body"),
        drawItem(item, rect.width - 24, rect.height - 58),
      );
      cell.dataset.drawn = drawn;
    }
  }
  for (const cell of grid.querySelectorAll(".cell")) {
    if (!seen.has(cell.dataset.id)) cell.remove();
  }
  grid.style.height = `${Math.max(0, bottomOf(layout) * (ROW + GAP) - GAP)}px`;
  return page;
}

function startGesture(event, page) {
  const cell = event.target.closest(".cell");
  const { store, interactive, onLocked } = page._options;
  if (!cell || event.button !== 0 || !interactive) return;
  event.stopPropagation();
  event.preventDefault();
  const { size, stepX } = page._geometry;
  const stepY = ROW + GAP;
  const id = cell.dataset.id;
  const start = { ...store.layoutFor(size.key)[id] };
  // Frames may be zoomed; convert pointer travel back to report pixels.
  const scale = page.getBoundingClientRect().width / page.offsetWidth;
  const resizing = Boolean(event.target.closest(".resize"));
  const origin = { x: event.clientX, y: event.clientY };
  let snapshot = null;
  let moved = false;

  const finish = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("dragging");
  };
  const onMove = (move) => {
    const dx = (move.clientX - origin.x) / scale;
    const dy = (move.clientY - origin.y) / scale;
    if (!moved) {
      if (Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < 4)
        return;
      moved = true;
      snapshot = store.beginGesture(size.key);
      if (!snapshot) {
        finish();
        onLocked?.(size);
        return;
      }
      store.select(id, size.key);
      document.body.classList.add("dragging");
    }
    const box = resizing
      ? {
          ...start,
          w: clamp(start.w + Math.round(dx / stepX), 1, size.cols - start.x),
          h: Math.max(2, start.h + Math.round(dy / stepY)),
        }
      : {
          ...start,
          x: clamp(start.x + Math.round(dx / stepX), 0, size.cols - start.w),
          y: Math.max(0, start.y + Math.round(dy / stepY)),
        };
    store.applyGesture(size.key, snapshot, id, box);
  };
  const onUp = () => {
    finish();
    if (!moved) store.select(id, size.key);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// ── Charts: drawn from tokens and sized to the cell they sit in ────────────

const REGIONS = [
  ["North America", 92],
  ["Western Europe", 74],
  ["East Asia", 66],
  ["Southeast Asia", 48],
  ["Latin America", 41],
  ["Middle East", 33],
  ["Northern Europe", 29],
  ["Oceania", 18],
  ["Africa", 12],
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const TREND = [42, 45, 43, 51, 55, 53, 60, 64, 62, 70, 76, 81];
const PRODUCTS = [
  ["Aurora desk lamp", "Lighting", "1,204", "$96.3k", "41%"],
  ["Linen throw", "Textiles", "982", "$58.9k", "38%"],
  ["Oak side table", "Furniture", "341", "$54.6k", "29%"],
  ["Stoneware mug set", "Kitchen", "1,877", "$45.0k", "52%"],
  ["Wool rug 5×8", "Textiles", "152", "$41.0k", "33%"],
  ["Brass wall hook", "Hardware", "2,410", "$28.9k", "61%"],
  ["Cedar planter", "Garden", "406", "$24.4k", "35%"],
  ["Glass carafe", "Kitchen", "733", "$22.0k", "47%"],
];
const COLUMNS = [
  ["Product", 150, ""],
  ["Category", 100, ""],
  ["Units", 64, "num"],
  ["Revenue", 80, "num"],
  ["Margin", 64, "num"],
];

const truncate = (text, length) =>
  text.length <= length ? text : `${text.slice(0, Math.max(1, length - 1))}…`;

function drawItem(item, w, h) {
  if (w < 40 || h < 30) return "";
  if (item.kind === "kpi") return kpi(item, w, h);
  if (item.kind === "bar") return barChart(w, h);
  if (item.kind === "line") return lineChart(w, h);
  return table(w, h);
}

function axis(left, right, baseY, plot, ticks, min, max) {
  return ticks
    .map((tick) => {
      const y = baseY - ((tick - min) / (max - min)) * plot;
      return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="grid-line"/><text x="${left - 6}" y="${y + 3.5}" text-anchor="end">${tick}</text>`;
    })
    .join("");
}

function barChart(w, h) {
  const left = 28;
  const top = 6;
  const slot = (w - left) / REGIONS.length;
  // The same chart reads differently by width: full labels, clipped, then angled.
  const labels = slot >= 84 ? "full" : slot >= 44 ? "short" : "angled";
  const plot = Math.max(10, h - top - (labels === "angled" ? 62 : 22));
  const baseY = top + plot;
  let svg = axis(left, w, baseY, plot, [0, 50, 100], 0, 100);
  REGIONS.forEach(([name, value], index) => {
    const cx = left + slot * index + slot / 2;
    const barWidth = Math.min(slot * 0.64, 56);
    const barHeight = (value / 100) * plot;
    svg += `<rect x="${cx - barWidth / 2}" y="${baseY - barHeight}" width="${barWidth}" height="${barHeight}" rx="2" class="bar"/>`;
    if (labels === "angled") {
      svg += `<text transform="translate(${cx + 3} ${baseY + 10}) rotate(-45)" text-anchor="end">${truncate(name, 11)}</text>`;
    } else {
      const text =
        labels === "full" ? name : truncate(name, Math.floor(slot / 6.4));
      svg += `<text x="${cx}" y="${baseY + 15}" text-anchor="middle">${text}</text>`;
    }
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg>`;
}

function lineChart(w, h) {
  const left = 28;
  const top = 8;
  const plotWidth = w - left - 8;
  const plot = h - top - 22;
  const baseY = top + plot;
  const every = Math.ceil(12 / Math.max(1, Math.floor(plotWidth / 38)));
  const points = TREND.map((value, index) => [
    left + (plotWidth * index) / 11,
    baseY - ((value - 30) / 60) * plot,
  ]);
  const line = points
    .map(
      ([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`,
    )
    .join(" ");
  let svg = axis(left, w, baseY, plot, [30, 60, 90], 30, 90);
  svg += `<path d="${line} L${left + plotWidth} ${baseY} L${left} ${baseY} Z" class="area"/><path d="${line}" class="line"/>`;
  points.forEach(([x, y], index) => {
    if (plotWidth / 11 > 30)
      svg += `<circle cx="${x}" cy="${y}" r="2.5" class="dot"/>`;
    if (index % every === 0)
      svg += `<text x="${x}" y="${baseY + 15}" text-anchor="middle">${MONTHS[index]}</text>`;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg>`;
}

function kpi(item, w, h) {
  const sparkWidth = Math.min(140, w * 0.4);
  const spark =
    w > 200 && h > 34
      ? `<svg width="${sparkWidth}" height="34" viewBox="0 0 ${sparkWidth} 34"><path class="line" d="${TREND.map(
          (value, index) =>
            `${index ? "L" : "M"}${((sparkWidth - 2) * index) / 11 + 1} ${32 - ((value - 40) / 42) * 30}`,
        ).join(" ")}"/></svg>`
      : "";
  return `<div class="kpi"><div><strong>${item.value}</strong><span>${item.delta} vs Q2</span></div>${spark}</div>`;
}

function table(w, h) {
  let used = 0;
  const columns = COLUMNS.filter(([, width], index) => {
    if (index > 0 && used + width > w) return false;
    used += width;
    return true;
  });
  const rows = PRODUCTS.slice(0, Math.max(1, Math.floor((h - 26) / 27)));
  const head = columns
    .map(([name, , align]) => `<th class="${align}">${name}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map(([, , align], index) => `<td class="${align}">${row[index]}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Workbench shell ────────────────────────────────────────────────────────

const PAGES = [
  { id: "frame", href: "frame.html", label: "1 · Frame" },
  { id: "artboards", href: "artboards.html", label: "2 · Artboards" },
  { id: "per-size", href: "per-size.html", label: "3 · Per-size layouts" },
];

export function mountShell({ current, note, store, onPreview }) {
  setMarkup(
    document.body,
    `
    <div class="protobar">
      <strong>Report canvas prototypes</strong>
      <nav>${PAGES.map((page) => `<a href="${page.href}"${page.id === current ? ' aria-current="page"' : ""}>${page.label}</a>`).join("")}</nav>
      <span class="note">${note}</span>
      <button type="button" data-theme aria-pressed="false">Dark theme</button>
    </div>
    <div class="stage">
      <section class="panel">
        <div class="page-head">
          <div>
            <p class="crumbs">Reports › Q3 revenue review</p>
            <h1>Q3 revenue review <span class="badge">Draft</span></h1>
          </div>
          <div class="actions">
            <button type="button" data-toggle="left" aria-pressed="true">Report pane</button>
            <button type="button" data-toggle="right" aria-pressed="true">Item pane</button>
            <button type="button" data-add>Add item</button>
            <button type="button" data-preview aria-pressed="false">Preview</button>
            <button type="button" class="primary">Publish</button>
          </div>
        </div>
        <div class="workbench">
          <aside class="pane left" aria-label="Report">
            <h2>Report</h2>
            <div class="section"><h3>Filters</h3><button type="button" class="dashed">Add a report filter</button></div>
            <div class="section"><h3>Theme</h3><div class="well">Default</div></div>
          </aside>
          <div class="canvas"></div>
          <aside class="pane right" aria-label="Report item"></aside>
        </div>
      </section>
    </div>`,
  );

  const workbench = document.querySelector(".workbench");
  const themeButton = document.querySelector("[data-theme]");
  themeButton.onclick = () => {
    const dark = document.body.classList.toggle("dark");
    themeButton.setAttribute("aria-pressed", String(dark));
    themeButton.textContent = dark ? "Light theme" : "Dark theme";
  };
  for (const button of document.querySelectorAll("[data-toggle]")) {
    button.onclick = () => {
      const hidden = workbench.classList.toggle(
        `hide-${button.dataset.toggle}`,
      );
      button.setAttribute("aria-pressed", String(!hidden));
    };
  }
  document.querySelector("[data-add]").onclick = () => store.add();
  const previewButton = document.querySelector("[data-preview]");
  previewButton.onclick = () => {
    const previewing = document.body.classList.toggle("previewing");
    previewButton.setAttribute("aria-pressed", String(previewing));
    previewButton.textContent = previewing ? "Back to editing" : "Preview";
    onPreview?.(previewing);
  };

  const canvas = document.querySelector(".canvas");
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.setAttribute("role", "status");
  let hintTimer;
  const showHint = (text) => {
    canvas.append(hint);
    hint.textContent = text;
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("show"), 2800);
  };

  return {
    workbench,
    canvas,
    inspector: document.querySelector(".pane.right"),
    showHint,
  };
}

export function renderInspector(pane, store) {
  const item = store.items.find((candidate) => candidate.id === store.selected);
  const size = SIZES.find((candidate) => candidate.key === store.activeKey);
  const layouts = SIZES.map((candidate) => {
    const custom = store.isCustom(candidate.key);
    const status =
      candidate.key === "lg"
        ? "Arranged by hand"
        : custom
          ? "Own layout"
          : "Follows desktop";
    const reset = custom
      ? `<button type="button" class="link" data-reset="${candidate.key}">Reset</button>`
      : "";
    return `<div class="layout-row${candidate.key === size.key ? " current" : ""}"><span>${candidate.label}</span><span class="badge${custom ? " custom" : ""}">${status}</span>${reset}</div>`;
  }).join("");
  const layoutSection = `<div class="section"><h3>Layouts</h3>${layouts}</div>`;

  if (!item) {
    setMarkup(
      pane,
      `<h2>Report item</h2><p class="muted">Select an item on the canvas.</p>${layoutSection}`,
    );
  } else {
    const box = store.layoutFor(size.key)[item.id];
    const fields = [
      ["Column", box.x + 1],
      ["Row", box.y + 1],
      ["Width", box.w],
      ["Height", box.h],
    ]
      .map(
        ([label, value]) =>
          `<div><small>${label}</small><div class="well">${value}</div></div>`,
      )
      .join("");
    setMarkup(
      pane,
      `
      <h2>${item.title}</h2>
      <p class="muted">from ${item.source}</p>
      <div class="section"><h3>Chart</h3><div class="well">${KIND_LABEL[item.kind]}</div></div>
      <div class="section"><h3>Position on ${size.label.toLowerCase()}</h3><div class="kv">${fields}</div></div>
      ${layoutSection}
      <div class="section"><button type="button" data-remove>Remove from report</button></div>`,
    );
    pane.querySelector("[data-remove]").onclick = () => store.remove(item.id);
  }
  for (const button of pane.querySelectorAll("[data-reset]")) {
    button.onclick = () => store.resetCustom(button.dataset.reset);
  }
}

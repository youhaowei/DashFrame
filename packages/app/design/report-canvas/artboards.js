import {
  createStore,
  mountShell,
  renderInspector,
  renderReport,
  setMarkup,
  sizeFor,
} from "./proto.js";

const perSize = document.body.dataset.mode === "per-size";
const store = createStore({ mode: perSize ? "per-size" : "linked" });
const { canvas, inspector, showHint } = mountShell({
  current: perSize ? "per-size" : "artboards",
  store,
  note: perSize
    ? "Every size on one canvas. Tablet and phone follow desktop until you drag on them; then that size keeps its own layout."
    : "Every size on one canvas, one layout. Scroll or drag the background to pan; ⌘/Ctrl + scroll to zoom. Arrange on desktop.",
  onPreview: () => render(),
});

const SPACING = 160;
const boards = [{ width: 1440 }, { width: 768 }, { width: 390 }];
const view = { x: 48, y: 64, z: 0.4 };

setMarkup(
  canvas,
  `
  <div class="board"><div class="world"></div></div>
  <div class="preview-scroller"></div>
  <div class="zoombar">
    <button type="button" data-zoom-by="0.8" aria-label="Zoom out">−</button>
    <span class="readout"></span>
    <button type="button" data-zoom-by="1.25" aria-label="Zoom in">+</button>
    <span class="divider"></span>
    <button type="button" data-fit>Fit all</button>
    <span class="focus-buttons"></span>
  </div>`,
);

const board = canvas.querySelector(".board");
const world = canvas.querySelector(".world");
const previewScroller = canvas.querySelector(".preview-scroller");
const readout = canvas.querySelector(".readout");
let previewReport = null;

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  world.style.setProperty("--z", String(view.z));
  readout.textContent = `${Math.round(view.z * 100)}%`;
}

function createFrame(index) {
  const frame = document.createElement("div");
  frame.className = "frame";
  setMarkup(
    frame,
    `<div class="frame-label"></div><div class="frame-body"></div><div class="frame-edge" title="Drag to change the width"></div>`,
  );
  frame
    .querySelector(".frame-edge")
    .addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = boards[index].width;
      document.body.classList.add("dragging");
      const onMove = (move) => {
        const width = startWidth + (move.clientX - startX) / view.z;
        boards[index].width = Math.round(Math.min(2560, Math.max(320, width)));
        render();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("dragging");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  world.append(frame);
  return frame;
}

function statusFor(size) {
  if (size.key === "lg") return "";
  if (!store.isCustom(size.key))
    return `<span class="badge">Follows desktop</span>`;
  return `<span class="badge custom">Own layout</span><button type="button" class="link" data-reset="${size.key}">Reset</button>`;
}

function render() {
  if (document.body.classList.contains("previewing")) {
    previewReport = renderReport(previewReport, {
      store,
      width: canvas.clientWidth,
      interactive: false,
    });
    if (!previewReport.isConnected) previewScroller.append(previewReport);
    return;
  }
  let x = 0;
  boards.forEach((entry, index) => {
    entry.frame ??= createFrame(index);
    const size = sizeFor(entry.width);
    entry.x = x;
    entry.report = renderReport(entry.report, {
      store,
      width: entry.width,
      interactive: true,
      onLocked: (locked) =>
        showHint(
          `${locked.label} follows the desktop layout. Arrange items on the desktop frame.`,
        ),
    });
    if (!entry.report.isConnected)
      entry.frame.querySelector(".frame-body").append(entry.report);
    entry.frame.style.left = `${x}px`;
    entry.frame.classList.toggle("active", store.activeKey === size.key);
    setMarkup(
      entry.frame.querySelector(".frame-label"),
      `<button type="button" class="name" data-focus="${index}">${size.label}</button><span>${entry.width}px</span>${statusFor(size)}`,
    );
    x += entry.width + SPACING;
  });
  setMarkup(
    canvas.querySelector(".focus-buttons"),
    boards
      .map(
        (entry, index) =>
          `<button type="button" data-focus="${index}">${sizeFor(entry.width).label}</button>`,
      )
      .join(""),
  );
  applyView();
  renderInspector(inspector, store);
}

function fitAll() {
  const last = boards.at(-1);
  const width = last.x + last.width;
  const height = Math.max(...boards.map((entry) => entry.report.offsetHeight));
  // Leave room on the right for the last frame's label, which doesn't scale.
  view.z = Math.min(
    1,
    (board.clientWidth - 280) / width,
    (board.clientHeight - 120) / height,
  );
  view.x = (board.clientWidth - width * view.z) / 2;
  view.y = 56;
  applyView();
}

function focusBoard(index) {
  const entry = boards[index];
  view.z = Math.min(1, (board.clientWidth - 96) / entry.width);
  view.x = board.clientWidth / 2 - (entry.x + entry.width / 2) * view.z;
  view.y = 56;
  applyView();
}

function zoomAt(factor, clientX, clientY) {
  const rect = board.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const z = Math.min(2, Math.max(0.1, view.z * factor));
  view.x = px - ((px - view.x) * z) / view.z;
  view.y = py - ((py - view.y) * z) / view.z;
  view.z = z;
  applyView();
}

canvas.addEventListener("click", (event) => {
  const focus = event.target.closest("[data-focus]");
  const reset = event.target.closest("[data-reset]");
  const zoomBy = event.target.closest("[data-zoom-by]");
  if (focus) focusBoard(Number(focus.dataset.focus));
  if (reset) store.resetCustom(reset.dataset.reset);
  if (event.target.closest("[data-fit]")) fitAll();
  if (zoomBy) {
    const rect = board.getBoundingClientRect();
    zoomAt(
      Number(zoomBy.dataset.zoomBy),
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }
});

board.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      // Pinch sends small deltas; a mouse wheel notch is ~100, so cap each step.
      const delta = Math.max(-50, Math.min(50, event.deltaY));
      zoomAt(Math.exp(-delta * 0.01), event.clientX, event.clientY);
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
      applyView();
    }
  },
  { passive: false },
);

board.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest(".cell, .frame-edge, button"))
    return;
  const origin = {
    x: event.clientX,
    y: event.clientY,
    viewX: view.x,
    viewY: view.y,
  };
  let moved = false;
  const onMove = (move) => {
    const dx = move.clientX - origin.x;
    const dy = move.clientY - origin.y;
    if (!moved && Math.hypot(dx, dy) < 3) return;
    moved = true;
    board.classList.add("panning");
    view.x = origin.viewX + dx;
    view.y = origin.viewY + dy;
    applyView();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    board.classList.remove("panning");
    if (!moved) store.select(null);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

store.subscribe(render);
new ResizeObserver(() => {
  if (document.body.classList.contains("previewing")) render();
}).observe(canvas);
render();
fitAll();

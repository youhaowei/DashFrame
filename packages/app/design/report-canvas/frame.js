import {
  createStore,
  mountShell,
  renderInspector,
  renderReport,
  setMarkup,
  sizeFor,
} from "./proto.js";

const PRESETS = [
  { label: "This window", width: null },
  { label: "Laptop", width: 1280 },
  { label: "Desktop", width: 1440 },
  { label: "Wide", width: 1920 },
  { label: "Tablet", width: 768 },
  { label: "Phone", width: 390 },
];
const ZOOMS = [
  { label: "Fit", value: null },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
];

const store = createStore({ mode: "linked" });
const { workbench, canvas, inspector, showHint } = mountShell({
  current: "frame",
  store,
  note: "One layout. Pick a width, or drag the frame's edge, to see it reflow. Tablet and phone arrange themselves from desktop.",
  onPreview: () => render(),
});

setMarkup(
  canvas,
  `
  <div class="canvas-toolbar">
    <div class="seg" role="group" aria-label="Frame width">${PRESETS.map((preset, index) => `<button type="button" data-preset="${index}">${preset.label}</button>`).join("")}</div>
    <label class="width-input">W <input type="number" min="320" max="2560" step="10" aria-label="Frame width in pixels" /></label>
    <div class="seg" role="group" aria-label="Zoom">${ZOOMS.map((zoom, index) => `<button type="button" data-zoom="${index}">${zoom.label}</button>`).join("")}</div>
  </div>
  <div class="frame-scroller">
    <div class="frame">
      <p class="frame-label"></p>
      <div class="frame-sizer"><div class="frame-scale"></div></div>
      <div class="frame-edge" title="Drag to change the width"></div>
    </div>
  </div>`,
);

const sizer = canvas.querySelector(".frame-sizer");
const scaleBox = canvas.querySelector(".frame-scale");
const label = canvas.querySelector(".frame-label");
const input = canvas.querySelector("input");

let chosenWidth = null; // null: the width the view page would have in this window
let zoom = null; // null: fit the canvas
let frozenScale = null; // held while the edge is dragged, so the frame doesn't rescale under the pointer
let current = { width: 0, scale: 1 };
let report = null;

function render() {
  const previewing = document.body.classList.contains("previewing");
  const width = previewing
    ? canvas.clientWidth
    : Math.round(chosenWidth ?? workbench.clientWidth);
  const scale = previewing
    ? 1
    : (frozenScale ?? zoom ?? Math.min(1, (canvas.clientWidth - 64) / width));
  const size = sizeFor(width);
  current = { width, scale };
  store.setActiveKey(size.key);

  report = renderReport(report, {
    store,
    width,
    interactive: !previewing,
    onLocked: (locked) =>
      showHint(
        `${locked.label} arranges itself from desktop. Choose a desktop width to move items.`,
      ),
  });
  if (!report.isConnected) scaleBox.append(report);
  scaleBox.style.transform = scale === 1 ? "" : `scale(${scale})`;
  sizer.style.width = `${width * scale}px`;
  sizer.style.height = `${report.offsetHeight * scale}px`;

  const columns = size.cols === 1 ? "stacked" : `${size.cols} columns`;
  const follows = store.isLocked(size.key) ? " · follows desktop" : "";
  label.textContent = `${size.label} · ${columns} · ${width}px · ${Math.round(scale * 100)}%${follows}`;
  if (document.activeElement !== input) input.value = String(width);
  for (const button of canvas.querySelectorAll("[data-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(PRESETS[button.dataset.preset].width === chosenWidth),
    );
  }
  for (const button of canvas.querySelectorAll("[data-zoom]")) {
    button.setAttribute(
      "aria-pressed",
      String(ZOOMS[button.dataset.zoom].value === zoom),
    );
  }
  renderInspector(inspector, store);
}

canvas.querySelector(".canvas-toolbar").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-preset]");
  const zoomButton = event.target.closest("[data-zoom]");
  if (preset) chosenWidth = PRESETS[preset.dataset.preset].width;
  if (zoomButton) zoom = ZOOMS[zoomButton.dataset.zoom].value;
  if (preset || zoomButton) render();
});
input.addEventListener("change", () => {
  const value = Number(input.value);
  if (value >= 320 && value <= 2560) chosenWidth = value;
  render();
});

canvas.querySelector(".frame-edge").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = current.width;
  frozenScale = current.scale;
  document.body.classList.add("dragging");
  const onMove = (move) => {
    // The frame is centred, so its edge travels half as far as the width changes.
    const delta = (2 * (move.clientX - startX)) / frozenScale;
    chosenWidth = Math.round(Math.min(2560, Math.max(320, startWidth + delta)));
    render();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("dragging");
    frozenScale = null;
    render();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

store.subscribe(render);
let frame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}).observe(canvas);
render();

// Shared shell for the report-trust prototypes: the top bar, the theme
// toggle, and a token-coloured bar chart standing in for a real one.

export function h(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

const CARET = `<svg class="caret" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export { CARET };

/** A bar chart drawn from theme tokens. Not the app's renderer. */
export function chart(values, { highlight = -1 } = {}) {
  const max = Math.max(...values);
  const step = 100 / values.length;
  const width = step * 0.62;
  const bars = values
    .map((value, index) => {
      const height = (value / max) * 78;
      const x = index * step + (step - width) / 2;
      const fill =
        index === highlight
          ? "var(--palette-primary)"
          : "color-mix(in oklab, var(--palette-primary) 55%, transparent)";
      return `<rect x="${x}" y="${88 - height}" width="${width}" height="${height}" rx="1.4" fill="${fill}" />`;
    })
    .join("");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Bar chart">
    ${bars}
    <line x1="0" y1="88" x2="100" y2="88" stroke="var(--neutral-border-subtle)" stroke-width="0.6" />
  </svg>`;
}

/**
 * The top bar. `controls` is a list of {label, options, onChange} toggle
 * groups; the theme switch is always appended.
 */
export function shell(title, controls) {
  const bar = h(`<div class="bar"></div>`);
  bar.append(h(`<span class="label">${title}</span>`));

  for (const control of controls) {
    bar.append(h(`<span class="label">${control.label}</span>`));
    const group = h(`<span style="display:flex;gap:4px"></span>`);
    for (const option of control.options) {
      const button = h(
        `<button type="button" aria-pressed="${option.value === control.value}">${option.label}</button>`,
      );
      button.onclick = () => {
        control.value = option.value;
        for (const sibling of group.children) {
          sibling.setAttribute("aria-pressed", String(sibling === button));
        }
        control.onChange(option.value);
      };
      group.append(button);
    }
    bar.append(group);
  }

  bar.append(h(`<span class="spacer"></span>`));
  const theme = h(`<button type="button" aria-pressed="false">Dark</button>`);
  theme.onclick = () => {
    const dark = document.body.classList.toggle("dark");
    theme.setAttribute("aria-pressed", String(dark));
    theme.textContent = dark ? "Light" : "Dark";
  };
  bar.append(theme);

  const stage = h(`<div class="stage"></div>`);
  const page = h(`<div class="page"></div>`);
  stage.append(page);
  document.body.append(bar, stage);
  return { page, stage };
}

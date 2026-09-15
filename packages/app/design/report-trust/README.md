# Report trust prototypes

Two static mocks for what a report tells its reader about the numbers on it:
which filters are exposed, and whether the report is currently trustworthy.
Nothing persists; reload to reset.

```sh
bunx vp dev --config packages/app/design/report-trust/preview.config.ts
```

Open `http://127.0.0.1:4385/controls.html` or `.../trust.html`; the bar at the
top switches states and theme.

## The model these draw

A runtime control (a filter, a sort, a limit) on a report item has two
independent properties:

- **visible** — whether the reader sees it at all.
- **changeable** — whether anything can change its value.

The question behind the chart declares what is runtime-controllable; the report
item may only tighten that, never loosen it. A report can hide what the question
exposes, and can never expose what the question fixed.

Three combinations are legal on an item:

- **hidden + fixed** — the default. Most filters are query hygiene (exclude
  nulls, exclude test data, scope to completed orders) and are part of what the
  chart means rather than something a reader acts on.
- **visible + fixed** — a filter that is part of the chart's claim, shown but
  not negotiable.
- **visible + changeable** — a knob for the reader. Changes are session-local
  and never touch the saved report.

The fourth, **hidden + changeable**, is never an authoring choice. It exists
only as a derived state: a report-level control bound to the item absorbs the
item's knob, so the value is still changeable while the control lives one level
up. Every changeable value therefore has a visible control somewhere, which is
what keeps an invisible knob from silently changing a number.

## 1 · Filter exposure (`controls.html`)

The three legal cells as tiles, then the report-level control that produces the
fourth.

The open question is the middle one. **visible + fixed** can be drawn two ways:

- **A · disabled** — the same well a changeable control uses, greyed out. It
  announces "a control you can't use", so a reader asks why not, and it leaves
  the tab order.
- **B · read-only** — a flat chip. It announces "a fact about this chart", and
  nothing suggests it could have been otherwise.

Both are on the page side by side. B follows the house rule that chips are flat
and fields are wells, which is why a changeable filter is drawn as a well and an
unset one as a dashed well.

The **filtered mark** is the compromise on default-hidden: a chart with hidden
filters carries one small count in its header, and the list appears on hover or
focus. Power BI and Superset both ship a mark like this by default; Looker
Studio and Mode hide chart-level filters from viewers entirely. Turn it off in
the top bar to compare.

## 2 · Report trust line (`trust.html`)

One line above the numbers, carrying three conditions: how current the data is,
a refresh that failed (old _because something broke_, not old on purpose), and
an item that can't render. Switch between **Reader** and **Author** — the same
condition, with the author getting the cause and the reader the consequence.

Publishing a broken report is not blocked. The author is allowed to leave it
broken; the reader is owed the fact.

## What to try

- On `controls.html`, compare the two **visible + fixed** tiles and pick a
  shape. That is the decision this prototype exists for.
- Switch **Filtered mark** off and decide whether the default-hidden tile is
  now too quiet, or correctly quiet.
- Set **Width · Narrow**. Three short filters is the practical ceiling for a
  tile-width control line; a fourth, or one long value, runs out of room. The
  overflow rule is not designed yet.
- On `trust.html`, read the broken condition as Reader then Author.

## Prototype-only choices

- Charts are SVG drawn from theme tokens, not the app's chart renderer.
- The report control bar is two wells with no binding UI behind them.
- Overflow of the control line is deliberately left unhandled.

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

- **hidden + fixed** — the default, and hidden means the reader is told nothing:
  not the value, not a count, not that any filter exists. Most filters are query
  hygiene (exclude nulls, exclude test data, scope to completed orders) and are
  part of what the chart means rather than something a reader acts on — and a
  filter can be worse than noise. `Customer is Acme Corp` names a customer;
  `Region is not LATAM` can name a market being exited. A filter value is
  potentially confidential, so exposing one is an act of disclosure by the
  author and can only be deliberate.
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

Every exposed control names its field. A bare value says nothing: `EMEA` could
be a region, an office, or an owner. The naming differs by shape because a fact
and a control are read differently — the chip reads as a sentence
(`Region is EMEA`), the well pairs a quiet field label with its value
(`Region  EMEA`), which is also the shape the report control bar uses.

**A passive "this chart is filtered" mark was prototyped and rejected.** Power BI
and Superset both ship one by default — a count on the visual, the list on hover.
It was dropped because a count still discloses: it says a filter exists and
invites a question that cannot be answered, and the list leaks values outright.
This puts the product with Looker Studio and Mode, which hide chart-level filters
from viewers entirely.

## 2 · Report trust line (`trust.html`)

One line above the numbers, carrying three conditions: how current the data is,
a refresh that failed (old _because something broke_, not old on purpose), and
an item that can't render. Switch between **Reader** and **Author** — the same
condition, with the author getting the cause and the reader the consequence.

Publishing a broken report is not blocked. The author is allowed to leave it
broken; the reader is owed the fact.

Reader-facing text never echoes a field name or a filter value — not in the
line, not on the broken tile. The author's version names the cause because the
author is cleared to see it; the reader's version names only the consequence.
That split is a confidentiality rule, not a vocabulary preference.

## What to try

- On `controls.html`, compare the two **visible + fixed** tiles and pick a
  shape. That is the decision this prototype exists for.
- Set **Width · Narrow**. Naming the field roughly doubles a control's width,
  so two is the practical ceiling for a tile-width line and the third clips. The
  overflow rule is not designed yet.
- On `trust.html`, read the broken condition as Reader then Author.

## Prototype-only choices

- Charts are SVG drawn from theme tokens, not the app's chart renderer.
- The report control bar is two wells with no binding UI behind them.
- Overflow of the control line is deliberately left unhandled.

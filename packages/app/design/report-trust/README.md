# Report trust prototypes

Two static mocks for what a report tells its reader about the numbers on it:
which filters are exposed, and whether the report is currently trustworthy.
Nothing persists; reload to reset.

```sh
bunx vp dev --config packages/app/design/report-trust/preview.config.ts
```

Open `http://127.0.0.1:4385/controls.html`, `.../styles.html`, or
`.../trust.html`; the bar at the top switches states and theme.

## The model these draw

A runtime control on a report item has two independent properties. A control is
not always a filter: `InsightRuntimeDeclaration` declares three kinds — any
number of filters, one sort, one limit — and they read differently and matter
differently. A limit is the one most likely to change what a reader concludes
(`Top 10` hides the tail) and the least likely to be confidential, so the case
for hiding it by default is the weakest of the three.

The two properties:

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

## 2 · Control style and authoring (`styles.html`)

The chip is the shape. What it says is the author's.

A runtime control already carries a `label` —
`InsightRuntimeDeclaration.filters[].label`, which `DashboardControlBar` reads
as `control.label ?? control.field` — so the tile shows what the author wrote,
not a sentence derived from the field and its operator. Derived text is both
verbose (`Date in last 12 months`) and wrong as often as not: only the author
knows that `Channel is not Partner` is better read as "Direct only". A derived
sentence also cannot survive a negation without stating it, which is how the
earlier label-and-value style got `Channel Partner` exactly backwards.

Four chip styles, switched from the top bar:

- **Label + value** — two tones in one chip, the label quiet and the value
  strong. An unlabelled control is just its value, which is the shortest a chip
  gets and is how a limit should read (`Top 10`).
- **Colon** — the same pairing punctuated. Needs the label to be present.
- **Divided** — label and value in their own halves. Easiest to scan down a
  column, widest per chip.
- **Derived sentence** — what the tile would say with no authored label, kept
  only as the thing to compare against.

The **Authoring** section is the item pane in the workbench: type a label and
the tile beside it changes. Clearing a label falls back to the value alone.

Overflow, using whichever style is selected:

- **Truncate** — show what fits, then `+N` opening the rest. The chart keeps its
  height; the reader has to click.
- **Wrap** — everything stays readable and the chart loses a row of height for
  each extra line.
- **Summarise** — one chip with a count, the list on click. Constant width at any
  number. A count over _exposed_ controls is fair: the author already chose to
  disclose them, which is what separates this from the mark rejected above.
- **Scroll** — one sideways-scrolling line. Cheap, and what is off-screen is easy
  to miss.

## 3 · Report trust line (`trust.html`)

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
- On `styles.html`, pick a chip style, then type labels in the **Authoring**
  pane and watch the tile. Clear the limit's label.
- Then set **Settings · 6** and **Width · Narrow**, and decide how much tile
  height an exposed control line may cost.
- Set **Width · Narrow**. Naming the field roughly doubles a control's width,
  so two is the practical ceiling for a tile-width line and the third clips. The
  overflow rule is not designed yet.
- On `trust.html`, read the broken condition as Reader then Author.

## Prototype-only choices

- Charts are SVG drawn from theme tokens, not the app's chart renderer.
- Sort and limit are drawn with placeholder phrasing (`Sorted by Revenue, high
to low`, `Top 10`); the wording is not settled.
- The report control bar is two wells with no binding UI behind them.
- Overflow of the control line is deliberately left unhandled.

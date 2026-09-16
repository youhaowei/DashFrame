# Report trust prototypes

Two static mocks for what a report tells its reader about the numbers on it:
which filters are exposed, and whether the report is currently trustworthy.
Nothing persists; reload to reset.

```sh
bunx vp dev --config packages/app/design/report-trust/preview.config.ts
```

Open `http://127.0.0.1:4385/controls.html`, `.../styles.html`,
`.../trust.html`, or `.../notion.html`; the bar at the top switches states and
theme.

## The model these draw

The decided model is written up as the spec "DashFrame v0.3 Report Viewer
(Runtime Control Disclosure)" in the project wiki; this file keeps the
prototype-level reasoning and each rejected alternative.

A runtime control on a report item has two independent properties. A control is
not always a filter: `InsightRuntimeDeclaration` declares three kinds — any
number of filters, one sort, one limit — and they read differently and matter
differently. A limit is the one most likely to change what a reader concludes
(`Top 10` hides the tail) and the least likely to be confidential, so the case
for hiding it by default is the weakest of the three.

Visibility itself has two strengths. **Pinned** is on the face of the tile,
always, at every width. **Visible** is on the tile but collapsed into a single
chip the reader can open. Both are disclosed — the difference is only whether
the reader has to ask.

That replaces overflow as a layout problem with an authoring decision. A
truncation rule drops whatever happens not to fit, which means the same report
shows different things on a laptop and a phone and the author cannot know what
a reader saw. Pinning is deterministic and width-independent: the author says
what matters, and it is what a reader sees first, everywhere.

The two properties:

- **visible** — whether the reader sees it at all.
- **changeable** — whether anything can change its value.

The question behind the chart declares what is runtime-controllable; the report
item may only tighten that, never loosen it. A report can hide what the question
exposes, and can never expose what the question fixed.

Three combinations are legal on an item:

(An author who pins more than fits is still overflowing, but it is now their
doing and the item pane can say so, rather than a rule silently choosing for
them.)

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

**Decided: B · read-only, and terse.** A **visible + fixed** control is a flat
chip; **A · disabled** is rejected. A greyed-out well announces "a control you
can't use", which invites a reader to ask why not and leaves a dead target on
the tile. A flat chip announces a fact about the chart and suggests nothing.
This follows the house rule that chips are flat and fields are wells, which is
why a changeable filter is a well and an unset one a dashed well.

The chip does **not** read as a sentence. `Region is EMEA` and `Date in last 12
months` spend two words on grammar the shape already carries; drop the copula
and write `Region EMEA`, `Date Last 12 months`. The label stays quiet, the value
strong.

Every exposed control still names its field — a bare value says nothing, since
`EMEA` could be a region, an office, or an owner. Fact and control therefore
carry the same words, and only the shape separates them: a flat chip is a fact,
a well is a knob. That is the distinction doing the work, not the phrasing.

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

**Decided: Label + value.** Two tones in one chip, the label quiet and the value
strong. An unlabelled control is just its value, which is the shortest a chip
gets and is how a limit should read (`Top 10`). The three rejected alternatives
stay switchable on the page as the comparison that produced the call:

- **Colon** — the same pairing punctuated. Spends a character on what the two
  tones already separate, and needs the label to be present.
- **Divided** — label and value in their own halves. Easiest to scan down a
  column, but the widest per chip, and width is the scarce thing on a tile.
- **Derived sentence** — what the tile would say with no authored label. Kept
  only as the thing to compare against; see above for why derived text loses.

**Icon** is a separate axis, applied to whichever style is selected:

- **None** — words only.
- **Kind** — a glyph naming what kind of control it is: filter, sort, or limit.
  It distinguishes a sort chip from a filter chip without spending a word, which
  is the one thing the label cannot do, since the label is about the subject and
  not the mechanism.
- **Instead of label** — the glyph replaces the author's label. This is the cheap
  option and it does not survive contact: `Direct only  Yes` becomes a funnel and
  `Yes`, and `Region  EMEA` becomes a funnel and `EMEA`. The glyph says _that_
  the chart is filtered, never _by what_, which is the same failure as the
  rejected count.

Note the design system has no funnel — `ArrowUpDownIcon` and `ListIcon` are the
closest it offers — so adopting a filter glyph is a change to `libs/stdui`, with
its own repo and its own gate, not a change to this app.

The **Authoring** section is the item pane in the workbench: type a label and
the tile beside it changes. Clearing a label falls back to the value alone.

**Decided: filter, sort, and limit are three separate categories**, not one pool
and not a two-way split between "shape" and filters. The control line is three
groups in a fixed order, and the group a chip sits in is what says which kind of
control it is.

That settles four things at once.

**No per-chip kind glyph.** The group already names the kind, so spending a
glyph on every chip to repeat it is waste. **Icon · none.** This also means the
design system does not need a funnel, so `libs/stdui` is untouched — the change
that was the most expensive option is now not required at all.

**Only the filter group is ever more than one chip.**
`InsightRuntimeDeclaration` declares any number of filters but exactly one sort
and exactly one limit, so those two groups hold at most one chip each. Whatever
the filter group needs — a button, a count, a ceiling — is its own concern and
does not have to generalise.

**The collapsed chip becomes a filter button.** Not a `+3` chip standing in for
the overflow — an actual control the reader opens. **Pinned filters are always on
the chart**, at every width. **Visible filters appear when the reader clicks the
filter button.** All three of the prototyped collapsed forms are dropped: `+3`,
`and 3 more`, and the per-kind glyph were three ways to label a remainder, and a
remainder is the wrong idea. Visible-but-unpinned is not overflow the layout
happened to produce; it is a disclosure the author chose, and it deserves a
control rather than a label.

This is also what makes the face stable. Only pinned controls are ever drawn on
it, so the line cannot overflow because a reader's window is narrow — it can only
overflow because an author pinned more than fits, which was already the stated
principle and is now the only way it happens.

The confidentiality rule is unchanged and now sits on the button: it may reflect
only **exposed** controls. A hidden filter must not widen it, appear in it, or
raise a count on it. A button that betrays the existence of a filter the author
chose to hide is the passive mark rejected above, wearing a different shape.

**The wording sheds its kind word.** A chip does not restate what its group
already establishes. Sort is the author's label and the direction, not `Sorted
by Revenue, high to low`. Limit is `Top 10`, not `Rows 10`. This is the same
terseness that dropped the copula from a fixed chip.

The **Placement** section shows the reader's tile with both properties in play at
once: Region and Period are pinned _and_ changeable, so they pin as wells with a
caret; Segment is pinned and fixed, so it pins as a chip. Pinned means "on the
face"; changeable decides whether the face is a knob or a fact.

Group order was prototyped three ways with sort and limit still paired as one
"shape" group, and **leading** was chosen: shape first, then filters, so that on
a wrap the fixed-width groups stay together on the first row. Splitting shape
into two categories keeps that property — sort, limit, then filters — but the
order of sort against limit is not yet settled, and neither is what separates
one group from the next on screen.

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

The decisions above are made; the page is now the record of how, and the place to
check a change against them.

- On `controls.html`, read the **visible + fixed** chip against the **visible +
  changeable** well. Shape is the only thing separating a fact from a knob, so
  that pair is the one to protect in any restyle.
- On `styles.html`, type labels in the **Authoring** pane and watch the tile.
  Clear the limit's label and confirm it falls back to its value alone.
- Set **Settings · 6** and **Width · Narrow**. The same pinned chips appear at
  both widths, which is the point of pinning over truncation.
- Then read the filter group at **Narrow**. Naming the field roughly doubles a
  control's width, so two is the practical ceiling and the third clips — that is
  the open overflow question, and it is now the filter group's alone.
- On `trust.html`, read the broken condition as Reader, then as Author.

## 4 · Categories as buttons (`notion.html`)

The decided model drawn as it would actually be built: three categories, pinned
controls on the face, and everything else exposed behind its category's button.
A Notion database toolbar reads this way — Filter and Sort are buttons you open,
not chips you decode — and that is the reference this page is testing.

Open **Filter**. The two exposed-but-unpinned filters are in there with their
own knobs; turning one marks the button as set. The two *hidden* filters are in
none of it: not a chip, not a row in the popover, not a number on the button.

Four axes, switched from the top bar, are the decisions this page exists to
settle:

- **Order** — sort, rows, filter; or rows, sort, filter; or filters first.
- **Separator** — a gap, a rule, or nothing. **None** is what the implementation
  branch shipped, and it is the state where a sort is indistinguishable from a
  filter.
- **Button** — word, glyph, both, or word plus a count of exposed controls.
- **Buttons for** — all three categories, or filters only. Switch to **filters
  only** to see the cost: an unpinned sort or limit has nowhere to go, so it
  falls back onto the face and the shape groups stop being fixed-width.

## Still open

- **Group order** — sort before limit, or limit before sort.
- **Group separation** — what divides one category from the next: a gap, a rule,
  or a quieter treatment on one of them. Nothing is drawn for this yet; the
  prototype still pairs sort and limit as one group.
- **Over-pinning** — what the item pane tells an author who pins more filters
  than fit. The face can no longer overflow on its own, so this is the only
  remaining overflow case, and it is an authoring-time warning rather than a
  layout rule.
- **The filter button's form** — glyph, word, or glyph plus a count of exposed
  filters. A funnel would be the obvious glyph and the design system has none
  (`ArrowUpDownIcon` and `ListIcon` are the closest), so this is the one place a
  `libs/stdui` addition is still on the table — now for a single button rather
  than every chip.
- **Visible-but-unpinned sort and limit** — a filter button is the filter
  group's affordance. Whether a sort or limit set to visible rather than pinned
  goes behind the same button, gets its own, or is simply not a legal
  combination is not yet decided.

## Prototype-only choices

- Charts are SVG drawn from theme tokens, not the app's chart renderer.
- Sort and limit are drawn with placeholder phrasing (`Sorted by Revenue, high
to low`, `Top 10`); the wording is not settled.
- The report control bar is two wells with no binding UI behind them.
- Overflow of the control line is deliberately left unhandled.

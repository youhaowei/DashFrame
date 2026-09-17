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
doing and theirs to judge on their own tile, rather than a rule silently
choosing for them.)

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

Note the design system does not yet export a funnel — `ArrowUpDownIcon` and
`ListIcon` are the closest it offers. `libs/stdui` re-exports lucide-react
through a curated allowlist (`packages/ui-react/src/icons.tsx`), and lucide
already ships `funnel`, `list-filter` and `arrow-down-wide-narrow`, so adopting
one is a two-line allowlist addition: still a `libs/stdui` change with its own
repo and gate, but not icon design.

The **Authoring** section is the item pane in the workbench: type a label and
the tile beside it changes. Clearing a label falls back to the value alone.

**Decided: filter, sort, and limit are three separate categories**, not one pool
and not a two-way split between "shape" and filters. The control line is three
groups in a fixed order, and the group a chip sits in is what says which kind of
control it is.

That settles four things at once.

**A category button is a ghost pill:** the geometry of a pill, none of its
fill. Borderless and transparent at rest, so it reads flat and does not compete
with the filter pills that carry values; the pill appears on hover and while
open.

Dropping the shape entirely was tried first and gives up too much. The hit
target shrinks to the glyph, the press has nowhere to land, and the control
stops aligning with the chips beside it. Keeping the geometry and dropping only
the fill separates the two kinds of thing without making the glyph a worse
button — a border would put it back in the line of values, but a background
that appears on hover only ever says "this is a control".

Having a pill again gives **set** somewhere to live: a control the reader has
turned tints its ghost pill and colours its glyph, so the state survives when
the pointer leaves.

**It is sized as an icon button, not a short pill.** A ghost button carries its
own padding, so a gap between two of them adds to that padding and the pair
reads as far more air than either was given: at 6px padding and a 10px gap the
cluster fell apart. The working numbers are 4px padding, a 2px inner gap
between glyph and caret, and 2px between buttons — about 30px wide against a
pill's 100 to 130. They sit nearly flush and the hover pills define the rhythm,
the way a toolbar of icon buttons does. A filter glyph leading its pills pulls
back tighter still, because it belongs to them.

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

**What says the glyph opens is the `OPENS` axis**, and the count is one of
three answers rather than the assumed one:

- **Caret** — the same caret a well uses, so "this opens" has one mark across
  the whole tile. Says nothing else, and needs no rule about when a number is
  informative. Three glyph-and-caret pairs in a row is its cost.
- **Count** — `▽ 4`, which also says how big the category is. Only informative
  for filters, since a declaration carries one sort and one limit, so it
  reintroduces the per-kind special case the categories removed.
- **Nothing** — the bare glyph, relying on hover and cursor.

If a count is used it must be **the whole category, not the remainder**: `▽ 4`
means four exposed filters whether two are pinned beside it or none are.
Counting only what is hidden breaks the moment the glyph sits next to its own
pills — `▽ 2` beside two pills reads as a label for those two.

The confidentiality rule is unchanged and sits on the button: it may reflect
only **exposed** controls. A hidden filter must not widen it, appear in it, or
raise the count. A button that betrays the existence of a filter the author
chose to hide is the passive mark rejected above, wearing a different shape.

**The wording sheds its kind word, and a glyph marks the exception.** A chip
does not restate what its group already establishes, so a pinned sort is not
`Sort Revenue, high to low` and a pinned limit is not `Rows 10`. But a pinned
control has no category button to carry its kind, and with filters leading and
varying in number, position alone cannot: the sort's place in the line moves.

So the earlier rule applies unchanged — **a filter is the ordinary runtime
control and takes no mark; the glyph earns its place marking what is not a
filter.** A pinned sort leads with its glyph and drops the word, a pinned limit
the same, and a pinned filter keeps its field name and stays bare. The face
reads `Region EMEA`, `⇅ Revenue, high to low`, `≡ Top 10`.

This is the same glyph the category button uses, so a reader meets each kind's
mark in one place whether it is pinned or behind a button.

The **Placement** section shows the reader's tile with both properties in play at
once: Region and Period are pinned _and_ changeable, so they pin as wells with a
caret; Segment is pinned and fixed, so it pins as a chip. Pinned means "on the
face"; changeable decides whether the face is a knob or a fact.

**Decided: pills left, glyphs right — as two columns, not one wrapping flow.**
The pills wrap among themselves on the left; the glyph cluster is its own
column and holds the top right, never joining their wrap. Sharing one flow puts
the cluster wherever the wrap happens to leave it, beside whichever pill ends
the last row, which reads as a relationship that is not there.

The line is two clusters, not three groups in a row. Value-carrying pills — the pinned filters — sit left; the
category glyphs group together and right-align, the way a Notion toolbar keeps
its content left and its Filter and Sort buttons right. A pill carries
something a reader reads as part of the chart's claim; a glyph is a way in.
Alignment separates those two kinds of thing far more firmly than a gap between
three same-looking groups did, which is most of what the separator axis was
trying to buy.

**Within the glyph cluster the order is filter, then sort, then limit.** That is
the order the chart is built in — which rows are included, how they are ordered,
how many are kept — and it is the order a reader asks about them.

This reverses the earlier call. Group order was first prototyped with sort and
limit paired as one "shape" group, and **leading** won: shape first, then
filters, because after a collapsed `+1` a trailing shape group read as part of
the filter group it was not in. That objection died with the collapsed chip.
There is no remainder chip any more, so nothing trails the filters that could be
mistaken for one — each category ends in its own button or in nothing.

What separates one group from the next on screen is still open.

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
own knobs; turning one marks the button as set. The two _hidden_ filters are in
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

## 5 · One door instead of three (`notion.html`, DISCLOSURE)

**Decided: one door.** The three category buttons of section 4 are rejected and
stay switchable on the page only as the comparison that produced the call. They
put ways-in on the line that carries the chart's facts, and left a tile with
nothing pinned holding a control row of buttons alone. The side popover with the
rest of the page dimmed already does what three buttons were for: every knob in
one panel, the chart lit while it changes.

**Pills on the face are pinned filters only.** Nothing mechanical is pinnable:
a pinned sort has no value to put in a pill — an order is a mechanism the bars
already display — so a sort pill would be a glyph wearing a pill's clothes. Sort
and limit always live behind the door.

**Everything else exposed sits behind one control button, seated on the title
line.** The three categories do not disappear; they move inside the popover as
headings, where there is room for them.

Putting the door beside the title rather than among the pills is what makes the
rule clean: **the title line carries the tile's own controls, the control line
carries only facts.** Every pill on that line is something the chart is
claiming; nothing on it is a way in. A tile with nothing pinned then has no
control line at all — just a title, its door, and the chart — rather than an
empty row of padding under the heading.

The **DOOR** axis offers two marks. A **sliders** glyph says "things you can
change here". An **ellipsis** is the cheaper option and collides: an ellipsis
beside a chart already means the tile's own menu — edit, duplicate, remove — so
using it for the reader's knobs makes one glyph mean two different things
depending on who is looking.

**Popover headings are a glyph and a name in sentence case — never all caps.**
The glyph is the same one the category button used, so a kind has one mark
wherever it appears. Sort and Rows hold exactly one control each, so their
heading _is_ the row — glyph, name, control on one line — rather than a heading
with a second label repeating the word under it. Filter keeps a heading over
its rows, since those name different fields. No label in these prototypes is
upper-cased: the bar and section labels dropped it too.

What this trades away is advertisement. `▽ 4` at least said filters exist and
are yours to move; one unlabelled glyph says only that something is behind it.
The counter-argument is that pinning is exactly the author's tool for surfacing
what matters, so anything behind the door is secondary by the author's own
decision.

## Still open

Nothing on control disclosure. The last three were called:

- **Group order in the popover: filter, sort, rows.** The order the chart is
  built in — which rows are included, how they are ordered, how many are kept.
- **Group separation in the popover: nothing drawn.** Each group already opens
  with its glyph and name; a rule between four rows would be clutter.
- **Over-pinning: the editor's decision, with no warning.** An author who pins
  more filters than fit sees the result on their own tile and owns it. The item
  pane does not warn, cap, or count.

Closed by the one-door call: a **visible-but-unpinned sort or limit** goes
behind the door, and since nothing mechanical is pinnable that is the only
place a sort or limit is ever exposed. **The filter button's form** no longer
applies — there is no filter button, and the category glyphs survive only as
popover headings.

## Prototype-only choices

- Charts are SVG drawn from theme tokens, not the app's chart renderer.
- Sort and limit are drawn with placeholder phrasing (`Sorted by Revenue, high
to low`, `Top 10`); the wording is not settled.
- The report control bar is two wells with no binding UI behind them.
- Overflow of the control line is deliberately left unhandled.

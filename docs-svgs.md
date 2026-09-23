# SVGs in MyST decks

How a drawing gets into a deck: the `{include-svg}` directive, the frontmatter
keys for deck CSS and definitions, and the shared `ld-` markers and classes in
[`shared/ld/svgs/`](shared/ld/svgs/).

How the SVG file itself has to be written — colours from `currentColor`, no
`light-dark()`, no units, prefixed ids, marker colouring, fonts — is a matter
of the browser runtime and is documented in LectureDoc2:
[SVGs.md](https://github.com/Delors/LectureDoc2/blob/main/SVGs.md) (in a
project with both submodules: `../LectureDoc2/SVGs.md`).

## 1. `{include-svg}`, not `{image}`

```markdown
:::{include-svg} drawings/round.svg
:width: 62ch
:height: 49.75ch
:class: center-content
:::
```

`{include-svg}` copies the file **verbatim** into the HTML, wrapped in a `<div>`
that carries the size:

```html
<div class="center-content" style="width: 62ch; height: 49.75ch;">
    <svg viewBox="…">…</svg>
</div>
```

`{image}` and `{figure}` render an `<img src="…">`, and an SVG loaded that way
is an independent document: the deck's CSS, `currentColor` and `<ld-globals>`
do not reach it. Use them for photographs and other raster material only (a
raster image that only reads on white can get `:class: light-image`).

| option | |
| --- | --- |
| argument | path of the SVG, relative to the file that contains the directive — for an `{include}`d snippet that is the snippet |
| `:width:`, `:height:` | **required**; CSS lengths in `ch` or `lh`, with the aspect ratio of the `viewBox`. A bare number is not a CSS length and leaves the element without a size. |
| `:class:` | classes of the wrapper, e.g. `center-content`, `margin-auto`, `incremental` (the whole drawing is one reveal step) |
| `:name:` | `id` of the wrapper |
| `:alt:` | `aria-label` of the wrapper |

Choosing the size: take the aspect ratio from the `viewBox` and pick the width
the slide can afford, e.g. `viewBox="0 0 160 90"` at `:width: 60ch` gives
`:height: 33.75ch`. Stay conservative — a slide with a vertical title has less
room than one might think (`sec-aes` uses 57ch there).

Because the copy is verbatim, the file must not carry an XML declaration, a
`<!DOCTYPE>` or a root `width`/`height`, and it must not contain a `<style>`
(it would apply to the whole deck). A file that only holds definitions for
other drawings is not included with `{include-svg}` but listed in
`ld.include-globals` (§2).

For an inline `<svg>` written directly into the deck (`{raw} html`), prefer
`{include-svg}`: the drawing then lives in a real `.svg` file that an editor
can open.

## 2. Deck CSS and definitions

Four `ld:` keys, two pairs — the same in `myst.yml` (below `project:`) and in a
deck's frontmatter:

```yaml
ld:
    include-styles: # files -> one <style> each in the <head>
        - drawings/aes-diagrams.css
    styles: | # inline CSS -> <style> in the <head>, after the files
        .aes-diagram .connector { stroke-width: 2; }
    include-globals: # files -> verbatim into <ld-globals> in the <body>
        - drawings/aes-defs.svg
    globals: | # inline markup -> <ld-globals>, after the files
        <svg xmlns="http://www.w3.org/2000/svg"><defs>…</defs></svg>
```

- **Paths** are relative to the document in a frontmatter and relative to the
  project root in `myst.yml`.
- **Everything accumulates.** The entries from `myst.yml` come first, a deck's
  own entries follow; a deck extends the project's lists, it does not replace
  them. A file listed on both levels is included once — a second copy of a
  definitions file would duplicate every id in it.
- **Order:** within each pair the files come before the inline content; deck
  CSS comes after `ld.css` and the theme.
- `globals` is markup and is **not** wrapped: a definitions file brings its own
  `<svg>`; the file content is not changed in any way.
- **Rebuilding:** a deck is considered out of date by the time stamp of its own
  `.md` only. After changing an included CSS or definitions file, rebuild with
  `ld2 build --force`.

## 3. The shared `ld-` definitions

[`shared/ld/svgs/`](shared/ld/svgs/) holds markers and classes meant to be used
by the drawings of **every** deck, so that arrows, lines and fills look the
same everywhere:

| file | include with | contains |
| --- | --- | --- |
| `ld-svg-defs.svg` | `ld.include-globals` | markers |
| `ld-svg.css` | `ld.include-styles` | classes |

A project includes both once, in `myst.yml` — in Lectures-Myst:

```yaml
project:
    ld:
        include-globals:
            - LectureDoc2Author/shared/ld/svgs/ld-svg-defs.svg
        include-styles:
            - LectureDoc2Author/shared/ld/svgs/ld-svg.css
```

(When LectureDoc2Author is installed from npm, the files are in
`node_modules/lecturedoc2-author/shared/ld/svgs/`.)

### Markers

| id | |
| --- | --- |
| `ld-arrow` | filled arrowhead in the foreground colour |
| `ld-arrow-muted`, `ld-arrow-accent`, `ld-arrow-danger`, `ld-arrow-success`, `ld-arrow-info`, `ld-arrow-warning` | the same in the theme's semantic colours |
| `ld-arrow-open` | open arrowhead (chevron), foreground colour |
| `ld-dot` | dot centred on the end point, foreground colour |

- They scale with the line (`markerUnits="strokeWidth"`).
- Used as `marker-start`, an arrowhead points backwards
  (`orient="auto-start-reverse"`): one marker also draws a double-headed arrow.
- **Geometry:** the tip lies exactly **1.5 × stroke-width** beyond the line's
  end point. To make an arrow touch a target, end the line
  1.5 × stroke-width before it (stroke-width 2 → 3 units before the target).
- **Colour:** a marker is coloured where it is defined — in `<ld-globals>`,
  i.e. with the colours of `<body>`. Inside an admonition with its own theme
  the plain `ld-arrow` keeps the body's foreground colour; use a variant if
  that does not fit.

### Classes

All classes match only inside an `<svg>` and paint with `currentColor`.

| class | effect |
| --- | --- |
| `ld-line` | `fill: none; stroke: currentColor; stroke-width: 0.1em` |
| `ld-connector` | like `ld-line`, plus `marker-end: url(#ld-arrow)` |
| `ld-dashed`, `ld-dotted` | dash patterns in `em` (combine with `ld-line`/`ld-connector`/`ld-box`) |
| `ld-box` | outlined shape: `fill: none; stroke: currentColor; stroke-width: 0.1em` |
| `ld-panel` | background region: `fill: currentColor; fill-opacity: 0.1` |
| `ld-cell` | element: `fill-opacity: 0.3` |
| `ld-highlight` | emphasised element: `fill-opacity: 0.65` |
| `ld-label` | text: `fill: currentColor` |
| `ld-label-on-fill` | text on a filled shape: `fill: var(--background-color)` |
| `ld-mono` | `font-family: var(--monospaced-font-family)` |
| `ld-muted`, `ld-accent`, `ld-danger`, `ld-success`, `ld-info`, `ld-warning` | set `color` to the theme colour — on an element, a `<g>` or the root `<svg>`; an `ld-connector` inside switches to the matching arrowhead |

- **Lengths are in `em`**, i.e. relative to the drawing's `font-size`. Set the
  size of a normal label as `font-size` on the root `<svg>`; stroke widths and
  dash patterns then match those of every other drawing. Without a root
  `font-size`, `em` is the slide's font size in *user units* — far too thick in
  a drawing with a small `viewBox`.
- The fill levels stack: an `ld-cell` on an `ld-panel` is darker still.
- The rules sit in the cascade layer `ld-svg`. A deck's own CSS is not layered
  and therefore always wins, whatever its specificity — override freely, e.g.
  `.aes-diagram .connector { stroke-width: 2; }`.
- Put a colour modifier on the connector itself or on its closest group: with
  two nested modifiers the line takes the inner colour, the arrowhead the one
  whose rule comes later.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 8" font-size="1">
    <rect class="ld-cell" x="0" y="2" width="10" height="4" />
    <text class="ld-label" x="5" y="4.35" text-anchor="middle">Client</text>
    <!-- the server's box starts at x=30: end the line 1.5 x 0.1 before -->
    <line class="ld-connector" x1="10" y1="4" x2="29.85" y2="4" />
    <g class="incremental ld-accent">
        <rect class="ld-cell" x="30" y="2" width="10" height="4" />
        <text class="ld-label" x="35" y="4.35" text-anchor="middle">Server</text>
    </g>
</svg>
```

Changing a shared definition changes every deck. Add rather than alter; if a
shape or colour really has to change, rebuild all decks (`ld2 build --force`)
and look at a few.

## 4. Deck specific definitions

What only one deck needs goes next to its drawings, under the deck's own
prefix — never `ld-`:

```
sec-aes/
├── folien.de.md
└── drawings/
    ├── aes-defs.svg        -> ld.include-globals  (#aes-matrix-4x4, …)
    ├── aes-diagrams.css    -> ld.include-styles   (.aes-diagram .connector, .hex, …)
    └── encryption_process.svg
```

Scope a deck's classes by a class on the drawings' root (`.aes-diagram …`) so
that they cannot hit another drawing in the same document.

## 5. Checklist

- [ ] embedded with `{include-svg}`, not `{image}`/`{figure}`
- [ ] `:width:` and `:height:` in `ch` or `lh`, aspect ratio of the `viewBox`
- [ ] the file satisfies the checklist in LectureDoc2's `SVGs.md`
- [ ] arrows, lines and fills use the shared `ld-` markers and classes where
      they fit; lines end 1.5 × stroke-width before their target
- [ ] root `font-size` set to the label size (the `ld-` classes measure in `em`)
- [ ] deck specific CSS and definitions in `ld.include-styles` /
      `ld.include-globals`, under a deck prefix
- [ ] built (`ld2 build --force` if only an included file changed) and checked
      in light and dark mode and in the PDF

## Worked example

`sec-aes` in the lecture repository: the drawings use `#ld-arrow` and the
`ld-panel`, `ld-cell`, `ld-label` and `ld-label-on-fill` classes, plus
AES-specific classes and symbols from `drawings/aes-diagrams.css` and
`drawings/aes-defs.svg`.

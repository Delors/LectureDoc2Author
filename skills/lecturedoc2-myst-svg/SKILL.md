---
name: lecturedoc2-myst-svg
description: Embed SVG drawings in LectureDoc2 MyST decks built with ld2 - {include-svg} with ch/lh sizes, ld.include-styles / ld.include-globals, and the shared ld- markers and classes (ld-arrow, ld-connector, ld-panel, ...). Use whenever a drawing is added to, replaced in or restyled in a MyST deck; use together with LectureDoc2's lecturedoc2-svg skill for the SVG file itself.
---

# SVG drawings in LectureDoc2 MyST decks

This skill covers how a drawing gets into a deck and which shared definitions
it should use. What the SVG file itself must look like (units, colours,
`<defs>`, markers) is LectureDoc2's skill `lecturedoc2-svg` — in a project with
both submodules: `LectureDoc2/skills/lecturedoc2-svg/SKILL.md`. Read it first.

Full documentation: [`docs-svgs.md`](../../docs-svgs.md). The shared files:
[`shared/ld/svgs/`](../../shared/ld/svgs/).

## Embedding

```markdown
:::{include-svg} drawings/key-schedule.svg
:width: 60ch
:height: 33.75ch
:class: center-content
:::
```

- Always `{include-svg}` for vector drawings; `{image}`/`{figure}` only for
  raster images (they load the SVG as a separate document — no theme, no
  shared markers).
- `:width:` and `:height:` are required, in `ch` or `lh`, with the aspect ratio
  of the `viewBox` (`viewBox="0 0 160 90"` → `60ch` × `33.75ch`). Never a bare
  number. Size conservatively; check the slide.
- The path is relative to the file containing the directive (an `{include}`d
  snippet resolves relative to itself).
- `:class: incremental` reveals the whole drawing as one step; steps inside it
  are `incremental` groups in the SVG.
- The file is copied verbatim: no XML declaration, `<!DOCTYPE>`, root
  `width`/`height`, `<style>` or `<defs>` in it.

## Shared `ld-` definitions (use them first)

In Lectures-Myst they are included for every deck through `myst.yml`
(`ld.include-globals` → `ld-svg-defs.svg`, `ld.include-styles` → `ld-svg.css`).
Another project adds the same two entries to its `myst.yml`.

Markers (`marker-end="url(#…)"`, also as `marker-start` — they reverse):

| id | use |
| --- | --- |
| `ld-arrow` | default arrowhead, foreground colour |
| `ld-arrow-muted`, `-accent`, `-danger`, `-success`, `-info`, `-warning` | arrowhead in a theme colour |
| `ld-arrow-open` | open (chevron) head |
| `ld-dot` | dot on the end point |

**Geometry:** the tip lies 1.5 × stroke-width beyond the line's end point. A
line that should touch its target ends 1.5 × stroke-width before it.

Classes (only inside `<svg>`, all paint with `currentColor`, lengths in `em`):

| class | for |
| --- | --- |
| `ld-line`, `ld-connector` (= line + `ld-arrow`) | lines; `stroke-width: 0.1em` |
| `ld-dashed`, `ld-dotted` | dash patterns, combined with a line class |
| `ld-box` | outlined shape |
| `ld-panel` / `ld-cell` / `ld-highlight` | fill at 0.1 / 0.3 / 0.65 opacity (they stack) |
| `ld-label`, `ld-label-on-fill` | text; text on a filled shape |
| `ld-mono` | monospaced text |
| `ld-muted`, `ld-accent`, `ld-danger`, `ld-success`, `ld-info`, `ld-warning` | colour modifier (sets `color`) on an element, `<g>` or root; an `ld-connector` inside gets the matching arrowhead |

- The root `<svg>` must set `font-size` to the label size — `em` lengths depend
  on it.
- The rules live in the cascade layer `ld-svg`: deck CSS always overrides them.
- Put a colour modifier on the connector or its closest group, not on two
  nested levels.
- Changing a shared definition changes every deck: add, don't alter, unless
  asked — and then rebuild and check several decks.

## Deck specific CSS and definitions

What only one deck needs goes next to its drawings, under a deck prefix
(never `ld-`), listed in the deck's frontmatter:

```yaml
ld:
    include-styles:
        - drawings/aes-diagrams.css   # classes scoped by the root class: .aes-diagram …
    include-globals:
        - drawings/aes-defs.svg       # <svg><defs> with #aes-… ids </defs></svg>
```

The deck's lists **extend** those from `myst.yml` (project entries first; a file
listed twice is included once). Inline variants: `ld.styles`, `ld.globals`.

## Workflow

1. Write or convert the SVG following `lecturedoc2-svg`, using `ld-` markers and
   classes wherever they fit; propose new deck-level classes before adding them.
2. Labels in the language of the deck (`lang:` in the frontmatter).
3. Embed with `{include-svg}`; compute `:height:` from the `viewBox`.
4. Build: `ld2 build <deck>` — `--force` if only an included CSS/definitions
   file changed (staleness is judged by the `.md` alone).
5. Look at it: `ld2 serve`, light and dark, and the PDF (`ld2 pdf`). For
   automated checks, render with headless Chromium and screenshot the SVG in the
   document view (`lectureDoc2.prepareForPrinting()`), once with
   `prefers-color-scheme: light` and once with `dark`.

## Checklist

- [ ] `{include-svg}` with `ch`/`lh` sizes matching the `viewBox`
- [ ] shared `ld-` markers/classes used where they fit; lines end
      1.5 × stroke-width before the target
- [ ] root `font-size` set
- [ ] deck-specific CSS/definitions in `include-styles`/`include-globals`,
      deck prefix, no `ld-`
- [ ] built (with `--force` if needed) and checked in light and dark mode

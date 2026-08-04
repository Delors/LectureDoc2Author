# MystToLectureDoc2

Converts [MyST Markdown](https://mystmd.org) documents into
[LectureDoc2](https://github.com/Delors/LectureDoc2) compatible HTML.

It is the MyST counterpart of
[reStructuredTextToLectureDoc2](https://github.com/Delors/reStructuredTextToLectureDoc2)
and supports the same set of directives — with one deliberate difference:

> **Math is rendered eagerly, at build time, with KaTeX.**
>
> `rst2ld` defers typesetting to MathJax, which runs in the browser _after_
> LectureDoc2 has laid the slides out. Overlays and incremental elements are
> measured before the math has its final size, which leads to visible jumps and
> mis-sized containers. Rendering with KaTeX during the build removes that whole
> class of problems: the HTML LectureDoc2 receives already has its final shape,
> and no math JavaScript is loaded at viewing time at all.

## Install

```sh
npm install
npm link            # optional: makes `myst2ld` available globally
```

## Use

```sh
myst2ld slides/folien.de.md              # -> slides/folien.de.html
myst2ld --out-dir build slides/*.md
myst2ld --watch slides/folien.de.md
myst2ld --serve slides/folien.de.md      # build + serve + watch + live reload
myst2ld --serve --port 8080 slides/*.md
myst2ld --serve --no-live-reload slides/*.md
```

Everything else is configured in `myst.yml` (see below) and in the document's
frontmatter.

### The development server

LectureDoc2 loads `ld.js` as an ES module and uses `crypto.subtle`, so the
slides have to be served over HTTP — `file://` does not work. `--serve` starts a
dependency-free `node:http` server (so no Python or extra package is needed),
serving **the project root** — the directory containing `myst.yml` — because the
generated HTML references `../LectureDoc2/src/…` and `../katex/…`.

| Flag | Meaning |
| --- | --- |
| `--serve` | serve and watch with live reload |
| `--port <n>` | port (default 8000); `--serve 8080` and `--serve=8080` are shorthands |
| `--root <dir>` | serve a different directory |
| `--host <host>` | bind address (default `127.0.0.1`) |
| `--no-live-reload` | do not inject the reload script |
| `--no-open` | do not print the deck URLs |

If the port is taken, the next free one (up to +20) is used. Responses carry
`Cache-Control: no-store`. The server can also be used stand-alone:

```sh
node node_modules/myst-to-lecturedoc2/src/serve.js <root> <port>
```

## Project configuration

```yaml
version: 1
project:
    plugins:
        - MystToLectureDoc2/myst-plugin.mjs # so `myst start` understands the directives
    ld:
        path: ../LectureDoc2/src # relative to the generated HTML
        theme: css/themes/dhbw.css # relative to LectureDoc2's src folder
        modules:
            animated-logo: ../LectureDoc2/src/css/themes/DHBW/animated-logo.js
            timeline: ../LectureDoc2/components/ld-timeline.js
        katex:
            dir: katex # assets are copied here (project root)
            macros:
                "\\RR": "\\mathbb{R}"
        roles: # custom inline roles
            eng: english # {eng}`text` -> <span class="english">
        passwords: passwords.json # where exercise passwords are written
```

## Document frontmatter

```yaml
---
title: "Titel der Vorlesung"
lang: de
author: Michael Eichberg
keywords: ["Schlagwort A", "Schlagwort B"]
description: "Kurzbeschreibung"
docinfo: # rendered as <dl class="docinfo"> on the title slide
    Dozent: "[Prof. Dr. M. Eichberg](https://example.org)"
    Kontakt: "<mail@example.org>"
    Version: "1.0"
substitutions:
    html-source: "<a href='…'>…</a>"
ld:
    id: my-lecture # <meta name="id"> – LectureDoc2 uses it for storage
    first-slide: last-viewed
    master-password: "…" # required for presenter notes / exercise passwords
---
```

## Slides

Every **level-1 heading starts a new slide**; whatever precedes the first
heading belongs to the _title slide_, whose heading comes from `title:`.

```md
:::{supplemental}
Hintergrundinformation zur Titelfolie.
:::

# Erste Folie

Inhalt.

## Eine Zwischenüberschrift <!-- rendered as <h3> -->
```

Slide attributes are set with `topic-attrs` (the MyST equivalent of putting
`.. class::` in front of a reST section):

`````md
# Bewertungskriterien

```{topic-attrs}
:class: center-child-elements
```
`````

Alternatively a slide can be written out explicitly with `{topic}` (alias
`{slide}`), which is useful when slides are generated:

```md
:::{topic} Titel der Folie
:class: center-child-elements

Inhalt.
:::
```

## Directives

| Directive               | Output                                        | Notes                                                    |
| ----------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `topic` / `slide`       | `<ld-topic>`                                  | explicit slide                                           |
| `topic-attrs`           | –                                             | sets `class`/`name` on the enclosing slide               |
| `supplemental`          | `<ld-supplemental>`                           | `:embed-in-document-flow:`                               |
| `story`                 | `<ld-story>`                                  | scrollable, incremental area                             |
| `scrollable`            | `<ld-scrollable>`                             | `:height:`                                               |
| `deck` / `card`         | `<ld-deck>` / `<ld-card>`                     | cards after the first get `incremental`                  |
| `grid` / `cell`         | `<ld-grid>` / `<ld-cell>`                     | `:align:`, `:theme:`                                     |
| `compound`              | `<div class="compound">`                      | `:theme:`                                                |
| `module`                | `<ld-module>`                                 | pulls in the configured JS module                        |
| `popover`               | `<button popovertarget>` + `<dialog popover>` |                                                          |
| `include-svg`           | inline `<svg>`                                | `:global:` collects into `<ld-svg-globals>`              |
| `global-information`    | `<ld-global-information>`                     | `:type:`, `:symbol:`, `:embed:`                          |
| `exercise` / `solution` | `<div class="ld-exercise">`                   | solutions are AES-GCM encrypted                          |
| `presenter-note`        | `<ld-presenter-note encrypted>`               | needs a master password                                  |
| `source`                | `<a>` to the source document                  | `:prefix:`, `:suffix:`, `:path:`                         |
| `include`               | –                                             | includes and parses another MyST file                    |
| `class`                 | –                                             | docutils' `.. class::` (next sibling or wrapped content) |

### Admonitions

The nine docutils admonitions — `attention`, `caution`, `danger`, `error`,
`hint`, `important`, `note`, `tip`, `warning` — render as

```html
<aside class="admonition" data-theme="hint">
    <p class="admonition-title" data-theme="hint-header">Hinweis</p>
    …
</aside>
```

with the label localized via `lang:` (currently `de` and `en`).

The LectureDoc2 "Renaissance" admonitions take an _additional_ title:

`definition`, `example`, `discussion`, `background`, `proof`, `theorem`,
`lemma`, `conclusion`, `observation`, `remark`, `summary`, `legend`,
`repetition`, `question`, `answer`, `remember`, `deprecated`, `assessment`.

```md
:::{definition} Monade
Ein Monoid in der Kategorie der Endofunktoren.
:::
```

`{admonition} Freier Titel` produces an admonition without a theme.

### Roles

`{raw-html}` / `{html}` inserts its value verbatim, `{incremental}` wraps its
content in `<span class="incremental">`, and every entry of `ld.roles` becomes a
class-applying role. mystmd's own roles (`{kbd}`, `{sub}`, `{sup}`, `{abbr}`,
`{del}`, `{sc}`, `{u}`, …) keep working.

## Nesting fences

MyST closes a colon fence at the first line with **at least as many** colons, so
an outer directive must use **more** colons than the directives nested inside
it:

```md
::::{story}
:::{warning}
…
:::
::::
```

## How it relates to mystmd

`myst-plugin.mjs` exports the directives and roles in the standard MyST plugin
format, so `myst start`/`myst build` can parse the documents. The LectureDoc2
_HTML_ however is produced by `myst2ld`, which owns the mdast → hast handlers
(LectureDoc2's stylesheets expect docutils-shaped markup: `<ul class="simple">`,
`<li><p>…</p></li>`, `<dl class="field-list">`, …).

Because mystmd registers its default directives first and keeps the first
registration of a name, `src/parse.js` removes the default `admonition` (and its
aliases) and `include` specs once at start-up so the LectureDoc2 variants win.

## Development

```sh
npm test         # node:test based unit tests
npm run fmt      # prettier
```

## License

BSD 3-Clause — see `LICENSE.txt`.

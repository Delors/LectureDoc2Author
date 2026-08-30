# LectureDoc2Author

The authoring toolchain for
[LectureDoc2](https://github.com/Delors/LectureDoc2): everything that runs in
Node between writing a deck and it being on a website.

`lecturedoc2` is what the *audience* loads — CSS and ES modules, no Node code.
`lecturedoc2-author` is what the *author* runs. One command, `ld2`:

```sh
ld2 build      # MyST Markdown -> LectureDoc2 HTML, only what is stale
ld2 serve      # build, serve the whole project, watch, live reload
ld2 watch      # build and publish on change; never renders PDFs
ld2 pdf        # HTML -> PDF via headless Chrome, on demand
ld2 publish    # copy what the .publish files name to the target folder
ld2 status     # what all of the above would do; changes nothing
ld2 clean      # remove what build and pdf generated
```

`build` and `serve` work on loose files. `pdf`, `publish`, `watch`, `status` and
`clean` need an `ld.config.json` — see [docs-publishing.md](docs-publishing.md).

`clean` derives what to delete from the sources — `<deck>.md.html`, its PDF and
the two password files, plus the vendored KaTeX directory — so a generated file
whose `.md` was renamed away is left alone rather than guessed about. It never
touches the target folder (`publish --prune` owns that), the publish manifest,
the secrets or a submodule's `dist/`. `ld2 clean -n` lists what would go.

## The converter

Converts [MyST Markdown](https://mystmd.org) documents into
LectureDoc2-compatible HTML.

It is the MyST counterpart of
[reStructuredTextToLectureDoc2](https://github.com/Delors/reStructuredTextToLectureDoc2)
and supports the same set of directives — with one deliberate difference: **Math is rendered eagerly, at build time, with KaTeX.** MathJax is no longer used.

## Install

```sh
pnpm add -D lecturedoc2-author
```

That puts `ld2` in `node_modules/.bin`, so `pnpm exec ld2 …` works and it is on
the `PATH` of every script. Nothing has to be linked globally.

Inside a project that consumes this package as a **git submodule**, make it a
workspace project instead — one `pnpm install` at the project root then links it
into `node_modules/` as a symlink, so `ld2` and `import "lecturedoc2-author"`
both work while the submodule stays live-editable. Workspaces resolve by
*package name*, so the directory may be called anything:

```yaml
# pnpm-workspace.yaml
packages:
    - LectureDoc2Author
```

The consuming project also has to depend on it — `"lecturedoc2-author":
"workspace:*"` — otherwise pnpm links nothing and `ld2` is not on the `PATH`.

Only for hacking on this package standalone:

```sh
pnpm install        # inside LectureDoc2Author/
node src/cli.js …   # or `pnpm link --global` to get a global `ld2`
```

## Use

```sh
pnpm exec ld2 build slides/folien.de.md              # -> slides/folien.de.md.html
pnpm exec ld2 build --out-dir build slides/*.md
pnpm exec ld2 build --pretty slides/folien.de.md     # pretty-print the HTML
pnpm exec ld2 serve slides/folien.de.md              # build + serve + watch + live reload
pnpm exec ld2 serve --port 8080 slides/*.md
pnpm exec ld2 serve --no-live-reload slides/*.md
```

`ld2 serve` serves the **project root**, not the deck's folder: a generated deck
references `../LectureDoc2/src/ld.js` and any shared assets, so serving only the
deck directory would 404 on everything it needs.

Everything else is configured in `myst.yml` (see below) and in the document's
frontmatter.

### Output files

`.html` is **appended** to the full source name rather than replacing the
extension, so `folien.de.md` becomes `folien.de.md.html` — the same convention
reStructuredTextToLectureDoc2 uses (`folien.de.rst.html`). Derived files are
therefore recognizable at a glance and a single `*.md.html` line in
`.gitignore` covers all of them. Use `--out` to choose a different name.

### When something is wrong

Every problem is reported as `file:line:column: directive: message`, with the
path relative to the project root — the file being the one the mistake is
written in, which with `{include}` is not necessarily the deck being built:

```
building 13 document(s):
  DHBW_W3WI-110.1-Web-Programmierung/folien.de.md.html (64 ms)
  [error] shared/snippets/intro.de.md:12:1: include-svg: :width: is required
          They give the SVG its box on the slide, e.g. `:width: 1600` and `:height: 900`.
          A file that only holds definitions for other SVGs belongs in `ld.include-globals`.
          included from web-html/folien.de.md:30
  cv/folien.de.md.html (16 ms)
  …

1 of 13 documents failed:
  web-html/folien.de.md
```

A failing document never stops the others, and `ld2 serve` starts the server
regardless — a mistake in the deck you are *not* working on should not keep you
from looking at the one you are. The exit code is 1 if anything failed.

`[warn]` is something that was ignored (an option that does not exist, a
formula KaTeX could not render); `[error]` means the generated HTML is missing
something. Both are positioned, and mystmd's two most common findings — an
unknown directive, an unexpected option — come with a suggestion:

```
    [error] deck.md:7:1: unknown directive: sourec
            Did you mean `source`?
```

| Flag | Meaning |
| --- | --- |
| `--no-strict` | write the output even when a document has errors |
| `--debug` | print stack traces (also `LD2_DEBUG=1`) |

An `internal error:` in a report is a bug in `ld2` rather than a mistake in the
document; it still names the document that triggered it, and `--debug` gets the
stack trace.

### The development server

LectureDoc2 loads `ld.js` as an ES module and uses `crypto.subtle`, so the
slides have to be served over HTTP — `file://` does not work. `ld2 serve` starts
a dependency-free `node:http` server (so no Python or extra package is needed),
serving **the project root** — the `ld.config.json` directory, or failing that
the `myst.yml` one — because the generated HTML references LectureDoc2 and the
shared assets relative to it.

| Flag | Meaning |
| --- | --- |
| `--port <n>` | port (default 8000) |
| `--root <dir>` | serve a different directory |
| `--host <host>` | bind address (default `127.0.0.1`) |
| `--no-live-reload` | do not inject the reload script |
| `--no-open` | do not print the deck URLs |

A deck that fails to build is reported and skipped; the server still comes up
and the watcher picks it up as soon as it is fixed.

If the port is taken, the next free one (up to +20) is used. Responses carry
`Cache-Control: no-store`. The server can also be used stand-alone:

```sh
node node_modules/lecturedoc2-author/src/serve.js <root> <port>
```

## Project configuration

Every path below `ld:` is relative to the **project root** (the directory that
holds `myst.yml`) and is rewritten into a document-relative href for each deck,
so decks may sit at any depth. Absolute URLs are used as-is. The one exception
is `theme`, which is relative to LectureDoc2's `src` folder.

A `master-password` given in a document's frontmatter overrides the one from
the secrets file, so a self-contained deck can encrypt with its own password.

```yaml
version: 1
project:
    plugins:
        - LectureDoc2Author/myst-plugin.mjs # so `myst start` understands the directives
    ld:
        path: LectureDoc2/src # relative to the project root
        theme: css/themes/dhbw.css # relative to LectureDoc2's src folder
        modules: # local urls are relative to the project root
            animated-logo: LectureDoc2/src/css/themes/DHBW/animated-logo.js
            timeline: LectureDoc2/components/ld-timeline.js
        katex:
            dir: shared/ext/katex # assets are copied here (project root)
            macros:
                "\\RR": "\\mathbb{R}"
        roles: # custom inline roles
            eng: english # {eng}`text` -> <span class="english">
        secrets: shared/secrets/ld-secrets.yml # git-ignored; holds master-password
        passwords: true # write <output>.passwords.json[.md] (default)
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
---
```

An unknown key under `ld:` is reported as a warning, with a suggestion where
there is an obvious one. A setting that is merely ignored is the worst way for
one to fail — the build succeeds and the deck is quietly missing whatever the
key was meant to do.

### Deck specific CSS and markup

Four keys, two pairs. `styles` and `globals` take their content inline,
`include-styles` and `include-globals` take a **list of files** whose content
is copied into the generated HTML **verbatim**:

```yaml
ld:
    include-styles: # -> <style> in the <head>, one per file
        - drawings/letter_frequency.css
    styles: | # -> <style> in the <head>, after the files
        .letterfreq .bar { fill: var(--accent-color); }
    include-globals: # -> <ld-globals> in the <body>, verbatim
        - drawings/arrow-defs.svg
    globals: | # -> <ld-globals>, after the files
        <script type="module">…</script>
```

| | wrapped in | resolved against |
| --- | --- | --- |
| `styles` / `include-styles` | `<style>` in the `<head>` | the document (`myst.yml`: the project root) |
| `globals` / `include-globals` | nothing | the document (`myst.yml`: the project root) |

The `include-*` list comes first and the inline counterpart after it, whatever
order the keys are written in — the merge with `myst.yml` does not preserve the
order *between* two keys, only *within* a list. A deck's CSS is emitted last in
the `<head>`, so it wins a specificity tie against `ld.css` and the theme.

`globals` is markup and is **not** wrapped: an SVG with `<defs>`, a `<style>`,
a one-off `<script>` each have to bring their own element. `<ld-globals>` is
zero-sized, fixed and `overflow: hidden` (but never `display: none`, which
would stop `url(#id)` references from rendering), so whatever is put there is
invisible without the author having to say so. A `<script>` there runs while
the document is being parsed — before the slides exist and before `ld.js`, which
is a module and therefore deferred; use `type="module"` or `DOMContentLoaded`
if it needs the DOM.

A list in a deck's frontmatter **replaces** the one from `myst.yml`, it does
not extend it. Project-wide styling belongs in `ld.theme`.

## Secrets and password files

The `master-password` (required for encrypted solutions and presenter notes)
must never sit in a committed file. It is read from the YAML file named by
`ld.secrets` — `shared/secrets/ld-secrets.yml` by default — which is merged into `ld` and
silently ignored when absent:

```yaml
# shared/secrets/ld-secrets.yml   (git-ignored)
master-password: …
```

Whenever a deck contains exercises, two files are written next to the slides:

- `<output>.passwords.json` — the master password plus every exercise password,
- `<output>.passwords.json.md` — the exercise passwords only; this is the file
  handed to students so they can unlock the sample solutions.

Both contain secrets and belong in `.gitignore` (`*.passwords.json*`). Set
`ld.passwords: false` to disable, or give a path to write a single fixed file.

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

Classes and an id are attached to a slide with **Pandoc style header
attributes** - the same syntax Quarto and `markdown-it-attrs` use:

```md
# Landau-Notation {.new-subsection}

# Beweis {.new-subsection .center-child-elements}

# Zusammenfassung {.transition-fade #fazit}
```

Every token has to start with `.` (class) or `#` (id), so a title that merely
ends in braces - `# Die Menge {1, 2, 3}` - is left untouched. The same works on
deeper headings, where the attributes land on the `<h3>`.

Alternatively a slide can be written out explicitly with `{topic}` (alias
`{slide}`), which is useful when slides are generated:

```md
:::{topic} Titel der Folie
:class: center-child-elements

Inhalt.
:::
```

## Attribute lines

Any other block gets its classes and its id from an **attribute line** written
directly above it — the block-level counterpart of the header attributes:

```md
{.incremental-list}

- Erster Punkt
- Zweiter Punkt

{.columns .evenly-spaced}

| A | B |
| - | - |

{.minor #anmerkung}

Ein Absatz.
```

The line has to be a paragraph of its own — a blank line before **and** after —
and may contain nothing but the attribute list; every token starts with `.`
(class) or `#` (id). Several lines in a row all apply to the block below them,
in the order written.

The rule is applied to the parsed document rather than to the source text, so a
`{.klasse}` inside a code block or a literal directive body is never touched —
it simply is not a paragraph. In running text, write it as inline code:
`` `{.klasse}` ``. And a paragraph that merely happens to consist of braces —
`{1, 2, 3}` — does not match, because every token has to start with `.` or `#`.

## Directives

| Directive               | Output                                        | Notes                                                    |
| ----------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `topic` / `slide`       | `<ld-topic>`                                  | explicit slide                                           |
| `supplemental`          | `<ld-supplemental>`                           | `:embed-in-document-flow:`                               |
| `story`                 | `<ld-story>`                                  | scrollable, incremental area                             |
| `scrollable`            | `<ld-scrollable>`                             | `:height:`                                               |
| `deck` / `card`         | `<ld-deck>` / `<ld-card>`                     | cards after the first get `incremental`                  |
| `grid` / `cell`         | `<ld-grid>` / `<ld-cell>`                     | `:align:`, `:theme:`                                     |
| `compound`              | `<div class="compound">`                      | `:theme:`                                                |
| `module`                | `<ld-module>`                                 | pulls in the configured JS module                        |
| `popover`               | `<button popovertarget>` + `<dialog popover>` |                                                          |
| `include-svg`           | inline `<svg>`                                | `:width:` and `:height:` are required                    |
| `global-information`    | `<ld-global-information>`                     | `:type:`, `:symbol:`, `:embed:`                          |
| `exercise` / `solution` | `<div class="ld-exercise">`                   | solutions are AES-GCM encrypted                          |
| `presenter-note`        | `<ld-presenter-note encrypted>`               | needs a master password                                  |
| `source`                | `<a>` to the source document                  | `:prefix:`, `:suffix:`, `:path:`                         |
| `include`               | –                                             | includes and parses another MyST file                    |
| `literalinclude`        | `<pre class="code …">`                        | shows (part of) an external file as code                 |
| `raw`                   | verbatim HTML                                 | `{raw} html`; unlike a raw HTML block, keeps blank lines |
| `container`             | `<div class="…">`                             | docutils' `.. container::`                               |
| `rubric`                | `<p class="rubric">`                          | informal heading                                         |
| `code` / `code-block`   | `<pre class="code …">`                        | `:number-lines:`, `:emphasize-lines:`                    |
| `csv-table`             | `<table>`                                     | `:header:`, `:widths:`, `:file:`; cells are MyST         |

### Including code from a file

Keep runnable code in a real file and show only the interesting part of it, so
that the deck cannot drift away from code that still compiles and runs:

````md
```{literalinclude} code/min_coins.py
:start-after: "# [begin:core]"
:end-before: "# [end:core]"
:dedent:
:number-lines:
:emphasize-lines: 3-4
```
````

The directive is also available as `include-code`; the option names are those
of Sphinx' and mystmd's `literalinclude`.

| Option | Meaning |
| --- | --- |
| `:language:` (`:lang:`) | highlighting language; inferred from the file extension when omitted |
| `:start-after:` / `:start-at:` | begin after / at the first line containing the given text |
| `:end-before:` / `:end-at:` | end before / at the first such line after the start |
| `:lines:` | explicit selection, e.g. `1,3,5-10,20-` |
| `:start-line:` / `:end-line:` | 1-based, inclusive |
| `:dedent:` | strip a given number of leading spaces, or the common indentation |
| `:lineno-match:` | number the lines as they are numbered in the file |
| `:number-lines:` / `:lineno-start:` | number the lines starting at 1 or a given value |
| `:emphasize-lines:` | highlight lines, counted from 1 **within the block** |
| `:class:` / `:name:` | as everywhere else |

Prefer the marker options over `:lines:` — a line range silently shows the
wrong code once the file is edited, whereas a marker that no longer exists
**fails the build** with the file name and the missing marker. Markers are
ordinary comments in the source file, so the file still runs:

```python
# [begin:core]
def min_coins(n, coins): ...
# [end:core]
```

`:emphasize-lines:` puts `class="emphasized"` on the affected `<code>` line and
its gutter entry; LectureDoc2's `code.css` styles both.

### Raw HTML

A raw HTML *block* in Markdown ends at the **first blank line** (CommonMark
§4.6): everything after it is parsed as Markdown again and ends up escaped in
the output. That makes plain HTML unusable for anything long — an inline `<svg>`
above all. `{raw} html` has no such limit and passes its body through
unchanged:

````md
```{raw} html
<div class="legend">
  <b>A</b>

  <i>B</i>
</div>
```
````

`{raw:latex}` and `{raw:typst}` parse but contribute nothing here; any other
format fails the build rather than silently dropping the block. For an inline
`<svg>` prefer [`include-svg`](#directives) — the drawing then lives in a real
`.svg` file that an editor can open.

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

### Code, tables and footnotes

Code blocks are highlighted at build time with Prism, mapped onto **Pygments'**
class names (`.keyword`, `.name function`, `.comment`, …) so that LectureDoc2's
`code.css` styles them unchanged. Line numbers use the docutils markup
(`<small class="ln">` + `<code data-lineno>`) that `ld-copy-to-clipboard.js`
expects.

Footnotes are rendered in docutils' shape and, unlike in stock mystmd, stay on
the slide they were written on instead of being collected into one section at
the end of the document.

### Roles

`{raw-html}` / `{html}` inserts its value verbatim, `{incremental}` wraps its
content in `<span class="incremental">`, every entry of `ld.roles` becomes a
class-applying role and every entry of `ld.code-roles` an inline code role
(the counterpart of docutils' `.. role:: java(code)`). mystmd's own roles (`{kbd}`, `{sub}`, `{sup}`, `{abbr}`,
`{del}`, `{sc}`, `{u}`, …) keep working.

All of these accept inline attributes, so a role can be combined with an
additional class or an id: `` {eng .incremental-4 #rail-1}`text` ``. A class
that has no role of its own does not need one - mystmd's `{span}` role renders
as a plain `<span>` and carries whatever is written in its attributes:

```md
{span .incremental-2}`m` {span .incremental-4}`e`
```

### Roles in a directive argument

A role in the argument line contains backticks, and CommonMark forbids those in
the info string of a backtick fence. Use a colon fence in that case:

```md
:::{rubric} Lösung mit Memoisierung ({eng}`Memoization`)
:::

::::{example} Das Rucksackproblem ({eng}`Knapsack Problem`)
Inhalt.
::::
```

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
_HTML_ however is produced by `ld2`, which owns the mdast → hast handlers
(LectureDoc2's stylesheets expect docutils-shaped markup: `<ul class="simple">`,
`<li><p>…</p></li>`, `<dl class="field-list">`, …).

Because mystmd registers its default directives first and keeps the first
registration of a name, `src/parse.js` removes the default `admonition` (and its
aliases) and `include` specs once at start-up so the LectureDoc2 variants win.

## Migrating reStructuredText sources

`tools/rst2myst.mjs` converts an existing `reStructuredTextToLectureDoc2`
document to MyST. It understands the subset of reST the slide sets use -
directives, roles, substitutions, field lists, footnotes, `.. class::` - and
moves the content mechanically so nothing is reworded:

```sh
node tools/rst2myst.mjs ../deck/folien.de.rst      # -> ../deck/folien.de.md
```

Review the result afterwards; the shared `docutils.defs` definitions belong in
`myst.yml` (`ld.roles`, `ld.code-roles`, `substitutions`) rather than in the
document.

## Development

```sh
pnpm test        # node:test based unit tests
pnpm fmt         # prettier
```

## License

BSD 3-Clause — see `LICENSE.txt`.

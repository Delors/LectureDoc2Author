# `ld` — build and publish

Replaces `generate-htmls.zsh` and `generate-pdfs.zsh`.

```
ld2 build   [file...]   MyST -> HTML, only where the HTML is out of date
ld2 pdf     [file...]   HTML -> PDF, only where the HTML is newer than the PDF
ld2 publish             copy everything the .publish files name to the target
ld2 watch               build + publish on change; never generates PDFs
ld2 status              what all three would do; changes nothing
```

Configuration is `ld.config.json` at the repository root — one `target`, one
`ignore` list, one `protect` list, no path hard-coded in a script.

## A typical day

```sh
ld2 watch                   # while writing
ld2 pdf                     # when a deck is ready
ld2 publish --prune -n      # review
ld2 publish --prune         # ship
```

## The three things that changed

**No polling.** The old loop woke every three seconds, globbed the whole tree
and listed the target directory, forever. `ld2 watch` uses `fs.watch(…,
{recursive: true})`, which is FSEvents on macOS: the kernel wakes us, and an
idle project costs nothing.

**PDFs are never a side effect.** Rendering a deck launches a browser and walks
every slide. `ld2 watch` will not do that to you mid-sentence; `ld2 pdf` is an
explicit step. `ld2 publish` warns when it is about to ship a PDF older than its
HTML, but publishes it anyway rather than silently spending the minutes.

**Deletion is driven by a manifest.** `.ld-publish-state.json` records what this
tool put into the target. `--prune` deletes what is recorded and no longer
wanted — never "everything in the target that is not listed", which is a claim
about files the tool does not own and which is why the old script needed
hard-coded exceptions for `.git` and `W3M20014`.

## How a deletion is decided

Every run recomputes the *wanted* set from the filesystem — not from the text of
`.publish`. A file that was deleted or renamed simply stops appearing in it, and
`recorded − wanted` is the deletion list. Renames need no detection: the old
path leaves the set, the new one enters, which is exactly the delete+add a
static site wants.

Instead of a "refuse to delete more than N files" threshold — which is always
the wrong N — the risky cases are separated by *why* a listed file is not on
disk:

| situation | response |
|---|---|
| file is there | publish it, record it |
| listed file is absent, but its source is (`folien.de.md` is there, `folien.de.md.html` is not) | **hold** — do not publish, do not delete, keep the record. This is "you have not built yet", not "you deleted it". |
| listed file is absent and nothing produces it | **report and disable pruning for that deck.** `.publish` and the working tree disagree; only you can say which is right. |
| a glob matches nothing | normal — this is how a deleted file stops being published |
| the deck folder is gone | delete everything recorded for it, then remove the empty folders |
| `.publish` is gone but the folder is still there | **delete nothing.** A deck being reorganised and a deck being retired look identical from here. |

Two further guards: deletes are restricted to paths under `target` *and* present
in the manifest, so a file the tool never wrote is unreachable; and a manifest
written for a different `target` is refused rather than reinterpreted.

If the manifest is lost, nothing is pruned — the failure mode is a stale file
lingering, never a site that deletes itself. `ld2 publish --adopt` starts from
empty after a retarget.

## Assets from a package

A deck loads LectureDoc2's CSS and JS from the website, so the runtime has to be
copied there too. Listing those files by hand does not scale — the list in this
project reached 151 entries, and forgetting to add one after a new `@import`
breaks the live site silently. Deriving them by analysing the code does not work
either: `ld.js` loads modules via ``import(`./js/${name}.js`)`` and resolves an
icon directory at runtime, so any static analysis is an approximation whose
failure mode is, again, a silently missing file.

So the set is neither maintained nor inferred — it is **declared once, where it
had to be declared anyway**. npm's `files` field already says which files
constitute a package when distributed, and for an asset-only package that is the
same question:

```json
// lecturedoc2/package.json
"files": ["src", "ext", "components"]
```

```json
// ld.config.json
"assets": [{ "package": "lecturedoc2", "to": "LectureDoc2" }]
```

Adding a stylesheet to a directory that is already listed publishes it. There is
nothing to update, so there is nothing to drift.

The package is located with `require.resolve("<name>/package.json")`, which works
identically for a workspace symlink and a real `node_modules` install — so the
same configuration serves this repository and a scaffolded project, where there
is no LectureDoc2 *directory* to put a `.publish` file in at all.

Entries are interpreted the way a website needs rather than the way `npm pack`
does: a directory means the whole tree, a file means that file, a pattern is
matched against the package. npm forces `package.json`, `README` and `LICENSE`
into every tarball; those are deliberately *not* published. `exclude` takes glob
patterns for anything else you do not want:

```json
"assets": [{
    "package": "lecturedoc2",
    "to": "LectureDoc2",
    "exclude": ["**/*.md"]
}]
```

A package that declares no `files` is refused rather than guessed at — publishing
a whole package directory to a website would ship its sources and its
`node_modules`.

### One folder, one publisher

An assets rule and a `.publish` file that write to the same folder are refused,
including when one is nested inside the other. Copying the same bytes twice
would be harmless, but the manifest records each file under the scope that
produced it, so with two claimants, removing one would prune files the other
still wants — a data-loss bug that surfaces months later. While
`LectureDoc2/.publish` still lists the runtime by hand, exactly one of the two
may be active.

## `.publish` format

Unchanged — one relative path per line — plus three backwards-compatible
additions:

```
# comments and blank lines are ignored
folien.de.md.html
folien.de.md.html.pdf
img/**              # globs
!img/draft-*.png    # negations
images              # a bare directory means everything below it
```

A name that exists on disk is taken literally even if it contains glob
metacharacters, so `VictorMono[wght].woff2` is the font, not a character class.

## Tests

```sh
node --test test/*.test.js
```

Each test is one real situation — a rename, a deleted image, a retired deck, a
deck that has not been built yet — and asserts what `--prune` does about it.

# Notizen zur Konversion rst → MyST (LectureDoc2)

Erfahrungen aus der Konversion von `web-html/folien.de.rst` (Aug. 2026),
von `sec-klassische-verschluesselungsverfahren`, `sec-blockchiffre` und
`DHBW_W3WI-EG304.1.2-Verschluesselungsverfahren` (26. Aug. 2026) sowie von
`DHBW-W3WI_SE411-…` (3 Decks), `sec-passwortwiederherstellung` und
`sec-passwortsicherheit` (26./27. Aug. 2026).

Ablauf: `node LectureDoc2Author/tools/rst2myst.mjs <deck>.de.rst`, danach die
folgenden Punkte von Hand nacharbeiten — der Konverter deckt sie nicht ab.

---

## 0. Arbeitsregeln

Diese Regeln haben sich als wichtiger erwiesen als jedes Einzelproblem weiter
unten. Sie gelten insbesondere für Cowork-/Agenten-Sessions.

- **Bestehende `.rst`-Dateien nicht löschen.** Auch nicht `*.rst.html` und
  `*.rst.html.pdf`. Der alte Build ist die einzige Referenz, gegen die sich das
  Konvertat prüfen lässt (siehe „Verifikation“). Das Aufräumen macht Michael
  selbst und von Hand, sobald er sich von der Richtigkeit überzeugt hat — also
  auch dann nicht ungefragt „nachhelfen“. Umgekehrt heißt das: sind die
  `*.rst.html` eines Decks schon weg, ist die Konversion bereits abgenommen;
  ein nachträglicher Vergleich ist dann nicht mehr möglich.
- **Keine Änderungen an `LectureDoc2Author` (und `LectureDoc2`) ohne explizite
  Rückfrage.** Wenn eine Lücke im Konverter oder im Renderer auffällt: im Deck
  einen Workaround bauen, die Lücke unter „Bekannte ld2-Lücken / TODOs“
  notieren und den Menschen fragen. Ein „das ist doch nur eine Zeile“ in
  `handlers.js` betrifft alle Decks des Repos.
- **`.publish` im Deck-Verzeichnis umstellen**: `*.de.rst.html` →
  `*.de.md.html` (inkl. der `.pdf`-Einträge). Wird das vergessen, verschwindet
  das Deck beim nächsten Publish von der Webseite.
- **Links *zwischen* Decks mitziehen.** `../allg-vortraege/folien.de.rst.html`
  → `…de.md.html`, ebenso absolute Links auf `delors.github.io/…`. Prüfen, ob
  das Zieldeck schon konvertiert ist; wenn nicht, den Link erst umstellen, wenn
  es soweit ist.
- **Struktur vergleichen — aber auf die Zielstruktur hin.** Der Vergleich mit
  dem rst-Build ist ein Suchwerkzeug für Verluste, kein Auftrag zur
  Pixelgleichheit. Wo docutils/rst2ld erkennbar etwas anderes gerendert hat,
  als der Autor gemeint hat (siehe „Wo der md-Build besser ist“), ist die
  saubere MyST-Struktur richtig — die Abweichung dann bewusst stehen lassen und
  im Ergebnisbericht nennen. Umgekehrt gilt: eine Abweichung, die niemand
  erklären kann, ist ein Fehler und kein Fortschritt.
- **Jede bewusste inhaltliche Änderung melden.** Reparierte Tippfehler,
  aufgelöste rst-Eigenheiten, entfernte Konstrukte: kurz auflisten, damit der
  Mensch widersprechen kann.
- **Am Ende die Folien ansehen.** Der HTML-Vergleich findet keine Layoutfehler
  und keine toten Links (siehe „Verifikation“, letzter Abschnitt).
- **Kein `git` im gemounteten Repo** ohne vorherige Löschfreigabe für den
  Ordner — sonst bleibt eine `index.lock` liegen und blockiert später die
  Commits. Details unten unter „git im gemounteten Repo“.

---

## 1. Frontmatter

- **`lang: de` fehlt immer** und ist von Hand zu ergänzen (steuert die
  Beschriftung der Admonitions). Auch bei genau einer `:description lang=de:`
  in `.. meta::` setzt der Konverter es nicht.
- Docinfo-Feldliste (`:Dozent:`, `:Kontakt:`, `:Version:`) aus dem Body in
  `docinfo:` heben — sonst steht sie *nach* der vom Renderer erzeugten
  Docinfo-Liste. **Ausnahme:** steht zwischen Titel und Feldliste noch etwas
  (z. B. `.. container:: section-subtitle`), erzeugt docutils gar keine
  Docinfo, sondern eine normale `<dl class="field-list simple">` *nach* dem
  Untertitel. ld2 rendert eine Markdown-Definitionsliste exakt so — in dem
  Fall die Liste im Body lassen, denn `docinfo:` im Frontmatter würde sie
  *über* den Untertitel ziehen (`ldTopic` rendert Titel → Untertitel →
  Docinfo → Body). E-Mail-Adressen dabei als Autolink schreiben (`<x@y.de>`),
  der Konverter macht daraus sonst Klartext.
- Kursiver Untertitel unter dem Titel → `subtitle:` (rendert `<p class="subtitle">`).
- `.. class:: X` vor dem Dokumenttitel → `class: X` im Frontmatter.
- `:module: X` aus `.. meta::` → `ld.requiredModules: ["X"]`
  (`ld.module` wird ignoriert; nur `requiredModules` wird ausgewertet).
- `.. include:: ../KI-Verwendung.de.rst.snippet` →
  `../shared/snippets/KI-Verwendung.de.md.snippet` (der Konverter schreibt
  `../_defs/…`, das es nicht gibt).
- **Markup im Dokumenttitel geht verloren.** `buildSlides` reicht zwar
  `titleNodes` weiter, aber `build.js` setzt es nie und `handlers.js` rendert
  die Titelfolie mit `u("text", node.title)`. `title: "… *DES*"` erscheint
  wörtlich mit Sternchen. Bis ld2 das kann: Titel als Klartext schreiben.
- **`.. |X| source:: datei.rst`** wird verworfen (Warnung „substitution
  definition dropped“). Ersatz im Dokument-Frontmatter — das Ziel dabei auf
  `.de.md` umstellen:

  ```yaml
  substitutions:
    Kontrollfragen:
      myst: |
        ```{source} kontrollfragen.de.md
        :path: relative
        :prefix: https://delors.github.io/
        :suffix: .html
        ```
  ```

---

## 2. Folienstruktur und Folien-Ids

- **Ein Folientitel mit Inline-Markup wird als Setext-Überschrift ausgegeben**
  (`... und Pfeffern ({eng}`Pepper`) von Passwörtern` + `-----`-Zeile). Setext
  ist `<h2>`, ld2 schneidet Folien aber an `#` — die Folie verschwindet
  ersatzlos und ihr Inhalt landet auf der vorherigen. Immer auf `#` umstellen.
  (Ein Titel, der *komplett* ein Link ist, wird dagegen korrekt zu
  `# [Text](url)`.) Prüfen mit `grep -n "^---\+$" folien.de.md`.
- **Die `id` einer Folie leitet ld2 aus dem Titeltext ab** — einschließlich
  rohem HTML im Titel. Aus `# Titel <a class="citation-reference" …>[PCFG]</a>`
  wird eine id, die den ganzen Tag enthält. Ebenso hängt docutils bei
  *doppelten* Folientiteln ein `-1` an, ld2 nicht (→ doppelte `id`s im
  Dokument, `jumpToId` trifft die falsche Folie). Beides ist mit einer
  expliziten id auf der Überschrift lösbar, kombinierbar mit Klassen:

  ```markdown
  # Gedankenexperiment {#gedankenexperiment-1 .transition-move-left .exercises}
  ```

- Die **Titelfolie** bekommt in ld2 die `ld.id` aus dem Frontmatter als `id`,
  in docutils war es der Slug des Dokumenttitels. Systematisch in allen Decks,
  ohne Folgen.

---

## 3. Interne Links (Zitate, Fußnoten, Querverweise)

`ld.js` registriert Klick-Handler nur auf

```js
'#ld-slides-pane a:where(.reference.internal, .citation-reference, [role="doc-backlink"])'
```

Nur diese Links rufen `jumpToId()` auf, das die Zielfolie sucht und dorthin
springt. Ein Link mit einer *anderen* Klasse — z. B. das
`class="reference external"`, das ld2 einem gewöhnlichen Markdown-Link
`[\[PCFG\]](#pcfg)` gibt — bekommt keinen Handler; der Browser setzt dann nur
den URL-Fragment, und da LectureDoc den Fragment als `#slide-N` interpretiert,
passiert nichts Sinnvolles.

**Konsequenz:** Querverweise innerhalb eines Decks müssen die passende Klasse
tragen. Da Markdown das nicht hergibt, den Link als rohes Inline-HTML
schreiben — das funktioniert auch in einer Überschrift (dann aber die Folien-id
explizit setzen, s. o.). Im HTML-Diff sieht ein Link mit falscher Klasse völlig
normal aus; er tut nur nichts.

---

## 4. Inhalt

- **rst-Grid-Tabellen** bleiben als roher rst-Text im `{table}`-Block liegen.
  Layout-Tabellen mit `colspan` als rohes HTML schreiben (Klassen `booktabs`,
  `incremental-table-rows`, `align-center` beibehalten).
- **Literale Blöcke (`::` in eigener Zeile)** werden *nicht* konvertiert: das
  `::` bleibt als Text stehen und der eingerückte Block wird dedentet — führende
  Leerzeichen (also die eigentliche Information bei ASCII-Grafik) gehen
  verloren, Zeilen mit `-` werden zu Listenpunkten. Ersatz: Backtick-Fence mit
  dem *originalen* rst-Blockinhalt (nur den gemeinsamen Einzug entfernen).
  Rendert als `<pre class="literal-block"><code>`, deckungsgleich mit rst2ld.
  War der Block in rst zusätzlich eingerückt (Blockzitat), den Fence mit `> `
  umschließen. Aufspüren mit `grep -n "^\s*::\s*$" folien.de.md`.
- **`.. math::` (Block)** wird inzwischen zu `$$…$$` konvertiert (mehrere durch
  Leerzeilen getrennte Gleichungen werden zu mehreren `$$`-Blöcken, wie in
  docutils). Inline `:math:` wird korrekt zu `$…$`.
- **Blockzitat mit `-- Attribution`** → `:::{epigraph}` (rekonstruiert
  `<blockquote>` + `<p class="attribution">`).
- **`.. epigraph:: <Titel>`**: das Argument wird verworfen (Warnung
  „unexpected argument provided for directive: epigraph“). rst2ld rendert es
  als *ersten Absatz* im Blockzitat — also dorthin verschieben.
- **`:ab:`** (rendert `<abbr>`) → `{abbr}`.
- **`incremental-code#1`** → `incremental-code-1`; LectureDoc2 liest die Step-Id
  hinter dem letzten Bindestrich, `#1` matcht nichts.
- **`.. include:: x.html :code: html`** → `{literalinclude}` (der Konverter
  macht daraus `{include}`, das die Datei als MyST parsen würde). Gilt genauso
  für `.. include:: exercise/crack.zsh :code: zsh :number-lines: :class: …` →
  `{literalinclude}` mit `:language: zsh` (Alias `code`/`lang`) plus den
  übrigen Optionen.
- **`{raw-html}` existiert in diesem Projekt nicht**: `myst.yml` definiert die
  Code-Rolle `html`, und die verdrängt die eingebaute Rolle `raw-html`/`html`
  komplett. Stattdessen das HTML einfach inline schreiben (`&#60;`, `<a …>`).
- **HTML-Entities, die als Text sichtbar sein sollen** (`&lt;`, `&nbsp;` …),
  müssen in Markdown doppelt escaped werden (`&amp;lt;`).
- **`<X>` im Fließtext und in `{csv-table}`-Zellen** wird vom Markdown-Parser
  als HTML-Tag geschluckt (`**Number<X>.od?**` → `Number.od?`, `*<Rest>*` →
  leer). `&lt;X&gt;` schreiben. Der Konverter escaped `<` nur an manchen
  Stellen (`&lt;X>`), nicht in Tabellenzellen.
- **Rohes HTML**: keine Leerzeile innerhalb eines HTML-Blocks (danach folgender
  eingerückter Text wird zum Codeblock) und eine Leerzeile *vor* der nächsten
  Fence bzw. dem nächsten Listenpunkt (sonst verschluckt der HTML-Block sie).
- Fußnotenreferenzen im Slide-Titel (`# HTML[^1] - Historie`) funktionieren.

### Blockzitate durch Über-Einrückung

rst erzeugt aus jedem tiefer als nötig eingerückten Block ein `<blockquote>`.
Solche Blöcke sind im Quelltext oft unabsichtlich entstanden, prägen aber das
Layout (Einzug). Der Konverter zieht sie ersatzlos flach. In einem Deck können
das leicht zehn Stück sein — der Element-Vergleich (`blockquote: rst=17 md=7`)
findet sie zuverlässig. Ersatz: `> ` davor, auch verschachtelt und innerhalb
von Listenpunkten (`  > `), inklusive `>`-Zeilen für die Leerzeilen dazwischen.
Ein `{container}` o. Ä. im Blockzitat wird komplett mit `> ` umschlossen.

### `.. class::` mit mehreren Blöcken

`.. class:: X` mit *eingerücktem Inhalt* gibt die Klasse an **jeden** Block im
Inhalt weiter; eine Markdown-Attributzeile gilt nur für den *nächsten* Block.
Der Konverter warnt („has more than one block; the attribute line only applies
to the first“) — dann `{.X}` vor jedem betroffenen Absatz wiederholen bzw. bei
Codeblöcken `:class: X` als Option setzen.

### `.ld.css` / `.ld.svg` (Beispiel: english_letter_frequency)

Das rst-Paar aus `.. include:: x.ld.css` (eine `.. meta:: :svg-style:`-Datei)
und `.. include:: x.ld.svg` (eine `.. raw:: html`-Datei) wird gar nicht
übernommen — die css-Zeile verschwindet, die svg-Zeile wird zu `{include}`, das
die Datei als MyST parsen würde. Ersatz:

- CSS-Body → `ld.svg-style: |` im Frontmatter (`build.js` liest
  `ld["svg-style"]` und schreibt daraus `<svg class="svg-global-style"><style>…`).
- SVG → `.ld.md` daneben legen: der Rohinhalt der `.. raw:: html`, umschlossen
  von `<div class="align-center">…</div>` (docutils' `:class:`-Wrapper), **ohne
  Leerzeilen** — eine Leerzeile beendet den HTML-Block in Markdown. Dann
  `{include} drawings/x.ld.md`.

### Zitate (`[X]_` / `.. [X]`) und das Literaturverzeichnis

`citations: false` in `LectureDoc2Author/src/parse.js` — MyST-Zitate sind in
diesem Projekt abgeschaltet. Der Konverter lässt die Referenzen als `[X]\_`
stehen und **kommentiert das Literaturverzeichnis komplett aus** (`% [X]`), die
Folie ist dann leer.

**Benannte Fußnoten sind kein Ersatz** (ausprobiert und wieder verworfen):
`[^X]` / `[^X]: …` baut zwar docutils-nahes Markup, aber `slide.css` setzt
`ld-slide > .footnote-list { position: absolute; bottom: 0 }` und
`footnoteDefinition` in `handlers.js` verpackt *jede* Definition in ein eigenes
`<aside class="footnote-list">` — fünf Einträge liegen dann alle übereinander
am Folienfuß. Zusätzlich zieht mystmd Fußnotendefinitionen aus
Direktiven-Bodies heraus: ein `:::{scrollable}`, das nur Definitionen enthält,
bricht den Build ab („no parsed content for required body of directive“).

Ersatz, der docutils' Rendering *exakt* trifft — das Verzeichnis als **rohes
HTML** in das `{scrollable}` schreiben (keine Leerzeilen im Block):

```html
<div role="list" class="citation-list">
<div class="citation" id="pcfg" role="doc-biblioentry">
<span class="label"><span class="fn-bracket">[</span><a role="doc-backlink" href="#citation-reference-1">PCFG</a><span class="fn-bracket">]</span></span>
<p>S. Aggarwal, … doi: <a class="reference external" href="…">10.1109/SP.2009.8</a></p>
</div>
</div>
```

… und die Referenz im Text ebenfalls als rohes Inline-HTML:

```html
<a class="citation-reference" href="#pcfg" id="citation-reference-1">[PCFG]</a>
```

Beide Klassen sind Pflicht: `.citation-reference` und `[role=doc-backlink]`
stehen im Selektor von `registerSlideInternalLinkClickedListener` (siehe
„Interne Links“), ein gewöhnlicher Markdown-Link springt nicht. Die Ids
`citation-reference-N` werden wie in docutils in Reihenfolge des Auftretens im
Dokument vergeben; `.citation`, `.label` und `.fn-bracket` liefern über
`common.css` den hängenden Einzug. Steht eine Referenz in einem Folientitel,
dort zusätzlich die Folien-id explizit setzen.

### Escaping-Fehler des Konverters

Alle echte Fehler, nicht Vorsicht — markdown-it kommt mit den Originalen
zurecht (geprüft):

- `*emph*` wird zu `\*emph\*` escaped, wenn das schließende `*` von `"` oder
  einem Bindestrich gefolgt wird (`"*th*"`, `*Swap*s`,
  `*Meet-in-the-Middle*-Angriff`). Zurücknehmen. Ausnahme: `\*` und `\$` in
  Hexdump-Zellen sind korrekt.
- rst-Escapes im Quelltext (`..\..`, `:\<\<\<:`, `[]\^_`) werden zu `\\`
  verdoppelt und der Backslash wird sichtbar. Auf einen bzw. keinen reduzieren.
- `- \31. Aug` (rst-Escape gegen Auto-Enumeration) wird zu `- \\31.`; in
  Markdown ist `- 31\. Aug` richtig.
- Umgekehrt *fehlt* das Escaping, wo Markdown mehr Syntax kennt als rst:
  `- 1\ . Spalte:` wird zu `- 1. Spalte:` und damit zur verschachtelten
  Aufzählung → `- 1\. Spalte:`.
- **Feldlisten-Terme, die mit einer Zahl beginnen** (`:19. Nov. 2025:`) werden
  zu `19. Nov. 2025` und damit zu einer nummerierten Liste — die
  Definitionsliste zerfällt. → `19\. Nov. 2025`. (`20.05.2026` ist ungefährlich:
  kein Leerzeichen hinter dem Punkt.)
- **Fettes Sternchen in `{csv-table}`-Zellen** wird zerschossen: aus `**\*\***`
  wird `**\*\**\*`, und eine Zelle enthielt am Ende sogar **NUL-Bytes**
  (`", \x000\x00*"`). Nach der Konversion auf `\x00` prüfen
  (`python3 -c "print(open(f).read().count(chr(0)))"`) und die Zellen von Hand
  aus dem rst übernehmen.
- **Inline-Literale mit Backtick** (``` ``k`≤-~ajsdk`` ```) werden zu einfachen
  Backticks und brechen am inneren Backtick auf → doppelte Backticks setzen.
- **Tab-eingerückte Fortsetzungszeilen in Codeblöcken** verlieren ihren Einzug.
  docutils expandiert Tabs auf Achterspalten (`\t\t` → 16 Spalten, minus
  gemeinsamer Einzug), der Konverter dedentet sie auf 0. Aus dem
  `*.rst.html`-Build ablesen und wiederherstellen.
- `S.\ Houshmand` (rst-escaptes Leerzeichen) rendert in docutils *ohne*
  Leerzeichen — beim Übertragen entscheiden, ob man das Original oder die
  offensichtliche Absicht will, und die Entscheidung melden.

### Strukturen ohne Markdown-Entsprechung

- **`(a)`/`(b)`-Aufzählungen** (docutils: `<ol class="loweralpha">`) bleiben
  Fließtext. Ersatz: `{.loweralpha}` + `1.`/`2.` — `ol.loweralpha` ist in
  `LectureDoc2/src/css/themes/LD/common.css` definiert. Achtung: Folgeabsätze,
  die in rst zum Listenpunkt gehörten (Einzug), werden herausgezogen und müssen
  wieder eingerückt werden.
- **`#.`-Autonummerierung** wird zu `\#.` → durch `1.`, `2.`, … ersetzen.
- **Unbalancierte Klammern in Link-URLs** (`…#rotateLeft(int,%20int))`) zerlegt
  der Markdown-Parser falsch → URL in spitze Klammern setzen: `[text](<URL>)`.
- **`.. solution:: Titel`**: das Argument wird von rst2ld ignoriert,
  `{solution}` in ld2 kennt keins und warnt. Ersatzlos streichen. (`:pwd:`
  funktioniert; die erzeugte `*.passwords.json` war in beiden Builds identisch
  — das ist ein guter zusätzlicher Check bei Decks mit Lösungen.)
- **`.. image::` mit dem Pfad in der Folgezeile** wird zu `{image}` ohne
  Argument → Build-Fehler. Pfad in die Direktivenzeile ziehen.
- **rst-Titelreferenz** (`` `Text <url>` `` ohne `__`, meist ein Tippfehler)
  rendert in docutils als `<cite>`; der Konverter macht daraus einen kaputten
  Code-Span. Sinnvoll ist die Reparatur zum echten Link — dann aber im
  Ergebnisbericht erwähnen, es ist eine inhaltliche Änderung.

---

## 5. Wo der md-Build *besser* ist als der rst-Build

Diese Unterschiede im Vergleich sind gewollt und sollten nicht „repariert“
werden — hier ist die neue Zielstruktur die richtige:

- **Um drei Leerzeichen eingerückte Unterlisten** (`- x` / `   - y`) sind in
  docutils keine Unterliste, sondern eine Definitionsliste — und rst2ld rendert
  deren `<dd>` als *„Definition“-Admonition-Kasten*. In Markdown wird daraus
  die offensichtlich gemeinte verschachtelte Liste. Zeigt sich im Vergleich als
  fehlendes Wort `Definition` und als `dl`/`dt`/`aside`-Differenz.
- **Leerzeilen im `{csv-table}`-Body** erzeugen in docutils eine *leere
  Tabellenzeile*; ld2 überspringt sie. Zeigt sich als `tr`/`td`-Differenz und
  als zwei fehlende leere Zellen.

---

## 6. Bekannte ld2-Lücken / TODOs

Nicht ohne Rückfrage anfassen (siehe Arbeitsregeln) — hier gesammelt, damit sie
nicht verloren gehen:

- `{container}` rendert nur die eigenen Klassen, nicht `docutils container`.
  Dadurch greift die Regel `div.container:not(:last-child){margin-bottom:…}`
  aus `common.css` nicht mehr — ein `{container}` verliert seinen Abstand nach
  unten. Betrifft alle konvertierten Decks (`class container: rst=20 md=0`).
- Doppelte Folientitel → doppelte HTML-`id`s (docutils hängte `-1` an); rohes
  HTML im Titel landet mit im Slug. Im Deck über `{#id}` umgehbar.
- `footnoteDefinition` verpackt jede Fußnote einzeln in ein
  `<aside class="footnote-list">`; `ld-slide > .footnote-list` ist absolut am
  Folienfuß positioniert. Mehrere Fußnoten auf einer Folie liegen deshalb
  übereinander. Sinnvoll wäre, alle Definitionen einer Folie in *eine* Liste zu
  ziehen.
- Keine Unterstützung für Zitate (`citations: false`) — Literaturverzeichnisse
  müssen als rohes HTML geschrieben werden (siehe oben).
- Markup im Dokumenttitel wird verworfen (`u("text", node.title)` in
  `handlers.js`), obwohl `buildSlides` `titleNodes` weiterreicht.
- `ldModule` gibt den Directive-Body mit `raw(node.value)` unescaped aus;
  rst2ld hat ihn escaped. Die Komponenten (`ld-embedded-iframe`, `ld-timeline`,
  `ld-quizzy`, …) lesen `element.textContent` — bei einem
  `{module} embedded-iframe` landet dadurch ein echtes `<iframe>`-Element im
  DOM und `textContent` liefert nur noch den Fallback-Text; der Iframe
  verschwindet. Workaround aktuell in `web-html/folien.de.md`: die beiden
  Modul-Bodies sind von Hand escaped (`&lt;iframe …`). Wird der Handler auf
  einen Textknoten umgestellt, müssen diese Escapes wieder zurückgenommen
  werden.

### TODOs für `rst2myst.mjs`

Die Punkte aus Abschnitt 1–4, die der Konverter selbst erledigen könnte:

- `lang:` aus `.. meta:: :description lang=xx:` immer setzen.
- Snippet-Pfad `../_defs/…` → `../shared/snippets/…`.
- Literale Blöcke (`::`) als Fence ausgeben statt als Text + dedenteten Block.
- Titel mit Inline-Markup als ATX-Überschrift (`#`) ausgeben, nicht als Setext.
- `.. class:: X` mit mehreren Blöcken auf alle Blöcke anwenden (warnt bereits).
- `.. include:: … :code:` → `{literalinclude}` statt `{include}`.
- Escaping: `\*emph\*`, `\\`-Verdopplung, `\#.`, NUL-Bytes und fette Sternchen
  in csv-Zellen, Inline-Literale mit Backtick, Tab-Einrückung in Codeblöcken.
- Feldlisten-Terme mit führender Zahl escapen (`19\. Nov.`).
- `(a)`-Aufzählungen → `{.loweralpha}` + `1.`.
- `.. epigraph::`-Argument als ersten Absatz übernehmen.
- Zitate: entweder als rohes `citation-list`-HTML ausgeben oder — besser —
  `citations` in ld2 unterstützen.

---

## 7. Änderungen an ld2 (26. Aug. 2026)

Drei Lücken in `{csv-table}`, alle in `src/directives/blocks.js` (plus
`src/render/handlers.js` für die Klassen, Tests in `test/blocks.test.js`).
Nach der Änderung wurden alle 17 Decks des Repos neu gebaut und mit dem Stand
davor verglichen — bis auf die beiden konvertierten `sec-*`-Decks
byte-identisch (Payloads ausgenommen).

- **`:delim:`** war deklariert, wurde aber nie ausgewertet — `parseCsv` hatte
  das Komma fest verdrahtet. Bei `:delim: space` wurde deshalb jede Zeile zu
  *einer* Zelle; aus einer 27-spaltigen Tabelle wurde eine einspaltige.
  Sechs Tabellen in `sec-klassische-verschluesselungsverfahren` waren
  betroffen, ohne Warnung. Jetzt: `csvDelimiter()` (`space`, `tab`, `\uXXXX`,
  einzelnes Zeichen) und `parseCsv(text, delimiter)`; der Delimiter gilt für
  den Body *und* für `:header:`, wie in docutils. Zusätzlich `skipinitialspace`
  — Leerzeichen direkt hinter dem Delimiter beginnen keine Zelle, sonst würde
  jede Ausrichtungslücke im Quelltext eine Leerzelle erzeugen.
- **Kurze Zeilen** werden jetzt auf die Breite der breitesten Zeile aufgefüllt
  (docutils' `pad_rows`). Vorher endete die Hexdump-Tabelle mit einer
  zweispaltigen letzten Zeile.
- **`:stub-columns:`** ergänzt: die ersten n Zellen jeder Zeile werden zu
  `<th class="stub">`, in den Kopfzeilen zu `<th class="stub head">` — genau
  wie docutils. Vorher wurde die Option mit einer Warnung ignoriert und die
  Stub-Spalte verlor Fettung/Zentrierung.

---

## 8. Verifikation

Bauen ohne `ld.config.json`-Target (das Publish-Ziel muss sonst existieren):

```sh
cd ~ && node <repo>/LectureDoc2Author/src/cli.js build --force <repo>/web-html/folien.de.md
```

Der Build muss **warnungsfrei** durchlaufen. Jede Warnung ist ein Hinweis auf
eine verlorene Direktive oder ein verworfenes Argument.

Vier Vergleiche gegen den alten `*.rst.html`-Build, keiner ersetzt die anderen.
Skript: `LectureDoc2Author/tools/cmp-rst-md.py alt.rst.html neu.md.html`
(`--ids` vergleicht nur die Folien-Ids):

1. **Sichtbarer Text pro `<ld-topic>`**, wortweise gediffed; Whitespace und die
   verschlüsselten Payloads (`MTAwMDAw:…`) ignorieren. Codeblöcke dabei
   ausklammern — rst2ld und ld2 verwenden unterschiedliche Highlighter, deren
   Token-Grenzen (und damit die Klassen `literal`/`string`/`name`/`escape`/
   `whitespace`/`punctuation`) systematisch abweichen.
2. **Element- und Klassen-Inventar** pro Dokument zählen (`ld-topic`,
   `ld-supplemental`, `ld-story`, `ld-deck`, `ld-card`, `ld-grid`, `ld-cell`,
   `table`, `tbody`, `thead`, `tr`, `th`, `td`, `svg`, `object`, `pre`, `code`,
   `aside`, `ol`, `ul`, `li`, `dl`, `h1`, `h2`, `em`, `strong`, `p`,
   `blockquote`, `a`, `cite`) — findet verlorene Struktur, die der Text-Diff
   nicht sieht, z. B. verschluckte `.. math::`-Blöcke, fehlende Blockzitate
   oder eine ganz verschwundene Folie (`# topics: rst=54 md=53`).
3. **Codeblöcke exakt**, ohne die `<small class="ln">`-Zeilennummern. Findet
   Einrückungsverluste (Tabs!), die im Text-Diff unsichtbar sind.
4. **Tabellen zellweise**: pro `<table>` die Liste `(Tag, Klassen, Text)` je
   Zelle vergleichen. Das ist nicht optional — eine zur Einspaltigkeit
   kollabierte Tabelle ist im Text-Diff *unsichtbar*, weil die Zelltexte zu
   denselben Wörtern zusammenlaufen. Genau so ist der `:delim:`-Fehler oben
   durch die ersten beiden Prüfungen gerutscht.

Ergänzend lohnt ein Diff der **`<ld-topic>`-Ids** beider Builds: er findet
verlorene/zusätzliche Folien, kaputte Slugs und fehlende `-1`-Suffixe bei
doppelten Titeln in einer Zeile. Bei Decks mit Lösungen zusätzlich die
`*.passwords.json` beider Builds vergleichen.

Zwei Fallen beim Vergleichsskript selbst: beim Strippen der Tags ein Leerzeichen
einsetzen (`re.sub(r"<[^>]+>", " ", …)`), sonst meldet der minifizierte
`*.md.html`-Build falsche Treffer an `</li><li>`-Grenzen; und beim Parsen
müssen Text- und Elementknoten in Dokumentreihenfolge bleiben (Text als
`#text`-Pseudokind einhängen), sonst diffen sich Phantome.

**Der Vergleich ersetzt keinen Blick auf die Folien.** Der zuerst gewählte
Bibliographie-Ansatz (Fußnoten statt `citation-list`) war in allen vier
Prüfungen unauffällig — Text, Reihenfolge und Elementzahl stimmten —, im
Browser lagen die fünf Einträge trotzdem übereinander; und Links mit der
falschen Klasse sehen im HTML-Diff völlig normal aus, tun aber nichts.
Positionierung, Überlauf und Klickverhalten sieht man nur im gerenderten Deck:
nach der Konversion mit `python3 -m http.server` einmal durchklicken,
insbesondere Folien mit Fußnoten, `{scrollable}`, Grids, langen Tabellen und
allen internen Links.

Erwartete Restunterschiede: die Quell-Links (`*.rst.html` → `*.md.html`),
Mathematik (ld2 rendert `$…$` eager mit KaTeX, rst2ld hat `\(…\)` roh
durchgereicht), ein zusätzliches `<code>` in `<pre class="literal-block">`,
ein `<p>` weniger im Docinfo-Wert, die Klassen der Highlighter-Tokens sowie
`fn-bracket`-Spans um Fußnoten-/Zitatlabels.

---

## 9. git im gemounteten Repo (Cowork-Sessions)

Ein von Cowork verbundener Ordner ist standardmäßig **löschgeschützt**: Lesen
und Schreiben funktioniert, `rm`/`rmdir`/`unlink` scheitern mit
`Operation not permitted`.

git legt für praktisch jede Operation — auch für ein harmloses `git status`,
das den Index auffrischen will — die Datei `index.lock` neben dem Index an und
löscht sie hinterher wieder. Genau dieses Löschen scheitert:

```
warning: unable to unlink '…/.git/modules/LectureDoc2Author/index.lock':
         Operation not permitted
```

Das Kommando läuft durch und meldet nichts Auffälliges — aber die `index.lock`
bleibt stehen und blockiert danach jeden Commit auf dem Mac („Unable to create
'…/index.lock': File exists“). Bei **Submodulen** liegt das Lock nicht unter
`<submodul>/.git`, sondern unter `<superprojekt>/.git/modules/<name>/`.

- Für Konversion, Build und Vergleich braucht es kein git — also nicht
  benutzen.
- Wenn git wirklich nötig ist: vorher Löschfreigabe für den Repo-Ordner
  anfragen. Danach räumt git seine Locks selbst wieder ab.
- Liegengebliebenes Lock aufräumen (nur wenn gerade kein git-Prozess läuft —
  0 Bytes und Stunden alt heißt verwaist):
  `find .git -name "*.lock"` und dann löschen. Ohne Löschfreigabe geht als
  Notbehelf `mv index.lock index.lock.stale`; git stört sich nur am Namen.

---

## 10. Checkliste pro Deck

1. `node LectureDoc2Author/tools/rst2myst.mjs <deck>.de.rst` — Warnungen lesen.
2. `.de.md` gegen `.de.rst` durchgehen; Punkte aus Abschnitt 1–4 abarbeiten.
3. Schnellprüfungen: `grep -n "^---\+$"` (Setext-Titel), `grep -n "^\s*::\s*$"`
   (literale Blöcke), `grep -n '_defs\|de\.rst\.html'` (Pfade/Links),
   `grep -nF '\\'` (verdoppelte Backslashes) und auf NUL-Bytes prüfen:
   `python3 -c "print(open('folien.de.md').read().count(chr(0)))"`.
4. Bauen, bis warnungs- und fehlerfrei.
5. Vier Vergleiche + Folien-Id-Diff (+ `passwords.json` bei Lösungen).
6. Jede verbleibende Differenz erklären können; nicht erklärbare = Fehler.
7. Deck im Browser durchklicken (Layout, Überlauf, interne Links).
8. `.publish` auf `*.de.md.html` umstellen.
9. `.rst`, `.rst.html`, `.rst.html.pdf` **stehen lassen**.
10. Ergebnisbericht: was wurde bewusst geändert, was bleibt offen.

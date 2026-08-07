---
title: "LectureDoc2Author – Beispielfoliensatz"
lang: de
author: Michael Eichberg
keywords: ["MyST", "LectureDoc2"]
description: "Demonstriert alle von LectureDoc2Author unterstützten Direktiven."
docinfo:
    Dozent: "[Prof. Dr. Michael Eichberg](https://delors.github.io/cv/folien.de.rst.html)"
    Kontakt: "<michael.eichberg@dhbw.de>"
    Version: "0.1"
substitutions:
    ld: "<em>LectureDoc2</em>"
ld:
    id: myst-to-lecturedoc2-example
    first-slide: last-viewed
    master-password: "beispiel-master"
---

:::{supplemental}
Dieser Foliensatz demonstriert {{ ld }} zusammen mit LectureDoc2Author.
:::

# Admonitions {.center-child-elements}

:::{hint}
Die neun docutils-Admonitions bekommen ein `data-theme` und ein lokalisiertes
Label.
:::

:::{warning}
:class: incremental

Diese erscheint erst beim zweiten Schritt.
:::

:::{definition} Monade
Ein Monoid in der Kategorie der Endofunktoren.
:::

:::{admonition} Frei gewählter Titel
Die generische Admonition hat kein Theme.
:::

# Layout: Deck und Karten

::::{deck}

:::{card}
Erste Karte – immer sichtbar.
:::

:::{card}
:theme: accent

Zweite Karte – `incremental`.
:::

::::

# Layout: Grid und Zellen

::::{grid}

:::{cell}
:align: center

Linke Spalte.
:::

:::{cell}
Rechte Spalte mit {sup}`hochgestelltem`, {sub}`tiefgestelltem` und
{kbd}`Ctrl+C` Text.
:::

::::

# Mathematik (KaTeX, eager)

Inline: $e^{i\pi} + 1 = 0$ und $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}
$$

:::{observation} Kein Layout-Sprung
Da die Formeln beim Bauen gesetzt werden, steht ihre Größe fest, bevor
LectureDoc2 die Folien vermisst.
:::

# Code und Scrollables

```{code-block} python
:linenos:

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

:::{scrollable}
:height: 200px

Sehr langer Inhalt …
:::

# Story

::::{story}

{.incremental-list}

- Punkt eins
- Punkt zwei

    :::{warning}
    Verschachtelte Admonition innerhalb eines Listenpunkts.
    :::

- Punkt drei

::::

# Übungen

::::{exercise} Fibonacci
Implementieren Sie `fib` iterativ.

:::{solution}
:pwd: lösung-eins

Siehe die Code-Folie.
:::

:::{hint}

Das Masterpasswort ist: "beispiel-master" und das Passwort für diese Übung ist: "lösung-eins". 
:::

::::

:::{presenter-note}
Nur in der Präsentationsansicht sichtbar – und verschlüsselt.
:::

# Popover, Compound und Quelle

:::{popover} Mehr erfahren
Der Inhalt eines `<dialog popover>`.
:::

:::{compound}
:theme: accent

Ein Absatz …

… und noch einer, die logisch zusammengehören.
:::

Quelle dieser Folien:

```{source}
:prefix: https://github.com/Delors/Lectures-Myst/blob/main/
```

# Eingebettetes SVG und globale Informationen

```{include-svg} kreis.svg
:width: 120px
:height: 120px
:alt: Ein Kreis
:class: align-center
```

:::{global-information} Glossar
:formatted-title: _Glossar_ der Vorlesung
:symbol: λ
:type: cheat-sheet

Steht auf allen Folien zur Verfügung.
:::

```{module} timeline

```

#!/usr/bin/env python3
"""Vergleicht einen alten `*.de.rst.html`-Build mit dem neuen `*.de.md.html`-Build.

    python3 cmp-rst-md.py folien.de.rst.html folien.de.md.html

Vier Prüfungen (keine ersetzt die anderen):

1. TEXT      - sichtbarer Text pro `<ld-topic>`, wortweise gediffed.
               `<pre>`-Inhalte sind durch einen Marker ersetzt, weil die
               Syntax-Highlighter von rst2ld und ld2 die Tokens anders
               schneiden - das erzeugt sonst nur Rauschen.
2. INVENTORY - Element- und Klassenzählung über das ganze Dokument. Findet
               verlorene Struktur, die der Text-Diff nicht sieht
               (verschluckte `.. math::`-Blöcke, fehlende `<blockquote>`,
               verschwundene Zeilen in `{csv-table}`).
3. PRE       - jeder Codeblock exakt (ohne die `<small class="ln">`-Zeilen-
               nummern). Zeigt Einrückungsverluste, die im Text-Diff
               unsichtbar sind.
4. TABLES    - pro `<table>` die Liste `(Tag, Klassen, Text)` je Zelle. Nicht
               optional: eine zur Einspaltigkeit kollabierte Tabelle ist im
               Text-Diff unsichtbar, weil die Zelltexte zu denselben Wörtern
               zusammenlaufen.

Ergänzend lohnt ein Diff der `<ld-topic>`-Ids beider Builds (Option --ids):
er findet verlorene Folien, kaputte Slugs und fehlende `-1`-Suffixe bei
doppelten Folientiteln.

Wichtig beim Parsen: Text- und Element-Knoten müssen *in Dokumentreihenfolge*
gehalten werden (`#text`-Pseudokinder). Sammelt man erst alle Textstücke eines
Knotens und dann die Kinder, wird die Reihenfolge zerwürfelt und der Diff
meldet lauter Phantomunterschiede. Ebenso muss beim Strippen der Tags ein
Leerzeichen eingesetzt werden, sonst meldet der minifizierte `*.md.html`-Build
falsche Treffer an `</li><li>`-Grenzen.

Und: der Vergleich ersetzt keinen Blick auf die gerenderten Folien. Absolute
Positionierung, Überlauf und tote interne Links sind im HTML unsichtbar.
"""

import sys, re, difflib
from collections import Counter
from html.parser import HTMLParser

VOID = {'br','img','hr','meta','link','input','source','area','base','col',
        'embed','param','track','wbr'}
TAGS = ['ld-topic','ld-supplemental','ld-story','ld-deck','ld-card','ld-grid',
        'ld-cell','ld-scrollable','table','tbody','thead','tr','th','td','svg',
        'object','pre','code','aside','ol','ul','li','dl','dt','dd','h1','h2',
        'em','strong','p','blockquote','a','cite','abbr','ld-module','figure','small']


def node(tag, cls=''):
    return {'tag': tag, 'cls': cls, 'kids': []}


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = node('#root')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        n = node(tag, dict(attrs).get('class', ''))
        self.stack[-1]['kids'].append(n)
        if tag not in VOID:
            self.stack.append(n)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1]['kids'].append(node(tag, dict(attrs).get('class', '')))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]['tag'] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        n = node('#text')
        n['data'] = data
        self.stack[-1]['kids'].append(n)


def parse(path):
    src = open(path, encoding='utf-8').read()
    m = re.search(r'<template>(.*)</template>', src, re.S)
    p = P()
    p.feed(m.group(1) if m else src)
    return p.root


def walk(n):
    yield n
    for c in n['kids']:
        yield from walk(c)


def raw_text(n, skip_ln=False):
    out = []

    def rec(x):
        if skip_ln and 'ln' in x['cls'].split():
            return
        if x['tag'] == '#text':
            out.append(x['data'])
            return
        for c in x['kids']:
            rec(c)

    rec(n)
    return ''.join(out)


def text_of(n):
    if n['tag'] == 'pre':
        return '⟦PRE⟧'
    out = []

    def rec(x):
        if x['tag'] == '#text':
            out.append(x['data'])
            out.append(' ')
            return
        if x['tag'] == 'pre':
            out.append(' ⟦PRE⟧ ')
            return
        for c in x['kids']:
            rec(c)
        out.append(' ')

    rec(n)
    return ' '.join(''.join(out).split())


def topics(root):
    return [n for n in walk(root) if n['tag'] == 'ld-topic']


def diff(xs, ys, pref='   '):
    for line in difflib.unified_diff(xs, ys, lineterm='', n=1):
        if line.startswith(('+', '-')) and not line.startswith(('+++', '---')):
            print(pref, line)


def cmp_text(a, b):
    ta, tb = topics(a), topics(b)
    print(f'# topics: rst={len(ta)} md={len(tb)}')
    for i, (x, y) in enumerate(zip(ta, tb)):
        wa, wb = text_of(x).split(), text_of(y).split()
        if wa != wb:
            print(f'--- topic {i} text differs')
            diff(wa, wb)


def cmp_inventory(a, b):
    ca = Counter(n['tag'] for n in walk(a))
    cb = Counter(n['tag'] for n in walk(b))
    for t in TAGS:
        if ca[t] != cb[t]:
            print(f'# tag {t}: rst={ca[t]} md={cb[t]}')
    cla = Counter(c for n in walk(a) for c in n['cls'].split())
    clb = Counter(c for n in walk(b) for c in n['cls'].split())
    for c in sorted(set(cla) | set(clb)):
        if cla[c] != clb[c]:
            print(f'# class {c}: rst={cla[c]} md={clb[c]}')


def cmp_pres(a, b):
    pa = [n for n in walk(a) if n['tag'] == 'pre']
    pb = [n for n in walk(b) if n['tag'] == 'pre']
    print(f'# pre blocks: rst={len(pa)} md={len(pb)}')
    for i, (x, y) in enumerate(zip(pa, pb)):
        tx, ty = raw_text(x, True), raw_text(y, True)
        if tx != ty:
            print(f'--- pre {i} differs (class rst={x["cls"]!r} md={y["cls"]!r})')
            diff([repr(l) for l in tx.split('\n')], [repr(l) for l in ty.split('\n')])


def cmp_tables(a, b):
    ta = [n for n in walk(a) if n['tag'] == 'table']
    tb = [n for n in walk(b) if n['tag'] == 'table']
    print(f'# tables: rst={len(ta)} md={len(tb)}')
    for i, (x, y) in enumerate(zip(ta, tb)):
        cx = [(n['tag'], ' '.join(sorted(n['cls'].split())), ' '.join(raw_text(n).split()))
              for n in walk(x) if n['tag'] in ('th', 'td')]
        cy = [(n['tag'], ' '.join(sorted(n['cls'].split())), ' '.join(raw_text(n).split()))
              for n in walk(y) if n['tag'] in ('th', 'td')]
        if cx != cy:
            print(f'--- table {i}: rst={len(cx)} cells, md={len(cy)} cells')
            diff([str(c) for c in cx], [str(c) for c in cy])


def cmp_ids(fa, fb):
    def ids(f):
        h = open(f, encoding='utf-8').read()
        return re.findall(r'<ld-topic[^>]*?id="([^"]+)"', h)
    xa, xb = ids(fa), ids(fb)
    print(f'# topic ids: rst={len(xa)} md={len(xb)}')
    diff(xa, xb)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    only_ids = '--ids' in argv
    if len(args) != 2:
        print(__doc__)
        return 2
    fa, fb = args
    if only_ids:
        cmp_ids(fa, fb)
        return 0
    a, b = parse(fa), parse(fb)
    print('==== TEXT ====');      cmp_text(a, b)
    print('==== INVENTORY ===='); cmp_inventory(a, b)
    print('==== PRE ====');       cmp_pres(a, b)
    print('==== TABLES ====');    cmp_tables(a, b)
    print('==== TOPIC IDS ===='); cmp_ids(fa, fb)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

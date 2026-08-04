/* Localized labels.
 *
 * The labels for the standard admonitions are taken from docutils
 * (`docutils/languages/de.py` and `en.py`) so that the generated HTML is
 * identical to the one produced by reStructuredTextToLectureDoc2.
 */

const LABELS = {
    en: {
        // standard (docutils) admonitions
        attention: "Attention!",
        caution: "Caution!",
        danger: "!DANGER!",
        error: "Error",
        hint: "Hint",
        important: "Important",
        note: "Note",
        tip: "Tip",
        warning: "Warning",
        // LectureDoc2 (Renaissance) admonitions
        definition: "Definition",
        example: "Example",
        discussion: "Discussion",
        background: "Background",
        proof: "Proof",
        theorem: "Theorem",
        lemma: "Lemma",
        conclusion: "Conclusion",
        observation: "Observation",
        remark: "Remark",
        summary: "Summary",
        legend: "Legend",
        repetition: "Repetition",
        question: "Question",
        answer: "Answer",
        remember: "Remember",
        deprecated: "Deprecated",
        assessment: "Assessment",
    },
    de: {
        attention: "Achtung!",
        caution: "Vorsicht!",
        danger: "!GEFAHR!",
        error: "Fehler",
        hint: "Hinweis",
        important: "Wichtig",
        note: "Bemerkung",
        tip: "Tipp",
        warning: "Warnung",
        definition: "Definition",
        example: "Beispiel",
        discussion: "Diskussion",
        background: "Hintergrund",
        proof: "Beweis",
        theorem: "Satz",
        lemma: "Lemma",
        conclusion: "Schlussfolgerung",
        observation: "Beobachtung",
        remark: "Bemerkung",
        summary: "Zusammenfassung",
        legend: "Legende",
        repetition: "Wiederholung",
        question: "Frage",
        answer: "Antwort",
        remember: "Zur Erinnerung",
        deprecated: "Veraltet",
        assessment: "Bewertung",
    },
};

/** Returns the localized label for `key`; falls back to English, then to the key. */
export function label(lang, key) {
    const base = (lang ?? "en").split(/[-_]/)[0].toLowerCase();
    return LABELS[base]?.[key] ?? LABELS.en[key] ?? key;
}

export { LABELS };

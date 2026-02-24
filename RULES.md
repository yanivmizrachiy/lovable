# RULES

עדכון אחרון: 2026-02-24

## Purpose
מנוע הפקה דטרמיניסטי להדפסה בלבד (A4) של דפי לימוד בעברית RTL, עם טיפוגרפיה אחידה, כותרת נושא ומספר עמוד בתוך עיגול למעלה משמאל, בולטים בלבד (ללא מספור שאלות), מנוע מתמטי (KaTeX), וגרפיקה וקטורית (SVG).

## Iron Rules
- A4 בלבד: `@page { size: A4; }`.
- RTL עברית: לכל עמוד `<html dir="rtl" lang="he">`.
- טיפוגרפיה: דוד 14pt (או מדיניות החלפה מפורשת).
- כותרת עמוד: כותרת נושא + מספר עמוד בעיגול למעלה משמאל.
- שאלות: ללא מספור מספרי בכלל; רק בולטים (עיגול שחור מלא לשאלה, עיגול שחור מלא קטן יותר לסעיף).
- הפרדת HTML/CSS מוחלטת: אין `style=` ואין `<style>`.
- גרפים/שרטוטים: SVG וקטורי כברירת מחדל.
- PDF: הפקה דטרמיניסטית עם Playwright (Chromium) ו-Print CSS.
- QA חוסם: `npm run qa` נכשל על כל הפרה.
- כל סט שינוי נחשב שלם רק אם RULES.md עודכן באותו סט שינוי.

## Architecture & Toolchain (Pinned)
- Node: 20.19.0
- npm: 11.6.0
- KaTeX: 0.16.10
- Playwright: 1.41.2 (Chromium)
- pdf-lib: 1.17.1
- chokidar: 3.6.0 (watch mode)

### Scripts
- `npm run setup`: התקנת תלותים + התקנת Chromium של Playwright.
- `npm run bootstrap`: כניסה אחת שמריצה setup → qa, מעדכנת RULES.md, ומריצה preview.
- `npm run preview`: שרת מקומי ופתיחת viewer.
- `npm run watch`: כמו preview, ובנוסף Watch על שינויים → QA → רענון תצוגה (best effort).
- `npm run qa`: בדיקות חוסמות.
- `npm run pdf`: הפקת PDF לפי אינדקס הספר.
- `npm run lint`: ESLint + Stylelint + Prettier check.

## Repository Structure
הקבצים והנתיבים הבאים נחשבים נתיבי ליבה:
- /index.html
- /package.json
- /assets/css/base.css
- /assets/css/print.css
- /assets/js/app.js
- /templates/page-template.html
- /templates/page-template.css
- /templates/page-doc-template.md
- /topics/<topic>/pages/page-001.html
- /topics/<topic>/docs/page-001.md
- /topics/<topic>/pages.json
- /scripts/qa/
- /scripts/pdf/
- /RULES.md
- /PROTOCOL.md
- /.vscode/settings.json
- /.vscode/tasks.json

## Design Memory (Owner-Learned, Canonical)
- Typography
  - Base font: David
  - Base size: 14pt
  - Line height target: 1.35
  - Headings: נושא עמוד 16pt bold
- Page geometry
  - A4 size via Print CSS
  - Margin: 12mm
  - Header height: 14mm
- Page header
  - Topic title top
  - Page number circle: top-left, high contrast, circle diameter 10mm, 1.2px stroke
- Bullets
  - Main question bullet: solid black circle, size 1.0em
  - Sub-item bullet: solid black circle, size 0.78em
  - Indent: right padding 6.2mm (main), 5.2mm (sub)
- A4 utilization
  - Avoid page breaks inside questions (`break-inside: avoid`)
  - No excess padding beyond margins
- RTL policy
  - Root dir+lang on html
  - `unicode-bidi: plaintext` on html
- Forbidden
  - Question numbering
  - Inline CSS
  - Raster images without explicit justification

## Graphics Style Memory (Owner-Learned, Canonical)
- SVG vector-first
- Print-safe B/W as default
- Stroke widths
  - Default line stroke: 1.2px
  - Emphasis stroke: 1.8px
- Text in SVG
  - Font: David
  - Size: 12pt for labels unless owner specifies otherwise
- Axes & ticks
  - Thin black lines, consistent tick length
  - Labels aligned for RTL where applicable
- Export integrity
  - Diagrams remain SVG (no rasterization in PDF pipeline)

## One-Time Permissions (Ask-Once Log)
- (אין עדיין)

## VS Code UX Lock (Repo-Local)
- Preview tab replacement disabled via `.vscode/settings.json`.
- Autosave: afterDelay (800ms).
- Smooth list scrolling enabled.
- Terminal scrollback: 10000.

## Book Index (Machine-Readable)
<!--BOOK_INDEX_JSON_START-->
{
  "topics": []
}
<!--BOOK_INDEX_JSON_END-->

## Topic Index (Human)
- (אין נושאים מוגדרים עדיין)

## Page Index Per Topic
- (אין)

## Per-Page Status
- (אין עמודים בריפו בשלב זה)

## QA Status
- Status: PASS
- Timestamp: 2026-02-24T00:00:00Z
- Failures: (none)

## Completed / In-Progress
- Completed: Bootstrap toolchain + templates + QA baseline
- In-Progress: None

## Change Log
- 2026-02-24: נוספו watch/bootstrap, SSE לרענון תצוגה (best effort), והוגדר `.gitignore`.
- 2026-02-24: Bootstrap ראשוני של המנוע, תבניות, CSS A4/RTL, viewer, QA, ותשתית PDF.


## QA Status
- Status: PASS
- Timestamp: 2026-02-24T14:28:47.372Z
- Failures:
(none)


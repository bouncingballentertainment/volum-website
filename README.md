# Volum website

Static marketing site, hosted on GitHub Pages (custom domain `app-volum.com`
via `CNAME`). This is its own git repo, nested inside the app repo — that's
required by GitHub Pages, not a mistake (user/org Pages sites must live in a
repo named exactly `<org>.github.io`).

## i18n build

`index.html`, `es/index.html`, and `pt/index.html` are **generated files**.
Don't hand-edit them directly — edits will be overwritten next time the
generator runs.

- `template.html` — single source of page structure/markup, in English, with
  `{{key}}` (HTML-escaped text) and `{{{key}}}` (raw trusted HTML) placeholders.
- `i18n/en.json`, `i18n/es.json`, `i18n/pt.json` — per-language copy, one JSON
  object keyed the same way across all three files. Includes meta tags
  (`meta_title`, `meta_description`, `og_title`, `og_description`,
  `schema_description`) and all body content.
- `scripts/generate.js` — renders the template against each locale's JSON and
  writes `index.html` / `es/index.html` / `pt/index.html`. No dependencies,
  run with plain Node:

  ```
  node scripts/generate.js
  ```

**Run this before every deploy** after touching `template.html` or any
`i18n/*.json` file, then commit the regenerated HTML alongside the source
change.

To add a new translatable string: add the key to `template.html` as
`{{new_key}}` (or `{{{new_key}}}` for raw HTML), then add `new_key` to all
three `i18n/*.json` files, then regenerate.

`script.js`'s `TRANSLATIONS` object is separate and intentionally small — it
only holds strings generated dynamically after user interaction (signup-form
feedback, the language-picker label), which can't be pre-baked into static
HTML. Everything else lives in `i18n/*.json`.

## Language switching

There's no browser-language auto-detection or redirect — each locale is a
real static page at its own URL (`/`, `/es/`, `/pt/`), fully translated
including meta tags and structured data, so crawlers and direct links always
get correct content. The language picker in the nav does a real navigation
between these URLs, not an in-place content swap.

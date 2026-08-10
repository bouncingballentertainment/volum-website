#!/usr/bin/env node
/**
 * Generates index.html, es/index.html, and pt/index.html from template.html
 * + i18n/{lang}.json. Run before every deploy (see README in this folder).
 *
 * Single source of truth: template.html holds the page structure with
 * {{key}} (text, HTML-escaped) and {{{key}}} (raw HTML) placeholders. Each
 * i18n/{lang}.json holds that language's copy, keyed the same way script.js's
 * old TRANSLATIONS dict was. No content is hand-duplicated between files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');

const LOCALES = [
  { code: 'en', htmlLang: 'en', ogLocale: 'en_US', urlPath: '/', outFile: path.join(ROOT, 'index.html') },
  { code: 'es', htmlLang: 'es', ogLocale: 'es_ES', urlPath: '/es/', outFile: path.join(ROOT, 'es', 'index.html') },
  { code: 'pt', htmlLang: 'pt-BR', ogLocale: 'pt_BR', urlPath: '/pt/', outFile: path.join(ROOT, 'pt', 'index.html') },
];

function escapeHtml(str) {
  // Escapes for both text-node and attribute-value contexts (some {{key}}
  // placeholders land inside content="..."/placeholder="..." attributes),
  // so quotes are escaped too even though none of today's plain-text values
  // contain one.
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsonString(str) {
  // Escape for embedding inside a JSON string literal that's already
  // sitting inside "..." in the template (so we only need to escape
  // backslashes, double quotes, and newlines -- not re-wrap in quotes).
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function renderTemplate(template, data, locale) {
  const tokens = {
    ...data,
    __html_lang: locale.htmlLang,
    __og_locale: locale.ogLocale,
    __canonical_url: `https://app-volum.com${locale.urlPath}`,
  };

  // Split on <script type="application/ld+json"> blocks so we can apply
  // JSON-safe escaping only within them; everywhere else gets HTML escaping
  // for {{key}} and raw substitution for {{{key}}} (trusted, hand-authored
  // markup fragments like form_consent's <a> link).
  const parts = template.split(/(<script type="application\/ld\+json">[\s\S]*?<\/script>)/g);

  return parts
    .map((part) => {
      const isJsonLd = part.startsWith('<script type="application/ld+json">');
      let out = part;
      // Raw HTML placeholders first (longer token), then plain text ones.
      out = out.replace(/\{\{\{(\w+)\}\}\}/g, (m, key) => {
        if (!(key in tokens)) throw new Error(`Missing key "${key}" for locale ${locale.code}`);
        return tokens[key]; // trusted raw HTML, no escaping
      });
      out = out.replace(/\{\{(\w+)\}\}/g, (m, key) => {
        if (!(key in tokens)) throw new Error(`Missing key "${key}" for locale ${locale.code}`);
        return isJsonLd ? escapeJsonString(tokens[key]) : escapeHtml(tokens[key]);
      });
      return out;
    })
    .join('');
}

function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  for (const locale of LOCALES) {
    const dataPath = path.join(ROOT, 'i18n', `${locale.code}.json`);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const html = renderTemplate(template, data, locale);
    fs.mkdirSync(path.dirname(locale.outFile), { recursive: true });
    fs.writeFileSync(locale.outFile, html, 'utf8');
    console.log(`Wrote ${path.relative(ROOT, locale.outFile)}`);
  }
}

main();

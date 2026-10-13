// Tests de la page et du code source : CSP, sécurité, données personnelles.
// On lit les fichiers comme du texte : pas besoin de navigateur.
// Ces tests empêchent de réintroduire par accident ce que CLAUDE.md interdit.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const html = lire('index.html');
const css = lire('css/style.css');

// Le code JavaScript de l'app (pas vendor/ : c'est pdf.js, copié tel quel).
const fichiersJs = readdirSync(new URL('../js/', import.meta.url)).filter((nom) => nom.endsWith('.js'));

describe('sécurité de index.html', () => {
  test('la CSP contient toutes les protections attendues', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.ok(csp, 'balise CSP absente');
    const directives = csp.split(';').map((directive) => directive.trim());
    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'none'", // aucune requête réseau
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "require-trusted-types-for 'script'", // le navigateur refuse innerHTML avec du texte
      "trusted-types 'none'",
    ]) {
      assert.ok(directives.includes(directive), `directive manquante : ${directive}`);
    }
    // Aucune source dangereuse ne doit apparaître.
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|data:|\*|https?:/);
  });

  test('la balise CSP est placée avant toute ressource', () => {
    const positionCsp = html.indexOf('Content-Security-Policy');
    for (const ressource of ['<link', '<script']) {
      assert.ok(positionCsp < html.indexOf(ressource), `la CSP doit précéder ${ressource}`);
    }
  });

  test('aucun script, style ou gestionnaire d’événement en ligne', () => {
    // Les seuls <script> autorisés pointent vers un fichier (src=…).
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(html, /<style\b/);
    assert.doesNotMatch(html, /\sstyle="/);
    assert.doesNotMatch(html, /\son[a-z]+="/);
  });

  test('scripts, styles et polices viennent du site lui-même (aucun CDN)', () => {
    for (const [, adresse] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      assert.doesNotMatch(adresse, /^(https?:)?\/\//, `ressource externe : ${adresse}`);
      assert.ok(existsSync(new URL(`../${adresse}`, import.meta.url)), `fichier introuvable : ${adresse}`);
    }
    for (const [, adresse] of css.matchAll(/url\('([^']+)'\)/g)) {
      assert.doesNotMatch(adresse, /^(https?:)?\/\//, `ressource externe dans le CSS : ${adresse}`);
      assert.ok(existsSync(new URL(`../css/${adresse}`, import.meta.url)), `fichier introuvable : ${adresse}`);
    }
  });
});

describe('code JavaScript', () => {
  test('aucun code n’écrit du HTML (innerHTML, outerHTML, insertAdjacentHTML, document.write)', () => {
    for (const fichier of fichiersJs) {
      // On cherche l'UTILISATION, pas le mot : les commentaires disent « jamais d'innerHTML ».
      assert.doesNotMatch(
        lire(`js/${fichier}`),
        /\.(innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/,
        `js/${fichier}`,
      );
    }
  });

  test('rien n’est stocké : ni localStorage, ni sessionStorage, ni IndexedDB, ni cookies', () => {
    for (const fichier of fichiersJs) {
      assert.doesNotMatch(
        lire(`js/${fichier}`),
        /\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie|\bcaches\.|serviceWorker/,
        `js/${fichier}`,
      );
    }
  });

  test('rien n’est envoyé : aucune requête réseau', () => {
    for (const fichier of fichiersJs) {
      assert.doesNotMatch(
        lire(`js/${fichier}`),
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/,
        `js/${fichier}`,
      );
    }
  });
});

test('style.css : l’attribut hidden cache toujours l’élément, même avec un display: grid', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

// Tests de l'intégration continue et du déploiement (.github/workflows/).
// Ils lisent les fichiers comme du texte : aucune commande git, aucun réseau.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { posix } from 'node:path';

const racine = new URL('../', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin, racine), 'utf8');

const dossierWorkflows = new URL('.github/workflows/', racine);
const workflows = readdirSync(dossierWorkflows).map((nom) => ({ nom, texte: lire(`.github/workflows/${nom}`) }));
const deploiement = workflows.find((w) => w.nom === 'deploiement.yml')?.texte ?? '';

/* ==================== La liste blanche du workflow ==================== */

/**
 * Lit les commandes « cp » de l'étape « Copier les fichiers du site dans _site ».
 * Renvoie ce qui est publié : des fichiers, et des dossiers (copiés en entier).
 *   « cp index.html 404.html _site/ »       → fichiers index.html, 404.html
 *   « cp -R css js _site/ »                 → dossiers css/, js/
 *   « cp data/referentiel.js _site/data/ »  → fichier data/referentiel.js
 */
function listeBlanche(texte) {
  // 1. Le bloc « run: | » de l'étape de copie, jusqu'à l'étape suivante.
  const bloc = /- name: Copier les fichiers du site dans _site\n\s*run: \|\n([\s\S]*?)\n\s*- name:/.exec(texte)?.[1];
  assert.ok(bloc, 'étape « Copier les fichiers du site dans _site » introuvable');

  const fichiers = new Set();
  const dossiers = new Set();
  for (const ligne of bloc.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('cp '))) {
    // 2. « cp [-R] source… destination » : la destination est le dernier mot.
    const mots = ligne.split(/\s+/).slice(1);
    const recursif = mots[0] === '-R';
    const sources = mots.filter((mot) => !mot.startsWith('-')).slice(0, -1);
    const destination = mots.at(-1);
    assert.match(destination, /^_site\//, `destination inattendue : ${ligne}`);
    const dossierPublie = destination.replace(/^_site\/?/, '');

    for (const source of sources) {
      // 3. Le fichier doit garder le MÊME chemin en ligne que dans le dépôt :
      //    sinon les adresses de la page ne le trouveraient pas.
      const publie = posix.join(dossierPublie, posix.basename(source));
      assert.equal(publie, source, `« ${source} » serait publié sous « ${publie} »`);
      (recursif ? dossiers : fichiers).add(source);
    }
  }
  return { fichiers, dossiers };
}

// Vrai si ce fichier du dépôt est publié (lui-même, ou dans un dossier publié).
function estPublie(chemin, { fichiers, dossiers }) {
  return fichiers.has(chemin) || [...dossiers].some((dossier) => chemin.startsWith(`${dossier}/`));
}

/* ==================== Ce que la page charge vraiment ==================== */

// Une adresse vers un autre site, une ancre ou un lien externe : pas un fichier du dépôt.
const estLocale = (adresse) => !/^(?:[a-z]+:|\/\/|#)/i.test(adresse);

// Chemin, dans le dépôt, d'une adresse trouvée dans un fichier (relative à lui, ou absolue « /… »).
function resoudre(depuis, adresse) {
  const sansParametres = adresse.split(/[?#]/)[0];
  return sansParametres.startsWith('/')
    ? sansParametres.slice(1) || 'index.html'
    : posix.normalize(posix.join(posix.dirname(depuis), sansParametres));
}

/**
 * Tous les fichiers chargés par le navigateur : ceux des pages HTML
 * (href, src), du CSS (url(…)), et des modules JS, en suivant les imports
 * de proche en proche à partir de js/app.js.
 */
function fichiersCharges() {
  const charges = new Set();
  const aSuivre = [];
  const ajouter = (depuis, adresse) => {
    if (!estLocale(adresse)) return;
    const chemin = resoudre(depuis, adresse);
    if (!charges.has(chemin)) {
      charges.add(chemin);
      aSuivre.push(chemin);
    }
  };

  // 1. Les pages : index.html, et la page 404.
  for (const page of ['index.html', '404.html']) {
    charges.add(page);
    for (const [, adresse] of lire(page).matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      ajouter(page, adresse);
    }
  }

  // 2. On suit chaque fichier trouvé : imports des modules, url() du CSS.
  while (aSuivre.length > 0) {
    const chemin = aSuivre.pop();
    if (!existsSync(new URL(chemin, racine)) || statSync(new URL(chemin, racine)).isDirectory()) continue;
    // pdf.js (vendor/) est copié tel quel : on ne suit pas son code interne.
    if (chemin.startsWith('vendor/')) continue;

    const texte = lire(chemin);
    if (/\.m?js$/.test(chemin)) {
      // Les imports statiques s'écrivent en début de ligne (^ avec le drapeau m) :
      // sinon « getElementById('import') » serait pris pour un import.
      const motifs = [
        /^\s*(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm, // import … from '…' (même sur plusieurs lignes)
        /^\s*import\s*['"]([^'"]+)['"]/gm, // import '…'
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('…'), chargé plus tard
        /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g, // le worker de pdf.js
      ];
      for (const motif of motifs) {
        for (const [, adresse] of texte.matchAll(motif)) ajouter(chemin, adresse);
      }
    } else if (chemin.endsWith('.css')) {
      for (const [, adresse] of texte.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) ajouter(chemin, adresse);
    }
  }
  return [...charges].sort();
}

/* ==================== Tests ==================== */

describe('workflows GitHub Actions', () => {
  test('toutes les actions sont épinglées par une empreinte SHA complète, avec la version en commentaire', () => {
    for (const { nom, texte } of workflows) {
      const lignes = texte.split('\n').filter((ligne) => /^\s*(-\s*)?uses:/.test(ligne));
      assert.ok(lignes.length > 0, `${nom} : aucune action trouvée`);
      for (const ligne of lignes) {
        // Ex. « uses: actions/checkout@3d3c42e5…ba90b1 # v7.0.1 » : 40 caractères hexadécimaux, puis « # vX.Y.Z ».
        assert.match(ligne, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/, `${nom} : ${ligne.trim()}`);
      }
    }
  });

  test('chaque workflow ne peut que lire le dépôt par défaut', () => {
    for (const { nom, texte } of workflows) {
      assert.match(texte, /^permissions:\n\s+contents: read$/m, nom);
    }
  });
});

describe('déploiement GitHub Pages', () => {
  test('publication seulement après les tests ; droits d’écriture dans le seul job « deploy »', () => {
    assert.ok(deploiement, 'deploiement.yml absent');
    assert.match(deploiement, /build:[\s\S]*?needs: test\n/);
    assert.match(deploiement, /deploy:[\s\S]*needs: \[test, build\]/);
    // Les droits d'écriture n'apparaissent qu'une fois (dans le job deploy).
    assert.equal(deploiement.match(/pages: write/g)?.length, 1);
    assert.equal(deploiement.match(/id-token: write/g)?.length, 1);
    assert.match(deploiement, /deploy:[\s\S]*pages: write[\s\S]*id-token: write[\s\S]*environment:\n\s+name: github-pages/);
  });

  test('chaque fichier chargé par la page est dans la liste blanche (sinon le site en ligne serait cassé)', () => {
    const liste = listeBlanche(deploiement);
    const charges = fichiersCharges();
    // Le test ne prouve rien s'il ne trouve pas les fichiers clés.
    for (const attendu of ['css/style.css', 'js/app.js', 'js/lecture-pdf.js', 'data/referentiel.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs']) {
      assert.ok(charges.includes(attendu), `${attendu} n’a pas été trouvé parmi les fichiers chargés`);
    }
    for (const chemin of charges) {
      assert.ok(existsSync(new URL(chemin, racine)), `${chemin} est chargé par la page, mais n’existe pas`);
      assert.ok(estPublie(chemin, liste), `${chemin} est chargé par la page, mais pas publié par deploiement.yml`);
    }
  });

  test('rien de privé ni d’inutile n’est publié', () => {
    const { fichiers, dossiers } = listeBlanche(deploiement);
    for (const chemin of [...fichiers, ...dossiers]) {
      assert.doesNotMatch(chemin, /^(?:prive|tests|docs|scripts|node_modules|\.github)\b|\.pdf$|referentiel\.json$/i, chemin);
      assert.ok(existsSync(new URL(chemin, racine)), `${chemin} est dans la liste blanche, mais n’existe pas`);
    }
    // La licence de pdf.js est publiée avec lui : elle est obligatoire (Apache 2.0).
    assert.ok(fichiers.has('vendor/pdfjs/LICENSE'));
  });

  test('404.html : même CSP que index.html, chemins absolus, retour à l’accueil, pas indexée', () => {
    const csp = (html) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    const page404 = lire('404.html');
    assert.equal(csp(page404), csp(lire('index.html')));
    assert.match(page404, /<link rel="stylesheet" href="\/css\/style\.css">/);
    assert.match(page404, /<a class="btn btn--primary" href="\/">/);
    assert.match(page404, /<meta name="robots" content="noindex">/);
  });
});

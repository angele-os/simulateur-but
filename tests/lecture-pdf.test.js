// Tests de la partie pure de js/lecture-pdf.js : le calcul des positions.
//
// La fixture releve-tourne.json contient ce que pdf.js renvoie (viewport et
// éléments texte bruts) pour un petit PDF INVENTÉ, sans rotation puis tourné
// de 90° comme le vrai relevé « Détail des notes ».
//
// Remarque : importer lecture-pdf.js charge pdf.js. Dans Node, pdf.js affiche
// « Please use the legacy build in Node.js environments » : c'est sans
// conséquence ici, on n'utilise que son calcul de matrices.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { positionAffichee, creerPolitiqueWorker, URL_WORKER, NOM_POLITIQUE } from '../js/lecture-pdf.js';
import { importerNotes } from '../js/import-notes.js';

const fixture = JSON.parse(readFileSync(new URL('fixtures/releve-tourne.json', import.meta.url), 'utf8'));
const [page0, page90] = fixture.pages;

// Ce que lecture-pdf.js fait de chaque élément brut de pdf.js, avec un
// calcul de position donné.
function versElements(page, calculer) {
  return page.items.map((item) => ({
    texte: item.str,
    ...calculer(item, page.viewport),
    largeur: item.width,
    page: 1,
  }));
}

// Le calcul corrigé : la position dans la page AFFICHÉE.
const calculAffiche = (item, viewport) => positionAffichee(item.transform, viewport);

// L'ancien calcul : la position brute, dans le fichier (AVANT rotation).
const calculBrut = (item) => ({
  x: item.transform[4],
  y: item.transform[5],
  taille: Math.hypot(item.transform[2], item.transform[3]),
});

// Arrondit au millième (les calculs de matrices donnent parfois 500.00000000000006).
const arrondir = (element) => ({
  ...element,
  x: Math.round(element.x * 1000) / 1000,
  y: Math.round(element.y * 1000) / 1000,
  taille: Math.round(element.taille * 1000) / 1000,
});

describe('positionAffichee', () => {
  test('la fixture contient une page à 0° et une page à 90°', () => {
    assert.deepEqual(
      fixture.pages.map((page) => [page.rotation, page.viewport.width, page.viewport.height]),
      [
        [0, 595, 842], // portrait
        [90, 842, 595], // tournée : affichée en paysage
      ],
    );
  });

  test('page à 0° : la position affichée est celle donnée par pdf.js', () => {
    const code = page0.items.find((item) => item.str === 'Code');
    assert.deepEqual(code.transform, [9, 0, 0, 9, 40, 500]);
    assert.deepEqual(positionAffichee(code.transform, page0.viewport), { x: 40, y: 500, taille: 9 });
  });

  test('page à 90° : x et y sont remis à leur place', () => {
    // Dans le fichier, pdf.js place « Code » en (95, 40) : x et y sont échangés.
    const code = page90.items.find((item) => item.str === 'Code');
    assert.deepEqual([code.transform[4], code.transform[5]], [95, 40]);
    // Sur la page affichée, il est en (40, 500), comme sur la page à 0°.
    assert.deepEqual(positionAffichee(code.transform, page90.viewport), { x: 40, y: 500, taille: 9 });
  });

  test('les deux pages donnent exactement les mêmes éléments affichés', () => {
    assert.deepEqual(
      versElements(page90, calculAffiche).map(arrondir),
      versElements(page0, calculAffiche).map(arrondir),
    );
  });

  test('lettre du filigrane penchée à 45° : sa taille reste 58 pt, quelle que soit la rotation', () => {
    for (const page of [page0, page90]) {
      const lettre = page.items.find((item) => item.str === 'N');
      assert.equal(Math.round(positionAffichee(lettre.transform, page.viewport).taille * 1000) / 1000, 58);
    }
  });
});

describe('relevé tourné de 90°, lu jusqu’au bout par importerNotes', () => {
  test('avec la position brute (ancien calcul), aucune ligne de titres n’est trouvée', () => {
    const resultat = importerNotes(versElements(page90, calculBrut));
    assert.deepEqual(resultat.semestres, []);
    assert.match(resultat.rapport.erreurs[0].message, /Aucune ligne de titres/);
  });

  test('avec la position affichée, le relevé est lu normalement', () => {
    const resultat = importerNotes(versElements(page90, calculAffiche));
    assert.deepEqual(resultat.rapport.erreurs, []);
    assert.deepEqual(resultat.semestres[0].elements[0].evaluations, [
      { libelle: 'Contrôle inventé - coef 1', note: 12.5, coef: 1, ue: null },
    ]);
  });
});

describe('politique Trusted Types du worker de pdf.js', () => {
  // Imitation de window.trustedTypes : elle note le nom demandé et renvoie
  // les règles telles quelles (le vrai navigateur les enveloppe).
  function fauxTrustedTypes() {
    const noms = [];
    return {
      noms,
      createPolicy(nom, regles) {
        noms.push(nom);
        return regles;
      },
    };
  }

  test('l’adresse du worker est celle de vendor/pdfjs/', () => {
    assert.ok(URL_WORKER.endsWith('/vendor/pdfjs/pdf.worker.min.mjs'), URL_WORKER);
  });

  test('la politique s’appelle « pdfjs-worker », le nom autorisé par la CSP', () => {
    const trustedTypes = fauxTrustedTypes();
    creerPolitiqueWorker(trustedTypes, URL_WORKER);
    assert.deepEqual(trustedTypes.noms, ['pdfjs-worker']);
    assert.equal(NOM_POLITIQUE, 'pdfjs-worker');
  });

  test('elle n’accepte QUE l’adresse exacte du worker', () => {
    const politique = creerPolitiqueWorker(fauxTrustedTypes(), URL_WORKER);
    assert.equal(politique.createScriptURL(URL_WORKER), URL_WORKER);
    for (const autre of [
      'https://exemple.invalid/pdf.worker.min.mjs', // un autre site
      URL_WORKER.replace('pdf.worker.min.mjs', 'pdf.min.mjs'), // un autre fichier de l'app
      `${URL_WORKER}?x=1`, // la même adresse, modifiée
      'data:text/javascript,alert(1)',
    ]) {
      assert.throws(() => politique.createScriptURL(autre), TypeError, autre);
    }
  });

  test('sans Trusted Types (ancien navigateur) : l’adresse est rendue telle quelle, avec la même vérification', () => {
    const politique = creerPolitiqueWorker(undefined, URL_WORKER);
    assert.equal(politique.createScriptURL(URL_WORKER), URL_WORKER);
    assert.throws(() => politique.createScriptURL('https://exemple.invalid/w.mjs'), TypeError);
  });
});

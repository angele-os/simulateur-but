// Vérifie que les fichiers copiés dans vendor/pdfjs/ ont la même version que
// pdfjs-dist installé dans node_modules. Si ce test échoue après une mise à
// jour de pdfjs-dist, il suffit de lancer « npm run vendor ».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const racine = new URL('../', import.meta.url);

// Version installée : celle écrite dans le package.json de pdfjs-dist.
const versionInstallee = JSON.parse(
  readFileSync(new URL('node_modules/pdfjs-dist/package.json', racine), 'utf8'),
).version;

// Version copiée : pdf.js l'écrit dans l'en-tête de chaque fichier,
// sous la forme « pdfjsVersion = 6.4.299 ».
function versionCopiee(cheminFichier) {
  const contenu = readFileSync(cheminFichier, 'utf8');
  const resultat = /pdfjsVersion = (\S+)/.exec(contenu);
  assert.ok(resultat, `Version introuvable dans ${cheminFichier.pathname}`);
  return resultat[1];
}

for (const nom of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  test(`vendor/pdfjs/${nom} a la même version que node_modules/pdfjs-dist`, () => {
    const chemin = new URL(`vendor/pdfjs/${nom}`, racine);

    // 1. Le fichier doit exister.
    assert.ok(existsSync(chemin), `vendor/pdfjs/${nom} est absent : lance « npm run vendor ».`);

    // 2. Sa version doit être celle installée.
    assert.equal(
      versionCopiee(chemin),
      versionInstallee,
      `vendor/pdfjs/${nom} n’est pas à jour : lance « npm run vendor ».`,
    );
  });
}

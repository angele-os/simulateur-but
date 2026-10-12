// Copie les fichiers de pdf.js utiles au navigateur, de node_modules vers
// vendor/pdfjs/, pour que l'app les serve elle-même (jamais depuis un CDN).
//
// Lancement : npm run vendor
// À refaire après chaque mise à jour de pdfjs-dist (un test le vérifie).

import { copyFileSync, mkdirSync } from 'node:fs';

// Les chemins sont calculés à partir de l'emplacement de ce script :
// le résultat est le même quel que soit le dossier d'où on le lance.
const source = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const destination = new URL('../vendor/pdfjs/', import.meta.url);

const fichiers = [
  'build/pdf.min.mjs', // la bibliothèque, chargée par la page
  'build/pdf.worker.min.mjs', // le worker, qui analyse le PDF en arrière-plan
  'LICENSE', // licence Apache 2.0 : obligatoire quand on redistribue pdf.js
];

// 1. On crée vendor/pdfjs/ s'il n'existe pas encore.
mkdirSync(destination, { recursive: true });

// 2. On copie chaque fichier, en gardant seulement son nom (sans « build/»).
for (const chemin of fichiers) {
  const nom = chemin.split('/').pop();
  copyFileSync(new URL(chemin, source), new URL(nom, destination));
  console.log(`copié : node_modules/pdfjs-dist/${chemin} → vendor/pdfjs/${nom}`);
}

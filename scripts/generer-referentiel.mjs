// Génère le référentiel des coefficients à partir des tableaux officiels de
// l'IUT (PDF publics), rangés dans prive/ (dossier ignoré par Git : les PDF
// ne vont jamais dans le dépôt, seulement leurs coefficients).
//
// Lancement : npm run referentiel
//             (ou : node scripts/generer-referentiel.mjs [dossier des PDF])
//
// Il écrit deux fichiers au contenu identique :
//   - data/referentiel.json : facile à lire et à comparer aux PDF ;
//   - data/referentiel.js   : le même objet en module ES, chargé par la page.
//     (La CSP « connect-src 'none' » interdit à la page de lire un .json :
//     un module .js, lui, se charge comme les autres scripts du site.)
//
// Il s'arrête avec une erreur si un tableau ne se lit pas parfaitement :
// total qui ne tombe pas juste, code en double, semestre inattendu…

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Le « build legacy » de pdf.js est la version prévue pour Node.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { elementsDeLaPage } from '../js/lecture-pdf.js';
import { importerCoefficients, RAISON_AVANT_EN_TETE } from '../js/import-coefficients.js';

// Les tableaux à lire : année, parcours, et nom du fichier dans prive/.
const SOURCES = [
  { annee: 1, parcours: 'commun', fichier: 'Tableau coefficients.pdf' },
  { annee: 2, parcours: 'RA', fichier: 'BUT2_Coefficients_ParcoursRA.pdf' },
  { annee: 2, parcours: 'DACS', fichier: 'BUT2_Coefficients_ParcoursDACS.pdf' },
  { annee: 3, parcours: 'RA', fichier: 'BUT3_Coefficients_ParcoursRA.pdf' },
  { annee: 3, parcours: 'DACS', fichier: 'BUT3_Coefficients_ParcoursDACS.pdf' },
];

// Les chemins sont calculés à partir de l'emplacement de ce script : le
// résultat est le même quel que soit le dossier d'où on le lance.
const racine = new URL('../', import.meta.url);
// Dossier des PDF : celui donné au lancement, sinon prive/ (le « / » final
// indique un dossier).
const dossierPdf = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL('prive/', racine);
const dossierData = new URL('data/', racine);

/**
 * Lit un PDF comme l'app : mêmes éléments texte, mêmes positions
 * (elementsDeLaPage, de js/lecture-pdf.js).
 *
 * @returns {Promise<{ elements: object[], date: string|null }>}
 */
async function lirePdf(chemin) {
  const tache = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(chemin)),
    isEvalSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const documentPdf = await tache.promise;
    const elements = [];
    for (let numero = 1; numero <= documentPdf.numPages; numero++) {
      const page = await documentPdf.getPage(numero);
      const contenu = await page.getTextContent();
      elements.push(...elementsDeLaPage(contenu.items, page.getViewport({ scale: 1 }), numero));
    }
    // Date de création du document, écrite par le logiciel qui l'a produit :
    // « D:20220901181502+02'00' » → « 2022-09-01 ».
    const { info } = await documentPdf.getMetadata();
    const trouve = /^D:(\d{4})(\d{2})(\d{2})/.exec(info?.CreationDate ?? '');
    return { elements, date: trouve ? `${trouve[1]}-${trouve[2]}-${trouve[3]}` : null };
  } finally {
    await tache.destroy();
  }
}

/**
 * Lit un tableau et le transforme en entrée du référentiel.
 * Lève une erreur au moindre doute : on ne publie pas un référentiel faux.
 */
async function lireTableau({ annee, parcours, fichier }) {
  const { elements, date } = await lirePdf(new URL(fichier, dossierPdf));
  const resultat = importerCoefficients(elements);

  // 1. Toute erreur de l'analyseur (total faux, code en double…) arrête tout.
  if (resultat.rapport.erreurs.length > 0) {
    const messages = resultat.rapport.erreurs.map((erreur) => `  - ${erreur.message}`).join('\n');
    throw new Error(`${fichier} : le tableau ne se lit pas parfaitement.\n${messages}`);
  }

  // 2. Une année contient deux semestres : 1 et 2, 3 et 4, ou 5 et 6.
  const attendus = [annee * 2 - 1, annee * 2];
  const lus = resultat.semestres.map((semestre) => semestre.numero);
  if (lus.join(',') !== attendus.join(',')) {
    throw new Error(`${fichier} : semestres ${lus.join(', ') || 'aucun'} trouvés, ${attendus.join(' et ')} attendus.`);
  }

  // 3. Le référentiel garde, pour chaque semestre : ses UE (avec leurs totaux
  //    imprimés, pour le contrôle) et chaque ligne avec ses coefficients.
  const semestres = resultat.semestres.map((semestre) => ({
    numero: semestre.numero,
    ues: semestre.ues.map((ue) => ({
      code: ue.code,
      // Les tableaux ne donnent que le code des UE, pas leur intitulé.
      intitule: null,
      totalSae: semestre.totaux.sae[ue.code] ?? 0,
      totalRessources: semestre.totaux.ressources[ue.code] ?? 0,
    })),
    lignes: semestre.lignes.map((ligne) => ({
      type: ligne.type,
      code: ligne.code,
      alias: ligne.alias,
      intitule: ligne.libelle,
      coefs: ligne.coefs,
    })),
  }));

  return { document: { fichier, date }, semestres, rapport: resultat.rapport };
}

/**
 * Résumé à comparer aux PDF : nombre d'UE et de lignes par semestre, et les
 * lignes qui méritent un coup d'œil.
 */
function resumer({ annee, parcours }, { document, semestres, rapport }) {
  const nomAnnee = annee === 1 ? '1re' : `${annee}e`;
  const lignesResume = [`\n${nomAnnee} année, ${parcours} (${document.fichier}, ${document.date ?? 'date inconnue'})`];
  for (const semestre of semestres) {
    const ressources = semestre.lignes.filter((ligne) => ligne.type === 'ressource');
    const sae = semestre.lignes.filter((ligne) => ligne.type === 'sae');
    lignesResume.push(
      `  S${semestre.numero} : ${semestre.ues.length} UE (${semestre.ues.map((ue) => ue.code).join(' ')}), ` +
        `${ressources.length} ressources, ${sae.length} lignes du pôle SAE`,
    );
    // Lignes à regarder : sans intitulé, ou sans aucun coefficient ce semestre.
    for (const ligne of semestre.lignes) {
      if (!ligne.intitule) {
        lignesResume.push(`    ? ${ligne.code} : aucun intitulé dans le tableau`);
      }
      if (Object.keys(ligne.coefs).length === 0) {
        lignesResume.push(`    ? ${ligne.code} ${ligne.intitule} : aucun coefficient ce semestre`);
      }
    }
  }
  // Lignes écartées DANS le tableau (titres, ECTS…) : une d'elles pourrait
  // être la suite d'un intitulé écrit sur deux lignes.
  for (const { page, texte, raison } of rapport.ignore) {
    if (raison !== RAISON_AVANT_EN_TETE) {
      lignesResume.push(`    écartée (page ${page}) : « ${texte} » (${raison})`);
    }
  }
  return lignesResume.join('\n');
}

// ---------- Programme principal ----------

const referentiel = {
  source:
    'Tableaux des coefficients du BUT Informatique de l’IUT de Metz (documents publics) : ' +
    'BUT1 tronc commun, BUT2 et BUT3 parcours RA et DACS. La date de chaque document est sa date de création.',
  genereLe: new Date().toISOString().slice(0, 10),
  generePar: 'scripts/generer-referentiel.mjs',
  remarque: 'Les tableaux ne donnent pas l’intitulé des UE : il vaut null.',
  annees: {},
};

const resumes = [];
try {
  for (const source of SOURCES) {
    const tableau = await lireTableau(source);
    referentiel.annees[source.annee] ??= {};
    referentiel.annees[source.annee][source.parcours] = { document: tableau.document, semestres: tableau.semestres };
    resumes.push(resumer(source, tableau));
  }
} catch (erreur) {
  // On n'écrit RIEN : l'ancien référentiel reste en place.
  console.error(`\nÉchec, aucun fichier écrit.\n${erreur.message}`);
  process.exit(1);
}

mkdirSync(dossierData, { recursive: true });
const json = `${JSON.stringify(referentiel, null, 2)}\n`;
writeFileSync(new URL('referentiel.json', dossierData), json);
writeFileSync(
  new URL('referentiel.js', dossierData),
  '// Fichier GÉNÉRÉ par scripts/generer-referentiel.mjs (npm run referentiel) :\n' +
    '// ne pas le modifier à la main. Même contenu que data/referentiel.json, en\n' +
    '// module ES : la page le charge comme ses autres scripts.\n' +
    `export default ${json.trimEnd()};\n`,
);

console.log(resumes.join('\n'));
console.log(`\nÉcrits : ${fileURLToPath(new URL('referentiel.json', dossierData))} et referentiel.js`);

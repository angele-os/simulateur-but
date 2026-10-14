// Vérifie l'app sur TES vrais relevés « Détail des notes », rangés dans
// prive/ (ignoré par Git). À lancer seulement en local : npm run verifier
//
// Pour chaque relevé, il fait exactement ce que fait l'app :
//   1. lecture du PDF (elementsDeLaPage, comme js/lecture-pdf.js) ;
//   2. choix de l'année et du parcours dans le référentiel (js/choix-annee.js) ;
//   3. import du relevé (importerNotes, puis preparerImportReleve) ;
//   4. calcul de toutes les moyennes (js/modele.js, qui appelle js/calcul.js) ;
// puis il affiche, pour chaque pôle, chaque UE et chaque compétence, la
// moyenne calculée, la moyenne officielle du relevé et l'écart.
//
// Option : npm run verifier -- --coef-inconnu=1
//   simule ta saisie : chaque évaluation NOTÉE dont le coefficient est
//   inconnu (« Coef ?? ») reçoit ce coefficient. Sans l'option, elles ne
//   comptent pas, comme dans l'app tant que tu ne les as pas complétées.
//
// Données personnelles : il n'écrit AUCUN fichier, et n'affiche que des
// codes (UE, ressources) et des nombres. L'en-tête du relevé (nom, dossier,
// NNE, e-mail) n'est jamais lu par importerNotes.

import { readFileSync, readdirSync } from 'node:fs';
// Le « build legacy » de pdf.js est la version prévue pour Node.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import referentiel from '../data/referentiel.js';
import { elementsDeLaPage } from '../js/lecture-pdf.js';
import { importerNotes } from '../js/import-notes.js';
import { preparerImportReleve, cleCode } from '../js/remplissage.js';
import { parcoursDe, creerSemestresAnnee, semestresDe, nomAnnee } from '../js/choix-annee.js';
import { creerSemestre, analyserSemestre, competencesAnnee, comparerOfficiel, ECART_SIGNALE } from '../js/modele.js';

const dossier = new URL('../prive/', import.meta.url);

// Coefficient donné aux évaluations notées au coef inconnu (option), ou null.
const optionCoef = process.argv.find((argument) => argument.startsWith('--coef-inconnu='));
const coefSimule = optionCoef ? optionCoef.split('=')[1] : null;

// Identifiants uniques, comme dans app.js.
let compteur = 0;
const nouvelId = () => `id${++compteur}`;

/** Lit un PDF comme l'app, et renvoie ses éléments texte. */
async function lirePdf(url) {
  const tache = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(url)),
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
    return elements;
  } finally {
    await tache.destroy();
  }
}

/**
 * Le parcours du relevé : celui du référentiel dont les codes correspondent
 * au plus grand nombre de lignes du relevé (R4.B.10 → DACS, R4.A.10 → RA).
 */
function devinerParcours(annee, releve) {
  const codesReleve = new Set(
    releve.semestres.flatMap((s) => s.elements.map((e) => e.code).filter(Boolean)).map(cleCode),
  );
  const scores = parcoursDe(referentiel, annee).map((parcours) => {
    const codes = referentiel.annees[annee][parcours].semestres.flatMap((s) =>
      s.lignes.flatMap((ligne) => [ligne.code, ...ligne.alias]),
    );
    return { parcours, score: new Set(codes.map(cleCode).filter((cle) => codesReleve.has(cle))).size };
  });
  scores.sort((a, b) => b.score - a.score);
  return { parcours: scores[0].parcours, scores };
}

// ---------- Mise en forme ----------

// 12.3456 → « 12,346 » ; null → « — ».
const nombre = (valeur) => (valeur === null || valeur === undefined ? '—' : valeur.toFixed(3).replace('.', ','));

/**
 * Une ligne du tableau : libellé, calculé, officiel, écart (signalé par
 * « ⚠ » au-delà de 0,01). L'écart affiché est calculé − officiel : « + »
 * veut dire que l'app trouve PLUS que le relevé.
 */
function ligneTableau(libelle, calcule, officiel) {
  const { ecart, signale } = comparerOfficiel(calcule, officiel);
  const signe = calcule !== null && officiel !== null && calcule < officiel ? '−' : '+';
  const texteEcart = ecart === null ? '' : ecart === 0 ? nombre(0) : `${signe}${nombre(ecart)}`;
  return `  ${libelle.padEnd(26)} ${nombre(calcule).padStart(8)} ${nombre(officiel).padStart(9)} ${texteEcart.padStart(8)}${signale ? '  ⚠' : ''}`;
}

const ENTETE = `  ${'Moyenne'.padEnd(26)} ${'calculé'.padStart(8)} ${'officiel'.padStart(9)} ${'écart'.padStart(8)}`;

// ---------- Programme principal ----------

// Les relevés : les PDF de prive/ dont le nom parle de « notes ».
const fichiers = readdirSync(dossier).filter((nom) => /notes/i.test(nom) && /\.pdf$/i.test(nom)).sort();
if (fichiers.length === 0) {
  console.log('Aucun relevé « Détail des notes » dans prive/.');
}

let ecartsSignales = 0;
for (const [index, fichier] of fichiers.entries()) {
  // 1. Lecture et analyse du relevé.
  const releve = importerNotes(await lirePdf(new URL(fichier, dossier)));
  console.log(`\n=================== Relevé ${index + 1} : ${fichier} ===================`);
  if (releve.semestres.length === 0) {
    console.log('  Non lu :', releve.rapport.erreurs.map((e) => e.message).join(' '));
    continue;
  }

  // 2. Année (d'après le premier semestre) et parcours (d'après les codes).
  const annee = Math.ceil(releve.semestres[0].numero / 2);
  const { parcours, scores } = devinerParcours(annee, releve);
  console.log(
    `${nomAnnee(annee)} année, parcours ${parcours} ` +
      `(codes reconnus : ${scores.map((s) => `${s.parcours} ${s.score}`).join(', ')})`,
  );

  // 3. Les semestres de l'année, comme le bouton « Créer mes semestres »,
  //    puis l'import du relevé, comme le bouton « Importer mon relevé ».
  const saisie = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, creerSemestre()]));
  Object.assign(saisie, creerSemestresAnnee(referentiel, annee, parcours, nouvelId));
  const proposition = preparerImportReleve(saisie, releve, nouvelId);
  Object.assign(saisie, proposition.semestres);
  const { officiels, rapport } = proposition;

  // Option : on complète les coefficients inconnus des évaluations notées,
  // comme tu le ferais dans l'app.
  if (coefSimule !== null) {
    let completes = 0;
    for (const numero of semestresDe(annee)) {
      for (const element of saisie[numero].elements) {
        for (const evaluation of element.evaluations) {
          if (evaluation.coef === '' && evaluation.note !== '') {
            evaluation.coef = coefSimule;
            completes++;
          }
        }
      }
    }
    console.log(`  SIMULATION : ${completes} coefficient(s) inconnu(s) remplacé(s) par ${coefSimule}.`);
  }

  // Ce que l'import signale (messages de l'analyseur : codes et libellés
  // d'évaluations seulement, jamais l'en-tête).
  for (const message of [...rapport.aVerifier, ...rapport.aCompleter.map((a) => a.texte)]) {
    console.log(`  rapport : ${message}`);
  }

  // 4. Les moyennes, semestre par semestre.
  for (const numero of semestresDe(annee)) {
    const analyse = analyserSemestre(saisie[numero], numero, '');
    console.log(`\n S${numero} (malus ${nombre(analyse.malus)})\n${ENTETE}`);
    for (const ue of analyse.ues) {
      const officiel = officiels.ues[numero]?.[ue.code] ?? {};
      for (const [nom, calcule, offi] of [
        [`${ue.code} pôle SAE`, ue.poleSae, officiel.poleSae],
        [`${ue.code} pôle ressources`, ue.poleRessources, officiel.poleRessources],
        [`${ue.code} UE`, ue.moyenne, officiel.moyenne],
      ]) {
        console.log(ligneTableau(nom, calcule, offi));
        ecartsSignales += comparerOfficiel(calcule, offi).signale ? 1 : 0;
      }
    }

    // Diagnostic : chaque ressource ou partie SAE dont le relevé donne une
    // moyenne officielle. Seules les lignes en écart sont affichées.
    const releveSemestre = releve.semestres.find((s) => s.numero === numero);
    const officielsLignes = new Map(
      (releveSemestre?.elements ?? [])
        .filter((e) => e.code && e.officiel.moyenne !== null)
        .map((e) => [cleCode(e.code), e.officiel.moyenne]),
    );
    for (const ligne of analyse.elements) {
      const offi = officielsLignes.get(cleCode(ligne.code));
      if (offi !== undefined && comparerOfficiel(ligne.moyenne, offi).signale) {
        console.log(ligneTableau(`  ↳ ligne ${ligne.code}`, ligne.moyenne, offi));
      }
    }
  }

  // 5. Les compétences de l'année.
  const { semestres: [impair], competences } = competencesAnnee(saisie, semestresDe(annee)[0]);
  console.log(`\n Compétences (S${impair} + S${impair + 1})\n${ENTETE}`);
  for (const competence of competences) {
    const offi = officiels.competences[impair]?.[competence.numero] ?? null;
    console.log(ligneTableau(`C${competence.numero}`, competence.moyenne, offi));
    ecartsSignales += comparerOfficiel(competence.moyenne, offi).signale ? 1 : 0;
  }
}

console.log(`\n${ecartsSignales} écart(s) de plus de ${String(ECART_SIGNALE).replace('.', ',')} (pôles, UE et compétences).`);

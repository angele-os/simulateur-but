// Choix de l'année et du parcours : crée les semestres de l'année à partir
// du référentiel des coefficients (data/referentiel.js).
//
// Fonctions pures : elles reçoivent le référentiel et ne touchent pas à la
// page. app.js leur passe le vrai référentiel ; les tests, le même ou un
// référentiel inventé.
//
// Choisir une année revient à importer le tableau officiel, déjà lu à
// l'avance : on donne le référentiel à preparerImportCoefficients, sous la
// forme que renvoie importerCoefficients. Les semestres obtenus sont donc
// exactement ceux qu'aurait donnés l'import du PDF.

import { creerSemestre } from './modele.js';
import { preparerImportCoefficients } from './remplissage.js';

/**
 * Les parcours proposés pour une année : ['commun'] en 1re année,
 * ['DACS', 'RA'] ensuite (dans l'ordre alphabétique).
 *
 * @param {object} referentiel
 * @param {number} annee 1, 2 ou 3
 * @returns {string[]}
 */
export function parcoursDe(referentiel, annee) {
  return Object.keys(referentiel.annees[annee] ?? {}).sort();
}

/**
 * Nom d'une année, à la française : 1 → « 1re », 2 → « 2e », 3 → « 3e ».
 *
 * @param {number} annee
 * @returns {string}
 */
export function nomAnnee(annee) {
  return annee === 1 ? '1re' : `${annee}e`;
}

/**
 * Les deux semestres d'une année : 1 → [1, 2], 2 → [3, 4], 3 → [5, 6].
 *
 * @param {number} annee
 * @returns {[number, number]}
 */
export function semestresDe(annee) {
  return [annee * 2 - 1, annee * 2];
}

/**
 * Crée les semestres d'une année : leurs UE, leurs ressources et SAE avec
 * leurs coefficients, sans aucune note ni malus.
 *
 * @param {object} referentiel
 * @param {number} annee 1, 2 ou 3
 * @param {string} parcours 'commun' en 1re année, 'DACS' ou 'RA' ensuite
 * @param {() => string} nouvelId fabrique un identifiant unique
 * @returns {Object<number, object>} n° de semestre → semestre neuf
 * @throws {Error} si cette année ou ce parcours n'est pas dans le référentiel
 */
export function creerSemestresAnnee(referentiel, annee, parcours, nouvelId) {
  // 1. Le tableau de cette année et de ce parcours.
  const tableau = referentiel.annees[annee]?.[parcours];
  if (!tableau) {
    throw new Error(`Aucun tableau des coefficients pour la ${nomAnnee(annee)} année, parcours ${parcours}.`);
  }

  // 2. On le met sous la forme que renvoie importerCoefficients : des UE
  //    (seul leur code sert) et des lignes avec leur « libellé ».
  const resultat = {
    semestres: tableau.semestres.map((semestre) => ({
      numero: semestre.numero,
      ues: semestre.ues.map((ue) => ({ code: ue.code })),
      lignes: semestre.lignes.map((ligne) => ({
        type: ligne.type,
        code: ligne.code,
        alias: ligne.alias,
        libelle: ligne.intitule,
        coefs: ligne.coefs,
      })),
    })),
    rapport: { erreurs: [], ignore: [] },
  };

  // 3. On le « remplit » dans des semestres VIDES : le résultat ne dépend
  //    pas de ce qui était saisi avant (app.js a déjà demandé confirmation).
  const vides = Object.fromEntries(semestresDe(annee).map((numero) => [numero, creerSemestre()]));
  return preparerImportCoefficients(vides, resultat, nouvelId).semestres;
}

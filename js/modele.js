// Modèle de la saisie : le lien entre ce que l'utilisateur tape et calcul.js.
//
// Fonctions pures : elles ne touchent pas à la page. app.js s'occupe de
// l'affichage et appelle ces fonctions ; les tests les vérifient sans navigateur.

import {
  moyenneEvaluations,
  moyenneUe,
  moyenneCompetence,
  noteAViser,
  arrondiMillieme,
} from './calcul.js';

/*
 * État de la saisie d'un semestre
 * -------------------------------
 * Les champs numériques sont gardés tels que l'utilisateur les a TAPÉS
 * (textes) : une saisie invalide n'est pas effacée, elle est signalée.
 *
 * semestre = {
 *   malus: '0,05',
 *   ues: [{ id, numero: 1, intitule: 'Réaliser' }],
 *   elements: [{
 *     id, type: 'ressource' | 'sae', code: 'R3.01', intitule: 'Développement',
 *     coefs: { [id de l'UE]: '12' },   // coefficient du tableau dans chaque UE
 *     evaluations: [{ id, libelle: 'Contrôle 1', note: '14,5', coef: '2' }],
 *   }],
 * }
 *
 * Une ressource (ou une partie du pôle SAE) n'est saisie qu'UNE fois, même
 * si elle compte dans plusieurs UE, comme dans le tableau des coefficients.
 */

// Nombre maximal d'UE par semestre (numéros 1 à 6).
export const NUMEROS_UE = [1, 2, 3, 4, 5, 6];

// Cible par défaut de la « note à viser ».
export const CIBLE_PAR_DEFAUT = 10;

/* ==================== Création ==================== */

export function creerSemestre() {
  return { malus: '', ues: [], elements: [] };
}

export function creerUe(id, numero) {
  return { id, numero, intitule: '' };
}

export function creerElement(id, type) {
  return { id, type, code: '', intitule: '', coefs: {}, evaluations: [] };
}

export function creerEvaluation(id) {
  return { id, libelle: '', note: '', coef: '' };
}

/**
 * Numéros des UE proposés pour un semestre vide : 1 à 6 en BUT1 et BUT2,
 * 1, 3 et 6 en BUT3 (parcours DACS, voir FORMAT-PDF.md).
 */
export function numerosUeParDefaut(numeroSemestre) {
  return numeroSemestre >= 5 ? [1, 3, 6] : [...NUMEROS_UE];
}

// Code d'une UE : semestre 3, numéro 1 → « UE3.1 ».
export function codeUe(numeroSemestre, numeroUe) {
  return `UE${numeroSemestre}.${numeroUe}`;
}

/* ==================== Lecture des nombres saisis ==================== */

// Un nombre positif, avec une virgule ou un point : « 12 », « 12,5 », « 12.5 ».
const MOTIF_NOMBRE = /^\d+(?:[.,]\d+)?$/;

/**
 * Lit un nombre tapé par l'utilisateur.
 *
 * @param {string} texte
 * @param {{ vide: number|null, min: number, max: number, minExclu?: boolean, message: string }} regles
 *   vide : valeur quand la case est vide ; message : erreur si hors limites
 * @returns {{ valeur: number|null, erreur: string|null }}
 *   En cas d'erreur, valeur = la valeur « vide » : une saisie invalide ne compte pas.
 */
function lireNombre(texte, { vide, min, max, minExclu = false, message }) {
  // 1. On enlève les espaces autour.
  const propre = String(texte ?? '').trim();

  // 2. Case vide : ce n'est pas une erreur.
  if (propre === '') {
    return { valeur: vide, erreur: null };
  }

  // 3. Il faut des chiffres, avec au plus une virgule (ou un point).
  if (!MOTIF_NOMBRE.test(propre)) {
    return { valeur: vide, erreur: 'Écris un nombre, par exemple 12,5.' };
  }

  // 4. On remplace la virgule par un point pour que JavaScript le comprenne.
  const valeur = Number(propre.replace(',', '.'));

  // 5. On vérifie les limites.
  const tropPetit = minExclu ? valeur <= min : valeur < min;
  if (tropPetit || valeur > max) {
    return { valeur: vide, erreur: message };
  }
  return { valeur, erreur: null };
}

// Note d'une évaluation : vide = pas encore notée.
export function lireNote(texte) {
  return lireNombre(texte, { vide: null, min: 0, max: 20, message: 'La note doit être entre 0 et 20.' });
}

// Coefficient d'une évaluation : vide = inconnu (« Coef ?? »).
export function lireCoefEvaluation(texte) {
  return lireNombre(texte, {
    vide: null,
    min: 0,
    max: 100,
    minExclu: true,
    message: 'Le coefficient doit être supérieur à 0 (et au plus 100).',
  });
}

// Coefficient d'une ressource ou d'une SAE dans une UE : vide = ne compte pas dans cette UE.
export function lireCoefUe(texte) {
  return lireNombre(texte, { vide: 0, min: 0, max: 100, message: 'Le coefficient doit être entre 0 et 100.' });
}

// Malus d'absences du semestre : vide = pas de malus.
export function lireMalus(texte) {
  return lireNombre(texte, { vide: 0, min: 0, max: 20, message: 'Le malus doit être entre 0 et 20.' });
}

// Cible de la note à viser : vide = 10.
export function lireCible(texte) {
  return lireNombre(texte, {
    vide: CIBLE_PAR_DEFAUT,
    min: 0,
    max: 20,
    message: 'La cible doit être entre 0 et 20.',
  });
}

/* ==================== Construction des UE pour calcul.js ==================== */

/**
 * Construit une UE au format de calcul.js à partir de la saisie.
 * Le poids de chaque pôle est la somme des coefficients de ses lignes dans
 * cette UE (exactement comme les lignes de total du tableau).
 *
 * @returns {object} ue = { code, poleSae: { poids, parties }, poleRessources: { poids, ressources } }
 */
export function modeleUe(semestre, ue, numeroSemestre) {
  // 1. Une évaluation au format de calcul.js (notes et coefs lus en nombres).
  //    On garde son id pour la retrouver (note à viser).
  const versEvaluation = (evaluation) => ({
    id: evaluation.id,
    libelle: evaluation.libelle,
    note: lireNote(evaluation.note).valeur,
    coef: lireCoefEvaluation(evaluation.coef).valeur,
  });

  // 2. Les lignes d'un type qui comptent dans cette UE (coefficient > 0).
  const lignes = (type) =>
    semestre.elements
      .filter((element) => element.type === type)
      .map((element) => ({
        id: element.id,
        code: element.code,
        libelle: element.intitule,
        coef: lireCoefUe(element.coefs[ue.id]).valeur,
        evaluations: element.evaluations.map(versEvaluation),
      }))
      .filter((ligne) => ligne.coef > 0);

  const parties = lignes('sae');
  const ressources = lignes('ressource');

  // 3. Poids d'un pôle = somme des coefficients de ses lignes.
  const somme = (liste) => arrondiMillieme(liste.reduce((total, ligne) => total + ligne.coef, 0));

  return {
    code: codeUe(numeroSemestre, ue.numero),
    poleSae: { poids: somme(parties), parties },
    poleRessources: { poids: somme(ressources), ressources },
  };
}

// Toutes les évaluations d'une UE construite par modeleUe.
function evaluationsDuModele(modele) {
  return [
    ...modele.poleSae.parties.flatMap((partie) => partie.evaluations),
    ...modele.poleRessources.ressources.flatMap((ressource) => ressource.evaluations),
  ];
}

/* ==================== Résultats ==================== */

/**
 * Calcule tous les résultats d'un semestre.
 *
 * @param {object} semestre état de la saisie du semestre
 * @param {number} numeroSemestre 1 à 6
 * @param {string} texteCible cible de la note à viser, telle que tapée
 * @returns {{
 *   malus: number, cible: number,
 *   ues: object[],        // une entrée par UE : moyennes, poids, note à viser…
 *   elements: object[],   // moyenne de chaque ressource et de chaque partie SAE
 *   aViserParEvaluation: Map<string, object[]>,  // id d'évaluation → note à viser dans chaque UE
 * }}
 */
export function analyserSemestre(semestre, numeroSemestre, texteCible) {
  const malus = lireMalus(semestre.malus).valeur;
  const cible = lireCible(texteCible).valeur;
  const aViserParEvaluation = new Map();

  const ues = semestre.ues.map((ue) => {
    // 1. L'UE au format de calcul.js, puis sa moyenne (malus compris).
    const modele = modeleUe(semestre, ue, numeroSemestre);
    const resultat = moyenneUe(modele, malus);
    const evaluations = evaluationsDuModele(modele);

    // 2. Note à viser, évaluation par évaluation : pour chaque évaluation non
    //    notée, la note minimale pour que CETTE UE atteigne la cible.
    for (const evaluation of evaluations.filter((e) => e.note === null)) {
      const liste = aViserParEvaluation.get(evaluation.id) ?? [];
      liste.push({ ue: modele.code, ...noteAViser(modele, evaluation, cible, malus) });
      aViserParEvaluation.set(evaluation.id, liste);
    }

    // 3. Note à viser sur TOUTES les évaluations restantes (même note partout).
    //    Celles dont le coef est inconnu ne peuvent pas compter : on les écarte.
    const restantes = evaluations.filter((e) => e.note === null && e.coef !== null);

    return {
      id: ue.id,
      numero: ue.numero,
      code: modele.code,
      intitule: ue.intitule,
      poidsSae: modele.poleSae.poids,
      poidsRessources: modele.poleRessources.poids,
      ...resultat,
      restantes: restantes.length,
      aViser: restantes.length > 0 ? noteAViser(modele, restantes, cible, malus) : null,
    };
  });

  // 4. Moyenne de chaque ressource et de chaque partie SAE.
  const elements = semestre.elements.map((element) => ({
    id: element.id,
    type: element.type,
    code: element.code,
    intitule: element.intitule,
    moyenne: moyenneEvaluations(
      element.evaluations.map((evaluation) => ({
        note: lireNote(evaluation.note).valeur,
        coef: lireCoefEvaluation(evaluation.coef).valeur,
      })),
    ),
  }));

  return { malus, cible, ues, elements, aViserParEvaluation };
}

/**
 * Compétences de l'année du semestre donné (S3 → S3 et S4) : chaque
 * compétence Cn est la moyenne des UE de numéro n des deux semestres.
 *
 * @param {Object<number, object>} semestres état des 6 semestres
 * @param {number} numeroSemestre
 * @returns {{ semestres: [number, number], competences: object[] }}
 */
export function competencesAnnee(semestres, numeroSemestre) {
  // 1. Les deux semestres de l'année : impair puis pair.
  const impair = numeroSemestre % 2 === 1 ? numeroSemestre : numeroSemestre - 1;
  const pair = impair + 1;

  // 2. Résultat de chaque UE d'un semestre, rangé par numéro d'UE.
  //    Si deux UE ont le même numéro, seule la première compte.
  const resultatsParNumero = (numero) => {
    const semestre = semestres[numero];
    const malus = lireMalus(semestre.malus).valeur;
    const parNumero = new Map();
    for (const ue of semestre.ues) {
      if (!parNumero.has(ue.numero)) {
        parNumero.set(ue.numero, moyenneUe(modeleUe(semestre, ue, numero), malus));
      }
    }
    return parNumero;
  };
  const resultatsImpair = resultatsParNumero(impair);
  const resultatsPair = resultatsParNumero(pair);

  // 3. Une compétence pour chaque numéro d'UE présent dans l'un des semestres.
  const numeros = [...new Set([...resultatsImpair.keys(), ...resultatsPair.keys()])].sort((a, b) => a - b);
  const absente = { moyenne: null, provisoire: true };

  return {
    semestres: [impair, pair],
    competences: numeros.map((numero) => ({
      numero,
      ues: [codeUe(impair, numero), codeUe(pair, numero)],
      ...moyenneCompetence(resultatsImpair.get(numero) ?? absente, resultatsPair.get(numero) ?? absente),
    })),
  };
}

/* ==================== Contrôles ==================== */

// Numéros d'UE utilisés plusieurs fois dans un semestre (à signaler).
export function numerosEnDouble(semestre) {
  const vus = new Set();
  const doubles = new Set();
  for (const ue of semestre.ues) {
    if (vus.has(ue.numero)) {
      doubles.add(ue.numero);
    }
    vus.add(ue.numero);
  }
  return doubles;
}

// Vrai si l'utilisateur a commencé une saisie (pour prévenir avant de fermer l'onglet).
export function contientDesDonnees(semestres) {
  return Object.values(semestres).some(
    (semestre) => semestre.ues.length > 0 || semestre.elements.length > 0 || semestre.malus.trim() !== '',
  );
}

/* ==================== Comparaison avec le relevé ==================== */

// Au-delà de cet écart (en points), une moyenne calculée et la moyenne
// officielle du relevé ne sont plus considérées comme égales.
export const ECART_SIGNALE = 0.01;

/**
 * Compare une moyenne calculée à la moyenne officielle du relevé.
 *
 * Piège : 12,345 − 12,335 donne 0,01000000000000156 pour l'ordinateur, donc
 * « plus que 0,01 ». On compare donc en millièmes ENTIERS : 10 millièmes
 * pile ne sont pas signalés, 11 le sont.
 *
 * @param {number|null} calcule moyenne calculée par l'app
 * @param {number|null|undefined} officiel moyenne du relevé (absente : null ou undefined)
 * @returns {{ officiel: number|null, ecart: number|null, signale: boolean }}
 */
export function comparerOfficiel(calcule, officiel) {
  // 1. Pas de moyenne officielle : rien à comparer.
  if (officiel === null || officiel === undefined) {
    return { officiel: null, ecart: null, signale: false };
  }
  // 2. Pas encore de moyenne calculée : on montre l'officielle, sans écart.
  if (calcule === null) {
    return { officiel, ecart: null, signale: false };
  }
  // 3. Écart en millièmes entiers, puis en points.
  const ecartMilliemes = Math.round(Math.abs(calcule - officiel) * 1000);
  return { officiel, ecart: ecartMilliemes / 1000, signale: ecartMilliemes > ECART_SIGNALE * 1000 };
}

/* ==================== Affichage des nombres ==================== */

/**
 * Moyenne à la française, avec 2 ou 3 décimales : 12.5 → « 12,50 »,
 * 12.206 → « 12,206 ». null → « — ».
 */
export function formaterMoyenne(valeur) {
  if (valeur === null) {
    return '—';
  }
  return valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/**
 * Note à viser, arrondie au centième SUPÉRIEUR : la note affichée suffit
 * toujours. 10.997 → « 11,00 ».
 * (On retire un milliardième avant d'arrondir : sinon 1,1 × 100, qui vaut
 * 110,00000000000001 pour l'ordinateur, donnerait 1,11. Pour 0, ce retrait
 * donnerait « -0 » : Math.max(0, …) le ramène à 0.)
 */
export function formaterNoteAViser(valeur) {
  const auCentieme = Math.max(0, Math.ceil(valeur * 100 - 1e-9) / 100);
  return auCentieme.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

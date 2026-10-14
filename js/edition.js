// Édition d'un bloc de la saisie (UE, ressource ou partie SAE, évaluation,
// malus), avec « Valider » et « Annuler ».
//
// Fonctions pures : elles ne touchent pas à la page. app.js affiche
// l'éditeur ; ces fonctions gèrent le BROUILLON, c'est-à-dire une copie du
// bloc que l'on modifie sans toucher à la saisie :
//   - à l'ouverture : brouillonDe (bloc existant) ou nouveauBloc (ajout) ;
//   - pendant la frappe : app.js range chaque champ dans le brouillon ;
//   - « Valider » : erreursBrouillon, puis appliquerBrouillon s'il n'y en a pas ;
//   - « Annuler » : on oublie simplement le brouillon.
// La saisie reçue n'est jamais modifiée : chaque fonction renvoie une copie.
//
// Une « cible » désigne le bloc édité :
//   { sorte: 'ue', id }                 une UE
//   { sorte: 'element', id }            une ressource ou une partie du pôle SAE
//   { sorte: 'evaluation', element, id } une évaluation (et la ligne qui la contient)
//   { sorte: 'malus' }                  le malus du semestre

import {
  NUMEROS_UE,
  creerUe,
  creerElement,
  lireNote,
  lireCoefEvaluation,
  lireCoefUe,
  lireMalus,
} from './modele.js';

/**
 * Identifiants des champs de l'éditeur. app.js les donne aux champs ; les
 * erreurs et les liens du rapport d'import (« à compléter ») les utilisent
 * pour désigner un champ.
 */
export const idChamp = {
  ueNumero: (ue) => `${ue.id}-numero`,
  ueIntitule: (ue) => `${ue.id}-intitule`,
  code: (element) => `${element.id}-code`,
  intitule: (element) => `${element.id}-intitule`,
  coef: (element, ue) => `${element.id}-coef-${ue.id}`,
  libelle: (evaluation) => `${evaluation.id}-libelle`,
  note: (evaluation) => `${evaluation.id}-note`,
  coefEvaluation: (evaluation) => `${evaluation.id}-coef`,
  malus: () => 'champ-malus',
};

// La ligne (ressource ou partie SAE) qui porte cet identifiant.
const trouverElement = (semestre, id) => semestre.elements.find((element) => element.id === id);

/**
 * Le brouillon d'un bloc EXISTANT : une copie, que l'on peut modifier sans
 * toucher à la saisie. null si le bloc n'existe plus.
 *
 * @param {object} semestre
 * @param {object} cible
 * @returns {object|null}
 */
export function brouillonDe(semestre, cible) {
  switch (cible.sorte) {
    case 'ue': {
      const ue = semestre.ues.find((candidate) => candidate.id === cible.id);
      return ue ? structuredClone(ue) : null;
    }
    case 'element': {
      const element = trouverElement(semestre, cible.id);
      return element ? structuredClone(element) : null;
    }
    case 'evaluation': {
      const evaluation = trouverElement(semestre, cible.element)?.evaluations.find((e) => e.id === cible.id);
      return evaluation ? structuredClone(evaluation) : null;
    }
    case 'malus':
      return { malus: semestre.malus };
    default:
      return null;
  }
}

/**
 * Un bloc NEUF, pour « Ajouter… » : sa cible et son brouillon. Il n'entre
 * dans la saisie qu'à la validation : « Annuler » ne laisse rien.
 *
 * (Une évaluation s'ajoute dans l'éditeur de sa ligne : son brouillon
 * contient toutes ses évaluations.)
 *
 * @param {object} semestre
 * @param {'ue'|'ressource'|'sae'} sorte
 * @param {() => string} nouvelId
 * @returns {{ cible: object, brouillon: object }|null} null s'il n'y a plus de place (6 UE)
 */
export function nouveauBloc(semestre, sorte, nouvelId) {
  if (sorte === 'ue') {
    // Le premier numéro libre (au plus 6 UE, numérotées de 1 à 6).
    const utilises = new Set(semestre.ues.map((ue) => ue.numero));
    const numero = NUMEROS_UE.find((n) => !utilises.has(n));
    if (numero === undefined) {
      return null;
    }
    const ue = creerUe(nouvelId(), numero);
    return { cible: { sorte: 'ue', id: ue.id }, brouillon: ue };
  }
  const element = creerElement(nouvelId(), sorte);
  return { cible: { sorte: 'element', id: element.id }, brouillon: element };
}

/**
 * Les erreurs du brouillon : un message par champ invalide. Vide : on peut valider.
 *
 * @param {object} semestre
 * @param {object} cible
 * @param {object} brouillon
 * @returns {{ champ: string, message: string }[]} champ : identifiant (voir idChamp)
 */
export function erreursBrouillon(semestre, cible, brouillon) {
  const erreurs = [];
  // Ajoute l'erreur d'un champ, s'il en a une.
  const verifier = (champ, { erreur }) => {
    if (erreur) {
      erreurs.push({ champ, message: erreur });
    }
  };
  // Les trois champs d'une évaluation (le libellé est libre).
  const verifierEvaluation = (evaluation) => {
    verifier(idChamp.note(evaluation), lireNote(evaluation.note));
    verifier(idChamp.coefEvaluation(evaluation), lireCoefEvaluation(evaluation.coef));
  };

  switch (cible.sorte) {
    case 'ue':
      // Deux UE ne peuvent pas avoir le même numéro.
      if (semestre.ues.some((ue) => ue.id !== brouillon.id && ue.numero === brouillon.numero)) {
        erreurs.push({ champ: idChamp.ueNumero(brouillon), message: 'Ce numéro est déjà utilisé par une autre UE.' });
      }
      break;
    case 'element':
      // Un coefficient par UE du semestre, puis chaque évaluation.
      for (const ue of semestre.ues) {
        verifier(idChamp.coef(brouillon, ue), lireCoefUe(brouillon.coefs[ue.id]));
      }
      brouillon.evaluations.forEach(verifierEvaluation);
      break;
    case 'evaluation':
      verifierEvaluation(brouillon);
      break;
    case 'malus':
      verifier(idChamp.malus(), lireMalus(brouillon.malus));
      break;
  }
  return erreurs;
}

/**
 * Vrai si le brouillon diffère de ce qu'il copie. Pour un bloc neuf, vrai
 * dès qu'un champ est rempli.
 *
 * @param {object|null} original le brouillon d'ouverture (brouillonDe ou nouveauBloc)
 * @param {object} brouillon
 */
export function estModifie(original, brouillon) {
  return JSON.stringify(original) !== JSON.stringify(brouillon);
}

/**
 * La saisie après « Valider » : le bloc est remplacé par son brouillon, ou
 * ajouté s'il est neuf.
 *
 * @param {object} semestre
 * @param {object} cible
 * @param {object} brouillon
 * @returns {object} nouveau semestre
 */
export function appliquerBrouillon(semestre, cible, brouillon) {
  const copie = structuredClone(semestre);
  const valeur = structuredClone(brouillon);

  // Remplace l'objet de même id dans la liste, ou l'ajoute à la fin.
  const remplacerOuAjouter = (liste) => {
    const index = liste.findIndex((objet) => objet.id === valeur.id);
    if (index === -1) {
      liste.push(valeur);
    } else {
      liste[index] = valeur;
    }
  };

  switch (cible.sorte) {
    case 'ue':
      remplacerOuAjouter(copie.ues);
      // Les UE restent rangées par numéro (UE3.1, UE3.2…).
      copie.ues.sort((a, b) => a.numero - b.numero);
      break;
    case 'element':
      remplacerOuAjouter(copie.elements);
      break;
    case 'evaluation': {
      const element = trouverElement(copie, cible.element);
      if (element) {
        remplacerOuAjouter(element.evaluations);
      }
      break;
    }
    case 'malus':
      copie.malus = valeur.malus;
      break;
  }
  return copie;
}

/**
 * La saisie sans ce bloc. Supprimer une UE efface aussi les coefficients
 * saisis pour elle dans chaque ligne.
 *
 * @param {object} semestre
 * @param {object} cible
 * @returns {object} nouveau semestre
 */
export function supprimerBloc(semestre, cible) {
  const copie = structuredClone(semestre);
  switch (cible.sorte) {
    case 'ue':
      copie.ues = copie.ues.filter((ue) => ue.id !== cible.id);
      for (const element of copie.elements) {
        delete element.coefs[cible.id];
      }
      break;
    case 'element':
      copie.elements = copie.elements.filter((element) => element.id !== cible.id);
      break;
    case 'evaluation': {
      const element = trouverElement(copie, cible.element);
      if (element) {
        element.evaluations = element.evaluations.filter((evaluation) => evaluation.id !== cible.id);
      }
      break;
    }
  }
  return copie;
}

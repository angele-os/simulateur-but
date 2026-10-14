// Interface du simulateur : relie la page (index.html) au modèle (modele.js).
// Ce fichier ne fait AUCUN calcul de moyenne : il affiche la saisie et les
// résultats calculés par modele.js, et gère les éditeurs.
//
// Affichage : par défaut, une vue propre (lecture seule) des UE, des
// ressources, des SAE et de leurs évaluations. Chaque bloc a un bouton
// engrenage « Modifier » qui ouvre son éditeur, avec « Valider » et
// « Annuler » (Échap). Le brouillon de l'éditeur est géré par edition.js :
// la saisie ne change, et les moyennes ne se recalculent, qu'à la validation.
//
// Sécurité : jamais d'innerHTML. Tout texte (surtout ce que l'utilisateur a
// saisi) est inséré avec textContent, qui l'affiche tel quel.
// Données : rien n'est stocké ni envoyé. Tout vit dans la variable « etat »
// et disparaît quand on ferme l'onglet.

import {
  NUMEROS_UE,
  creerSemestre,
  creerUe,
  creerEvaluation,
  numerosUeParDefaut,
  codeUe,
  lireNote,
  lireCoefEvaluation,
  lireCoefUe,
  lireMalus,
  lireCible,
  analyserSemestre,
  competencesAnnee,
  contientDesDonnees,
  formaterMoyenne,
  formaterNoteAViser,
  comparerOfficiel,
} from './modele.js';
import {
  idChamp,
  brouillonDe,
  nouveauBloc,
  erreursBrouillon,
  estModifie,
  appliquerBrouillon,
  supprimerBloc,
} from './edition.js';
import { importerCoefficients } from './import-coefficients.js';
import { importerNotes } from './import-notes.js';
import { preparerImportCoefficients, preparerImportReleve, messageConfirmation } from './remplissage.js';
import { parcoursDe, semestresDe, nomAnnee, creerSemestresAnnee } from './choix-annee.js';
// Le référentiel des coefficients officiels (généré par scripts/generer-referentiel.mjs).
import referentiel from '../data/referentiel.js';
// lecture-pdf.js (et donc pdf.js) n'est chargé qu'au premier import, avec
// import() : la saisie manuelle fonctionne toujours, même sans lui.

/* ==================== État de la saisie ==================== */

const etat = {
  semestreActif: 1,
  cible: '', // cible de la note à viser, telle que tapée (vide = 10)
  // Un semestre vide pour chacun des 6 semestres.
  semestres: Object.fromEntries([1, 2, 3, 4, 5, 6].map((numero) => [numero, creerSemestre()])),
  // Moyennes officielles du dernier relevé importé, pour « calculé / officiel » :
  //   ues : n° de semestre → code d'UE → { moyenne, poleSae, poleRessources } ;
  //   competences : année (n° du semestre impair) → n° de compétence → moyenne.
  officiels: { ues: {}, competences: {} },
};

// L'éditeur ouvert (un seul à la fois), ou null :
//   cible     : le bloc édité (voir edition.js) ;
//   brouillon : la copie modifiée pendant la frappe ;
//   original  : le brouillon tel qu'à l'ouverture (pour savoir s'il a changé) ;
//   nouveau   : vrai pour un bloc ajouté, qui n'existe pas encore dans la saisie.
let edition = null;

// Identifiants uniques : ils relient chaque champ à sa donnée et à son libellé.
let compteurId = 0;
const nouvelId = () => `id${++compteurId}`;

const semestreActif = () => etat.semestres[etat.semestreActif];

const NOMS = {
  ressource: { court: 'ressource', sansCode: 'ressource sans code', nouvelle: 'Nouvelle ressource' },
  sae: { court: 'partie SAE', sansCode: 'partie SAE sans code', nouvelle: 'Nouvelle partie du pôle SAE' },
};

// Lecture de chaque champ numérique (attribut data-champ) : elle donne aussi
// le message d'erreur, affiché pendant la frappe.
const LECTEURS = {
  malus: lireMalus,
  'element-coef': lireCoefUe,
  'evaluation-note': lireNote,
  'evaluation-coef': lireCoefEvaluation,
};

/* ==================== Éléments fixes de la page ==================== */

const onglets = [...document.querySelectorAll('[role="tab"]')];
const zoneSemestre = document.getElementById('semestre');
const titreSaisie = document.getElementById('titre-saisie');
const titreResultats = document.getElementById('titre-resultats');
const listeUes = document.getElementById('liste-ues');
const uesVide = document.getElementById('ues-vide');
const boutonCreerUes = document.getElementById('btn-creer-ues');
const boutonAjouterUe = document.getElementById('btn-ajouter-ue');
const zoneCompetences = document.getElementById('competences');
const zoneMalus = document.getElementById('zone-malus');
const listes = {
  ressource: document.getElementById('liste-ressource'),
  sae: document.getElementById('liste-sae'),
};
const boutonsAjouterLigne = [
  document.getElementById('btn-ajouter-ressource'),
  document.getElementById('btn-ajouter-sae'),
];
const champCible = document.getElementById('cible');
const zoneAnnonce = document.getElementById('annonce');
const sectionImport = document.getElementById('import');
const etatImport = document.getElementById('import-etat');
const rapportImport = document.getElementById('rapport-import');

/* ==================== Petits utilitaires ==================== */

// Crée un élément avec une classe et un texte (toujours via textContent).
function creer(balise, classe, texte) {
  const element = document.createElement(balise);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  return element;
}

// Zone role="status" : ce qu'on y écrit est lu par les lecteurs d'écran.
function annoncer(message) {
  // On vide puis on réécrit un peu plus tard : sinon un même message ne serait pas relu.
  zoneAnnonce.textContent = '';
  setTimeout(() => {
    zoneAnnonce.textContent = message;
  }, 60);
}

// Affiche (ou efface) le message d'erreur d'un champ.
function afficherErreurChamp(champ, message) {
  champ.closest('.field').querySelector('.field-error').textContent = message ?? '';
  // aria-invalid : le lecteur d'écran annonce « non valide » sur ce champ.
  if (message) {
    champ.setAttribute('aria-invalid', 'true');
  } else {
    champ.removeAttribute('aria-invalid');
  }
}

// Donne le focus à un élément de la page. Renvoie false s'il n'existe pas.
function donnerFocus(id) {
  const cible = id ? document.getElementById(id) : null;
  if (!cible) return false;
  cible.focus();
  return true;
}

// Nom court d'une ligne, pour les boutons : « R3.01 », ou « ressource sans code ».
const nomLigne = (element) => element.code.trim() || NOMS[element.type].sansCode;

// Titre d'une ligne : « R3.01 — Développement », ou son nom court.
function titreElement(element) {
  const intitule = element.intitule.trim();
  return intitule ? `${nomLigne(element)} — ${intitule}` : nomLigne(element);
}

// Coefficients et poids : sans décimales inutiles (40 → « 40 », 7.5 → « 7,5 »).
const formaterPoids = (valeur) => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// Cible affichée simplement : 10 → « 10 », 12.5 → « 12,5 ».
const texteCible = (cible) => cible.toLocaleString('fr-FR');

/* ==================== Bouton engrenage « Modifier » ==================== */

// Identifiant du bouton « Modifier » d'un bloc : le focus y revient après l'édition.
const idModifier = (cible) => (cible.sorte === 'malus' ? 'modifier-malus' : `modifier-${cible.id}`);

/**
 * Le bouton engrenage d'un bloc : un vrai <button>, atteignable avec Tab.
 * Son nom pour les lecteurs d'écran est « Modifier R3.01 » (aria-label) ;
 * title l'affiche aussi en bulle au survol de la souris.
 *
 * @param {string} nom ce que le bouton modifie : « R3.01 », « le malus »…
 * @param {object} cible le bloc à éditer (voir edition.js)
 */
function boutonModifier(nom, cible) {
  const bouton = creer('button', 'engrenage');
  bouton.type = 'button';
  bouton.id = idModifier(cible);
  bouton.setAttribute('aria-label', `Modifier ${nom}`);
  bouton.title = `Modifier ${nom}`;
  bouton.dataset.action = 'modifier';
  // La cible est rangée en texte JSON dans un attribut data-*.
  bouton.dataset.cible = JSON.stringify(cible);
  // L'icône est recopiée depuis un <template> de index.html (pas d'innerHTML).
  bouton.append(document.getElementById('icone-engrenage').content.firstElementChild.cloneNode(true));
  return bouton;
}

/* ==================== Affichage du semestre ==================== */

// Vrai si l'éditeur ouvert est celui de ce bloc.
function enEdition(cible) {
  if (edition === null || edition.cible.sorte !== cible.sorte) return false;
  return cible.sorte === 'malus' || edition.cible.id === cible.id;
}

// Vrai si l'éditeur ouvert est celui d'un bloc NEUF de cette sorte (UE, ressource, SAE).
function nouveauEnEdition(sorte) {
  if (edition === null || !edition.nouveau) return false;
  return sorte === 'ue' ? edition.cible.sorte === 'ue' : edition.cible.sorte === 'element' && edition.brouillon.type === sorte;
}

/**
 * Reconstruit tout le semestre actif : résultats (UE, compétences, malus) et
 * lignes (ressources, SAE et leurs évaluations). L'éditeur ouvert est
 * affiché à la place de son bloc, avec son brouillon.
 * Les moyennes sont calculées sur la saisie VALIDÉE (pas sur le brouillon).
 *
 * @param {string} [idAFocaliser] champ ou bouton qui reçoit le focus ensuite
 */
function afficher(idAFocaliser) {
  const numero = etat.semestreActif;
  const semestre = semestreActif();
  const analyse = analyserSemestre(semestre, numero, etat.cible);
  titreResultats.textContent = `Résultats du semestre ${numero}`;
  titreSaisie.textContent = `Notes du semestre ${numero}`;

  // 1. Les UE : une carte de résultat chacune (ou son éditeur), puis une
  //    nouvelle UE en cours d'ajout.
  const ues = analyse.ues.map((ue) => (enEdition({ sorte: 'ue', id: ue.id }) ? editeurUe(numero) : vueUe(ue, analyse, numero)));
  if (nouveauEnEdition('ue')) {
    ues.push(editeurUe(numero));
  }
  listeUes.replaceChildren(...ues.map((contenu) => enItem(contenu)));
  uesVide.hidden = ues.length > 0;
  boutonCreerUes.hidden = semestre.ues.length > 0;
  boutonCreerUes.textContent =
    numero >= 5
      ? `Créer les UE ${numero}.1, ${numero}.3 et ${numero}.6 (parcours DACS)`
      : `Créer les 6 UE (UE${numero}.1 à UE${numero}.6)`;
  // Au plus une UE par numéro (6 en tout).
  boutonAjouterUe.disabled = semestre.ues.length >= NUMEROS_UE.length;

  // 2. Les compétences de l'année : elles dépendent des DEUX semestres, on
  //    les montre dès que l'un des deux a une UE.
  const annee = competencesAnnee(etat.semestres, numero);
  zoneCompetences.replaceChildren(...(annee.competences.length > 0 ? [carteCompetences(annee)] : []));

  // 3. Le malus.
  zoneMalus.replaceChildren(enEdition({ sorte: 'malus' }) ? editeurMalus() : vueMalus(analyse.malus));

  // 4. Les ressources, puis les parties du pôle SAE (et une ligne en cours d'ajout).
  const moyennes = new Map(analyse.elements.map((ligne) => [ligne.id, ligne.moyenne]));
  for (const type of ['ressource', 'sae']) {
    const lignes = semestre.elements.filter((element) => element.type === type);
    const items = lignes.map((element, i) =>
      enEdition({ sorte: 'element', id: element.id })
        ? enItem(editeurLigne(numero, i), 'ligne ligne--edition')
        : vueLigne(element, moyennes.get(element.id), analyse, numero),
    );
    if (nouveauEnEdition(type)) {
      items.push(enItem(editeurLigne(numero, lignes.length), 'ligne ligne--edition'));
    }
    listes[type].replaceChildren(...items);
  }

  donnerFocus(idAFocaliser);
}

// Range un contenu dans un <li> (les cartes d'UE et les éditeurs sont dans des listes).
function enItem(contenu, classe) {
  const item = creer('li', classe);
  item.append(contenu);
  return item;
}

/* ==================== Vue propre (lecture seule) ==================== */

// Pastille « repère » : au-dessus ou en dessous de 10, sans verdict.
// court = true : « ≥ 10 » seulement (dans un tableau, où la colonne s'appelle déjà « Repère »).
function badgeRepere(moyenne, court = false) {
  const haut = moyenne >= 10;
  const badge = creer('span', `badge ${haut ? 'badge--haut' : 'badge--bas'}`);
  // Le symbole est caché aux lecteurs d'écran, qui lisent la phrase à la place.
  const symbole = creer('span', null, `${court ? '' : 'Repère '}${haut ? '≥ 10' : '< 10'}`);
  symbole.setAttribute('aria-hidden', 'true');
  badge.append(symbole, creer('span', 'sr-only', haut ? 'Repère : au moins 10' : 'Repère : moins de 10'));
  return badge;
}

// Carte du résultat d'une UE, avec son bouton « Modifier UE3.1 ».
function vueUe(ue, analyse, numero) {
  const carte = creer('article', 'card ue-resultat bloc-modifiable');
  const titreId = `resultat-${ue.id}`;
  carte.setAttribute('aria-labelledby', titreId);

  // 1. Titre, moyenne et bouton « Modifier ».
  const tete = creer('div', 'ue-resultat__tete bloc-tete');
  const titre = creer('h4', null, ue.code);
  titre.id = titreId;
  if (ue.intitule.trim()) {
    titre.append(creer('span', 'ue-resultat__intitule', ` — ${ue.intitule.trim()}`));
  }
  const moyenne =
    ue.moyenne === null
      ? creer('p', 'moyenne moyenne--vide', 'Pas encore de note')
      : creer('p', 'moyenne', formaterMoyenne(ue.moyenne));
  tete.append(titre, moyenne, boutonModifier(ue.code, { sorte: 'ue', id: ue.id }));
  carte.append(tete);

  // 2. Pastilles : provisoire, repère.
  if (ue.moyenne !== null) {
    const etiquettes = creer('p', 'etiquettes');
    if (ue.provisoire) {
      etiquettes.append(creer('span', 'badge badge--provisoire', 'Provisoire : un pôle n’a pas encore de note'));
    }
    etiquettes.append(badgeRepere(ue.moyenne));
    carte.append(etiquettes);
  }

  // 3. Pôles (avec leur poids) et malus.
  const poles = creer('dl', 'poles');
  const ajouterLigne = (libelle, precision, valeur) => {
    const terme = creer('dt', null, libelle);
    if (precision) terme.append(creer('span', 'hint', ` ${precision}`));
    poles.append(terme, creer('dd', null, valeur));
  };
  ajouterLigne('Pôle SAE', `(poids ${formaterPoids(ue.poidsSae)})`, formaterMoyenne(ue.poleSae));
  ajouterLigne('Pôle ressources', `(poids ${formaterPoids(ue.poidsRessources)})`, formaterMoyenne(ue.poleRessources));
  if (analyse.malus > 0 && ue.moyenne !== null) {
    ajouterLigne('Malus', null, `− ${formaterPoids(analyse.malus)}`);
  }
  carte.append(poles);

  // 4. Le relevé importé donne les moyennes officielles : calculé / officiel.
  const officiel = etat.officiels.ues[numero]?.[ue.code];
  if (officiel && [officiel.moyenne, officiel.poleSae, officiel.poleRessources].some((v) => v !== null)) {
    const comparaisons = [
      ['Moyenne de l’UE', comparerOfficiel(ue.moyenne, officiel.moyenne), ue.moyenne],
      ['Pôle SAE', comparerOfficiel(ue.poleSae, officiel.poleSae), ue.poleSae],
      ['Pôle ressources', comparerOfficiel(ue.poleRessources, officiel.poleRessources), ue.poleRessources],
    ];
    carte.append(tableauComparaison(comparaisons));
    if (comparaisons.some(([, comparaison]) => comparaison.signale)) {
      carte.append(
        creer(
          'p',
          'alerte',
          'Écart de plus de 0,01 avec le relevé : vérifie les coefficients. Celui écrit dans un libellé n’est pas toujours celui qu’utilise l’IUT.',
        ),
      );
    }
  }

  // 5. Les poids du tableau officiel totalisent 100 : on prévient sinon.
  const totalPoids = ue.poidsSae + ue.poidsRessources;
  if (totalPoids > 0 && Math.abs(totalPoids - 100) > 0.001) {
    carte.append(
      creer('p', 'alerte', `Les coefficients de cette UE font ${formaterPoids(totalPoids)} au lieu de 100 : vérifie-les.`),
    );
  }

  // 6. Note à viser sur les évaluations restantes.
  if (ue.aViser) {
    carte.append(creer('p', 'a-viser', texteAViserUe(ue, analyse.cible)));
  }
  return carte;
}

// Le malus du semestre, avec son bouton « Modifier le malus ».
function vueMalus(malus) {
  const bloc = creer('div', 'malus-vue bloc-modifiable');
  const tete = creer('div', 'bloc-tete');
  const texte =
    malus > 0
      ? `${formaterPoids(malus)} point retiré de chaque UE du semestre.`
      : 'Aucun malus.';
  tete.append(creer('p', 'malus-vue__texte', texte), boutonModifier('le malus', { sorte: 'malus' }));
  bloc.append(tete);
  return bloc;
}

/**
 * Une ressource ou une partie du pôle SAE : titre, moyenne, coefficients, et
 * ses évaluations (chacune avec son propre bouton « Modifier »).
 */
function vueLigne(element, moyenne, analyse, numero) {
  const item = creer('li', 'ligne bloc-modifiable');
  const cible = { sorte: 'element', id: element.id };

  // 1. Titre, moyenne et bouton « Modifier R3.01 ».
  const tete = creer('div', 'ligne__tete bloc-tete');
  tete.append(
    creer('h4', 'ligne__titre', titreElement(element)),
    creer('span', 'ligne__moyenne', moyenne === null ? 'pas de note' : `moy. ${formaterMoyenne(moyenne)}`),
    boutonModifier(nomLigne(element), cible),
  );

  // 2. Ses coefficients, UE par UE : « UE3.1 : 15 · UE3.2 : 5 ».
  const coefs = semestreActif()
    .ues.filter((ue) => String(element.coefs[ue.id] ?? '').trim() !== '')
    .map((ue) => `${codeUe(numero, ue.numero)} : ${String(element.coefs[ue.id]).trim()}`);
  const texteCoefs =
    coefs.length > 0 ? `Coefficients : ${coefs.join(' · ')}` : 'Aucun coefficient : ne compte dans aucune UE.';
  item.append(tete, creer('p', 'ligne__coefs', texteCoefs));

  // 3. Ses évaluations (ou l'éditeur de l'une d'elles).
  if (element.evaluations.length === 0) {
    item.append(creer('p', 'vide-texte', 'Aucune évaluation.'));
  } else {
    const liste = creer('ul', 'evaluations-vue');
    liste.append(
      ...element.evaluations.map((evaluation) =>
        enEdition({ sorte: 'evaluation', id: evaluation.id })
          ? enItem(editeurEvaluation(element), 'evaluation-vue evaluation-vue--edition')
          : vueEvaluation(evaluation, element, analyse),
      ),
    );
    item.append(liste);
  }
  return item;
}

// Une évaluation : intitulé, note, coef, bouton « Modifier », et la note à viser si elle n'est pas notée.
function vueEvaluation(evaluation, element, analyse) {
  const item = creer('li', 'evaluation-vue bloc-modifiable');
  const libelle = evaluation.libelle.trim() || 'Évaluation sans intitulé';
  const note = evaluation.note.trim();
  const coef = evaluation.coef.trim();

  const tete = creer('div', 'evaluation-vue__tete bloc-tete');
  tete.append(
    creer('span', 'evaluation-vue__libelle', libelle),
    creer('span', note ? 'evaluation-vue__note' : 'evaluation-vue__note evaluation-vue__note--vide', note ? `${note} / 20` : 'pas encore notée'),
    creer('span', coef ? 'evaluation-vue__coef' : 'evaluation-vue__coef evaluation-vue__coef--inconnu', coef ? `coef ${coef}` : 'coef inconnu'),
    boutonModifier(`l’évaluation « ${libelle} » (${nomLigne(element)})`, {
      sorte: 'evaluation',
      element: element.id,
      id: evaluation.id,
    }),
  );
  item.append(tete);

  // Note à viser, sous une évaluation pas encore notée.
  if (lireNote(evaluation.note).valeur === null) {
    const aViser = creer('p', 'a-viser');
    aViser.append(...texteAViserEvaluation(analyse.aViserParEvaluation.get(evaluation.id), analyse.cible));
    item.append(aViser);
  }
  return item;
}

// Texte de la note à viser d'une évaluation, dans chaque UE où elle compte.
function texteAViserEvaluation(resultats, cible) {
  // 1. L'évaluation ne compte dans aucune UE (aucun coefficient sur sa ligne).
  if (!resultats || resultats.length === 0) {
    return [creer('span', null, 'Ne compte encore dans aucune UE : donne un coefficient à cette ligne.')];
  }
  // 2. Coefficient inconnu : rien à calculer.
  if (resultats[0].statut === 'coef-inconnu') {
    return [creer('span', null, 'Coefficient inconnu : complète-le pour connaître la note à viser.')];
  }
  // 3. Sinon, un morceau par UE : « UE3.1 : 11,00 · UE3.2 : déjà atteint ».
  const morceaux = [creer('span', null, `Note à viser pour ${texteCible(cible)} : `)];
  resultats.forEach((resultat, i) => {
    if (i > 0) morceaux.push(creer('span', null, ' · '));
    morceaux.push(creer('span', null, `${resultat.ue} `));
    if (resultat.statut === 'possible') {
      morceaux.push(creer('strong', null, formaterNoteAViser(resultat.note)));
    } else if (resultat.statut === 'deja-atteinte') {
      morceaux.push(creer('strong', null, 'déjà atteint'));
    } else {
      morceaux.push(creer('strong', null, 'hors d’atteinte'));
      morceaux.push(creer('span', null, ` (20 donnerait ${formaterMoyenne(resultat.moyenne)})`));
    }
  });
  return morceaux;
}

// Phrase de la note à viser d'une UE (toutes les évaluations restantes).
function texteAViserUe(ue, cible) {
  const restantes = ue.restantes === 1 ? '1 évaluation restante' : `${ue.restantes} évaluations restantes`;
  const aChacune = ue.restantes === 1 ? '' : ' à chacune';
  const { statut, note, moyenne } = ue.aViser;
  if (statut === 'deja-atteinte') {
    return `${restantes} : ${texteCible(cible)} est déjà atteint, même avec 0${aChacune}.`;
  }
  if (statut === 'impossible') {
    return `${restantes} : ${texteCible(cible)} est hors d’atteinte, même avec 20${aChacune} (maximum ${formaterMoyenne(moyenne)}).`;
  }
  return `${restantes} : il faut au moins ${formaterNoteAViser(note)}${aChacune} pour atteindre ${texteCible(cible)}.`;
}

/**
 * Cellule « officiel » : la moyenne du relevé, et l'écart s'il dépasse 0,01.
 *
 * @param {{ officiel: number|null, ecart: number|null, signale: boolean }} comparaison (voir comparerOfficiel)
 */
function celluleOfficiel(comparaison) {
  const cellule = creer('td', 'num', formaterMoyenne(comparaison.officiel));
  if (comparaison.signale) {
    cellule.append(creer('span', 'precision ecart', `écart ${formaterMoyenne(comparaison.ecart)}`));
  }
  return cellule;
}

// Tableau « calculé / officiel » d'une UE : sa moyenne et ses deux pôles.
function tableauComparaison(comparaisons) {
  const tableau = creer('table', 'data-table comparaison');
  tableau.append(creer('caption', null, 'Comparaison avec le relevé importé'));

  const entete = creer('tr');
  for (const [texte, classe] of [['Moyenne'], ['Calculé', 'num'], ['Officiel', 'num']]) {
    const cellule = creer('th', classe, texte);
    cellule.scope = 'col';
    entete.append(cellule);
  }
  const tete = creer('thead');
  tete.append(entete);

  const corps = creer('tbody');
  for (const [libelle, comparaison, calcule] of comparaisons) {
    const rangee = creer('tr');
    const nom = creer('th', null, libelle);
    nom.scope = 'row';
    rangee.append(nom, creer('td', 'num', formaterMoyenne(calcule)), celluleOfficiel(comparaison));
    corps.append(rangee);
  }
  tableau.append(tete, corps);
  return tableau;
}

// Tableau des compétences de l'année (les deux semestres).
function carteCompetences({ semestres: [impair, pair], competences }) {
  const carte = creer('section', 'card');
  carte.setAttribute('aria-labelledby', 'titre-competences');
  const titre = creer('h3', null, `Compétences de l’année (S${impair} + S${pair})`);
  titre.id = 'titre-competences';
  const aide = creer(
    'p',
    'hint',
    `Chaque compétence Cn est la moyenne des UE de numéro n du S${impair} et du S${pair}. Elle reste provisoire tant que l’une des deux manque ou est provisoire.`,
  );
  carte.append(titre, aide);

  // Moyennes officielles de l'année, si un relevé a été importé.
  const officiels = etat.officiels.competences[impair] ?? {};
  const avecOfficiel = competences.some((competence) => (officiels[competence.numero] ?? null) !== null);

  const tableau = creer('table', 'data-table');
  const entete = creer('tr');
  const colonnes = [
    ['Compétence'],
    [avecOfficiel ? 'Calculé' : 'Moyenne', 'num'],
    ...(avecOfficiel ? [['Officiel', 'num']] : []),
    ['Repère'],
  ];
  for (const [texte, classe] of colonnes) {
    const cellule = creer('th', classe, texte);
    cellule.scope = 'col';
    entete.append(cellule);
  }
  const corps = creer('tbody');
  for (const competence of competences) {
    const rangee = creer('tr');
    // Peu de colonnes, pour tenir sur un téléphone : les UE sont écrites en
    // petit sous le nom, et « provisoire » sous la moyenne.
    const nom = creer('th', null, `C${competence.numero}`);
    nom.scope = 'row';
    nom.append(creer('span', 'precision', competence.ues.join(' + ')));
    const moyenne = creer('td', 'num', formaterMoyenne(competence.moyenne));
    if (competence.moyenne !== null && competence.provisoire) {
      moyenne.append(creer('span', 'precision', 'provisoire'));
    }
    const repere = creer('td');
    if (competence.moyenne !== null) {
      repere.append(badgeRepere(competence.moyenne, true));
    }
    rangee.append(nom, moyenne);
    if (avecOfficiel) {
      rangee.append(celluleOfficiel(comparerOfficiel(competence.moyenne, officiels[competence.numero])));
    }
    rangee.append(repere);
    corps.append(rangee);
  }
  const tete = creer('thead');
  tete.append(entete);
  tableau.append(tete, corps);
  carte.append(tableau);
  return carte;
}

/* ==================== Éditeurs ==================== */

/**
 * Un champ de saisie : libellé relié (for), saisie, et zone d'erreur reliée
 * (aria-describedby). data-champ dit à quelle donnée du brouillon il correspond.
 *
 * @param {{ id: string, libelle: string, precision?: string, valeur: string, champ: string,
 *   numerique?: boolean, maxlength?: number, donnees?: object, classe?: string, placeholder?: string }} options
 *   precision : texte en plus pour les lecteurs d'écran (« , évaluation 2 (R3.01) »)
 */
function creerChamp({ id, libelle, precision, valeur, champ, numerique = false, maxlength = 80, donnees = {}, classe, placeholder }) {
  const field = creer('div', classe ? `field ${classe}` : 'field');
  const label = creer('label', null, libelle);
  if (precision) label.append(creer('span', 'sr-only', precision));
  label.htmlFor = id;

  const saisie = creer('input', numerique ? 'input input--num' : 'input');
  saisie.type = 'text';
  saisie.id = id;
  saisie.value = valeur ?? '';
  saisie.maxLength = maxlength;
  saisie.autocomplete = 'off';
  if (numerique) saisie.inputMode = 'decimal';
  if (placeholder) saisie.placeholder = placeholder;
  saisie.dataset.champ = champ;
  Object.assign(saisie.dataset, donnees);

  const erreur = creer('p', 'field-error');
  erreur.id = `${id}-error`;
  saisie.setAttribute('aria-describedby', erreur.id);
  field.append(label, saisie, erreur);

  // Une valeur déjà invalide est signalée dès l'ouverture.
  const lire = LECTEURS[champ];
  if (lire) afficherErreurChamp(saisie, lire(saisie.value).erreur);
  return field;
}

/**
 * Le cadre commun des éditeurs : un formulaire nommé (« Modifier R3.01 »),
 * son contenu, puis « Valider » (Entrée), « Annuler » (Échap) et, pour un
 * bloc existant, « Supprimer… ».
 */
function cadreEditeur(titre, contenu, texteSupprimer) {
  const formulaire = creer('form', 'editeur');
  formulaire.noValidate = true; // nos propres messages, pas ceux du navigateur
  const entete = creer('p', 'editeur__titre', titre);
  entete.id = 'titre-editeur';
  formulaire.setAttribute('aria-labelledby', entete.id);

  const pied = creer('div', 'editeur__pied');
  const valider = creer('button', 'btn btn--primary btn--sm', 'Valider');
  valider.type = 'submit';
  const annuler = creer('button', 'btn btn--secondary btn--sm', 'Annuler');
  annuler.type = 'button';
  annuler.dataset.action = 'annuler';
  pied.append(valider, annuler);
  if (texteSupprimer && !edition.nouveau) {
    const supprimer = creer('button', 'btn btn--danger btn--sm', texteSupprimer);
    supprimer.type = 'button';
    supprimer.dataset.action = 'supprimer-bloc';
    pied.append(supprimer);
  }

  formulaire.append(entete, ...contenu, pied);
  return formulaire;
}

// Éditeur d'une UE : numéro et intitulé.
function editeurUe(numero) {
  const ue = edition.brouillon;
  const codeAvant = codeUe(numero, edition.original.numero);

  // 1. Le numéro, dans une liste (UE3.1, UE3.2…).
  const fieldNumero = creer('div', 'field');
  const label = creer('label', null, 'Numéro');
  label.htmlFor = idChamp.ueNumero(ue);
  const liste = creer('select', 'input');
  liste.id = idChamp.ueNumero(ue);
  liste.dataset.champ = 'ue-numero';
  liste.append(
    ...NUMEROS_UE.map((n) => {
      const option = creer('option', null, codeUe(numero, n));
      option.value = String(n);
      return option;
    }),
  );
  liste.value = String(ue.numero);
  const erreur = creer('p', 'field-error');
  erreur.id = `${liste.id}-error`;
  liste.setAttribute('aria-describedby', erreur.id);
  fieldNumero.append(label, liste, erreur);

  // 2. L'intitulé.
  const fieldIntitule = creerChamp({
    id: idChamp.ueIntitule(ue),
    libelle: 'Intitulé (facultatif)',
    valeur: ue.intitule,
    champ: 'ue-intitule',
    maxlength: 60,
  });

  const grille = creer('div', 'editeur__grille');
  grille.append(fieldNumero, fieldIntitule);
  return cadreEditeur(edition.nouveau ? 'Nouvelle UE' : `Modifier ${codeAvant}`, [grille], `Supprimer ${codeAvant}`);
}

// Éditeur du malus du semestre.
function editeurMalus() {
  const champ = creerChamp({
    id: idChamp.malus(),
    libelle: 'Malus du semestre',
    valeur: edition.brouillon.malus,
    champ: 'malus',
    numerique: true,
    maxlength: 5,
    classe: 'field--court',
  });
  const aide = creer('p', 'hint', 'Retiré de chaque UE du semestre (par exemple 0,05). Laisse vide s’il n’y en a pas.');
  return cadreEditeur('Modifier le malus', [aide, champ]);
}

// Les trois champs d'une évaluation : intitulé, note, coef.
function champsEvaluation(evaluation, precision) {
  const donnees = { evaluation: evaluation.id };
  return [
    creerChamp({
      id: idChamp.libelle(evaluation),
      libelle: 'Intitulé',
      precision,
      valeur: evaluation.libelle,
      champ: 'evaluation-libelle',
      donnees,
      classe: 'evaluation__libelle',
      placeholder: 'ex. Contrôle 1',
    }),
    creerChamp({
      id: idChamp.note(evaluation),
      libelle: 'Note /20',
      precision,
      valeur: evaluation.note,
      champ: 'evaluation-note',
      numerique: true,
      maxlength: 6,
      donnees,
      classe: 'evaluation__note',
    }),
    creerChamp({
      id: idChamp.coefEvaluation(evaluation),
      libelle: 'Coef',
      precision,
      valeur: evaluation.coef,
      champ: 'evaluation-coef',
      numerique: true,
      maxlength: 5,
      donnees,
      classe: 'evaluation__coef',
    }),
  ];
}

// Éditeur d'une seule évaluation (bouton « Modifier » de l'évaluation).
function editeurEvaluation(element) {
  const evaluation = edition.brouillon;
  const libelle = edition.original.libelle.trim() || 'sans intitulé';
  const grille = creer('div', 'evaluation');
  grille.append(...champsEvaluation(evaluation, ` (${nomLigne(element)})`));
  return cadreEditeur(`Modifier l’évaluation « ${libelle} » (${nomLigne(element)})`, [grille], 'Supprimer l’évaluation');
}

/**
 * Éditeur d'une ressource ou d'une partie SAE : code, intitulé, coefficient
 * dans chaque UE, et toutes ses évaluations (ajout et suppression compris).
 */
function editeurLigne(numero, index) {
  const ligne = edition.brouillon;
  const nom = `${NOMS[ligne.type].court} ${index + 1}`; // « ressource 2 », pour les lecteurs d'écran
  const precision = ` (${nom})`;

  // 1. Code et intitulé.
  const entete = creer('div', 'editeur__grille editeur__grille--ligne');
  const champCode = creerChamp({
    id: idChamp.code(ligne),
    libelle: 'Code',
    precision,
    valeur: ligne.code,
    champ: 'element-code',
    maxlength: 20,
    placeholder: ligne.type === 'ressource' ? 'ex. R3.01' : 'ex. S3.01',
  });
  champCode.querySelector('input').autocapitalize = 'characters';
  champCode.querySelector('input').spellcheck = false;
  entete.append(
    champCode,
    creerChamp({ id: idChamp.intitule(ligne), libelle: 'Intitulé', precision, valeur: ligne.intitule, champ: 'element-intitule' }),
  );

  // 2. Une case de coefficient par UE du semestre.
  const groupeCoefs = creer('fieldset', 'groupe');
  const legendeCoefs = creer('legend', null, 'Coefficient dans chaque UE');
  legendeCoefs.append(creer('span', 'sr-only', precision));
  groupeCoefs.append(legendeCoefs, creer('p', 'hint', 'Celui du tableau des coefficients. Case vide : ne compte pas dans cette UE.'));
  const ues = semestreActif().ues;
  if (ues.length === 0) {
    groupeCoefs.append(creer('p', 'hint', 'Ajoute d’abord les UE du semestre.'));
  } else {
    const grille = creer('div', 'coefs');
    grille.append(
      ...ues.map((ue) =>
        creerChamp({
          id: idChamp.coef(ligne, ue),
          libelle: codeUe(numero, ue.numero),
          precision: ` : coefficient (${nom})`,
          valeur: ligne.coefs[ue.id] ?? '',
          champ: 'element-coef',
          numerique: true,
          maxlength: 5,
          donnees: { ue: ue.id },
          classe: 'coef',
        }),
      ),
    );
    groupeCoefs.append(grille);
  }

  // 3. Les évaluations, chacune avec un bouton pour la retirer, puis « Ajouter ».
  const groupeEvaluations = creer('fieldset', 'groupe');
  const legende = creer('legend', null, 'Évaluations');
  legende.append(creer('span', 'sr-only', precision));
  const liste = creer('ul', 'evaluations');
  liste.append(
    ...ligne.evaluations.map((evaluation, i) => {
      const item = creer('li', 'evaluation evaluation--retirable');
      const retirer = creer('button', 'btn-icon evaluation__suppr');
      retirer.type = 'button';
      retirer.dataset.action = 'retirer-evaluation';
      retirer.dataset.evaluation = evaluation.id;
      retirer.append(iconeCroix(), creer('span', 'sr-only', `Retirer l’évaluation ${i + 1}${precision}`));
      item.append(...champsEvaluation(evaluation, `, évaluation ${i + 1}${precision}`), retirer);
      return item;
    }),
  );
  const ajouter = creer('button', 'btn btn--secondary btn--sm', 'Ajouter une évaluation');
  ajouter.type = 'button';
  ajouter.id = `${ligne.id}-ajouter-evaluation`;
  ajouter.dataset.action = 'ajouter-evaluation';
  ajouter.append(creer('span', 'sr-only', precision));
  const pied = creer('div');
  pied.append(ajouter);
  groupeEvaluations.append(legende, liste, pied);

  const titre = edition.nouveau ? NOMS[ligne.type].nouvelle : `Modifier ${titreElement(edition.original)}`;
  return cadreEditeur(titre, [entete, groupeCoefs, groupeEvaluations], `Supprimer cette ${NOMS[ligne.type].court}`);
}

// Petite croix « retirer », dessinée avec l'API SVG du DOM (pas d'innerHTML).
function iconeCroix() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const trait = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trait.setAttribute('d', 'M18 6 6 18M6 6l12 12');
  svg.append(trait);
  return svg;
}

/* ==================== Ouvrir, valider, annuler ==================== */

// Le champ qui reçoit le focus à l'ouverture d'un éditeur.
function premierChamp(cible, brouillon) {
  switch (cible.sorte) {
    case 'ue':
      return idChamp.ueNumero(brouillon);
    case 'element':
      return idChamp.code(brouillon);
    case 'evaluation':
      return idChamp.note(brouillon);
    default:
      return idChamp.malus();
  }
}

// Vrai si l'éditeur ouvert contient des modifications pas encore validées.
const modificationsEnCours = () => edition !== null && estModifie(edition.original, edition.brouillon);

/**
 * Avant de changer de semestre, d'importer ou de choisir une année :
 * l'éditeur ouvert est fermé, après confirmation s'il a des modifications.
 *
 * @returns {boolean} false si l'utilisateur préfère garder ses modifications
 */
function fermerEdition() {
  if (modificationsEnCours() && !window.confirm('Abandonner les modifications en cours ?')) {
    return false;
  }
  edition = null;
  return true;
}

/**
 * Ouvre l'éditeur d'un bloc. Un seul éditeur à la fois : si celui qui est
 * ouvert a des modifications, on y reste (rien n'est perdu en silence).
 *
 * @param {object} cible
 * @param {{ brouillon?: object, nouveau?: boolean, focus?: string }} [options]
 */
function ouvrir(cible, { brouillon = brouillonDe(semestreActif(), cible), nouveau = false, focus } = {}) {
  if (modificationsEnCours()) {
    annoncer('Valide ou annule d’abord la modification en cours.');
    document.querySelector('.editeur input, .editeur select')?.focus();
    return;
  }
  if (brouillon === null) {
    annoncer('Ce bloc n’existe plus.');
    return;
  }
  edition = { cible, brouillon, original: structuredClone(brouillon), nouveau };
  afficher();
  // Le champ demandé (lien du rapport d'import), sinon le premier de l'éditeur.
  if (!donnerFocus(focus)) {
    donnerFocus(premierChamp(cible, brouillon));
  }
}

// Ajoute une UE, une ressource ou une partie SAE : son éditeur s'ouvre, vide.
function ouvrirNouveau(sorte) {
  const bloc = nouveauBloc(semestreActif(), sorte, nouvelId);
  if (bloc) {
    ouvrir(bloc.cible, { brouillon: bloc.brouillon, nouveau: true });
  }
}

// Où revient le focus quand l'éditeur se ferme : sur le bouton « Modifier »
// du bloc, ou sur le bouton « Ajouter » si le bloc neuf a été annulé.
function retourFocus({ cible, brouillon, nouveau }, valide) {
  if (nouveau && !valide) {
    return cible.sorte === 'ue' ? 'btn-ajouter-ue' : `btn-ajouter-${brouillon.type}`;
  }
  return idModifier(cible);
}

// « Valider » : refusé s'il reste une erreur ; sinon la saisie est mise à
// jour et les moyennes recalculées.
function valider() {
  const numero = etat.semestreActif;
  const erreurs = erreursBrouillon(semestreActif(), edition.cible, edition.brouillon);
  if (erreurs.length > 0) {
    for (const { champ, message } of erreurs) {
      const saisie = document.getElementById(champ);
      if (saisie) afficherErreurChamp(saisie, message);
    }
    donnerFocus(erreurs[0].champ);
    annoncer(erreurs.length === 1 ? 'Un champ est à corriger.' : `${erreurs.length} champs sont à corriger.`);
    return;
  }
  etat.semestres[numero] = appliquerBrouillon(semestreActif(), edition.cible, edition.brouillon);
  const focus = retourFocus(edition, true);
  edition = null;
  afficher(focus);
  annoncer('Modifications validées. Moyennes recalculées.');
}

// « Annuler » (ou Échap) : le brouillon est oublié, la saisie n'a pas changé.
function annuler() {
  const focus = retourFocus(edition, false);
  edition = null;
  afficher(focus);
  annoncer('Modifications annulées.');
}

// « Supprimer… » dans l'éditeur d'un bloc existant : effet immédiat, après
// confirmation si le bloc contient des données.
function supprimerEnEdition() {
  const numero = etat.semestreActif;
  const semestre = semestreActif();
  const { cible, original } = edition;
  let question = null;
  let focus;
  let message;

  if (cible.sorte === 'ue') {
    const code = codeUe(numero, original.numero);
    if (semestre.elements.some((element) => String(element.coefs[cible.id] ?? '').trim() !== '')) {
      question = `Supprimer ${code} et les coefficients saisis pour cette UE ?`;
    }
    focus = 'btn-ajouter-ue';
    message = `${code} supprimée.`;
  } else if (cible.sorte === 'element') {
    if (original.evaluations.length > 0) {
      question = `Supprimer « ${titreElement(original)} » et ses évaluations ?`;
    }
    focus = `btn-ajouter-${original.type}`;
    message = `« ${titreElement(original)} » supprimée.`;
  } else {
    if (original.note.trim() !== '') {
      question = `Supprimer l’évaluation « ${original.libelle.trim() || 'sans intitulé'} » et sa note ?`;
    }
    focus = idModifier({ sorte: 'element', id: cible.element });
    message = 'Évaluation supprimée.';
  }

  if (question && !window.confirm(question)) {
    return;
  }
  etat.semestres[numero] = supprimerBloc(semestre, cible);
  edition = null;
  afficher(focus);
  annoncer(message);
}

// Range la valeur d'un champ de l'éditeur dans le brouillon, et affiche son
// erreur éventuelle. Les moyennes ne bougent pas avant « Valider ».
function majBrouillon(champ) {
  const brouillon = edition.brouillon;
  const valeur = champ.value;
  // L'évaluation concernée : le brouillon lui-même (éditeur d'une évaluation),
  // ou l'une des évaluations du brouillon (éditeur d'une ligne).
  const evaluation = () =>
    edition.cible.sorte === 'evaluation'
      ? brouillon
      : brouillon.evaluations.find((candidate) => candidate.id === champ.dataset.evaluation);

  switch (champ.dataset.champ) {
    case 'ue-numero':
      brouillon.numero = Number(valeur);
      break;
    case 'ue-intitule':
      brouillon.intitule = valeur;
      break;
    case 'element-code':
      brouillon.code = valeur;
      break;
    case 'element-intitule':
      brouillon.intitule = valeur;
      break;
    case 'element-coef':
      brouillon.coefs[champ.dataset.ue] = valeur;
      break;
    case 'evaluation-libelle':
      evaluation().libelle = valeur;
      break;
    case 'evaluation-note':
      evaluation().note = valeur;
      break;
    case 'evaluation-coef':
      evaluation().coef = valeur;
      break;
    case 'malus':
      brouillon.malus = valeur;
      break;
    default:
      return;
  }
  const lire = LECTEURS[champ.dataset.champ];
  afficherErreurChamp(champ, lire ? lire(valeur).erreur : null);
}

/* ==================== Clavier et souris ==================== */

// Frappe dans un champ d'un éditeur : le brouillon suit.
zoneSemestre.addEventListener('input', (event) => {
  if (edition !== null && event.target.dataset.champ) {
    majBrouillon(event.target);
  }
});

// « Valider » (bouton, ou Entrée dans un champ).
zoneSemestre.addEventListener('submit', (event) => {
  event.preventDefault(); // rien n'est envoyé : la page reste où elle est
  if (edition !== null) {
    valider();
  }
});

// Échap dans un éditeur : comme « Annuler ».
zoneSemestre.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && edition !== null && event.target.closest('.editeur')) {
    event.preventDefault();
    annuler();
  }
});

// Boutons des vues et des éditeurs (attribut data-action).
zoneSemestre.addEventListener('click', (event) => {
  const bouton = event.target.closest('button[data-action]');
  if (!bouton) return;

  switch (bouton.dataset.action) {
    case 'modifier':
      ouvrir(JSON.parse(bouton.dataset.cible));
      break;
    case 'annuler':
      annuler();
      break;
    case 'supprimer-bloc':
      supprimerEnEdition();
      break;
    case 'ajouter-evaluation': {
      // Dans l'éditeur d'une ligne : une évaluation vide, dans le brouillon.
      const evaluation = creerEvaluation(nouvelId());
      edition.brouillon.evaluations.push(evaluation);
      afficher(idChamp.libelle(evaluation));
      annoncer('Évaluation ajoutée. Elle sera enregistrée à la validation.');
      break;
    }
    case 'retirer-evaluation': {
      // Dans l'éditeur d'une ligne : retirée du brouillon (« Annuler » la rend).
      const evaluations = edition.brouillon.evaluations;
      const index = evaluations.findIndex((evaluation) => evaluation.id === bouton.dataset.evaluation);
      evaluations.splice(index, 1);
      // Le focus va sur l'évaluation suivante, sinon sur « Ajouter une évaluation ».
      const suivante = evaluations[index] ?? evaluations[index - 1];
      afficher(suivante ? idChamp.libelle(suivante) : `${edition.brouillon.id}-ajouter-evaluation`);
      annoncer('Évaluation retirée. « Annuler » la remet.');
      break;
    }
  }
});

// « Créer les UE du semestre » : les UE par défaut, d'un coup.
boutonCreerUes.addEventListener('click', () => {
  if (!fermerEdition()) return;
  const semestre = semestreActif();
  for (const numeroUe of numerosUeParDefaut(etat.semestreActif)) {
    semestre.ues.push(creerUe(nouvelId(), numeroUe));
  }
  afficher(idModifier({ sorte: 'ue', id: semestre.ues[0].id }));
  annoncer(`${semestre.ues.length} UE créées.`);
});

// « Ajouter une UE », « Ajouter une ressource », « Ajouter une SAE… ».
boutonAjouterUe.addEventListener('click', () => ouvrirNouveau('ue'));
for (const bouton of boutonsAjouterLigne) {
  bouton.addEventListener('click', () => ouvrirNouveau(bouton.dataset.type));
}

// Cible de la note à viser (commune à tous les semestres) : un réglage, pas
// une donnée de la saisie. Les notes à viser se mettent à jour pendant la frappe.
champCible.addEventListener('input', () => {
  etat.cible = champCible.value;
  afficherErreurChamp(champCible, lireCible(champCible.value).erreur);
  afficher();
});

/* ==================== Import des PDF ==================== */

// Les deux imports : leur bouton, leur sélecteur de fichier, leur analyseur
// (import-*.js) et leur remplissage (remplissage.js).
const IMPORTS = {
  coefficients: {
    bouton: document.getElementById('btn-import-coefficients'),
    fichier: document.getElementById('fichier-coefficients'),
    analyser: importerCoefficients,
    preparer: preparerImportCoefficients,
    titre: 'Tableau des coefficients importé',
  },
  releve: {
    bouton: document.getElementById('btn-import-releve'),
    fichier: document.getElementById('fichier-releve'),
    analyser: importerNotes,
    preparer: preparerImportReleve,
    titre: 'Relevé de notes importé',
  },
};

// L'onglet d'un semestre (1 à 6).
const ongletDu = (numero) => onglets.find((onglet) => Number(onglet.dataset.semestre) === numero);

/**
 * Importe un PDF : lecture, analyse, proposition de remplissage, confirmation
 * si une saisie serait remplacée, puis application.
 * Tant que la proposition n'est pas appliquée (étape 5), la saisie ne change
 * pas : une erreur ou une annulation ne laisse rien à moitié rempli.
 *
 * @param {'coefficients'|'releve'} sorte
 * @param {File} fichier
 */
async function importerFichier(sorte, fichier) {
  const { analyser, preparer, titre } = IMPORTS[sorte];
  // L'éditeur ouvert est fermé d'abord (après confirmation s'il a des modifications).
  if (!fermerEdition()) {
    afficherMessageImport('Import annulé', 'Valide ou annule d’abord la modification en cours.');
    return;
  }
  patienter(true);
  try {
    // 1. Lecture du PDF. pdf.js n'est chargé qu'ici, au premier import.
    const { lirePdf } = await import('./lecture-pdf.js');
    const elements = await lirePdf(fichier);

    // 2. Analyse, puis proposition de remplissage (fonctions pures et testées).
    const proposition = preparer(etat.semestres, analyser(elements), nouvelId);
    const numeros = Object.keys(proposition.semestres).map(Number);

    // 3. Aucun semestre compris (mauvais PDF ?) : seulement le rapport.
    if (numeros.length === 0) {
      afficherRapport('Rien n’a pu être importé', proposition.rapport, numeros);
      return;
    }

    // 4. Rien n'est écrasé en silence : on demande avant de remplacer une saisie.
    if (proposition.remplaces.length > 0 && !window.confirm(messageConfirmation(proposition.remplaces))) {
      afficherMessageImport('Import annulé', 'Rien n’a été modifié.');
      return;
    }

    // 5. On applique la proposition, et on garde les moyennes officielles.
    Object.assign(etat.semestres, proposition.semestres);
    if (proposition.officiels) {
      Object.assign(etat.officiels.ues, proposition.officiels.ues);
      Object.assign(etat.officiels.competences, proposition.officiels.competences);
    }

    // 6. On montre le premier semestre importé (sauf si on y est déjà), puis le rapport.
    if (numeros.includes(etat.semestreActif)) {
      afficher();
    } else {
      choisirSemestre(ongletDu(numeros[0]), false);
    }
    afficherRapport(titre, proposition.rapport, numeros);
  } catch (erreur) {
    // ErreurLecturePdf : un message prévu pour toi. Autre erreur : un message
    // général. Rien n'est journalisé : l'erreur pourrait citer le PDF.
    const message =
      erreur?.name === 'ErreurLecturePdf' ? erreur.message : 'Ce PDF n’a pas pu être lu. Rien n’a été modifié.';
    afficherMessageImport('Import impossible', message);
  } finally {
    patienter(false);
  }
}

// Pendant la lecture : boutons désactivés et message d'attente (lu par les
// lecteurs d'écran grâce à role="status").
function patienter(oui) {
  for (const { bouton } of Object.values(IMPORTS)) {
    bouton.disabled = oui;
  }
  sectionImport.setAttribute('aria-busy', String(oui));
  etatImport.textContent = oui ? 'Lecture du PDF en cours…' : '';
}

// Affiche le rapport d'un import : compris, à compléter, à vérifier, écarté.
function afficherRapport(titre, rapport, numeros) {
  const blocs = [creer('h3', 'rapport__titre', titre)];
  if (numeros.length > 0) {
    const remplis = numeros.map((n) => `S${n}`).join(', ');
    blocs.push(
      creer('p', null, `${numeros.length === 1 ? 'Semestre rempli' : 'Semestres remplis'} : ${remplis}. Tout reste modifiable.`),
    );
  }
  blocs.push(
    partieRapport('Compris', rapport.compris.map((texte) => creer('li', null, texte)), 'compris'),
    partieRapport('Coefficients à compléter', rapport.aCompleter.map(itemACompleter), 'completer'),
    partieRapport('Pas compris ou à vérifier', rapport.aVerifier.map((texte) => creer('li', null, texte)), 'verifier'),
  );

  // Ce qui a été écarté exprès (en-tête personnel, lignes SENSE…) : replié.
  if (rapport.ignores.length > 0) {
    const details = creer('details', 'rapport__ecarte');
    details.append(
      creer('summary', null, `Écarté volontairement (${rapport.ignores.length})`),
      creer('ul'),
    );
    details.querySelector('ul').append(...rapport.ignores.map((texte) => creer('li', null, texte)));
    blocs.push(details);
  }
  montrerRapport(blocs);
}

// Un message court à la place du rapport (import annulé ou impossible).
function afficherMessageImport(titre, message) {
  montrerRapport([creer('h3', 'rapport__titre', titre), creer('p', null, message)]);
}

// Une partie du rapport : un titre et une liste. Rien si la liste est vide.
function partieRapport(titre, items, sorte) {
  if (items.length === 0) {
    return null;
  }
  const partie = creer('section', `rapport__partie rapport__partie--${sorte}`);
  const liste = creer('ul');
  liste.append(...items);
  partie.append(creer('h4', null, `${titre} (${items.length})`), liste);
  return partie;
}

// Un champ à compléter : un lien qui ouvre le bon semestre et y place le curseur.
function itemACompleter({ texte, cible }) {
  const item = creer('li');
  const lien = creer('a', null, texte);
  lien.href = `#${idDuChamp(cible)}`;
  lien.addEventListener('click', (event) => {
    event.preventDefault();
    allerAuChamp(cible);
  });
  item.append(lien);
  return item;
}

// Identifiant du champ visé, dans l'éditeur de son bloc (voir idChamp, edition.js).
function idDuChamp(cible) {
  if (cible.champ === 'evaluation-coef') {
    return idChamp.coefEvaluation({ id: cible.evaluation });
  }
  // Coefficient d'une ligne : sa première case d'UE (ou son code, sans UE).
  return cible.ue ? idChamp.coef({ id: cible.element }, { id: cible.ue }) : idChamp.code({ id: cible.element });
}

// Ouvre le semestre du champ, puis l'éditeur de son bloc, avec le curseur dans le champ.
function allerAuChamp(cible) {
  if (cible.semestre !== etat.semestreActif) {
    if (!fermerEdition()) return;
    choisirSemestre(ongletDu(cible.semestre), false);
  }
  // Un coefficient d'évaluation s'édite dans l'éditeur de l'évaluation ;
  // un coefficient de ligne, dans celui de la ligne.
  const bloc =
    cible.champ === 'evaluation-coef'
      ? { sorte: 'evaluation', element: cible.element, id: cible.evaluation }
      : { sorte: 'element', id: cible.element };
  if (brouillonDe(semestreActif(), bloc) === null) {
    annoncer('Ce champ n’existe plus : la ligne a été supprimée.');
    return;
  }
  ouvrir(bloc, { focus: idDuChamp(cible) });
}

// Affiche le rapport, avec un bouton pour le fermer, et lui donne le focus :
// le lecteur d'écran lit son titre.
function montrerRapport(blocs) {
  const fermer = creer('button', 'btn btn--secondary btn--sm', 'Fermer le rapport');
  fermer.type = 'button';
  fermer.addEventListener('click', () => {
    rapportImport.hidden = true;
    rapportImport.replaceChildren();
    // (Le bouton des coefficients est dans le menu « Avancé », souvent replié.)
    IMPORTS.releve.bouton.focus();
  });
  blocs[0].id = 'titre-rapport';
  rapportImport.replaceChildren(...blocs.filter(Boolean), fermer);
  rapportImport.hidden = false;
  rapportImport.focus();
}

for (const [sorte, { bouton, fichier }] of Object.entries(IMPORTS)) {
  // Le bouton ouvre le sélecteur de fichier, caché.
  bouton.addEventListener('click', () => fichier.click());
  fichier.addEventListener('change', () => {
    const choisi = fichier.files[0];
    // On vide le sélecteur : choisir à nouveau le même fichier relancera l'import.
    fichier.value = '';
    if (choisi) {
      importerFichier(sorte, choisi);
    }
  });
}

/* ==================== Choix du semestre (onglets accessibles) ==================== */
// Modèle « tabs » de l'ARIA : un seul onglet atteignable avec Tab, on passe
// de l'un à l'autre avec les flèches gauche/droite (et Début/Fin).

function choisirSemestre(onglet, focusSurOnglet) {
  // L'éditeur ouvert appartient au semestre affiché : on le ferme d'abord.
  if (!fermerEdition()) return;
  etat.semestreActif = Number(onglet.dataset.semestre);
  for (const autre of onglets) {
    const actif = autre === onglet;
    autre.setAttribute('aria-selected', String(actif));
    autre.tabIndex = actif ? 0 : -1;
  }
  zoneSemestre.setAttribute('aria-labelledby', onglet.id);
  if (focusSurOnglet) onglet.focus();
  afficher();
}

onglets.forEach((onglet, i) => {
  onglet.addEventListener('click', () => choisirSemestre(onglet, false));
  onglet.addEventListener('keydown', (event) => {
    const n = onglets.length;
    let cible = null;
    // Onglet suivant (on revient au premier après le dernier : modulo n).
    if (event.key === 'ArrowRight') cible = onglets[(i + 1) % n];
    // Onglet précédent (+ n pour ne jamais avoir d'indice négatif).
    if (event.key === 'ArrowLeft') cible = onglets[(i - 1 + n) % n];
    if (event.key === 'Home') cible = onglets[0];
    if (event.key === 'End') cible = onglets[n - 1];
    if (cible) {
      event.preventDefault();
      choisirSemestre(cible, true);
    }
  });
});

/* ==================== Choix de l'année et du parcours ==================== */
// Le choix crée les deux semestres de l'année à partir du référentiel, puis
// il est oublié : rien n'est stocké. (autocomplete="off" sur le formulaire :
// le navigateur ne le remet pas non plus après un rechargement.)

const formAnnee = document.getElementById('form-annee');
const choixAnnee = document.getElementById('choix-annee');
const choixParcours = document.getElementById('choix-parcours');
const etatAnnee = document.getElementById('annee-etat');

// Valeur cochée d'un groupe de boutons radio (« 2 », « DACS »), ou '' si aucune.
const valeurCochee = (nom) => formAnnee.elements[nom].value;

// Pas de choix de parcours en 1re année (tronc commun) : on le cache.
// Tant qu'aucune année n'est cochée, il reste visible.
function afficherChoixParcours() {
  const annee = Number(valeurCochee('annee'));
  choixParcours.hidden = annee !== 0 && parcoursDe(referentiel, annee).length <= 1;
}

// Affiche (ou efface) le message d'erreur d'un groupe de choix.
function signalerChoix(groupe, message) {
  groupe.querySelector('.field-error').textContent = message ?? '';
  groupe.classList.toggle('choix--erreur', Boolean(message));
}

formAnnee.addEventListener('change', (event) => {
  if (event.target.name === 'annee') {
    afficherChoixParcours();
  }
  signalerChoix(event.target.closest('.choix'), null);
});

formAnnee.addEventListener('submit', (event) => {
  // Rien n'est envoyé : on empêche le navigateur de « soumettre » le formulaire.
  event.preventDefault();

  // 1. L'année, puis le parcours (le seul proposé en 1re année : « commun »).
  const annee = Number(valeurCochee('annee'));
  if (!annee) {
    signalerChoix(choixAnnee, 'Choisis ton année.');
    choixAnnee.querySelector('input').focus();
    return;
  }
  const proposes = parcoursDe(referentiel, annee);
  const parcours = proposes.length === 1 ? proposes[0] : valeurCochee('parcours');
  if (!proposes.includes(parcours)) {
    signalerChoix(choixParcours, 'Choisis ton parcours.');
    choixParcours.querySelector('input').focus();
    return;
  }

  // 2. Les semestres de l'année ont déjà une saisie : on demande avant de la
  //    remplacer (et l'éditeur ouvert est fermé d'abord).
  if (!fermerEdition()) return;
  const numeros = semestresDe(annee);
  const actuels = Object.fromEntries(numeros.map((numero) => [numero, etat.semestres[numero]]));
  if (
    contientDesDonnees(actuels) &&
    !window.confirm(
      `Remplacer tout ce qui est saisi en S${numeros[0]} et S${numeros[1]} (notes comprises) par les semestres officiels de la ${nomAnnee(annee)} année ?`,
    )
  ) {
    return;
  }

  // 3. On crée les semestres (fonction pure et testée, voir choix-annee.js).
  //    Les moyennes officielles de ces semestres venaient d'un ancien relevé :
  //    on les oublie.
  const semestres = creerSemestresAnnee(referentiel, annee, parcours, nouvelId);
  Object.assign(etat.semestres, semestres);
  for (const numero of numeros) {
    delete etat.officiels.ues[numero];
  }
  delete etat.officiels.competences[numeros[0]];

  // 4. On montre le premier semestre de l'année, et on dit ce qui a été créé
  //    (zone role="status" : lue par les lecteurs d'écran).
  choisirSemestre(ongletDu(numeros[0]), false);
  const nom = parcours === 'commun' ? `${nomAnnee(annee)} année` : `${nomAnnee(annee)} année, parcours ${parcours}`;
  etatAnnee.textContent =
    `${nom} : S${numeros[0]} et S${numeros[1]} créés, avec leurs UE, leurs ressources, leurs SAE et leurs coefficients officiels. ` +
    'Importe ton relevé ou saisis tes notes.';
});

afficherChoixParcours();

/* ==================== Avant de fermer l'onglet ==================== */
// Rien n'est enregistré : si une saisie est en cours, le navigateur demande
// confirmation avant de fermer ou de recharger la page.
window.addEventListener('beforeunload', (event) => {
  if (contientDesDonnees(etat.semestres)) {
    event.preventDefault();
    event.returnValue = ''; // pour les navigateurs plus anciens
  }
});

/* ==================== Démarrage ==================== */
afficher();

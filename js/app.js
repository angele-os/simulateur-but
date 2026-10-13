// Interface du simulateur : relie la page (index.html) au modèle (modele.js).
// Ce fichier ne fait AUCUN calcul de moyenne : il lit les champs, met à jour
// l'état de la saisie, appelle modele.js, puis affiche les résultats.
//
// Sécurité : jamais d'innerHTML. Tout texte (surtout ce que l'utilisateur a
// saisi) est inséré avec textContent, qui l'affiche tel quel.
// Données : rien n'est stocké ni envoyé. Tout vit dans la variable « etat »
// et disparaît quand on ferme l'onglet.

import {
  NUMEROS_UE,
  creerSemestre,
  creerUe,
  creerElement,
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
  numerosEnDouble,
  contientDesDonnees,
  formaterMoyenne,
  formaterNoteAViser,
  comparerOfficiel,
} from './modele.js';
import { importerCoefficients } from './import-coefficients.js';
import { importerNotes } from './import-notes.js';
import { preparerImportCoefficients, preparerImportReleve, messageConfirmation } from './remplissage.js';
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

// Identifiants uniques : ils relient chaque champ à sa donnée et à son libellé.
let compteurId = 0;
const nouvelId = () => `id${++compteurId}`;

// Cartes de ressource ou de SAE repliées par l'utilisateur (les autres sont dépliées).
const cartesRepliees = new Set();

const semestreActif = () => etat.semestres[etat.semestreActif];

const NOMS = {
  ressource: { court: 'ressource', sansNom: 'Ressource sans code' },
  sae: { court: 'partie SAE', sansNom: 'SAE sans code' },
};

// Lecture de chaque champ numérique : elle donne aussi le message d'erreur.
const LECTEURS = {
  malus: lireMalus,
  'element-coef': lireCoefUe,
  'evaluation-note': lireNote,
  'evaluation-coef': lireCoefEvaluation,
};

/* ==================== Éléments fixes de la page ==================== */

const onglets = [...document.querySelectorAll('[role="tab"]')];
const saisie = document.getElementById('saisie');
const titreSaisie = document.getElementById('titre-saisie');
const listeUes = document.getElementById('liste-ues');
const uesVide = document.getElementById('ues-vide');
const boutonCreerUes = document.getElementById('btn-creer-ues');
const boutonAjouterUe = document.getElementById('btn-ajouter-ue');
const listes = {
  ressource: document.getElementById('liste-ressource'),
  sae: document.getElementById('liste-sae'),
};
const champMalus = document.getElementById('malus');
const champCible = document.getElementById('cible');
const titreResultats = document.getElementById('titre-resultats');
const contenuResultats = document.getElementById('resultats-contenu');
const zoneAnnonce = document.getElementById('annonce');
const sectionImport = document.getElementById('import');
const etatImport = document.getElementById('import-etat');
const rapportImport = document.getElementById('rapport-import');

// Zones mises à jour en direct dans la saisie, remplies à chaque affichage :
// id d'évaluation → { sortie, evaluation } ; id de ligne → zone de sa moyenne.
const sortiesAViser = new Map();
const sortiesMoyenne = new Map();

/* ==================== Petits utilitaires ==================== */

// Crée un élément avec une classe et un texte (toujours via textContent).
function creer(balise, classe, texte) {
  const element = document.createElement(balise);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  return element;
}

// Recopie le contenu d'un <template> de index.html.
function cloner(idModele) {
  return document.getElementById(idModele).content.firstElementChild.cloneNode(true);
}

// Zone role="status" : ce qu'on y écrit est lu par les lecteurs d'écran.
function annoncer(message) {
  // On vide puis on réécrit un peu plus tard : sinon un même message ne serait pas relu.
  zoneAnnonce.textContent = '';
  setTimeout(() => {
    zoneAnnonce.textContent = message;
  }, 60);
}

/**
 * Prépare un champ d'un modèle : identifiant, libellé relié (for), zone
 * d'erreur reliée (aria-describedby) et valeur.
 */
function preparerChamp(field, id, valeur) {
  const champ = field.querySelector('input, select');
  const erreur = field.querySelector('.field-error');
  champ.id = id;
  field.querySelector('label').htmlFor = id;
  erreur.id = `${id}-error`;
  champ.setAttribute('aria-describedby', erreur.id);
  champ.value = valeur;
  return champ;
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

// Titre d'une carte : « R3.01 — Développement », ou un texte par défaut.
function titreElement(element) {
  const code = element.code.trim() || NOMS[element.type].sansNom;
  const intitule = element.intitule.trim();
  return intitule ? `${code} — ${intitule}` : code;
}

// Retrouve la donnée liée à un champ ou un bouton, grâce aux attributs data-* des lignes.
function trouverUe(noeud) {
  const id = noeud.closest('[data-ue-id]').dataset.ueId;
  return semestreActif().ues.find((ue) => ue.id === id);
}

function trouverElement(noeud) {
  const id = noeud.closest('[data-element-id]').dataset.elementId;
  return semestreActif().elements.find((element) => element.id === id);
}

function trouverEvaluation(noeud) {
  const id = noeud.closest('[data-evaluation-id]').dataset.evaluationId;
  return trouverElement(noeud).evaluations.find((evaluation) => evaluation.id === id);
}

/* ==================== Affichage de la saisie ==================== */

/**
 * Reconstruit toute la saisie du semestre actif, puis les résultats.
 * On l'appelle après un changement de STRUCTURE (ajout, suppression,
 * changement de semestre). Pendant la frappe, seuls les résultats sont
 * recalculés : les champs ne sont pas recréés et gardent le focus.
 *
 * @param {string} [idAFocaliser] champ ou bouton qui reçoit le focus ensuite
 */
function afficherSaisie(idAFocaliser) {
  const numero = etat.semestreActif;
  const semestre = semestreActif();
  titreSaisie.textContent = `Saisie du semestre ${numero}`;

  // 1. Les UE, avec les numéros en double signalés.
  const doubles = numerosEnDouble(semestre);
  listeUes.replaceChildren(...semestre.ues.map((ue, i) => creerLigneUe(ue, i, doubles)));
  uesVide.hidden = semestre.ues.length > 0;
  boutonCreerUes.hidden = semestre.ues.length > 0;
  boutonCreerUes.textContent =
    numero >= 5
      ? `Créer les UE ${numero}.1, ${numero}.3 et ${numero}.6 (parcours DACS)`
      : `Créer les 6 UE (UE${numero}.1 à UE${numero}.6)`;
  // Au plus une UE par numéro (6 en tout).
  boutonAjouterUe.disabled = semestre.ues.length >= NUMEROS_UE.length;

  // 2. Les ressources, puis les parties du pôle SAE.
  sortiesAViser.clear();
  sortiesMoyenne.clear();
  for (const type of ['ressource', 'sae']) {
    const lignes = semestre.elements.filter((element) => element.type === type);
    listes[type].replaceChildren(...lignes.map((element, i) => creerCarte(element, i)));
  }

  // 3. Le malus.
  champMalus.value = semestre.malus;
  afficherErreurChamp(champMalus, lireMalus(semestre.malus).erreur);

  // 4. Résultats, puis focus (après : l'élément doit exister dans la page).
  afficherResultats();
  donnerFocus(idAFocaliser);
}

// Donne le focus à un élément. S'il est dans une carte repliée, on la déplie
// d'abord : un champ caché ne peut pas recevoir le focus.
function donnerFocus(id) {
  const cible = id ? document.getElementById(id) : null;
  if (!cible) return;
  const carte = cible.closest('details');
  if (carte && !carte.open) {
    carte.open = true;
    cartesRepliees.delete(cible.closest('[data-element-id]').dataset.elementId);
  }
  cible.focus();
}

// Une ligne d'UE : numéro (liste), intitulé, bouton supprimer.
function creerLigneUe(ue, index, doubles) {
  const ligne = cloner('modele-ue');
  ligne.dataset.ueId = ue.id;
  const [champNumero, champIntitule] = ligne.querySelectorAll('.field');

  // 1. La liste des numéros, affichés comme des codes (UE3.1, UE3.2…).
  const liste = preparerChamp(champNumero, `${ue.id}-numero`, '');
  liste.replaceChildren(
    ...NUMEROS_UE.map((numero) => {
      const option = creer('option', null, codeUe(etat.semestreActif, numero));
      option.value = String(numero);
      return option;
    }),
  );
  liste.value = String(ue.numero);
  if (doubles.has(ue.numero)) {
    afficherErreurChamp(liste, 'Ce numéro est déjà utilisé par une autre UE.');
  }

  // 2. L'intitulé.
  preparerChamp(champIntitule, `${ue.id}-intitule`, ue.intitule);

  // 3. Textes lus par les lecteurs d'écran, pour savoir de quelle UE on parle.
  for (const precision of ligne.querySelectorAll('.js-pour')) {
    precision.textContent = ` (UE de la ligne ${index + 1})`;
  }
  ligne.querySelector('.js-supprimer').textContent = `Supprimer ${codeUe(etat.semestreActif, ue.numero)}`;
  return ligne;
}

// Une carte de ressource ou de partie SAE : code, intitulé, coefficients, évaluations.
function creerCarte(element, index) {
  const carte = cloner('modele-element');
  carte.dataset.elementId = element.id;
  const nom = `${NOMS[element.type].court} ${index + 1}`; // « ressource 2 »

  // 1. Dépliée, sauf si l'utilisateur l'a repliée.
  carte.querySelector('details').open = !cartesRepliees.has(element.id);

  // 2. Résumé : titre et moyenne (la moyenne est remplie par afficherResultats).
  carte.querySelector('.js-titre').textContent = titreElement(element);
  sortiesMoyenne.set(element.id, carte.querySelector('.js-moyenne'));

  // 3. Code et intitulé.
  const [champCode, champIntitule] = carte.querySelectorAll('.element__entete .field');
  const code = preparerChamp(champCode, `${element.id}-code`, element.code);
  code.placeholder = element.type === 'ressource' ? 'ex. R3.01' : 'ex. S3.01';
  preparerChamp(champIntitule, `${element.id}-intitule`, element.intitule);

  // 4. Une case de coefficient par UE du semestre.
  const ues = semestreActif().ues;
  const grille = carte.querySelector('.js-coefs');
  if (ues.length === 0) {
    grille.replaceChildren(creer('p', 'hint', 'Ajoute d’abord les UE du semestre.'));
  } else {
    grille.replaceChildren(...ues.map((ue) => creerCaseCoef(element, ue, nom)));
  }

  // 5. Les évaluations.
  carte
    .querySelector('.js-evaluations')
    .replaceChildren(...element.evaluations.map((evaluation, i) => creerLigneEvaluation(evaluation, i, nom)));

  // 6. Boutons et précisions pour les lecteurs d'écran.
  carte.querySelector('[data-action="ajouter-evaluation"]').id = `${element.id}-ajouter`;
  carte.querySelector('.js-supprimer-element').textContent = `Supprimer cette ${NOMS[element.type].court}`;
  for (const precision of carte.querySelectorAll('.js-pour')) {
    precision.textContent = ` (${nom})`;
  }
  return carte;
}

// La case « coefficient dans l'UE x » d'une ressource ou d'une partie SAE.
function creerCaseCoef(element, ue, nom) {
  const field = cloner('modele-coef');
  const code = codeUe(etat.semestreActif, ue.numero);
  field.querySelector('.js-ue').textContent = code;
  field.querySelector('.js-pour').textContent = ` : coefficient (${nom})`;
  const champ = preparerChamp(field, `${element.id}-coef-${ue.id}`, element.coefs[ue.id] ?? '');
  champ.dataset.coefUe = ue.id;
  afficherErreurChamp(champ, lireCoefUe(champ.value).erreur);
  return field;
}

// Une ligne d'évaluation : libellé, note, coef, supprimer, note à viser.
function creerLigneEvaluation(evaluation, index, nom) {
  const ligne = cloner('modele-evaluation');
  ligne.dataset.evaluationId = evaluation.id;
  const [champLibelle, champNote, champCoef] = ligne.querySelectorAll('.field');

  preparerChamp(champLibelle, `${evaluation.id}-libelle`, evaluation.libelle);
  const note = preparerChamp(champNote, `${evaluation.id}-note`, evaluation.note);
  const coef = preparerChamp(champCoef, `${evaluation.id}-coef`, evaluation.coef);
  afficherErreurChamp(note, lireNote(evaluation.note).erreur);
  afficherErreurChamp(coef, lireCoefEvaluation(evaluation.coef).erreur);

  for (const precision of ligne.querySelectorAll('.js-pour')) {
    precision.textContent = `, évaluation ${index + 1} (${nom})`;
  }
  ligne.querySelector('.js-supprimer').textContent = `Supprimer l’évaluation ${index + 1} (${nom})`;
  sortiesAViser.set(evaluation.id, { sortie: ligne.querySelector('.js-a-viser'), evaluation });
  return ligne;
}

/* ==================== Affichage des résultats ==================== */

// Cible affichée simplement : 10 → « 10 », 12.5 → « 12,5 ».
const texteCible = (cible) => cible.toLocaleString('fr-FR');

/**
 * Recalcule et affiche tous les résultats du semestre actif. Appelée à
 * chaque frappe : elle ne touche pas aux champs de la saisie.
 */
function afficherResultats() {
  const numero = etat.semestreActif;
  const analyse = analyserSemestre(semestreActif(), numero, etat.cible);
  titreResultats.textContent = `Résultats du semestre ${numero}`;

  // 1. Moyenne de chaque ligne, dans le résumé de sa carte.
  for (const ligne of analyse.elements) {
    const sortie = sortiesMoyenne.get(ligne.id);
    if (sortie) {
      sortie.textContent = ligne.moyenne === null ? 'pas de note' : `moy. ${formaterMoyenne(ligne.moyenne)}`;
    }
  }

  // 2. Note à viser sous chaque évaluation non notée.
  for (const { sortie, evaluation } of sortiesAViser.values()) {
    const nonNotee = lireNote(evaluation.note).valeur === null;
    sortie.hidden = !nonNotee;
    if (nonNotee) {
      sortie.replaceChildren(...texteAViserEvaluation(analyse.aViserParEvaluation.get(evaluation.id), analyse.cible));
    }
  }

  // 3. Le panneau des résultats.
  contenuResultats.replaceChildren(...blocsResultats(analyse, numero));
}

// Texte de la note à viser d'une évaluation, dans chaque UE où elle compte.
function texteAViserEvaluation(resultats, cible) {
  // 1. L'évaluation ne compte dans aucune UE (aucun coefficient sur sa ligne).
  if (!resultats || resultats.length === 0) {
    return [creer('span', null, 'Ne compte encore dans aucune UE : donne un coefficient à cette ligne.')];
  }
  // 2. Coefficient inconnu : rien à calculer.
  if (resultats[0].statut === 'coef-inconnu') {
    return [creer('span', null, 'Coefficient inconnu : saisis-le pour connaître la note à viser.')];
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

// Tous les blocs du panneau des résultats.
function blocsResultats(analyse, numero) {
  const blocs = [];
  if (analyse.ues.length === 0) {
    blocs.push(creer('p', 'vide-texte', 'Ajoute des UE et des notes : les résultats s’afficheront ici, en direct.'));
  }
  blocs.push(...analyse.ues.map((ue) => carteUe(ue, analyse, numero)));
  if (analyse.elements.length > 0) {
    blocs.push(carteMoyennesLignes(analyse.elements));
  }
  // Les compétences dépendent des DEUX semestres de l'année : on les montre
  // dès que l'un des deux a une UE (par exemple sur le S4 encore vide).
  const annee = competencesAnnee(etat.semestres, numero);
  if (annee.competences.length > 0) {
    blocs.push(carteCompetences(annee));
  }
  return blocs;
}

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

// Carte du résultat d'une UE.
function carteUe(ue, analyse, numero) {
  const carte = creer('article', 'card ue-resultat');
  const titreId = `resultat-${ue.id}`;
  carte.setAttribute('aria-labelledby', titreId);

  // 1. Titre et moyenne.
  const tete = creer('div', 'ue-resultat__tete');
  const titre = creer('h3', null, ue.code);
  titre.id = titreId;
  if (ue.intitule.trim()) {
    titre.append(creer('span', 'ue-resultat__intitule', ` — ${ue.intitule.trim()}`));
  }
  const moyenne =
    ue.moyenne === null
      ? creer('p', 'moyenne moyenne--vide', 'Pas encore de note')
      : creer('p', 'moyenne', formaterMoyenne(ue.moyenne));
  tete.append(titre, moyenne);
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

// Coefficients et poids : sans décimales inutiles (40 → « 40 », 7.5 → « 7,5 »).
const formaterPoids = (valeur) => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

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

// Tableau des moyennes de chaque ressource et partie SAE.
function carteMoyennesLignes(lignes) {
  const carte = creer('section', 'card');
  carte.setAttribute('aria-labelledby', 'titre-moyennes-lignes');
  const titre = creer('h3', null, 'Ressources et SAE');
  titre.id = 'titre-moyennes-lignes';

  const tableau = creer('table', 'data-table');
  const entete = creer('tr');
  for (const [texte, classe] of [['Ligne'], ['Type'], ['Moyenne', 'num']]) {
    const cellule = creer('th', classe, texte);
    cellule.scope = 'col';
    entete.append(cellule);
  }
  const corps = creer('tbody');
  for (const ligne of lignes) {
    const rangee = creer('tr');
    const nom = creer('th', null, titreElement(ligne));
    nom.scope = 'row';
    rangee.append(
      nom,
      creer('td', null, ligne.type === 'sae' ? 'SAE' : 'Ressource'),
      creer('td', 'num', formaterMoyenne(ligne.moyenne)),
    );
    corps.append(rangee);
  }
  const tete = creer('thead');
  tete.append(entete);
  tableau.append(tete, corps);
  carte.append(titre, tableau);
  return carte;
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

/* ==================== Saisie au clavier et à la souris ==================== */

// Frappe dans un champ : on met à jour l'état, l'erreur éventuelle, puis les résultats.
saisie.addEventListener('input', (event) => {
  const champ = event.target;
  const sorte = champ.dataset.champ;
  if (!sorte) return;
  const semestre = semestreActif();

  switch (sorte) {
    case 'malus':
      semestre.malus = champ.value;
      break;
    case 'ue-numero':
      // Le numéro change les codes affichés partout (UE3.1…) : on reconstruit la saisie.
      trouverUe(champ).numero = Number(champ.value);
      afficherSaisie(champ.id);
      return;
    case 'ue-intitule':
      trouverUe(champ).intitule = champ.value;
      break;
    case 'element-code':
    case 'element-intitule': {
      const element = trouverElement(champ);
      element[sorte === 'element-code' ? 'code' : 'intitule'] = champ.value;
      champ.closest('.element').querySelector('.js-titre').textContent = titreElement(element);
      break;
    }
    case 'element-coef':
      trouverElement(champ).coefs[champ.dataset.coefUe] = champ.value;
      break;
    case 'evaluation-libelle':
      trouverEvaluation(champ).libelle = champ.value;
      break;
    case 'evaluation-note':
      trouverEvaluation(champ).note = champ.value;
      break;
    case 'evaluation-coef':
      trouverEvaluation(champ).coef = champ.value;
      break;
  }

  const lire = LECTEURS[sorte];
  if (lire) {
    afficherErreurChamp(champ, lire(champ.value).erreur);
  }
  afficherResultats();
});

// Boutons : ajouter ou supprimer une UE, une ligne, une évaluation.
saisie.addEventListener('click', (event) => {
  const bouton = event.target.closest('button[data-action]');
  if (!bouton) return;
  const numero = etat.semestreActif;
  const semestre = semestreActif();

  switch (bouton.dataset.action) {
    case 'creer-ues': {
      for (const numeroUe of numerosUeParDefaut(numero)) {
        semestre.ues.push(creerUe(nouvelId(), numeroUe));
      }
      afficherSaisie(`${semestre.ues[0].id}-intitule`);
      annoncer(`${semestre.ues.length} UE créées.`);
      break;
    }

    case 'ajouter-ue': {
      // Premier numéro libre.
      const utilises = new Set(semestre.ues.map((ue) => ue.numero));
      const ue = creerUe(nouvelId(), NUMEROS_UE.find((n) => !utilises.has(n)));
      semestre.ues.push(ue);
      afficherSaisie(`${ue.id}-numero`);
      annoncer(`${codeUe(numero, ue.numero)} ajoutée.`);
      break;
    }

    case 'supprimer-ue': {
      const ue = trouverUe(bouton);
      const code = codeUe(numero, ue.numero);
      // On demande confirmation si des coefficients ont été saisis pour cette UE.
      const utilisee = semestre.elements.some((element) => (element.coefs[ue.id] ?? '').trim() !== '');
      if (utilisee && !window.confirm(`Supprimer ${code} et les coefficients saisis pour cette UE ?`)) {
        return;
      }
      semestre.ues = semestre.ues.filter((autre) => autre !== ue);
      for (const element of semestre.elements) {
        delete element.coefs[ue.id];
      }
      afficherSaisie('btn-ajouter-ue');
      annoncer(`${code} supprimée.`);
      break;
    }

    case 'ajouter-element': {
      const element = creerElement(nouvelId(), bouton.dataset.type);
      semestre.elements.push(element);
      afficherSaisie(`${element.id}-code`);
      annoncer(element.type === 'ressource' ? 'Ressource ajoutée.' : 'Partie SAE ajoutée.');
      break;
    }

    case 'supprimer-element': {
      const element = trouverElement(bouton);
      const nom = titreElement(element);
      if (element.evaluations.length > 0 && !window.confirm(`Supprimer « ${nom} » et ses évaluations ?`)) {
        return;
      }
      semestre.elements = semestre.elements.filter((autre) => autre !== element);
      cartesRepliees.delete(element.id);
      afficherSaisie(`btn-ajouter-${element.type}`);
      annoncer(`« ${nom} » supprimée.`);
      break;
    }

    case 'ajouter-evaluation': {
      const element = trouverElement(bouton);
      const evaluation = creerEvaluation(nouvelId());
      element.evaluations.push(evaluation);
      afficherSaisie(`${evaluation.id}-libelle`);
      annoncer('Évaluation ajoutée.');
      break;
    }

    case 'supprimer-evaluation': {
      const element = trouverElement(bouton);
      const evaluation = trouverEvaluation(bouton);
      const index = element.evaluations.indexOf(evaluation);
      element.evaluations.splice(index, 1);
      // Le focus va sur l'évaluation suivante, sinon sur le bouton « Ajouter ».
      const suivante = element.evaluations[index] ?? element.evaluations[index - 1];
      afficherSaisie(suivante ? `${suivante.id}-libelle` : `${element.id}-ajouter`);
      annoncer('Évaluation supprimée.');
      break;
    }
  }
});

// Carte repliée ou dépliée : on s'en souvient pour les prochains affichages.
// (« toggle » ne remonte pas jusqu'à #saisie : on l'écoute en phase de capture, avec true.)
saisie.addEventListener(
  'toggle',
  (event) => {
    const carte = event.target.closest('[data-element-id]');
    if (!carte) return;
    if (event.target.open) {
      cartesRepliees.delete(carte.dataset.elementId);
    } else {
      cartesRepliees.add(carte.dataset.elementId);
    }
  },
  true,
);

// Cible de la note à viser (commune à tous les semestres).
champCible.addEventListener('input', () => {
  etat.cible = champCible.value;
  afficherErreurChamp(champCible, lireCible(champCible.value).erreur);
  afficherResultats();
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
      afficherSaisie();
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

// Identifiant du champ visé (voir creerLigneEvaluation et creerCaseCoef).
function idDuChamp(cible) {
  if (cible.champ === 'evaluation-coef') {
    return `${cible.evaluation}-coef`;
  }
  // Coefficient d'une ligne : sa première case d'UE (ou son code, sans UE).
  return cible.ue ? `${cible.element}-coef-${cible.ue}` : `${cible.element}-code`;
}

// Ouvre le semestre du champ, puis lui donne le focus.
function allerAuChamp(cible) {
  if (cible.semestre !== etat.semestreActif) {
    choisirSemestre(ongletDu(cible.semestre), false);
  }
  const id = idDuChamp(cible);
  if (document.getElementById(id)) {
    donnerFocus(id);
  } else {
    annoncer('Ce champ n’existe plus : la ligne a été supprimée.');
  }
}

// Affiche le rapport, avec un bouton pour le fermer, et lui donne le focus :
// le lecteur d'écran lit son titre.
function montrerRapport(blocs) {
  const fermer = creer('button', 'btn btn--secondary btn--sm', 'Fermer le rapport');
  fermer.type = 'button';
  fermer.addEventListener('click', () => {
    rapportImport.hidden = true;
    rapportImport.replaceChildren();
    IMPORTS.coefficients.bouton.focus();
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

function choisirSemestre(onglet, donnerFocus) {
  etat.semestreActif = Number(onglet.dataset.semestre);
  for (const autre of onglets) {
    const actif = autre === onglet;
    autre.setAttribute('aria-selected', String(actif));
    autre.tabIndex = actif ? 0 : -1;
  }
  saisie.setAttribute('aria-labelledby', onglet.id);
  if (donnerFocus) onglet.focus();
  afficherSaisie();
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
afficherSaisie();

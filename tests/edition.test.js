// Tests de js/edition.js : brouillon d'un bloc, « Valider », « Annuler »,
// suppression. Toutes les données sont INVENTÉES.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { creerSemestre, creerUe, creerElement, creerEvaluation } from '../js/modele.js';
import {
  idChamp,
  brouillonDe,
  nouveauBloc,
  erreursBrouillon,
  estModifie,
  appliquerBrouillon,
  supprimerBloc,
} from '../js/edition.js';

function fabriqueIds() {
  let compteur = 0;
  return () => `n${++compteur}`;
}

// Un semestre inventé : deux UE, une ressource notée.
function semestreInvente() {
  const semestre = creerSemestre();
  semestre.malus = '0,05';
  semestre.ues.push({ ...creerUe('u1', 1), intitule: 'Réaliser' }, creerUe('u3', 3));
  semestre.elements.push({
    ...creerElement('e1', 'ressource'),
    code: 'R9.01',
    intitule: 'Ressource inventée',
    coefs: { u1: '20', u3: '10' },
    evaluations: [
      { ...creerEvaluation('v1'), libelle: 'Contrôle', note: '12', coef: '2' },
      { ...creerEvaluation('v2'), libelle: 'TP', note: '', coef: '1' },
    ],
  });
  return semestre;
}

describe('brouillon d’un bloc existant', () => {
  test('c’est une copie : la modifier ne change pas la saisie', () => {
    const semestre = semestreInvente();
    const brouillon = brouillonDe(semestre, { sorte: 'element', id: 'e1' });
    brouillon.evaluations[0].note = '20';
    brouillon.coefs.u1 = '99';
    assert.equal(semestre.elements[0].evaluations[0].note, '12');
    assert.equal(semestre.elements[0].coefs.u1, '20');
  });

  test('chaque sorte de bloc : UE, ligne, évaluation, malus ; null si le bloc n’existe plus', () => {
    const semestre = semestreInvente();
    assert.equal(brouillonDe(semestre, { sorte: 'ue', id: 'u1' }).intitule, 'Réaliser');
    assert.equal(brouillonDe(semestre, { sorte: 'element', id: 'e1' }).code, 'R9.01');
    assert.equal(brouillonDe(semestre, { sorte: 'evaluation', element: 'e1', id: 'v2' }).libelle, 'TP');
    assert.deepEqual(brouillonDe(semestre, { sorte: 'malus' }), { malus: '0,05' });
    assert.equal(brouillonDe(semestre, { sorte: 'element', id: 'absent' }), null);
  });
});

describe('« Valider »', () => {
  test('les erreurs bloquent la validation, avec l’identifiant du champ fautif', () => {
    const semestre = semestreInvente();
    const brouillon = brouillonDe(semestre, { sorte: 'element', id: 'e1' });
    brouillon.coefs.u3 = 'dix';
    brouillon.evaluations[0].note = '25';
    brouillon.evaluations[1].coef = '0';
    assert.deepEqual(
      erreursBrouillon(semestre, { sorte: 'element', id: 'e1' }, brouillon).map((e) => e.champ),
      [idChamp.coef(brouillon, { id: 'u3' }), 'v1-note', 'v2-coef'],
    );
  });

  test('cases vides : pas une erreur (note vide = pas encore notée, coef vide = inconnu)', () => {
    const semestre = semestreInvente();
    const brouillon = brouillonDe(semestre, { sorte: 'evaluation', element: 'e1', id: 'v1' });
    brouillon.note = '';
    brouillon.coef = '';
    assert.deepEqual(erreursBrouillon(semestre, { sorte: 'evaluation', element: 'e1', id: 'v1' }, brouillon), []);
  });

  test('UE : un numéro déjà pris par une autre UE est refusé', () => {
    const semestre = semestreInvente();
    const brouillon = { ...brouillonDe(semestre, { sorte: 'ue', id: 'u3' }), numero: 1 };
    assert.deepEqual(erreursBrouillon(semestre, { sorte: 'ue', id: 'u3' }, brouillon), [
      { champ: 'u3-numero', message: 'Ce numéro est déjà utilisé par une autre UE.' },
    ]);
  });

  test('malus invalide : refusé', () => {
    const semestre = semestreInvente();
    assert.equal(erreursBrouillon(semestre, { sorte: 'malus' }, { malus: '-1' })[0].champ, 'champ-malus');
  });

  test('le bloc est remplacé par son brouillon, sans toucher à la saisie reçue', () => {
    const semestre = semestreInvente();
    const copie = structuredClone(semestre);
    const cible = { sorte: 'evaluation', element: 'e1', id: 'v2' };
    const brouillon = { ...brouillonDe(semestre, cible), note: '15,5' };
    const apres = appliquerBrouillon(semestre, cible, brouillon);
    assert.equal(apres.elements[0].evaluations[1].note, '15,5');
    assert.deepEqual(semestre, copie);
  });

  test('UE renumérotée : les UE restent rangées par numéro', () => {
    const semestre = semestreInvente();
    const cible = { sorte: 'ue', id: 'u1' };
    const apres = appliquerBrouillon(semestre, cible, { ...brouillonDe(semestre, cible), numero: 5 });
    assert.deepEqual(apres.ues.map((ue) => [ue.id, ue.numero]), [['u3', 3], ['u1', 5]]);
  });

  test('malus validé', () => {
    assert.equal(appliquerBrouillon(semestreInvente(), { sorte: 'malus' }, { malus: '' }).malus, '');
  });
});

describe('blocs neufs (« Ajouter… ») et « Annuler »', () => {
  test('un bloc neuf n’entre dans la saisie qu’à la validation', () => {
    const semestre = semestreInvente();
    const { cible, brouillon } = nouveauBloc(semestre, 'sae', fabriqueIds());
    assert.equal(semestre.elements.length, 1); // « Annuler » : rien n'a changé
    brouillon.code = 'S9.01';
    const apres = appliquerBrouillon(semestre, cible, brouillon);
    assert.deepEqual(apres.elements.map((e) => [e.code, e.type]), [['R9.01', 'ressource'], ['S9.01', 'sae']]);
  });

  test('évaluation ajoutée dans l’éditeur de sa ligne : elle est validée avec la ligne', () => {
    const semestre = semestreInvente();
    const cible = { sorte: 'element', id: 'e1' };
    const brouillon = brouillonDe(semestre, cible);
    brouillon.evaluations.push({ ...creerEvaluation('v3'), libelle: 'Projet', note: '14', coef: '3' });
    const apres = appliquerBrouillon(semestre, cible, brouillon);
    assert.deepEqual(apres.elements[0].evaluations.map((e) => e.libelle), ['Contrôle', 'TP', 'Projet']);
  });

  test('nouvelle UE : le premier numéro libre ; plus de place après 6 UE', () => {
    const semestre = semestreInvente();
    assert.equal(nouveauBloc(semestre, 'ue', fabriqueIds()).brouillon.numero, 2);
    for (const numero of [2, 4, 5, 6]) {
      semestre.ues.push(creerUe(`u${numero}`, numero));
    }
    assert.equal(nouveauBloc(semestre, 'ue', fabriqueIds()), null);
  });

  test('estModifie : faux tant que rien n’a changé, vrai ensuite', () => {
    const semestre = semestreInvente();
    const cible = { sorte: 'element', id: 'e1' };
    const original = brouillonDe(semestre, cible);
    const brouillon = brouillonDe(semestre, cible);
    assert.equal(estModifie(original, brouillon), false);
    brouillon.evaluations[1].note = '9';
    assert.equal(estModifie(original, brouillon), true);
  });
});

describe('suppression', () => {
  test('supprimer une UE efface aussi ses coefficients dans chaque ligne', () => {
    const apres = supprimerBloc(semestreInvente(), { sorte: 'ue', id: 'u3' });
    assert.deepEqual(apres.ues.map((ue) => ue.id), ['u1']);
    assert.deepEqual(apres.elements[0].coefs, { u1: '20' });
  });

  test('supprimer une ligne, ou une évaluation', () => {
    assert.deepEqual(supprimerBloc(semestreInvente(), { sorte: 'element', id: 'e1' }).elements, []);
    const apres = supprimerBloc(semestreInvente(), { sorte: 'evaluation', element: 'e1', id: 'v1' });
    assert.deepEqual(apres.elements[0].evaluations.map((e) => e.id), ['v2']);
  });
});

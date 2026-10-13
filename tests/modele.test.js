// Tests de js/modele.js. Toutes les données sont INVENTÉES.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
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
  modeleUe,
  analyserSemestre,
  competencesAnnee,
  numerosEnDouble,
  contientDesDonnees,
  formaterMoyenne,
  formaterNoteAViser,
} from '../js/modele.js';

// Fabrique une évaluation saisie (les nombres sont des TEXTES, comme dans la page).
function ev(id, note, coef) {
  return { ...creerEvaluation(id), libelle: `Évaluation ${id}`, note, coef };
}

// Fabrique une ressource ou une partie SAE saisie.
function element(id, type, code, coefs, evaluations) {
  return { ...creerElement(id, type), code, intitule: `${code} inventée`, coefs, evaluations };
}

// Semestre 3 inventé, avec deux UE :
// - R3.01 compte dans UE3.1 (30) et UE3.2 (10) ; une note 12, une évaluation non notée (e2) ;
// - R3.02 compte dans UE3.1 (30) ; une note 16 ;
// - R3.03 compte dans UE3.2 (50) ; une évaluation non notée au coef inconnu (e5) ;
// - S3.01 (SAE) compte dans les deux UE (40) ; une note 14.
function semestre3(malus = '') {
  return {
    malus,
    ues: [creerUe('u1', 1), creerUe('u2', 2)],
    elements: [
      element('r1', 'ressource', 'R3.01', { u1: '30', u2: '10' }, [ev('e1', '12', '1'), ev('e2', '', '1')]),
      element('r2', 'ressource', 'R3.02', { u1: '30' }, [ev('e3', '16', '2')]),
      element('r3', 'ressource', 'R3.03', { u2: '50' }, [ev('e5', '', '')]),
      element('s1', 'sae', 'S3.01', { u1: '40', u2: '40' }, [ev('e4', '14', '1')]),
    ],
  };
}

describe('création', () => {
  test('numéros d’UE proposés : 1 à 6 en BUT1-2, 1, 3, 6 en BUT3', () => {
    assert.deepEqual(numerosUeParDefaut(1), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(numerosUeParDefaut(4), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(numerosUeParDefaut(5), [1, 3, 6]);
    assert.deepEqual(numerosUeParDefaut(6), [1, 3, 6]);
  });

  test('code d’une UE', () => {
    assert.equal(codeUe(3, 1), 'UE3.1');
  });

  test('un semestre vide', () => {
    assert.deepEqual(creerSemestre(), { malus: '', ues: [], elements: [] });
  });
});

describe('lecture des nombres saisis', () => {
  test('virgule ou point, espaces autour', () => {
    assert.deepEqual(lireNote('12,5'), { valeur: 12.5, erreur: null });
    assert.deepEqual(lireNote('12.5'), { valeur: 12.5, erreur: null });
    assert.deepEqual(lireNote(' 7 '), { valeur: 7, erreur: null });
  });

  test('case vide : pas une erreur, valeur par défaut selon le champ', () => {
    assert.deepEqual(lireNote(''), { valeur: null, erreur: null }); // pas encore notée
    assert.deepEqual(lireCoefEvaluation(''), { valeur: null, erreur: null }); // coef inconnu
    assert.deepEqual(lireCoefUe(''), { valeur: 0, erreur: null }); // ne compte pas dans l'UE
    assert.deepEqual(lireMalus(''), { valeur: 0, erreur: null });
    assert.deepEqual(lireCible(''), { valeur: 10, erreur: null });
  });

  test('texte qui n’est pas un nombre : erreur, et la valeur ne compte pas', () => {
    for (const texte of ['abc', '12,5,3', '-1', '1e3', ',5']) {
      assert.deepEqual(lireNote(texte), { valeur: null, erreur: 'Écris un nombre, par exemple 12,5.' }, texte);
    }
  });

  test('hors limites : erreur claire', () => {
    assert.deepEqual(lireNote('21'), { valeur: null, erreur: 'La note doit être entre 0 et 20.' });
    assert.equal(lireNote('20').erreur, null);
    assert.equal(lireNote('0').erreur, null);
    // Un coefficient d'évaluation à 0 n'a pas de sens : il doit être > 0.
    assert.equal(lireCoefEvaluation('0').erreur, 'Le coefficient doit être supérieur à 0 (et au plus 100).');
    // Dans une UE, 0 veut dire « ne compte pas » : c'est permis.
    assert.deepEqual(lireCoefUe('0'), { valeur: 0, erreur: null });
    assert.equal(lireMalus('25').erreur, 'Le malus doit être entre 0 et 20.');
    assert.equal(lireCible('20,5').erreur, 'La cible doit être entre 0 et 20.');
  });
});

describe('modeleUe', () => {
  test('construit l’UE pour calcul.js : poids = somme des coefficients de chaque pôle', () => {
    const semestre = semestre3();
    const modele = modeleUe(semestre, semestre.ues[1], 3);
    assert.equal(modele.code, 'UE3.2');
    // Pôle SAE : S3.01 (40). Pôle ressources : R3.01 (10) + R3.03 (50) = 60.
    assert.equal(modele.poleSae.poids, 40);
    assert.equal(modele.poleRessources.poids, 60);
    assert.deepEqual(
      modele.poleRessources.ressources.map((r) => [r.code, r.coef]),
      [
        ['R3.01', 10],
        ['R3.03', 50],
      ],
    );
  });

  test('une ligne sans coefficient dans une UE n’y compte pas', () => {
    const semestre = semestre3();
    const modele = modeleUe(semestre, semestre.ues[0], 3);
    assert.ok(!modele.poleRessources.ressources.some((r) => r.code === 'R3.03'));
  });

  test('les notes et coefs sont lus en nombres (vide → null)', () => {
    const semestre = semestre3();
    const r301 = modeleUe(semestre, semestre.ues[0], 3).poleRessources.ressources[0];
    assert.deepEqual(r301.evaluations, [
      { id: 'e1', libelle: 'Évaluation e1', note: 12, coef: 1 },
      { id: 'e2', libelle: 'Évaluation e2', note: null, coef: 1 },
    ]);
  });
});

describe('analyserSemestre', () => {
  test('moyennes des UE, des pôles et des ressources', () => {
    const analyse = analyserSemestre(semestre3(), 3, '');
    // UE3.1 : R3.01 = 12, R3.02 = 16 → pôle ressources = (12×30 + 16×30) / 60 = 14 ;
    //         pôle SAE = 14 ; UE = (40×14 + 60×14) / 100 = 14.
    // UE3.2 : R3.01 = 12, R3.03 sans note → pôle ressources = 12 ;
    //         UE = (40×14 + 60×12) / 100 = 12,8.
    assert.deepEqual(
      analyse.ues.map((ue) => [ue.code, ue.poleSae, ue.poleRessources, ue.moyenne, ue.provisoire]),
      [
        ['UE3.1', 14, 14, 14, false],
        ['UE3.2', 14, 12, 12.8, false],
      ],
    );
    assert.deepEqual(
      analyse.elements.map((e) => [e.code, e.moyenne]),
      [
        ['R3.01', 12],
        ['R3.02', 16],
        ['R3.03', null],
        ['S3.01', 14],
      ],
    );
  });

  test('le malus est retranché de chaque UE', () => {
    const analyse = analyserSemestre(semestre3('0,2'), 3, '');
    assert.equal(analyse.malus, 0.2);
    assert.deepEqual(
      analyse.ues.map((ue) => ue.moyenne),
      [13.8, 12.6],
    );
  });

  test('note à viser par évaluation, dans chaque UE où elle compte', () => {
    const analyse = analyserSemestre(semestre3(), 3, '15');
    const pourE2 = analyse.aViserParEvaluation.get('e2');
    assert.deepEqual(
      pourE2.map((r) => [r.ue, r.statut]),
      [
        ['UE3.1', 'possible'],
        ['UE3.2', 'possible'],
      ],
    );
    // UE3.1 : 5,6 + 0,3 × (R3.01 + 16) ≥ 15 → R3.01 ≥ 15,33 → n ≥ 18,67 environ.
    assert.ok(pourE2[0].note > 18.6 && pourE2[0].note <= 18.67, `${pourE2[0].note}`);
    // UE3.2 : 5,6 + 0,6 × R3.01 ≥ 15 → R3.01 ≥ 15,67 → n ≥ 19,33 environ.
    assert.ok(pourE2[1].note > 19.3 && pourE2[1].note <= 19.34, `${pourE2[1].note}`);
  });

  test('évaluation au coef inconnu : statut « coef-inconnu »', () => {
    const analyse = analyserSemestre(semestre3(), 3, '');
    assert.deepEqual(
      analyse.aViserParEvaluation.get('e5').map((r) => [r.ue, r.statut]),
      [['UE3.2', 'coef-inconnu']],
    );
  });

  test('une évaluation notée n’a pas de note à viser', () => {
    const analyse = analyserSemestre(semestre3(), 3, '');
    assert.equal(analyse.aViserParEvaluation.has('e1'), false);
  });

  test('évaluations restantes de l’UE (coef inconnu exclu) et note à viser commune', () => {
    const analyse = analyserSemestre(semestre3(), 3, '');
    assert.deepEqual(
      analyse.ues.map((ue) => [ue.restantes, ue.aViser.statut]),
      [
        // UE3.1, avec 0 à e2 : R3.01 = 6, pôle ressources = 11, UE = 5,6 + 6,6 = 12,2 ≥ 10.
        [1, 'deja-atteinte'],
        // UE3.2, avec 0 à e2 : R3.01 = 6, UE = 5,6 + 3,6 = 9,2 < 10.
        [1, 'possible'],
      ],
    );
    // UE3.2 : 5,6 + 0,6 × (12 + n) / 2 ≥ 10 → n ≥ 2,67 environ.
    const note = analyse.ues[1].aViser.note;
    assert.ok(note > 2.6 && note <= 2.67, `${note}`);
  });

  test('UE sans aucune ligne : pas de moyenne, provisoire, rien à viser', () => {
    const semestre = { ...creerSemestre(), ues: [creerUe('u1', 1)] };
    const [ue] = analyserSemestre(semestre, 1, '').ues;
    assert.equal(ue.moyenne, null);
    assert.equal(ue.provisoire, true);
    assert.equal(ue.restantes, 0);
    assert.equal(ue.aViser, null);
  });
});

describe('competencesAnnee', () => {
  // Semestres vides, sauf ceux qu'on remplit dans le test.
  function sixSemestres() {
    return { 1: creerSemestre(), 2: creerSemestre(), 3: creerSemestre(), 4: creerSemestre(), 5: creerSemestre(), 6: creerSemestre() };
  }

  test('Cn = moyenne des UE de numéro n des deux semestres de l’année', () => {
    const semestres = sixSemestres();
    semestres[3] = semestre3();
    // S4 : une seule UE (numéro 1), à 10.
    semestres[4] = {
      malus: '',
      ues: [creerUe('v1', 1)],
      elements: [element('r9', 'ressource', 'R4.01', { v1: '60' }, [ev('e9', '10', '1')])],
    };

    // Le résultat est le même qu'on soit sur le S3 ou sur le S4.
    for (const numero of [3, 4]) {
      const { semestres: annee, competences } = competencesAnnee(semestres, numero);
      assert.deepEqual(annee, [3, 4]);
      assert.deepEqual(competences, [
        // C1 = (UE3.1 + UE4.1) / 2 = (14 + 10) / 2 = 12
        { numero: 1, ues: ['UE3.1', 'UE4.1'], moyenne: 12, provisoire: false },
        // C2 : pas d'UE4.2, on prend UE3.2 seule → provisoire
        { numero: 2, ues: ['UE3.2', 'UE4.2'], moyenne: 12.8, provisoire: true },
      ]);
    }
  });

  test('aucune UE dans l’année : aucune compétence', () => {
    assert.deepEqual(competencesAnnee(sixSemestres(), 5), { semestres: [5, 6], competences: [] });
  });
});

describe('contrôles', () => {
  test('numéros d’UE en double', () => {
    const semestre = { ...creerSemestre(), ues: [creerUe('a', 1), creerUe('b', 2), creerUe('c', 1)] };
    assert.deepEqual([...numerosEnDouble(semestre)], [1]);
    assert.equal(numerosEnDouble(semestre3()).size, 0);
  });

  test('contientDesDonnees : faux au départ, vrai dès qu’on a saisi quelque chose', () => {
    const semestres = { 1: creerSemestre(), 2: creerSemestre() };
    assert.equal(contientDesDonnees(semestres), false);
    semestres[2].malus = '0,05';
    assert.equal(contientDesDonnees(semestres), true);
    semestres[2].malus = '';
    semestres[1].ues.push(creerUe('u1', 1));
    assert.equal(contientDesDonnees(semestres), true);
  });
});

describe('affichage des nombres', () => {
  test('moyenne : 2 ou 3 décimales, à la française', () => {
    assert.equal(formaterMoyenne(12.5), '12,50');
    assert.equal(formaterMoyenne(12.206), '12,206');
    assert.equal(formaterMoyenne(10), '10,00');
    assert.equal(formaterMoyenne(null), '—');
  });

  test('note à viser : arrondie au centième supérieur, pour qu’elle suffise toujours', () => {
    assert.equal(formaterNoteAViser(10.997), '11,00');
    assert.equal(formaterNoteAViser(12.341), '12,35');
    assert.equal(formaterNoteAViser(0), '0,00');
    // Piège : 1,1 × 100 = 110,00000000000001 pour l'ordinateur.
    assert.equal(formaterNoteAViser(1.1), '1,10');
  });
});

// Tests de js/calcul.js.
// Toutes les notes et tous les coefficients sont INVENTÉS.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  arrondiMillieme,
  moyenneEvaluations,
  poleRessources,
  poleSae,
  moyenneUe,
  moyenneCompetence,
  noteAViser,
} from '../js/calcul.js';

// Fabrique une évaluation inventée.
function ev(note, coef, libelle = 'Évaluation inventée') {
  return { libelle, note, coef };
}

// Fabrique une UE inventée de type S3 :
// - pôle SAE (poids 40) avec des évaluations directes ;
// - pôle ressources (poids 60) avec les ressources données.
function creerUe(evaluationsSae, ressources) {
  return {
    code: 'UE9.1',
    poleSae: { poids: 40, evaluations: evaluationsSae },
    poleRessources: { poids: 60, ressources },
  };
}

// Fabrique une ressource inventée.
function ressource(coef, evaluations, code = 'R9.01') {
  return { code, libelle: 'Ressource inventée', coef, evaluations };
}

describe('arrondiMillieme', () => {
  test('exemple de la doc : 12.2055 donne 12.206', () => {
    assert.equal(arrondiMillieme(12.2055), 12.206);
  });

  test('piège des flottants : 8.0025 donne 8.003', () => {
    // 8.0025 est stocké 8.00249999… : l'arrondi naïf se trompe.
    assert.equal(Math.round(8.0025 * 1000) / 1000, 8.002);
    assert.equal(arrondiMillieme(8.0025), 8.003);
  });

  test('piège sur un résultat de calcul : (14.007 + 10) / 2 donne 12.004', () => {
    // En maths, 12.0035. En JavaScript, 12.00349999…
    const moyenne = (14.007 + 10) / 2;
    assert.equal(Math.round(moyenne * 1000) / 1000, 12.003);
    assert.equal(arrondiMillieme(moyenne), 12.004);
  });

  test('sous la moitié, on arrondit vers le bas (la marge ne triche pas)', () => {
    assert.equal(arrondiMillieme(12.2054), 12.205);
    assert.equal(arrondiMillieme(12.20549), 12.205);
  });

  test('valeurs déjà rondes et négatives', () => {
    assert.equal(arrondiMillieme(15), 15);
    assert.equal(arrondiMillieme(0), 0);
    assert.equal(arrondiMillieme(-0.0001), 0);
    assert.equal(arrondiMillieme(-8.0025), -8.003);
  });
});

describe('moyenneEvaluations', () => {
  test('moyenne pondérée simple', () => {
    // (14 × 2 + 8 × 1) / 3 = 36 / 3 = 12
    assert.equal(moyenneEvaluations([ev(14, 2), ev(8, 1)]), 12);
  });

  test('le résultat est arrondi au millième', () => {
    // (10 + 11 + 11) / 3 = 10.6666… → 10.667
    assert.equal(moyenneEvaluations([ev(10, 1), ev(11, 1), ev(11, 1)]), 10.667);
  });

  test('piège d’arrondi dans une vraie moyenne', () => {
    // (14.007 + 10) / 2 = 12.0035 → 12.004
    assert.equal(moyenneEvaluations([ev(14.007, 1), ev(10, 1)]), 12.004);
  });

  test('une note vide ne compte pas', () => {
    assert.equal(moyenneEvaluations([ev(14, 2), ev(null, 3)]), 14);
  });

  test('un coef inconnu (null) ne compte pas', () => {
    assert.equal(moyenneEvaluations([ev(14, 2), ev(6, null)]), 14);
  });

  test('aucune note : pas de moyenne (null, pas 0)', () => {
    assert.equal(moyenneEvaluations([ev(null, 1), ev(null, 2)]), null);
    assert.equal(moyenneEvaluations([]), null);
  });
});

describe('poleRessources', () => {
  test('pondère les moyennes par les coefs du tableau, sans les ressources vides', () => {
    const pole = {
      poids: 60,
      ressources: [
        ressource(30, [ev(12, 1)], 'R9.01'),
        ressource(10, [ev(16, 1)], 'R9.02'),
        ressource(20, [ev(null, 1)], 'R9.03'), // pas encore notée : ignorée
      ],
    };
    // (12 × 30 + 16 × 10) / (30 + 10) = 520 / 40 = 13
    assert.equal(poleRessources(pole), 13);
  });
});

describe('poleSae', () => {
  test('S3 : moyenne des évaluations SAE de l’UE', () => {
    // (15 × 2 + 11 × 1) / 3 = 41 / 3 = 13.666… → 13.667
    assert.equal(poleSae({ poids: 40, evaluations: [ev(15, 2), ev(11, 1)] }), 13.667);
  });

  test('S4 et S6 : moyenne des parties, portfolio sans coef ignoré', () => {
    const pole = {
      poids: 50,
      parties: [
        { code: 'S9.01', libelle: 'SAE', coef: 30, evaluations: [ev(14, 1)] },
        { code: 'S9.PF', libelle: 'Portfolio', coef: 0, evaluations: [ev(18, 1)] },
        { code: 'S9.MP', libelle: 'Stage', coef: 10, evaluations: [ev(10, 1)] },
      ],
    };
    // (14 × 30 + 10 × 10) / 40 = 520 / 40 = 13 (le 18 du portfolio ne compte pas)
    assert.equal(poleSae(pole), 13);
  });
});

describe('moyenneUe', () => {
  // Pôle SAE à 15, pôle ressources à 10.
  const ueComplete = creerUe([ev(15, 1)], [ressource(1, [ev(10, 1)])]);

  test('combine les deux pôles avec leurs poids', () => {
    // (40 × 15 + 60 × 10) / 100 = 1200 / 100 = 12
    assert.deepEqual(moyenneUe(ueComplete), {
      moyenne: 12,
      provisoire: false,
      poleSae: 15,
      poleRessources: 10,
    });
  });

  test('retranche le malus du semestre', () => {
    // 12 − 0.05 = 11.95
    assert.equal(moyenneUe(ueComplete, 0.05).moyenne, 11.95);
  });

  test('un pôle sans note : UE provisoire, calculée avec l’autre pôle', () => {
    const ue = creerUe([ev(null, 1)], [ressource(1, [ev(10, 1)])]);
    assert.deepEqual(moyenneUe(ue), {
      moyenne: 10,
      provisoire: true,
      poleSae: null,
      poleRessources: 10,
    });
  });

  test('UE sans aucune note : pas de moyenne, et pas de malus', () => {
    const ue = creerUe([ev(null, 2)], [ressource(1, [ev(null, 1)])]);
    assert.deepEqual(moyenneUe(ue, 0.05), {
      moyenne: null,
      provisoire: true,
      poleSae: null,
      poleRessources: null,
    });
  });
});

describe('moyenneCompetence', () => {
  test('moyenne simple des deux UE de l’année', () => {
    // (12.5 + 13.25) / 2 = 12.875
    assert.deepEqual(
      moyenneCompetence({ moyenne: 12.5, provisoire: false }, { moyenne: 13.25, provisoire: false }),
      { moyenne: 12.875, provisoire: false },
    );
  });

  test('provisoire si l’une des UE est provisoire', () => {
    const resultat = moyenneCompetence(
      { moyenne: 12, provisoire: true },
      { moyenne: 14, provisoire: false },
    );
    assert.deepEqual(resultat, { moyenne: 13, provisoire: true });
  });

  test('une seule UE avec moyenne : on l’utilise, provisoire', () => {
    const resultat = moyenneCompetence(
      { moyenne: 11, provisoire: false },
      { moyenne: null, provisoire: true },
    );
    assert.deepEqual(resultat, { moyenne: 11, provisoire: true });
  });

  test('aucune moyenne', () => {
    const vide = { moyenne: null, provisoire: true };
    assert.deepEqual(moyenneCompetence(vide, vide), { moyenne: null, provisoire: true });
  });
});

describe('noteAViser', () => {
  // UE inventée : SAE = un 12 déjà noté + l'évaluation à viser (coef 1 chacune),
  // ressources = une seule ressource avec la note donnée.
  // Sans arrondi : UE = 0.4 × (12 + n) / 2 + 0.6 × noteRessource.
  function creerCas(noteRessource) {
    const aViser = ev(null, 1, 'Soutenance SAE - coef 1');
    const ue = creerUe([ev(12, 1), aViser], [ressource(1, [ev(noteRessource, 1)])]);
    return { ue, aViser };
  }

  test('cas général : note minimale, en tenant compte des arrondis', () => {
    const { ue, aViser } = creerCas(9);
    // Sans arrondi : 7.8 + 0.2 n ≥ 10, donc n ≥ 11.
    // Avec les arrondis officiels, 10.997 suffit déjà :
    //   pôle SAE = (12 + 10.997) / 2 = 11.4985 → 11.499
    //   UE = 0.4 × 11.499 + 5.4 = 9.9996 → 10.000
    // et 10.996 ne suffit pas :
    //   pôle SAE = 11.498 ; UE = 9.9992 → 9.999
    assert.deepEqual(noteAViser(ue, aViser), { statut: 'possible', note: 10.997, moyenne: 10 });
  });

  test('cible personnalisée', () => {
    const { ue, aViser } = creerCas(9);
    // 7.8 + 0.2 n ≥ 12, donc n ≥ 21 : impossible pour 12, mais possible pour 11.
    // Pour 11 : 0.2 n ≥ 3.2, donc n ≥ 16 (16 donne exactement 11).
    assert.equal(noteAViser(ue, aViser, 12).statut, 'impossible');
    assert.equal(noteAViser(ue, aViser, 11).statut, 'possible');
    assert.ok(noteAViser(ue, aViser, 11).note <= 16);
  });

  test('cible déjà atteinte, même avec 0', () => {
    const { ue, aViser } = creerCas(18);
    // Avec 0 : pôle SAE = 6 ; UE = 0.4 × 6 + 0.6 × 18 = 2.4 + 10.8 = 13.2
    assert.deepEqual(noteAViser(ue, aViser), { statut: 'deja-atteinte', note: 0, moyenne: 13.2 });
  });

  test('cible impossible, même avec 20', () => {
    const { ue, aViser } = creerCas(2);
    // Avec 20 : pôle SAE = 16 ; UE = 0.4 × 16 + 0.6 × 2 = 6.4 + 1.2 = 7.6
    assert.deepEqual(noteAViser(ue, aViser), { statut: 'impossible', note: null, moyenne: 7.6 });
  });

  test('plusieurs évaluations à passer : même note partout', () => {
    const premiere = ev(null, 1, 'Rapport - coef 1');
    const seconde = ev(null, 1, 'Démo - coef 1');
    const ue = creerUe([premiere, seconde], [ressource(1, [ev(9, 1)])]);
    // Sans arrondi : 0.4 n + 5.4 ≥ 10, donc n ≥ 11.5.
    // Avec les arrondis : 11.499 donne UE = 9.9996 → 10.000, et 11.498 donne 9.999.
    assert.deepEqual(noteAViser(ue, [premiere, seconde]), {
      statut: 'possible',
      note: 11.499,
      moyenne: 10,
    });
  });

  test('le malus augmente la note à viser', () => {
    const { ue, aViser } = creerCas(9);
    const sansMalus = noteAViser(ue, aViser).note;
    const avecMalus = noteAViser(ue, aViser, 10, 0.2).note;
    // Il faut 0.2 point d'UE en plus, soit environ 1 point de plus à l'évaluation.
    assert.ok(avecMalus > sansMalus);
    assert.equal(avecMalus, 11.997);
  });

  test('ne modifie pas l’UE reçue', () => {
    const { ue, aViser } = creerCas(9);
    noteAViser(ue, aViser);
    assert.equal(aViser.note, null);
  });

  test('coef inconnu : on ne peut rien viser', () => {
    const inconnue = ev(null, null, 'Oral - Coef ??');
    const ue = creerUe([ev(12, 1), inconnue], [ressource(1, [ev(9, 1)])]);
    assert.deepEqual(noteAViser(ue, inconnue), { statut: 'coef-inconnu', note: null, moyenne: null });
  });

  test('évaluation absente de l’UE : erreur claire', () => {
    const { ue } = creerCas(9);
    assert.throws(() => noteAViser(ue, ev(null, 1, 'Ailleurs')), /introuvable/);
  });
});

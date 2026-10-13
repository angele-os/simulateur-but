// Tests du référentiel des coefficients (data/referentiel.json), généré par
// scripts/generer-referentiel.mjs à partir des tableaux publics de l'IUT.
// Ils vérifient que chaque tableau a été lu sans erreur : si l'un d'eux
// échoue après une régénération, le référentiel ne doit pas être publié.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import referentielModule from '../data/referentiel.js';
import { cleCode } from '../js/remplissage.js';

const referentiel = JSON.parse(readFileSync(new URL('../data/referentiel.json', import.meta.url), 'utf8'));

// Tous les tableaux du référentiel : { annee, parcours, tableau }.
const tableaux = Object.entries(referentiel.annees).flatMap(([annee, parcours]) =>
  Object.entries(parcours).map(([nom, tableau]) => ({ annee: Number(annee), parcours: nom, tableau })),
);

// Somme des coefficients d'une liste de lignes dans une UE, arrondie au
// millième (pour ne pas être piégé par les flottants, comme 0,1 + 0,2).
function somme(lignes, codeUe) {
  const total = lignes.reduce((cumul, ligne) => cumul + (ligne.coefs[codeUe] ?? 0), 0);
  return Math.round(total * 1000) / 1000;
}

describe('référentiel des coefficients', () => {
  test('le module chargé par la page a exactement le même contenu que le JSON', () => {
    assert.deepEqual(referentielModule, referentiel);
  });

  test('en tête : la source et la date de génération', () => {
    assert.match(referentiel.source, /IUT de Metz/);
    assert.match(referentiel.genereLe, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(referentiel.generePar, 'scripts/generer-referentiel.mjs');
  });

  test('les années et les parcours attendus, avec leur document d’origine', () => {
    assert.deepEqual(
      tableaux.map(({ annee, parcours }) => `${annee} ${parcours}`),
      ['1 commun', '2 RA', '2 DACS', '3 RA', '3 DACS'],
    );
    for (const { tableau } of tableaux) {
      assert.match(tableau.document.fichier, /\.pdf$/);
      assert.match(tableau.document.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('chaque année a ses deux semestres (1 et 2, 3 et 4, 5 et 6)', () => {
    for (const { annee, parcours, tableau } of tableaux) {
      assert.deepEqual(
        tableau.semestres.map((s) => s.numero),
        [annee * 2 - 1, annee * 2],
        `${annee} ${parcours}`,
      );
    }
  });

  test('chaque UE totalise 100, et chaque pôle correspond à son total imprimé', () => {
    for (const { annee, parcours, tableau } of tableaux) {
      for (const semestre of tableau.semestres) {
        const sae = semestre.lignes.filter((ligne) => ligne.type === 'sae');
        const ressources = semestre.lignes.filter((ligne) => ligne.type === 'ressource');
        for (const ue of semestre.ues) {
          const ou = `${annee} ${parcours}, ${ue.code}`;
          assert.equal(somme(sae, ue.code), ue.totalSae, `${ou} : pôle SAE`);
          assert.equal(somme(ressources, ue.code), ue.totalRessources, `${ou} : pôle ressources`);
          assert.equal(somme(semestre.lignes, ue.code), 100, `${ou} : total de l’UE`);
        }
      }
    }
  });

  test('aucun code en double dans un semestre (alias compris)', () => {
    for (const { annee, parcours, tableau } of tableaux) {
      for (const semestre of tableau.semestres) {
        // Les clés des codes de chaque ligne : son code et ses alias. Un alias
        // qui a la même clé que son propre code (« SAE 5.A.01 » et
        // « SAE5.A.01 ») ne compte qu'une fois.
        const vues = new Map(); // clé → code de la ligne qui la porte
        for (const ligne of semestre.lignes) {
          for (const cle of new Set([ligne.code, ...ligne.alias].map(cleCode))) {
            assert.ok(!vues.has(cle), `${annee} ${parcours}, S${semestre.numero} : ${cle} porté par ${vues.get(cle)} et ${ligne.code}`);
            vues.set(cle, ligne.code);
          }
        }
      }
    }
  });

  test('chaque coefficient est rangé dans une UE du semestre, et chaque ligne a un intitulé', () => {
    for (const { annee, parcours, tableau } of tableaux) {
      for (const semestre of tableau.semestres) {
        const codesUe = new Set(semestre.ues.map((ue) => ue.code));
        for (const ligne of semestre.lignes) {
          const ou = `${annee} ${parcours}, ${ligne.code}`;
          assert.ok(['sae', 'ressource'].includes(ligne.type), ou);
          assert.ok(ligne.intitule.trim() !== '', `${ou} : intitulé vide`);
          // L'intitulé ne commence plus par un code (« R2.01Développement… »).
          assert.doesNotMatch(ligne.intitule, /^(R|S|SAE ?)\d\./, `${ou} : « ${ligne.intitule} »`);
          for (const [ue, coef] of Object.entries(ligne.coefs)) {
            assert.ok(codesUe.has(ue), `${ou} : UE ${ue} inconnue`);
            assert.ok(coef > 0, `${ou} : coefficient ${coef}`);
          }
        }
      }
    }
  });
});

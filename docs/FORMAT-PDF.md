# Format des PDF et règles de calcul

Ces règles ont été établies à partir des vrais documents de l'IUT de Metz (BUT Informatique) le 12/10/2026 :
- les tableaux de coefficients du BUT1, du BUT2 et du BUT3, en parcours A et B ;
- deux relevés « Détail des notes ».

Elles ont été **complétées le 13/10/2026**, après un test de l'app sur de vrais relevés : pages tournées, ressource sans évaluation détaillée, lignes doublées « FI », totaux préfixés en BUT3 DACS, messages inutiles du rapport, code de parcours collé à l'intitulé.

**Les vrais fichiers ne sont pas dans le dépôt**, car ils contiennent des données personnelles. Tous les nombres d'exemple ci-dessous sont **inventés**.

---

## 1. Lire un PDF

- **Ce sont des PDF texte, pas des scans.** `page.getTextContent()` de pdf.js suffit, sans OCR. Chaque élément donne :
  - son texte (`str`) ;
  - sa matrice `transform` = `[a, b, c, d, x, y]`, qui donne sa position et sa taille **dans le repère du fichier** ;
  - sa largeur (`width`), mesurée le long de la ligne.
- **Les pages peuvent être tournées : le relevé « Détail des notes » a une rotation de 90°.** pdf.js donne les positions **avant** la rotation. Lues telles quelles (`transform[4]`, `transform[5]`), x et y sont échangés : chaque titre de colonne se retrouve sur sa propre ligne, et **aucune ligne n'est trouvée**. Il faut calculer la position sur la page **affichée** :
  - `viewport = page.getViewport({ scale: 1 })` ;
  - `m = pdfjs.Util.transform(viewport.transform, element.transform)` ;
  - `x = m[4]`, `y = viewport.height - m[5]` (y reste compté depuis le bas), `taille = Math.hypot(m[2], m[3])`.

  C'est la fonction `positionAffichee` de `js/lecture-pdf.js`. La largeur (`width`) ne change pas avec la rotation. Exemple inventé : sur une page tournée de 90°, « Code » est en (95, 40) dans le fichier, mais s'affiche en (40, 500).
- **L'axe vertical part du bas de la page.** Pour lire de haut en bas, il faut trier par y **décroissant**.
- **Reconstituer les lignes** : on regroupe les éléments dont les y diffèrent de moins de 2 points, puis on les trie par x.
- **Ne jamais se fier au texte brut concaténé.** Les cases vides disparaissent et des champs se collent, comme `coef 3 103JXH2M02E1`, où la note 10 touche le code suivant. **Seules les positions sont fiables.**
- **Les documents font plusieurs pages.** Il faut enchaîner les lignes de toutes les pages.

---

## 2. Tableau des coefficients

### Mises en page rencontrées
| Document | Colonnes | Particularités |
|---|---|---|
| BUT1 | `Numéro SAE / Ressource` · `Intitulé` · `UE1.1 … UE1.6` | Le code est répété : `R1.01 R1.01 Initiation…` |
| BUT2 | Comme le BUT1, avec un bandeau « IUT concerné » | `R4.08 R4.B.08 Virtualisation` : le 2ᵉ code, plus précis, est celui du relevé |
| BUT3 | `Nature` · `Numéro` · `Intitulé` · `UE5.1 UE5.3 UE5.6` | Il y a une colonne Nature (`SAE`, `RSC`) et une ligne ECTS (`10 10 10`) **au-dessus** de l'en-tête. On trouve aussi `SAE SAE 5.A.01 SAE5.B.01 …` |

Chaque PDF contient **deux semestres**, et chacun a sa propre ligne d'en-tête.

### Algorithme
1. **Trouver la ligne d'en-tête du semestre.** Ce sont les éléments du type `^UE\d\.\d$`. On mémorise le **centre horizontal** de chacun.
   - Le nombre d'UE varie : 6 en BUT1 et BUT2, **3 en BUT3**.
   - En parcours DACS, le BUT3 a les UE 5.1, 5.3, 5.6, puis 6.1, 6.3, 6.6.
   - Il ne faut jamais supposer 6 UE.
2. **Trouver les lignes de données.** Elles contiennent un code :
   - ressources : `R1.01`, `R4.B.08`, `R5.B.12`… ;
   - SAE : `S3.01`, `SAE5.B.01`, `S6.A.01`… ;
   - portfolio : `S3.PF`, `PORTFOLIO` ;
   - stage : `S4.MP`, `S6.STAGE`.

   Quand une ligne contient plusieurs codes, on garde **le dernier avant l'intitulé**. C'est le plus précis, et c'est celui du relevé de notes.
   - **Dans les vrais PDF, ce dernier code est collé au début de l'intitulé**, dans un seul élément texte : pdf.js renvoie `R4.08`, puis `R4.B.08 Virtualisation` d'un bloc. De même pour les SAE : `S4.01`, puis `SAE 4.01 Déploiement…` ; en BUT3, `SAE 5.A.01`, puis `SAE5.B.01 Evolution…`. On détache donc un code placé au début de l'élément qui suit les codes (en un mot, `R4.B.08`, ou en deux, `SAE 2.01`), à condition qu'il reste un intitulé derrière. Sans cela, `R4.B.08` passe dans l'intitulé, et le code gardé est `R4.08`, celui que le relevé n'utilise pas.
   - En BUT1, le code est même collé **sans espace** : `R2.01Développement orienté objets`. On coupe alors là où une lettre suit les chiffres du code.
   - Les autres codes de la ligne sont gardés comme **alias** (`R4.08`). Une note du relevé est rattachée à la ligne dont le code **ou un alias** correspond.
   - Une **ressource** du relevé qui ne correspond à aucune ligne du tableau n'est pas ajoutée en silence : elle est signalée dans « à vérifier » (ses notes sont gardées, sans coefficient).
3. **Ranger chaque nombre de la ligne dans la colonne UE dont le centre est le plus proche horizontalement.** Exemple inventé : `R9.01 Initiation 30 12`, avec 30 sous `UE9.1` et 12 sous `UE9.4`.
4. **Le type vient des lignes de section** : « Pôle SAE » pour les SAE, « Pôle Ressources » pour les ressources.
5. **Les lignes « TOTAL SAE », « Total Ressource(s) » et « TOTAL GENERAL » servent de contrôle.** Pour chaque UE, la somme des coefficients lus doit être égale à ces totaux, et le total général vaut 100. **Sinon, on signale l'erreur** au lieu d'importer en silence.
   - **En BUT3 DACS, les totaux du S5 sont précédés de la colonne Nature** : `RSC Total Ressources : 50 50 50` et `RSC TOTAL GENERAL : 100 100 100`. On retire ce préfixe de nature (`SAE`, `RSC`) avant de chercher une ligne de total. Sinon, la ligne est prise pour un titre et le contrôle signale à tort un total « introuvable ».
6. **On ignore** :
   - le bandeau « IUT concerné » ;
   - « Parcours … » et « Non évalué ce semestre » ;
   - la ligne ECTS, c'est-à-dire tout nombre qui n'est pas sur une ligne portant un code.
7. **Le portfolio peut n'avoir aucun coefficient**, par exemple aux semestres 1, 3 et 5. Il ne compte alors pas.
8. **Le poids des SAE varie selon le semestre** : 40, 50 ou 60 sur 100. On ne le code jamais en dur, on le lit dans le tableau.

### Référentiel intégré (`data/referentiel.json`)
Les cinq tableaux de l'IUT (BUT1 tronc commun, BUT2 et BUT3 en parcours RA et DACS) sont des documents **publics**. Leurs coefficients sont donc dans le dépôt, mais **pas les PDF**, qui restent dans `prive/` (ignoré par Git).
- `npm run referentiel` (`scripts/generer-referentiel.mjs`) lit ces PDF avec le build « legacy » de pdf.js pour Node, et `elementsDeLaPage` de `js/lecture-pdf.js` : les positions sont les mêmes que dans l'app. Il passe chaque tableau dans `importerCoefficients` et **s'arrête sans rien écrire** à la moindre erreur (total faux, code en double, semestre inattendu).
- Il écrit `data/referentiel.json` et `data/referentiel.js` (le même objet, en module ES). La page ne peut pas lire le `.json` : la CSP `connect-src 'none'` bloque `fetch` et l'import de JSON. Un module `.js` se charge comme les autres scripts (`script-src 'self'`).
- Pour chaque année et chaque parcours, il donne : le document d'origine et sa date de création, les deux semestres, leurs UE avec leurs totaux imprimés (`totalSae`, `totalRessources`), et chaque ligne (type, code, alias, intitulé, coefficient par UE).
- **Les tableaux ne donnent pas l'intitulé des UE** : il vaut `null`. Le relevé, une fois importé, complète l'intitulé des UE.
- En BUT3, les UE du parcours RA sont 5.1, 5.2 et 5.6 (6.1, 6.2, 6.6) ; celles du parcours DACS sont 5.1, 5.3 et 5.6.
- Le choix « année + parcours » de l'interface (`js/choix-annee.js`) crée les semestres de l'année à partir de ce référentiel, en passant par le même remplissage que l'import du PDF.

---

## 3. Relevé « Détail des notes » (ENT)

### À ignorer complètement
- **L'en-tête** : nom, « Dossier », « NNE », « Courriel », « Date d'édition ». On ne le garde pas, on ne l'affiche pas, on ne le journalise pas.
- **Le filigrane « NON CERTIFIÉ »** : ce sont de grosses lettres grises d'environ 47 à 65 pt, éparpillées sur les lignes. **On filtre tout élément dont la taille dépasse 20 pt, avant tout le reste.** Sinon, des lettres se collent aux libellés et aux notes (`F17.833`, `missioOns`) ou font disparaître des notes.
- Les lignes SENSE, « Certificat SENSE » et « Se saisir des Enjeux… ».
- La colonne « Rang » (par exemple `14/30`).
- **La ligne du diplôme**, par exemple `B2 - Informatique PT DACS (FI)` : ignorée **sans message**. Si elle est plus à gauche que les autres lignes, celles-ci sont « dessous » dans l'arbre : elles sont lues normalement.
- **La légende du bas de page**, par exemple `ADM : Admis   AJ : Ajourné` : ce n'est **pas** une ligne SENSE, ni une ligne du tableau. On l'écarte comme un pied de page, **avant** de construire l'arbre. Sinon, rangée par son retrait, elle tombe sous la ligne précédente : une ligne SENSE, ou une ressource, dont elle devient une fausse évaluation.

### Colonnes
`Code` · `Libellé` · `Session 1` (la note) · `Session 2` · `Résultat` (ADM, V, V/COR) · `Rang`.

On repère leurs positions grâce à la ligne d'en-tête « Code Libellé Session 1 Session 2 Résultat Rang ». **La colonne « Session 2 » est toujours présente**, le plus souvent vide. On ne la signale que si elle contient **au moins une note** : ces notes ne sont pas importées.

Les codes, comme `3JXH2M01E1`, sont des identifiants internes. On ne s'en sert que comme identifiant, sans jamais déduire quoi que ce soit de leur contenu.

### Hiérarchie : on la lit grâce au **retrait du libellé**
Plus un libellé commence à droite, plus il est profond dans l'arbre. Le **parent** d'une ligne est la ligne précédente dont le retrait est plus petit. Pour classer les retraits, il faut comparer leurs valeurs entre elles, pas utiliser de valeurs absolues.

Les niveaux observés, du plus à gauche au plus à droite :
1. compétences annuelles, semestre ;
2. UE, malus ;
3. pôles ;
4. ressource, SAE, portfolio, stage ;
5. évaluation, ou « matière » (par exemple `Mati 1 Anglais`) ;
6. évaluation d'une matière, ou évaluation de SAE du S3.

### Types de lignes, reconnus par le libellé
| Libellé (exemple) | Signification |
|---|---|
| `C1 Réaliser un développement… Niveau 2` | Moyenne **officielle** d'une compétence sur l'année |
| `SEMESTRE 3 BUT Informatique` | Début d'un semestre |
| `UE3.1 Aller jusqu'à…` | Moyenne **officielle** de l'UE, avec son résultat |
| `Pôle SAE UE 3.1` / `Pôle Ressource UE 3.1` | Moyennes **officielles** des pôles. Au BUT1, on trouve aussi l'abrégé `Pôle Res UE 1.5` ou `Pôle RES UE 2.1` |
| `R3.01 Développement web`, `R4.B.09 …` | Ressource, avec sa moyenne officielle |
| `SAE 3.01 …`, `Portfolio`, `Stage` | Parties du pôle SAE |
| `… - coef 2`, `… - Coef 3` | Évaluation. Le coefficient est **dans le libellé** : on le cherche sans tenir compte des majuscules |
| `… - Coef ??` | Coefficient inconnu : **on le demande à l'utilisateur**, sans le deviner |
| `Mati 1 Anglais` | Niveau intermédiaire, entre une ressource (Langues) et ses évaluations |
| `Malus absences injustifiées …` | Valeur à retrancher (par exemple `0.05`). Elle peut être vide ou à 0 |
| `… - Coef 1` avec `ABJ` comme note | Absence justifiée : l'évaluation est **neutralisée** par l'IUT. Elle n'est pas importée (c'est signalé), ce qui donne le même calcul |

### Pièges
- **Une ressource n'apparaît qu'une seule fois**, sous le pôle de la **première** UE où elle compte. Pour savoir dans quelles autres UE elle compte, et avec quel poids, il faut le **tableau des coefficients**.
- **Au S3, les évaluations de la SAE sont rangées par UE** dans leur libellé : `Sae UE 3.2 : MVP - Coef 2`. On trouve aussi des variantes comme `UE 3.03` (qui veut dire 3.3) ou `UE 3.6 DACS : …`.
- **Au S4 et au S6, le pôle SAE est formé de parties** : SAE, portfolio et stage. Elles sont pondérées par le tableau (`S4.01`, `S4.PF`, `S4.MP`).
- **Une note vide veut dire « pas encore notée ».** On garde l'évaluation, mais elle ne compte pas. En début d'année, le relevé ne contient que la structure, sans aucune note.
- **Une ressource peut n'avoir aucune évaluation détaillée**, par exemple `R4.03 … 15` sans aucune ligne dessous. Sans évaluation, elle n'aurait pas de note et ne compterait pas. Si une ressource ou une partie SAE a une moyenne officielle mais **aucune évaluation** (matières comprises), on crée une évaluation **« Moyenne du relevé »** avec cette note et **coef 1**, et on le signale dans le rapport. Ce contrôle se fait à la fin de la lecture, après la fusion des lignes doublées.
- **Au BUT3, une ressource peut être écrite sur deux lignes**, au même retrait : `R5.B.04 Programmation système` puis `R5.B.04 Programmation système FI`. C'est le même élément (même code) : on les **fusionne**.
  - On réunit les évaluations des deux lignes.
  - On prend la moyenne officielle de celle qui en a une. Si les deux en ont une, différente, on garde la première et on le signale.
  - Il n'y a pas de message « apparaît deux fois ». Seul un libellé vraiment différent (pas seulement « … FI ») est signalé.

---

## 4. Règles de calcul
Ces règles ont été vérifiées sur un relevé réel : **23 moyennes officielles sur 24** sont retrouvées exactement.

1. **Moyenne d'une ressource** (ou d'une matière) = Σ(note × coef de l'évaluation) / Σ coef, sur les évaluations notées seulement.
2. **Pôle Ressources d'une UE** = Σ(moyenne de la ressource × coef du tableau pour cette UE) / Σ coef. On ne compte que les ressources qui ont une moyenne.
3. **Pôle SAE d'une UE** :
   - au S3, c'est la moyenne pondérée des évaluations SAE de **cette** UE, avec les coefficients des libellés ;
   - au S4 et au S6, c'est la moyenne des parties (SAE, portfolio, stage), pondérée par les coefficients du tableau.
4. **Moyenne de l'UE** = (total SAE × pôle SAE + total ressources × pôle ressources) / 100, **moins le malus** du semestre. Le malus s'applique à chaque UE du semestre.
5. **Si un pôle n'a encore aucune note**, on affiche l'UE comme **provisoire**, calculée avec ce qui existe.
6. **Arrondi** : chaque moyenne intermédiaire est **arrondie au millième, au plus proche**, avant d'être réutilisée. Par exemple, 12,2055 donne 12,206.
   - ⚠️ En JavaScript, `12.2055` est stocké en réalité `12.20549999…`. Un arrondi naïf donne donc 12,205.
   - Il faut arrondir avec une petite marge, ou calculer en millièmes entiers. **Ce cas doit avoir son test.**
7. **Compétence (année)** = moyenne simple des 2 UE de même numéro de l'année. Par exemple, UE3.1 et UE4.1 donnent C1.
8. **Écarts observés** : le coefficient écrit dans un libellé n'est **pas toujours** celui qu'utilise l'IUT.
   - Vérifié le 14/10/2026 avec `npm run verifier` sur trois vrais relevés (BUT1, BUT2 DACS, BUT3 DACS) :
     - **BUT2** : aucun écart. Le pôle SAE de l'UE 3.6, autrefois en écart d'environ 0,9 point, tombe désormais juste (ses évaluations « UE 3.6 DACS – … » sont toutes lues). Le seul écart du S4 venait d'un stage noté « Coef ?? » : il disparaît dès que ce coefficient est saisi.
     - **BUT1** : 8 ressources ou SAE ont une moyenne officielle calculée avec d'autres poids que ceux des libellés : moyenne simple au lieu des coefs affichés, interro « Coef 0.5 » comptée comme coef 1, évaluation non comptée, poids 1, 2, 3 au lieu de 1, 1, 1… Si l'on remplace la moyenne de ces 8 lignes par leur moyenne officielle, **tous** les pôles, UE et compétences tombent juste : les règles 2 à 7 sont donc bonnes. Ces écarts ne sont pas des bugs, et on ne peut pas les deviner.
   - L'app doit :
     - afficher **« calculé » et « officiel » côte à côte** quand le relevé fournit l'officiel ;
     - signaler les écarts supérieurs à 0,01 ;
     - laisser modifier les coefficients.
   - Une évaluation **sans aucun coefficient** dans son libellé (`PPP : Note 1`) est traitée comme un `Coef ??` : on le demande.
9. **Règles de validation** (seuils, compensation) : elles sont à reprendre du règlement des études de l'IUT. Tant qu'elles ne sont pas fournies, l'app n'affiche que les moyennes et un repère « ≥ 10 », **sans verdict** (pas de « admis » ni « ajourné »).

### Note à viser
Pour une UE et une évaluation pas encore notée, on calcule la **note minimale** à obtenir pour que l'UE atteigne 10 (ou une cible choisie). Les cas à gérer :
- la cible est déjà atteinte ;
- la cible est impossible, même avec 20 ;
- plusieurs évaluations restent à passer : on suppose alors la même note partout.

---

## 5. Données de test
Les fixtures (`tests/fixtures/*.json`) sont des listes d'éléments `{ texte, x, y, taille, page }`, **inventés**, qui imitent ce que renvoie pdf.js. Elles doivent couvrir :
- les lettres du filigrane, les champs collés, les deux mises en page de tableau (BUT1-2 et BUT3), un document sur deux pages ;
- un `Coef ??`, une note vide, un malus, le niveau « matière » (Langues) ;
- un tableau dont les totaux ne tombent pas juste, pour vérifier que l'erreur est signalée ;
- un arrondi piège (x,xxx5) ;
- une page tournée de 90° : `releve-tourne.json` contient ce que pdf.js renvoie (viewport et éléments bruts) pour un petit PDF inventé, sans rotation puis tourné ;
- un relevé de BUT3 DACS (`releve-but3.json`) : lignes doublées « FI », ressource sans évaluation détaillée, colonne « Session 2 » vide, ligne du diplôme, légende du bas de page ;
- un tableau de BUT3 DACS aux totaux préfixés `RSC` (`coefficients-but3-dacs.json`) ;
- un tableau dont le code de parcours est collé à l'intitulé (`coefficients-codes-colles.json` : `R4.10` puis `R4.B.10 Cryptographie (inventée)`). Avec le relevé `releve-but2.json`, il sert au test de bout en bout : tableau + relevé → moyennes d'UE.

La version de pdf.js copiée dans `vendor/` est faite pour les navigateurs : elle utilise `Uint8Array.prototype.toHex`, que Node 24 n'a pas. On ne peut donc pas lire un PDF entier dans les tests. On teste le calcul pur (`positionAffichee`) et les analyseurs, à partir de données capturées.

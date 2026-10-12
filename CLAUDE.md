# Consignes pour Claude Code — simulateur-but

## Le projet
Simulateur de moyennes du BUT Informatique (IUT de Metz). L'utilisateur saisit ses coefficients et ses notes. L'app calcule les moyennes des ressources, des pôles, des UE et des compétences, puis la note à viser.

Deux imports **facultatifs** pré-remplissent les champs :
- le PDF du tableau des coefficients ;
- le PDF « Détail des notes » téléchargé sur l'ENT.

La description précise de ces PDF et les règles de calcul vérifiées sont dans `docs/FORMAT-PDF.md`. **Lis ce fichier avant toute étape qui touche aux calculs ou aux imports.**

## Qui je suis
- Étudiant en BUT Informatique, parcours réseaux et cybersécurité. Je débute complètement en programmation.
- Réponds en français et tutoie-moi.

## Comment travailler avec moi
- C'est toi qui écris le code. Mon objectif est de le comprendre.
- **Avant de modifier** : explique simplement ce que tu vas faire et pourquoi. Si tu utilises un terme technique, explique-le.
- **Après** :
  - résume le rôle de chaque fichier modifié ;
  - donne les 2 ou 3 idées importantes à retenir, avec un exemple concret.
- Commente le code en français. Pour les calculs et l'analyse des PDF, commente chaque étape.
- Une seule étape à la fois.

## Règles techniques
- **Technologies** : HTML, CSS et JavaScript vanilla, en modules ES. Aucun framework.
- **Dépendances** : la seule est `pdfjs-dist`. Ses fichiers sont copiés dans `vendor/pdfjs/` et ne sont jamais chargés depuis un CDN. N'ajoute **aucune** autre dépendance, même en devDependencies, sans me demander.
- **Fichiers de logique** : `js/calcul.js`, `js/import-coefficients.js` et `js/import-notes.js` sont des fonctions pures.
  - Elles n'accèdent ni à la page (DOM) ni à pdf.js.
  - Elles sont testées avec node:test dans `tests/`.
  - Lance `npm test` après chaque changement et corrige jusqu'à ce que tout passe.
- **Lecture des PDF** : `js/lecture-pdf.js` est le seul fichier qui parle à pdf.js. Il renvoie une simple liste d'éléments texte `{ texte, x, y, taille, page }`. Les analyseurs travaillent sur cette liste, ce qui permet de les tester sans PDF.

## Données personnelles (non négociable)
- **Rien n'est stocké** : pas de localStorage, sessionStorage, IndexedDB ni cookies.
- **Rien n'est envoyé** : aucune requête réseau.
- **L'en-tête du relevé est ignoré** : on ne lit pas, n'affiche pas et ne conserve pas le nom, le n° de dossier, le NNE/INE ni l'e-mail.
- **Aucune vraie donnée dans le dépôt** : aucun vrai PDF ni vraie note. Les tests utilisent des données inventées, dans `tests/fixtures/`. Le dépôt est public.

## Comportement de l'app
- **La saisie manuelle fonctionne toujours, sans import.**
- **Un import ne fait que pré-remplir les champs.** Tout reste modifiable, ajoutable et supprimable.
- **Si un import ne comprend pas une partie, il le dit clairement.** Il n'invente jamais de valeur. Un coefficient inconnu (`Coef ??`) est demandé à l'utilisateur.

## Sécurité
- Jamais d'`innerHTML` avec une donnée venant de l'utilisateur ou d'un PDF : toujours `textContent`.
- CSP stricte : aucun script externe, aucun `unsafe-inline` ni `unsafe-eval`, `connect-src 'none'`.
- pdf.js est utilisé avec `isEvalSupported: false`. On impose aussi des limites de taille et de nombre de pages.

## Interface
- Reprends l'identité visuelle de mon portfolio, comme dans net-toolkit : violet et crème, polices Inter et Fraunces, effet verre. Reprends ses variables CSS.
- Tout est en français.
- L'app doit être utilisable sur téléphone, et accessible : labels, navigation au clavier, contraste suffisant.

## Git
- Ne fais ni commit ni push : je m'en occupe.
- Propose-moi un message au format Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

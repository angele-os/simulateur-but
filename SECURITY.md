# Sécurité

Le simulateur lit des PDF venus de l'ENT (relevé de notes, tableau des coefficients) **dans le navigateur**. Ces fichiers contiennent des données personnelles. Ce document décrit les menaces prises en compte, ce qui protège contre chacune, et les limites connues.

## Signaler une faille

N'ouvre **pas** d'issue publique pour une faille. Utilise le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Décris le problème et, si possible, un PDF **inventé** qui le reproduit. N'envoie jamais un vrai relevé.

## Ce que l'app fait, et ne fait pas

- Elle lit le PDF choisi, dans la mémoire de l'onglet, et en extrait le texte avec pdf.js.
- Elle ne **stocke** rien : ni `localStorage`, ni `sessionStorage`, ni IndexedDB, ni cookies.
- Elle n'**envoie** rien : aucune requête réseau, aucun formulaire.
- Tout disparaît quand l'onglet est fermé.

---

## Menace 1 : un PDF piégé

Un PDF peut être construit pour exploiter un défaut du lecteur, comme exécuter du code, bloquer le navigateur ou épuiser la mémoire. Exemple réel : la CVE-2024-4367 de pdf.js (versions antérieures à 4.2.67) permettait d'exécuter du JavaScript au moyen d'une police piégée.

**Ce qui protège** (`js/lecture-pdf.js`) :
- **Contrôles avant la lecture**. Le fichier doit être de type `application/pdf`, ne pas être vide, et peser 5 Mo au plus. Son premier kilo-octet doit contenir la signature `%PDF-`.
- **Limites pendant la lecture** : 10 pages au plus, et 15 secondes au plus. Au-delà, la lecture est abandonnée avec un message clair.
- **`isEvalSupported: false`**. pdf.js ne génère et n'exécute jamais de code à partir du contenu du PDF. C'est la protection contre les failles du type CVE-2024-4367.
- **`disableFontFace: true`**. Les polices du PDF ne sont pas chargées dans la page : on ne lit que le texte.
- **Le PDF est analysé dans un worker** (un fil d'exécution séparé, sans accès à la page). Après chaque lecture, quelle qu'en soit l'issue, le document, l'objet `PDFWorker` et le worker sont détruits.
- **Messages sûrs**. Les erreurs de pdf.js sont traduites en messages prévus à l'avance. Ils ne citent ni le contenu du PDF, ni le nom du fichier. Rien n'est journalisé.
- **pdf.js est à jour**. Le test `tests/vendor-pdfjs.test.js` vérifie que les fichiers servis ont la version installée (voir la menace 4).

## Menace 2 : injection par les libellés d'un PDF

Les libellés d'un PDF (noms de ressources, d'évaluations…) sont du texte contrôlé par celui qui a fabriqué le fichier. Insérés comme du HTML, ils pourraient exécuter du code (XSS) : `<img src=x onerror=…>`.

**Ce qui protège** :
- **Jamais de HTML construit à partir du texte.** Tout texte est inséré avec `textContent` ou dans des attributs avec `setAttribute` (`aria-label`, `title`) : le navigateur l'affiche tel quel, sans l'interpréter. Le test `tests/page.test.js` échoue si `innerHTML`, `outerHTML`, `insertAdjacentHTML` ou `document.write` apparaissent dans `js/`.
- **Les icônes** sont recopiées depuis des `<template>` de la page, ou dessinées avec l'API SVG du DOM.
- **Trusted Types** (`require-trusted-types-for 'script'`). Même si du code essayait d'écrire du HTML, le navigateur refuserait une simple chaîne (voir la menace 5).
- **CSP stricte**, dans `index.html` :
  ```
  default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self';
  connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
  require-trusted-types-for 'script'; trusted-types pdfjs-worker; upgrade-insecure-requests
  ```
  Il n'y a ni `unsafe-inline` ni `unsafe-eval` : un script injecté dans la page ne s'exécuterait pas. Le test `tests/page.test.js` vérifie chaque directive.
- **Les analyseurs sont des fonctions pures**, testées avec des données inventées (`js/import-*.js`). Un libellé n'y est jamais exécuté, seulement comparé à des expressions régulières, sur un texte de 10 pages au plus.
- **Le référentiel `data/referentiel.js`** est généré avec `JSON.stringify`, qui échappe correctement chaque chaîne. Un intitulé ne peut donc pas devenir du code. Ce fichier est relu à chaque commit.

## Menace 3 : fuite de données personnelles

Le relevé contient le nom, le n° de dossier, le NNE ou INE, l'e-mail et toutes les notes.

**Ce qui protège** :
- **Rien ne sort de l'appareil.**
  - `connect-src 'none'` interdit les requêtes réseau, et le test `tests/page.test.js` échoue si `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` ou `sendBeacon` apparaissent dans `js/`.
  - `form-action 'none'` interdit l'envoi d'un formulaire. Constaté pendant un test : quand l'app n'avait pas pu démarrer, le navigateur a tenté d'envoyer le formulaire de choix de l'année, et la CSP l'a bloqué.
  - `<meta name="referrer" content="no-referrer">` : un lien suivi ne transmet pas l'adresse de la page.
- **Rien n'est stocké.** Un test interdit `localStorage`, `sessionStorage`, IndexedDB, les cookies et le cache. Le formulaire de choix de l'année a `autocomplete="off"`.
- **L'en-tête du relevé n'est jamais lu.**
  - Les lignes au-dessus de la ligne de titres sont seulement **comptées**, ainsi que les lignes qui ressemblent à des données personnelles (« Dossier : », une adresse e-mail, la date d'édition) et les pieds de page.
  - Leur texte ne va ni dans le résultat, ni dans le rapport.
  - Le test « aucun nom, dossier, NNE, e-mail ni date d'édition ne sort du parseur » le vérifie, sur un relevé **inventé** qui en contient.
- **Le mauvais PDF au mauvais bouton.** Un relevé donné à l'import des coefficients n'est pas recopié : on n'affiche que le nombre de lignes écartées.
- **Le dépôt est public.**
  - Les vrais PDF restent dans `prive/`, et `.gitignore` exclut ce dossier ainsi que tous les `*.pdf`.
  - Les fixtures de `tests/fixtures/` sont **inventées**.
  - Les scripts `npm run verifier` et `npm run referentiel` se lancent en local. Le premier n'écrit aucun fichier et n'affiche que des codes et des nombres. Le second n'écrit que des coefficients, qui sont des documents publics.

## Menace 4 : la chaîne d'approvisionnement (pdf.js)

Une dépendance compromise, ou chargée depuis un serveur tiers, pourrait exécuter n'importe quel code dans la page.

**Ce qui protège** :
- **Une seule dépendance** : `pdfjs-dist`. Il n'y a aucune autre dépendance, même de développement, ni étape de compilation.
- **Aucun CDN.** Les fichiers de pdf.js sont copiés dans `vendor/pdfjs/` (`npm run vendor`) et servis par le site lui-même. `script-src 'self'` interdit tout script venu d'ailleurs, et un test vérifie qu'aucune ressource de la page ne vient d'un autre site.
- **Versions verrouillées.** `package-lock.json` fixe la version exacte et l'empreinte (`integrity`) de chaque paquet téléchargé. Utilise `npm ci` pour installer exactement ces versions.
- **Fichiers servis à jour.** `tests/vendor-pdfjs.test.js` échoue si `vendor/pdfjs/` n'a pas la même version que `node_modules/pdfjs-dist`.
- **Mises à jour réfléchies.** Avant de mettre à jour pdf.js, lis ses notes de version et ses avis de sécurité (GitHub Advisories), puis lance `npm audit`, `npm run vendor` et `npm test`.

**Limite.** Le test compare les **versions**, pas le contenu des fichiers : une modification de `vendor/pdfjs/` à la main ne serait pas détectée. Relis tout diff de ce dossier.

## Menace 5 : Trusted Types et la politique `pdfjs-worker`

`require-trusted-types-for 'script'` oblige le navigateur à refuser une simple chaîne dans les fonctions dangereuses : `innerHTML`, `eval`, `new Worker(url)`… Elles n'acceptent plus qu'une valeur « approuvée » par une **politique**. pdf.js a besoin de lancer son worker : il faut donc une politique, la plus étroite possible.

**Ce qui protège** :
- **Une seule politique autorisée.** La CSP ne permet que le nom `pdfjs-worker` (`trusted-types pdfjs-worker`), sans `allow-duplicates`. Aucun autre code ne peut créer de politique, ni recréer celle-ci. Un test vérifie que `createPolicy` n'apparaît qu'une fois, dans `js/lecture-pdf.js`.
- **Une seule adresse acceptée.** La règle `createScriptURL` de cette politique n'approuve que l'adresse **exacte** du worker, `vendor/pdfjs/pdf.worker.min.mjs`. Toute autre adresse lève une erreur : un autre fichier, la même adresse avec un paramètre, une adresse `data:`… C'est testé dans `tests/lecture-pdf.test.js`.
- **Le worker est lancé par l'app**, avec cette adresse approuvée, puis confié à pdf.js (`new pdfjs.PDFWorker({ port })`). pdf.js ne crée donc jamais de worker lui-même, et ne se rabat jamais sur un « faux worker » qui tournerait dans la page.
- **Rien d'autre n'utilise de fonction dangereuse.** La politique ne fournit pas `createHTML` ni `createScript` : `innerHTML` et `eval` restent refusés pour tout le monde.
- **Anciens navigateurs.** Sans Trusted Types, l'adresse est passée telle quelle, après la même vérification. La CSP (`script-src 'self'`, qui s'applique aussi aux workers) n'autorise de toute façon que les scripts du site.

---

## Limites connues

- **La CSP est dans une balise `<meta>`.** Certaines directives n'y fonctionnent pas, notamment `frame-ancestors` (protection contre l'affichage de la page dans un cadre). Si l'hébergeur le permet, envoie aussi la CSP en **en-tête HTTP**, avec `frame-ancestors 'none'`.
- **Le worker n'hérite pas de la CSP de la page.** Un worker chargé depuis une adresse du site reçoit la CSP des en-têtes HTTP de **son propre fichier**, pas celle de la balise `<meta>`. Sans en-tête, `connect-src 'none'` ne s'applique donc pas à l'intérieur du worker. `isEvalSupported: false` et les limites de taille réduisent ce risque, mais l'hébergeur devrait aussi envoyer la CSP sur `vendor/pdfjs/pdf.worker.min.mjs`.
- **La mémoire de l'onglet** contient les notes tant qu'il est ouvert. Une extension de navigateur malveillante pourrait les lire. C'est hors de portée de l'app.
- **Les résultats sont indicatifs.** Seul le relevé officiel fait foi (voir `docs/FORMAT-PDF.md`, règle 8).

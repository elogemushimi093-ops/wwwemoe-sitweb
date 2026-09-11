# Site E.M.O.E pour Cloudflare Pages

Le logo et le nom de l’école n’ont pas été changés. Dépose le fichier image original `logo-emoe.jpg` à côté de `index.html` avant le déploiement.

## Ce qui est corrigé

- Le bouton `EN`/`FR` traduit réellement tout le contenu visible, le titre de page et la description.
- Les trois logos sociaux sont de vrais liens cliquables, sans texte. Dans `index.html`, remplace les trois valeurs dans `SOCIAL_URLS` par les liens exacts des comptes Facebook, Instagram et YouTube de l’école. Ils ouvrent aujourd’hui les trois plateformes, car aucun lien officiel de ces comptes n’a été fourni.
- Les neuf pays ont leur drapeau.
- Licence, Master et Doctorat sont dans un carrousel horizontal qui avance automatiquement toutes les 2 secondes. Les flèches et les indicateurs restent utilisables.
- Le formulaire ne dépend plus du logiciel de messagerie du visiteur : il appelle une fonction Cloudflare qui envoie l’inscription à `ecoleombredeleternel@gmail.com`.

## Déploiement Cloudflare Pages et envoi email

1. Mets le contenu entier de ce dossier dans un nouveau dépôt GitHub, sans oublier `functions/api/admission.js`.
2. Dans Cloudflare, va à **Workers & Pages > Create application > Pages > Connect to Git**. Sélectionne le dépôt. Pour un dépôt contenant directement ces fichiers, renseigne **Build command** : `exit 0` et **Build output directory** : `.`. Le dossier `functions` doit rester à la racine du dépôt.
3. Crée un compte [Resend](https://resend.com), ajoute et vérifie un domaine qui t’appartient, par exemple `ecoleombredeleternel.org`.
4. Dans les paramètres du projet Pages, ouvre **Settings > Environment variables** et ajoute, pour Production :

   | Variable | Valeur |
   | --- | --- |
   | `RESEND_API_KEY` | La clé API Resend, marquée comme secret |
   | `RESEND_FROM` | `E.M.O.E Admissions <admissions@ton-domaine-verifie.org>` |

5. Redéploie le site. Fais une candidature test avec ton propre email, puis vérifie la réception sur `ecoleombredeleternel@gmail.com` et réponds directement au candidat : l’adresse du candidat est placée en `Reply-To`.

Ne mets jamais une clé Resend dans `index.html`, GitHub, ni une capture d’écran : elle est seulement dans les variables secrètes Cloudflare.

## Important avant publication

- Colle les **trois URLs officielles exactes** des comptes sociaux dans `SOCIAL_URLS`. Avec seulement un nom de compte, il est impossible de relier une icône à une page précise de manière fiable.
- Le formulaire contient une validation serveur, limites de longueur et un champ anti-robot invisible. Pour une protection supplémentaire contre le spam, active Cloudflare Turnstile / WAF dans ton tableau de bord après le premier déploiement.
- Le fichier `_headers` ajoute des en-têtes de sécurité adaptés au site. Ne le supprime pas.
- Utilise l’intégration **Git** (ou Wrangler), pas « Drag and drop » dans le tableau de bord : cette méthode ne déploie pas le dossier `functions`, donc le formulaire ne pourrait pas envoyer d’email.


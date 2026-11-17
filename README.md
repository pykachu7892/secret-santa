# Secret Santa

Un lien à partager sur Snap. Chacun s’inscrit avec son prénom et un code à 4 chiffres. L’organisateur ferme les inscriptions, ce qui lance le tirage. Ensuite chacun tire son prénom depuis son téléphone. La liste complète « qui offre à qui » reste scellée jusqu’au jour J, même pour l’organisateur.

## Mettre en ligne sur Vercel (environ 5 minutes)

Il te faut un compte Vercel (gratuit) et Node 18 ou plus.

1. Ouvre ce dossier dans Cursor, puis dans le terminal :

   ```bash
   npm install
   npx vercel
   ```

   Réponds aux questions : *Set up and deploy* → **Y**, *Link to existing project* → **N**, nom → `secret-santa`, dossier → `./`, *Modify settings* → **N**.

2. Ajoute la base de données (gratuite) : sur vercel.com, ouvre le projet **secret-santa** → onglet **Storage** → **Create Database** → **Upstash for Redis** → plan gratuit → **Connect** au projet (coche tous les environnements).

3. Redéploie pour que le site voie la base :

   ```bash
   npx vercel --prod
   ```

4. Ouvre l’adresse donnée (du genre `https://secret-santa-xxxx.vercel.app`). Crée ton groupe, puis copie le lien d’inscription depuis l’« Espace organisateur » et colle-le sur Snap.

Si le site affiche « Base de données manquante », c’est que l’étape 2 n’est pas faite ou que l’étape 3 n’a pas été relancée après.

## Comment ça marche

- **Inscription** : prénom et code à 4 chiffres. Deux personnes ne peuvent pas avoir le même prénom (ajouter une initiale : « Marie L. »).
- **Fermeture** : seul l’organisateur peut fermer. Le tirage forme une seule grande boucle, donc personne ne se tire soi-même et personne ne reste coincé à la fin.
- **Tirage** : chacun touche son prénom et tape son code. Après 5 codes faux, le prénom est bloqué 10 minutes.
- **Jour J** : à partir de 00 h le jour choisi, la liste complète s’affiche pour tout le monde. Avant, le serveur ne la renvoie à personne.
- **Rouvrir** : l’organisateur peut rouvrir les inscriptions (quelqu’un a oublié de s’inscrire). L’ancien tirage est effacé sans être montré et il faut refermer pour en refaire un. La date du jour J ne se change qu’avant le tirage.
- **Lien organisateur** : dans l’Espace organisateur, « Copier mon lien organisateur » donne un lien secret pour gérer le groupe depuis un autre téléphone. Ne le partage pas.
- Les données s’effacent seules environ 5 mois après la dernière activité.

## Tester en local

```bash
npm install
npm run dev
```

Puis http://localhost:3000. Sans Redis configuré, les données sont gardées en mémoire et disparaissent quand tu arrêtes le serveur.

## Fichiers

- `public/index.html` : toute l’interface.
- `public/art.svg` : les gravures et lettrines.
- `api/santa.js` : le point d’entrée du serveur (fonction Vercel).
- `lib/santa.js` : les règles (inscription, tirage, scellé du jour J).
- `lib/store.js` : le stockage (Upstash Redis en ligne, mémoire en local).

## Crédits

Gravures et lettrines tirées de magazines publiés entre 1880 et 1910, dans le domaine public, vectorisées par WelshPixie (licence CC0) : https://github.com/WelshPixie/vintageart. Polices IM Fell (Google Fonts, licence OFL).

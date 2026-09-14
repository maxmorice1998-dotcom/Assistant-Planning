# SDIS — version collègues (préversion)
Ouvrir **SDIS-Collegues.exe** par double-clic. Aucun terminal, Node, npm ou chemin à saisir.
Cette version est verrouillée en simulation, y compris lors du lancement direct du moteur.

L'assistant ouvre des navigateurs indépendants, découvre l'identifiant AGATT et l'agenda Dendreo après connexion, et enregistre les réglages email. Le mot de passe d'application Gmail est saisi dans un champ masqué et chiffré par DPAPI pour le compte Windows courant. Les mots de passe AGATT/Dendreo restent saisis sur leurs sites.
Les données et profils se trouvent sous LocalAppData/SDIS-Bot-Collegues, séparément du programme et du bot personnel. Les ports réservés sont 19222 et 19223. Un port appartenant à un autre profil est refusé.

## État réel
- Runtime Node et dépendances embarqués.
- Assistant Windows natif ; aucune commande à taper.
- Moteur AGATT/Google, Dendreo, nettoyage et alertes repris.
- Les lecteurs de tokens et de secrets utilisent exclusivement DPAPI.
- Aucun mail et aucune synchronisation réelle exécutés pendant la préparation.
- La connexion Google utilise une application OAuth Desktop dédiée, configurée une fois par le distributeur dans google-oauth-config.json. Le collègue ne manipule aucun fichier OAuth.
- Le bouton Connexion Google ouvre le navigateur Google, attend le retour local et chiffre le token dans LocalAppData. Le renouvellement utilise le refresh token Google ; un accès expiré ou révoqué affiche « Reconnecter Google ».
- Le calendrier secondaire SDIS-BOT est retrouvé par son nom ou son marqueur ; son identifiant est conservé dans LocalAppData. Sa création reste bloquée tant que dryRun est true.
- Le flux Desktop utilise state et PKCE S256. Le code verifier reste uniquement en mémoire pendant la connexion.
- Les scopes prévus sont calendar.app.created, calendar.calendarlist.readonly et calendar.events. Ils couvrent la création des calendriers de l'application, la recherche en lecture de la liste et les événements nécessaires, sans demander le scope global calendar.
- Le statut Google effectue un renouvellement silencieux puis une requête Calendar légère. Une révocation affiche « Reconnecter Google » ; une panne réseau est signalée comme temporaire et ne supprime pas le token.
- La version n'est donc pas encore validée pour distribution ; validation avec comptes de test et packaging final encore nécessaires.

Le dossier tools, les tests, les sources de fabrication et original-integrity.json sont réservés à la préparation, jamais à inclure dans un package distribué.
Les profils, configurations utilisateur, caches et secrets ne doivent jamais entrer dans un package.
DPAPI ne protège pas contre un logiciel malveillant exécuté sous le même compte Windows.

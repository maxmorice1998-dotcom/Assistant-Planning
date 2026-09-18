Fabriquer l’installateur avec `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-installer.ps1`.

`INSTALLER Assistant Planning.exe` installe l’application pour le compte Windows courant dans `%LOCALAPPDATA%\Assistant Planning`. Il crée ou remplace la tâche `Assistant Planning - Synchronisation automatique`, déclenchée 12 secondes après l’ouverture de session, le déverrouillage ou la sortie de veille, sans privilèges administrateur ni mot de passe Windows.

La session AGATT est sauvegardée avec le chiffrement Windows du compte courant et restaurée automatiquement si nécessaire. Lors d’une connexion manuelle réussie depuis l’assistant, les identifiants saisis sont également chiffrés pour rétablir la connexion après expiration de la session. Si AGATT demande une validation supplémentaire ou refuse les identifiants, une connexion manuelle reste nécessaire.

La tâche lance l’exécutable installé avec `--background-sync`. Cette option lance uniquement le moteur existant, sans interface ni console. Les navigateurs nécessaires sont ouverts en mode headless ; ceux ouverts par cette synchronisation sont fermés à la fin. Les profils, identifiants et configurations restent dans `%LOCALAPPDATA%\SDIS-Bot-Collegues`.

Le journal existant `assistant-planning.log` reçoit les lignes `[AUTO]` de démarrage, succès ou erreur. Les erreurs de synchronisation utilisent uniquement l’envoi existant de `send-combined-alerts.js` ; aucun deuxième envoi n’est ajouté pour cette exécution. Si Internet ou l’autorisation Gmail empêche l’envoi, le statut d’envoi et l’erreur restent enregistrés dans les fichiers existants. Les connexions initiales doivent déjà avoir été configurées dans l’application.

Une mise à jour et une réinstallation créent ou remplacent la tâche avec le chemin réel de destination. Les instances concurrentes sont ignorées par Windows et protégées par le verrou existant du moteur.

Publier les artefacts compilés avec `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1`, après avoir poussé le commit correspondant sur GitHub. Le script utilise l’identifiant GitHub déjà enregistré, téléverse les fichiers dans une release brouillon, vérifie leurs tailles et empreintes, puis rend la release publique et vérifie le manifest du canal stable.

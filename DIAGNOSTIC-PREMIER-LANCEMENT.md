# Diagnostic du premier lancement — 12 septembre 2026

La paire OAuth de `google-desktop-oauth.json` est cohérente et configurée. Aucune valeur OAuth n'est reproduite ici.

## Refus EPERM

Chemin exécuté : `C:\Users\Accueil\Desktop\sdis-bot-installateur\SDIS-Collegues-Bridge.exe`.

Observations reproductibles avec `tools/diagnose-launch.js` :

- Node lançant `node.exe --version` avec redirections : `EPERM`, aucun code de sortie enfant.
- Même lancement sans redirections : code 0.
- Node lançant le pont avec redirections : `EPERM`, aucun code de sortie enfant.
- Même pont sans redirections, sans argument : code 2 attendu (validation des arguments).
- Le lancement asynchrone Node avec redirections échoue aussi avec `EPERM`.
- Le même pont, lancé via .NET avec redirections, réalise un aller-retour DPAPI réussi (`tools/diagnose-bridge.ps1`). Test effectué avec une chaîne factice non secrète.
- Le compte exécutant les tests n'est pas administrateur.
- Les ACL autorisent le compte courant à exécuter le fichier. Aucun flux Zone.Identifier n'est présent. Aucun processus du pont ne restait actif au contrôle. Aucun verrou empêchant l'exécution n'est démontré : l'exécution native réussit.

Le refus est isolé à la création des redirections Node dans ce contexte restreint ; ce n'est pas une erreur retournée par le code DPAPI. L'exécution du pont et DPAPI CurrentUser fonctionnent sans élévation. Cela ne constitue pas une validation sur un autre compte Windows ou sur le PC du collègue.

## Absence de callback

`tools/diagnose-windows-context.ps1` constate un jeton Windows restreint, la station WinSta0 et un bureau CodexSandboxDesktop distinct du bureau interactif habituel.

`tools/diagnose-browser-callback.js` utilise le même lancement rundll32 que l'application, vers une page locale sans OAuth :

- Le serveur 127.0.0.1 répond au contrôle HTTP direct.
- rundll32 démarre et sort avec le code 0.
- Aucune visite du navigateur ne parvient à la page locale pendant 15 secondes.

Le code de sortie du lanceur ne prouve donc pas l'ouverture effective d'un navigateur utilisable. L'absence de retour se reproduit sans Google ni identifiants OAuth. Le contexte de bureau isolé rend ce test interactif non représentatif d'un double-clic par un collègue sur son bureau Windows ; le mécanisme Windows exact qui empêche l'ouverture du navigateur n'a pas été établi au-delà de ces observations.

## Résultat et limite

Le test réel renouvelé utilise `.google-clean-8ca8209c` : aucun token, secret client DPAPI, profil AGATT/Dendreo, agentId ou calendarId. Il expire après cinq minutes sans retour Google et sans token enregistré.

Aucun changement supplémentaire du flux OAuth ni du pont n'est justifié par ces observations. Les restrictions de cette session n'autorisent pas de relance hors sandbox. Ne pas contourner cette restriction en changeant le transport des secrets ou les permissions du programme.

La validation réelle doit être exécutée dans une session Windows interactive normale, sans élévation, avec un nouveau dossier de données applicatives. L'installateur n'a pas été reconstruit, faute de succès de ce test.

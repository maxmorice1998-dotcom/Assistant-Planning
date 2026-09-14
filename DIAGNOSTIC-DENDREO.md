# Diagnostic Dendreo — 14 septembre 2026

Travail effectué uniquement dans le projet source. Aucune synchronisation réelle,
aucune suppression/création Dendreo, aucun envoi de mail, aucune publication et
aucune reconstruction de l'installateur.

## Cause démontrée de la garde du 02/10 ignorée

`sync.js/getRawDateFromAgattId()` renvoie `20261002`. Le producteur du snapshot
écrivait cette valeur dans `guards[].date`. Les consommateurs Dendreo filtraient
sur `YYYY-MM-DD`, éliminant toutes ces gardes sans erreur.

Le compte rendu installé `simulation-status.json`, daté du 13/09/2026 à
22:40:52 UTC, confirme : Google synchronisé, puis « Gardes fiables : 0 » dans
le nettoyage et « 0 garde(s) » dans la synchronisation Dendreo.

Avant correction, le dry-run autonome, qui interroge Google sans snapshot,
recevait bien `2026-10-02` et décidait CREATE. Après correction, un test avec les
dix dates compactes dans un snapshot et un état Dendreo fictivement vide confirme
que `20261002` devient `2026-10-02` et arrive dans la boucle. Le faux état Dendreo
du snapshot est ignoré au profit du serveur.

## Page réelle et doublon

La page utilise FullCalendar 4 et des liens `a.fc-event` avec `data-creneau-id`.
Les anciens sélecteurs correspondent donc aux classes réellement présentes.
Ils associent cependant événements et dates par chevauchement de rectangles,
et ne garantissent ni la présence des événements masqués ni la fin du chargement.
Le clic historique a ouvert le bon formulaire du 02/10 en lecture seule : ce clic
n'est pas la cause démontrée de l'absence actuelle.

Lecture GET directe de la source `config_agenda.events_url`, identique à celle
utilisée par FullCalendar :

- 02/10 : aucun événement.
- 06/10 : indisponibilités bot `1000000001523` et `1000000001558`, toutes deux du
  06/10 00:00 au 07/10 00:00 exclusif.
- 12/10 : une seule indisponibilité bot.

Le formulaire GET edit de 1558 confirme le marqueur exact, l'identifiant, les
dates du 06/10 et `recurrent=0`. Aucune requête DELETE n'a été exécutée.

L'ancien contrôle regroupait les bots par date et texte, puis les normalisait
sans identifiant dans la clé. Deux événements distincts devenaient une entrée.
Son compteur `bot=0` comptait les différences, pas les événements présents.
Le nettoyage était court-circuité par les dates compactes rejetées.

Les journaux disponibles ne permettent pas d'attribuer avec certitude la seconde
création à une exécution précise. Les risques identifiés dans l'ancien code sont
la lecture DOM avant chargement complet, l'attente fixe après POST, l'absence de
verrou entre processus et l'absence de déduplication des gardes du snapshot.
Il n'existe pas de retry explicite dans la boucle de création examinée. Un nouvel
appel pouvait cependant recréer après un échec de détection.

## Corrections

- `sync.js` : contrat ISO au point de production du snapshot, sans changer les
  dates compactes utilisées en interne par AGATT/Google.
- `dendreo-state.js` : normalisation stricte des dates ; priorité jour/24h sur
  nuit ; déduplication des dates ; lecture GET sans cache de la source réelle ;
  fin exclusive ; conservation de chaque identifiant ; journal par date.
- `sync-dendreo.js` : même lecteur serveur pour la décision et la vérification ;
  sélection FullCalendar et formulaire précisément ciblés ; une réponse POST ou
  un clic ne suffisent pas ; exactement une nouvelle indisponibilité portant le
  titre attendu doit être relue. Aucun retry automatique. Les événements manuels
  restent présents, même lorsqu'une garde nécessite une création à la même date.
- `cleanup-dendreo-stale.js` : même source de gardes et même lecteur ; conserve
  un bot par date de garde et retire seulement les autres IDs vérifiés ; aucune
  suppression sans marqueur exact, ID, date unique et formulaire non récurrent.
  Une relecture vérifie la disparition de l'ID et la présence des autres événements.
- `sdis-utils.js` : invalidation du snapshot avant toute tentative d'écriture,
  indicateur d'écriture irréversible pendant l'exécution, y compris après échec
  de confirmation ou étape suivante sans action.
- `check-dendreo-alerts.js` : contrôle final toujours relu sur le serveur ; nombre
  d'événements distinct des changements ; signalement des dates manquantes et
  doublons ; migration explicite des anciennes références géométriques.
- `test-dendreo.js` : sept tests locaux de régression.

Les scripts de mutation partagent un verrou exclusif local. Le dry-run a priorité
sur `--real` si les deux arguments sont fournis. `ensure-dendreo-browser.js` et le
runner ne nécessitent pas de modification : les lecteurs attendent la source
réelle, et le contrôle final ne réutilise plus leur snapshot Dendreo.

## Validation

Syntaxe Node vérifiée sur les sept fichiers JavaScript modifiés/ajoutés.
Sept tests locaux réussis : dates, jour/nuit, identifiants distincts, protection
du manuel, échec de lecture, invalidation de cache, confirmation de création.
Trois scripts exécutés uniquement en dry-run contre Dendreo réel.

Résultat : 36 événements, 10 indisponibilités bot, une date manquante (02/10),
une date en doublon (06/10). Les données distantes n'ont pas été corrigées puisque
l'exécution réelle n'est pas autorisée. Les chemins d'écriture sont testés localement,
mais aucun POST/DELETE réel n'a servi à leur validation.

Les sources précédentes sont conservées dans `diagnostic-dendreo-backup`.
Le test avec dates compactes est conservé dans `dendreo-dry-run-result.txt`.

## Commandes PowerShell en lecture seule

```powershell
Set-Location 'C:\Users\Accueil\Desktop\sdis-bot-installateur'
& .\runtime\node\node.exe .\sync-dendreo.js --dry-run
& .\runtime\node\node.exe .\cleanup-dendreo-stale.js --dry-run
& .\runtime\node\node.exe .\check-dendreo-alerts.js after --dry-run
& .\runtime\node\node.exe --test .\test-dendreo.js
```

L'agenda Dendreo doit être connecté dans le navigateur géré par l'assistant,
sur le port 19223. Ces commandes utilisent le code source corrigé ; l'application
installée n'a pas été remplacée.

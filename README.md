# Rebecca • Anteprima feed

Applicazione web statica ottimizzata per Safari e Chrome su iPhone. Simula il profilo Instagram e permette di pianificare visivamente il feed.

## Funzioni

- griglia verticale 3:4 come il profilo mostrato negli screenshot;
- ritaglio della copertina senza deformare l'immagine;
- trascinamento e zoom per scegliere l'inquadratura;
- post con una o più foto;
- scelta della foto da usare come copertina nei post multipli;
- simbolo del carosello mostrato soltanto quando il post contiene più foto;
- visualizzazione del file originale quando il post viene aperto, senza stiramenti;
- riordino ed eliminazione dei post;
- salvataggio locale tramite IndexedDB;
- backup completo tramite esportazione e importazione JSON;
- funzionamento offline dopo il primo caricamento.

## Aggiornamento su GitHub Pages

Per aggiornare una versione già pubblicata, sostituisci nel repository questi file:

- `index.html`
- `styles.css`
- `app.js`
- `sw.js`

La cartella `assets` non deve essere cancellata. Dopo il commit, attendi il nuovo deploy di GitHub Pages e ricarica il sito. Il nuovo service worker elimina automaticamente la vecchia cache.

## Memorizzazione

Foto, ordine e ritagli vengono conservati nello stesso browser e sullo stesso indirizzo. La versione aggiornata ripara automaticamente i 14 post iniziali memorizzati male senza eliminare i post aggiunti dall'utente.

Per proteggersi dalla cancellazione dei dati di Safari, usa periodicamente `…` → `Esporta backup`.

## Instagram

Questa versione non contiene password, token o credenziali Meta. Nessuna foto viene pubblicata su Instagram o caricata su server esterni.

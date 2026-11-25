# Lampada web viewer

Il plugin [Lampada](https://github.com/rubengrep/lampada) in una sola pagina HTML, per i computer dove non si può installare Obsidian (per esempio un PC dell'ufficio). Basta un browser.

## Come si usa

1. Scarica `lampada.html` dall'ultima release.
2. Mettilo dove vuoi, anche nella cartella di OneDrive accanto al vault.
3. Aprilo con un doppio clic in **Edge** o **Chrome**. Firefox e Safari non possono aprire le cartelle.
4. Premi **Apri la cartella del vault** e scegli la cartella del vault, quella con dentro `.obsidian` e `.lampada`.

Il browser si ricorda la cartella: le volte dopo basta un clic su **Riapri**.

- La prima apertura legge tutte le note e può durare un po'. Dalla volta dopo rilegge solo quelle cambiate.
- Comandi: **Ctrl+P**. Impostazioni: **Ctrl+,**. Ci sono anche nel pulsantino ⋯ in basso a sinistra.

## Cosa fa e cosa no

- **Funziona come in Obsidian:** Bibbia, Biblioteca, Oggi, SCRABB, Chiedi (con la chiave OpenRouter), evidenziazioni, segnalibri e risposte. I dati sono quelli del vault: quello che cambi qui lo vedi anche in Obsidian, dopo la sincronizzazione.
- **Note:** si aprono in sola lettura.
- **Non funziona:**
  - **Download e importazioni dal sito:** il sito non permette alle pagine web di leggerlo. Si fanno da Obsidian, e qui compare quello che c'è già nel vault.
  - **I comandi che servono un editor di note.**
- **Impostazioni per dispositivo:** il browser ha le sue (`stato-web.json`, `index-cache-web.json`). Quelle del computer con Obsidian restano sue.

La pagina non manda dati da nessuna parte. Si collega solo a OpenRouter, quando usi l'intelligenza artificiale.

## Sviluppo

Il codice di Lampada resta nel suo repo. Qui c'è solo lo strato che fa le veci di Obsidian nel browser:

| File | Contenuto |
|---|---|
| `src/obsidian.js` | le parti dell'API di Obsidian usate da Lampada: aggiunte agli elementi HTML, finestre, menu, impostazioni, viste, icone, markdown |
| `src/vault.js` | file del vault (cartella scelta nel browser o server di prova), elenco dei file, proprietà e link delle note |
| `src/avvio.js` | pagina iniziale e avvio del plugin |
| `src/base.css` | colori e pezzi di interfaccia di Obsidian che lo stile di Lampada dà per scontati |

- **Build:** `npm run build` genera `dist/lampada.html`, con Lampada alla versione `lampada` di `package.json` scaricata da GitHub. Per usare una cartella locale: `LAMPADA_DIR=/percorso/di/lampada npm run build`.
- **Prova senza scegliere la cartella:** `node scripts/server-prova.js <vault>`. Il server legge il vault senza modificarlo: le scritture restano in memoria.

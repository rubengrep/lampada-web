/*
 * Lampada web: avvio. Si sceglie la cartella del vault (una volta; poi basta un clic per riaprirla), si leggono
 * l'elenco dei file e le proprietà delle note, poi parte il plugin vero, con la vista unica a tutta pagina.
 */
import { FuzzySuggestModal, Keymap, Menu, Modal, Notice, Scope, Workspace } from './obsidian.js';
import { FileManager, MetadataCache, Vault, handleFs, httpFs, idbGet, idbSet, resolveImages } from './vault.js';
import LampadaPlugin from 'lampada/src/main.js';
import manifest from 'lampada/manifest.json';
import CSS_BASE from './base.css';
import CSS_LAMPADA from 'lampada/styles.css';

const PLUGIN_DIR = `.obsidian/plugins/${manifest.id}`;

document.head.createEl('style', { text: CSS_BASE });
document.head.createEl('style', { text: CSS_LAMPADA });
const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => {
  document.body.toggleClass('theme-dark', dark.matches);
  document.body.toggleClass('theme-light', !dark.matches);
};
dark.addEventListener('change', theme);
theme();
document.body.addClass('is-desktop', 'lmp-web');

const start = document.body.createDiv('lmp-web-start');
start.createEl('h1', { text: 'Lampada' });
const info = start.createEl('p', { text: 'Scegli la cartella del vault (quella con dentro .obsidian e .lampada).' });
const buttons = start.createDiv('lmp-web-buttons');
const status = start.createEl('p', 'lmp-web-status');

function fail(msg) {
  status.setText(msg);
  status.addClass('is-error');
}

async function pick() {
  if (!window.showDirectoryPicker) return fail('Questo browser non può aprire le cartelle: usa Edge o Chrome.');
  try {
    const dir = await showDirectoryPicker({ id: 'lampada-vault', mode: 'readwrite' });
    await idbSet('vault-handle', dir);
    await boot(handleFs(dir));
  } catch (e) {
    if (e.name !== 'AbortError') fail(`Cartella non aperta: ${e.message}`);
  }
}

async function reopen(dir) {
  try {
    if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return fail('Permesso negato: scegli di nuovo la cartella.');
    await boot(handleFs(dir));
  } catch (e) {
    fail(`Cartella non aperta: ${e.message}`);
  }
}

async function boot(fs) {
  buttons.hide();
  info.setText(`Apro «${fs.name}»…`);
  if (!(await fs.stat(`${PLUGIN_DIR}/data.json`)) && !(await fs.stat('.lampada'))) {
    buttons.show();
    return fail('In questa cartella non c’è Lampada (manca .obsidian/plugins/lampada o .lampada). Scegli la cartella del vault.');
  }
  const app = (window.app = {
    isMobile: false,
    viewRegistry: {},
    commands: { list: [], executeCommandById: (id) => runCommand(app.commands.list.find((c) => c.id === id)) },
    plugins: { plugins: {}, getPlugin: (id) => app.plugins.plugins[id] || null, enabledPlugins: new Set([manifest.id]) },
    internalPlugins: { getPluginById: () => null, getEnabledPluginById: () => null },
    loadLocalStorage(k) {
      try {
        const v = localStorage.getItem(`${fs.name}-${k}`);
        return v == null ? null : JSON.parse(v);
      } catch (e) {
        return null;
      }
    },
    saveLocalStorage(k, v) {
      try {
        v == null ? localStorage.removeItem(`${fs.name}-${k}`) : localStorage.setItem(`${fs.name}-${k}`, JSON.stringify(v));
      } catch (e) {
        /* niente localStorage: si ricomincia ogni volta */
      }
    },
    showInFolder: () => new Notice('Nel browser non si può mostrare il file nella cartella.'),
    openWithDefaultApp: () => {},
  });
  app.scope = new Scope();
  app.keymap = new Keymap(app);
  app.vault = new Vault(app, fs);
  app.metadataCache = new MetadataCache(app);
  app.fileManager = new FileManager(app);
  resolveImages(app.vault.adapter);

  await app.vault.scan((n) => info.setText(`Elenco dei file: ${n}…`));
  app.metadataCache.rebuildLinks();
  await app.metadataCache.load((n, tot) => info.setText(`Leggo le note: ${n} di ${tot}…`));
  info.setText('Avvio Lampada…');

  const root = document.body.createDiv('lmp-web-root');
  app.workspace = new Workspace(app, root);
  app.setting = settingsOf(app);
  const plugin = new LampadaPlugin(app, { ...manifest, dir: PLUGIN_DIR });
  app.plugins.plugins[manifest.id] = plugin;
  plugin._loaded = true;
  await plugin.onload();
  await app.workspace.start();
  start.remove();
  await plugin.openApp();
  addCorner(app);
  app.scope.register(['Mod'], 'p', () => (new CommandModal(app).open(), false));
  app.scope.register(['Mod'], ',', () => (app.setting.open(), false));
  window.addEventListener('beforeunload', () => plugin.onunload());
}

function runCommand(c) {
  if (!c) return;
  if (c.callback) return c.callback();
  if (c.checkCallback) return c.checkCallback(false);
  new Notice('Questo comando serve un editor di note: nel browser non c’è.');
}

class CommandModal extends FuzzySuggestModal {
  constructor(app) {
    super(app);
    this.setPlaceholder('Cerca un comando…');
  }
  getItems() { return this.app.commands.list.filter((c) => (c.callback || (c.checkCallback && c.checkCallback(true) !== false))); }
  getItemText(c) { return c.name; }
  onChooseItem(c) { runCommand(c); }
}

function settingsOf(app) {
  return {
    tabs: [],
    modal: null,
    open() {
      const tab = this.tabs[0];
      if (!tab) return;
      const m = (this.modal = new Modal(app));
      m.modalEl.addClass('mod-settings', 'lmp-web-settings');
      m.setTitle('Impostazioni di Lampada');
      m.contentEl.appendChild(tab.containerEl);
      tab.containerEl.empty();
      tab.display();
      m.onClose = () => tab.hide();
      m.open();
    },
    openTabById() { this.open(); },
    close() { if (this.modal) this.modal.close(); },
  };
}

/** Un pulsantino nell'angolo: comandi e impostazioni (in Obsidian sarebbero nella sua interfaccia). */
function addCorner(app) {
  const b = document.body.createEl('button', { cls: 'lmp-web-corner clickable-icon', attr: { 'aria-label': 'Comandi e impostazioni', title: 'Comandi (Ctrl+P) e impostazioni (Ctrl+,)' } });
  b.setText('⋯');
  b.addEventListener('click', (e) => {
    new Menu()
      .addItem((i) => i.setTitle('Comandi…').setIcon('search').onClick(() => new CommandModal(app).open()))
      .addItem((i) => i.setTitle('Impostazioni').setIcon('settings').onClick(() => app.setting.open()))
      .addItem((i) => i.setTitle('Cambia cartella').setIcon('folder-open').onClick(() => location.reload()))
      .showAtMouseEvent(e);
  });
}

(async () => {
  const server = new URLSearchParams(location.search).get('server');
  if (server) return boot(httpFs(server.replace(/\/$/, ''))).catch((e) => (console.error(e), fail(e.message)));
  const saved = await idbGet('vault-handle');
  if (saved) buttons.createEl('button', { cls: 'mod-cta', text: `Riapri «${saved.name}»` }).addEventListener('click', () => reopen(saved));
  buttons.createEl('button', { cls: saved ? '' : 'mod-cta', text: saved ? 'Scegli un’altra cartella' : 'Apri la cartella del vault' }).addEventListener('click', pick);
})();

window.addEventListener('unhandledrejection', (e) => console.error('[lampada web]', e.reason));

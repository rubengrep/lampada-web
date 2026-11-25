/*
 * Lampada web: il vault letto dal browser. Due modi di arrivare ai file:
 * - handleFs: la cartella scelta con showDirectoryPicker (Edge/Chrome, anche aprendo l'HTML da OneDrive);
 * - httpFs: un piccolo server di prova (web/server-prova.js), per provare sul Mac senza la finestra di scelta.
 */
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

const enc = new TextEncoder();
const dec = new TextDecoder();
const toBuf = (d) => (typeof d === 'string' ? enc.encode(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : d);
const parentOf = (p) => p.split('/').slice(0, -1).join('/');
const nameOf = (p) => p.split('/').pop();

/* ---------------- Eventi (come Events di Obsidian) ---------------- */

class Events {
  constructor() { this._ev = {}; }
  on(name, fn, ctx) {
    const ref = { e: this, name, fn, ctx };
    (this._ev[name] ||= []).push(ref);
    return ref;
  }
  off(name, fn) { this._ev[name] = (this._ev[name] || []).filter((r) => r.fn !== fn); }
  offref(ref) { if (ref) this._ev[ref.name] = (this._ev[ref.name] || []).filter((r) => r !== ref); }
  trigger(name, ...data) {
    for (const r of [...(this._ev[name] || [])]) {
      try {
        r.fn.apply(r.ctx, data);
      } catch (e) {
        console.error(e);
      }
    }
  }
  tryTrigger(ref, args) { ref.fn.apply(ref.ctx, args); }
}

/* ---------------- Accesso ai file ---------------- */

function handleFs(root) {
  const dirs = new Map([['', root]]);
  async function dir(path, create = false) {
    if (dirs.has(path)) return dirs.get(path);
    const h = await (await dir(parentOf(path), create)).getDirectoryHandle(nameOf(path), { create });
    dirs.set(path, h);
    return h;
  }
  const file = async (path, create = false) => (await dir(parentOf(path), create)).getFileHandle(nameOf(path), { create });
  return {
    name: root.name,
    async list(path) {
      const out = { files: [], folders: [] };
      for await (const [n, h] of (await dir(path)).entries()) (h.kind === 'directory' ? out.folders : out.files).push(n);
      return out;
    },
    async read(path) { return (await (await file(path)).getFile()).arrayBuffer(); },
    async write(path, data) {
      const w = await (await file(path, true)).createWritable();
      await w.write(toBuf(data));
      await w.close();
    },
    async mkdir(path) { await dir(path, true); },
    async remove(path) { await (await dir(parentOf(path))).removeEntry(nameOf(path)); },
    async rmdir(path, recursive) {
      await (await dir(parentOf(path))).removeEntry(nameOf(path), { recursive });
      for (const k of [...dirs.keys()]) if (k === path || k.startsWith(`${path}/`)) dirs.delete(k);
    },
    async stat(path) {
      try {
        const f = await (await file(path)).getFile();
        return { type: 'file', size: f.size, mtime: f.lastModified, ctime: f.lastModified };
      } catch (e) {
        try {
          await dir(path);
          return { type: 'folder', size: 0, mtime: 0, ctime: 0 };
        } catch (e2) {
          return null;
        }
      }
    },
  };
}

function httpFs(base) {
  const u = (op, p) => `${base}/${op}?p=${encodeURIComponent(p)}`;
  const ok = async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r;
  };
  return {
    name: 'vault (prova)',
    list: async (p) => (await ok(await fetch(u('list', p)))).json(),
    read: async (p) => (await ok(await fetch(u('file', p)))).arrayBuffer(),
    write: async (p, d) => void (await ok(await fetch(u('file', p), { method: 'PUT', body: toBuf(d) }))),
    mkdir: async (p) => void (await ok(await fetch(u('mkdir', p), { method: 'POST' }))),
    remove: async (p) => void (await ok(await fetch(u('file', p), { method: 'DELETE' }))),
    rmdir: async (p) => void (await ok(await fetch(u('rmdir', p), { method: 'POST' }))),
    stat: async (p) => {
      const r = await fetch(u('stat', p));
      return r.ok ? r.json() : null;
    },
  };
}

/* ---------------- File e cartelle ---------------- */

class TAbstractFile {
  constructor(vault, path) {
    this.vault = vault;
    this.path = path;
    this.name = nameOf(path);
    this.parent = null;
  }
}

class TFile extends TAbstractFile {
  constructor(vault, path, stat) {
    super(vault, path);
    const i = this.name.lastIndexOf('.');
    this.basename = i > 0 ? this.name.slice(0, i) : this.name;
    this.extension = i > 0 ? this.name.slice(i + 1).toLowerCase() : '';
    this.stat = stat || { mtime: 0, ctime: 0, size: 0 };
  }
}

class TFolder extends TAbstractFile {
  constructor(vault, path) {
    super(vault, path);
    this.children = [];
  }
  isRoot() { return this.path === '/'; }
}

/* ---------------- Adattatore (percorsi del vault, anche nascosti) ---------------- */

// ponytail: i file "per dispositivo" del Mac (…-desktop.json) restano suoi; il browser ne ha di suoi. Se servono
// altri file per dispositivo, aggiungerli qui.
const deviceFile = (p) => p.replace(/^(\.obsidian\/plugins\/[^/]+\/(?:index-cache|stato))-desktop\.json$/, '$1-web.json');

class Adapter {
  constructor(vault, fs) {
    this.vault = vault;
    this.fs = fs;
    this.urls = new Map();
  }
  getName() { return this.fs.name; }
  async read(p) { return dec.decode(await this.fs.read(deviceFile(p))); }
  readBinary(p) { return this.fs.read(deviceFile(p)); }
  async write(p, data) {
    p = deviceFile(p);
    await this.mkdir(parentOf(p));
    await this.fs.write(p, data);
    this.urls.delete(p);
    await this.vault.touched(p);
  }
  writeBinary(p, data) { return this.write(p, data); }
  async append(p, text) { await this.write(p, ((await this.exists(p)) ? await this.read(p) : '') + text); }
  async exists(p) { return !!(await this.fs.stat(deviceFile(p))); }
  stat(p) { return this.fs.stat(deviceFile(p)); }
  async list(p) {
    const l = await this.fs.list(p);
    const full = (n) => (p ? `${p}/${n}` : n);
    return { files: l.files.map(full), folders: l.folders.map(full) };
  }
  async mkdir(p) { if (p) await this.fs.mkdir(p); }
  async remove(p) {
    await this.fs.remove(p);
    this.vault.gone(p);
  }
  async rmdir(p, recursive) {
    await this.fs.rmdir(p, recursive);
    this.vault.gone(p);
  }
  async rename(a, b) {
    await this.write(b, await this.fs.read(a));
    await this.remove(a);
  }
  async copy(a, b) { await this.write(b, await this.fs.read(a)); }
  async trashLocal(p) { await this.remove(p); }
  async trashSystem(p) { await this.remove(p); return true; }
  /** Indirizzo per <img src>: va dato subito, ma il file si legge dopo. Un segnaposto che resolveImages() sostituisce. */
  getResourcePath(p) {
    return this.urls.get(p) || `data:image/gif;base64,R0lGODlhAQABAAAAACw=#lmp=${encodeURIComponent(p)}`;
  }
  async resolve(p) {
    if (!this.urls.has(p)) {
      const ext = p.split('.').pop().toLowerCase();
      const type = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf' }[ext] || '';
      this.urls.set(p, URL.createObjectURL(new Blob([await this.fs.read(p)], { type })));
    }
    return this.urls.get(p);
  }
}

/** Sostituisce i segnaposto di getResourcePath con il file vero, ovunque compaiano nella pagina. */
function resolveImages(adapter) {
  const fix = async (img) => {
    const m = /#lmp=(.+)$/.exec(img.getAttribute('src') || '');
    if (!m) return;
    try {
      img.src = await adapter.resolve(decodeURIComponent(m[1]));
    } catch (e) {
      img.removeAttribute('src');
    }
  };
  const scan = (n) => {
    if (n.nodeType !== 1) return;
    if (n.tagName === 'IMG') fix(n);
    else n.querySelectorAll('img[src*="#lmp="]').forEach(fix);
  };
  new MutationObserver((list) => {
    for (const m of list) m.type === 'attributes' ? scan(m.target) : m.addedNodes.forEach(scan);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
}

/* ---------------- Vault: i file visibili (fuori dalle cartelle col punto) ---------------- */

const hidden = (p) => p.split('/').some((s) => s.startsWith('.'));

class Vault extends Events {
  constructor(app, fs) {
    super();
    this.app = app;
    this.adapter = new Adapter(this, fs);
    this.configDir = '.obsidian';
    this.files = new Map();
    this.root = new TFolder(this, '/');
    this.root.name = '';
    this.files.set('/', this.root);
    this.reads = new Map();
  }
  getName() { return this.adapter.getName(); }

  /** Elenca i file visibili, con data e dimensione (servono alle cache di Lampada). */
  async scan(progress) {
    const fs = this.adapter.fs;
    let level = [''];
    let n = 0;
    while (level.length) {
      const next = [];
      await Promise.all(
        level.map(async (d) => {
          const l = await fs.list(d).catch(() => ({ files: [], folders: [] }));
          for (const f of l.folders) if (!f.startsWith('.')) next.push(this.addFolder(d ? `${d}/${f}` : f).path);
          await Promise.all(
            l.files.filter((f) => !f.startsWith('.')).map(async (f) => {
              const p = d ? `${d}/${f}` : f;
              this.addFile(p, await fs.stat(p));
              if (++n % 500 === 0 && progress) progress(n);
            })
          );
        })
      );
      level = next;
    }
  }
  addFolder(path) {
    if (this.files.has(path)) return this.files.get(path);
    const f = new TFolder(this, path);
    f.parent = path.includes('/') ? this.addFolder(parentOf(path)) : this.root;
    f.parent.children.push(f);
    this.files.set(path, f);
    return f;
  }
  addFile(path, stat) {
    let f = this.files.get(path);
    if (f) {
      f.stat = stat || f.stat;
      return f;
    }
    f = new TFile(this, path, stat);
    f.parent = path.includes('/') ? this.addFolder(parentOf(path)) : this.root;
    f.parent.children.push(f);
    this.files.set(path, f);
    return f;
  }
  /** Dopo una scrittura (anche dall'adattatore): aggiorna l'elenco e avvisa, come il watcher di Obsidian. */
  async touched(path) {
    this.reads.delete(path);
    if (hidden(path)) return;
    const isNew = !this.files.has(path);
    const f = this.addFile(path, await this.adapter.fs.stat(path));
    this.trigger(isNew ? 'create' : 'modify', f);
    if (f.extension === 'md') await this.app.metadataCache.update(f);
  }
  gone(path) {
    this.reads.delete(path);
    const f = this.files.get(path);
    if (!f) return;
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(`${path}/`)) this.files.delete(k);
    if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
    this.app.metadataCache.forget(path);
    this.trigger('delete', f);
  }

  getAbstractFileByPath(p) { return this.files.get(p) || null; }
  getFileByPath(p) { const f = this.files.get(p); return f instanceof TFile ? f : null; }
  getFolderByPath(p) { const f = this.files.get(p); return f instanceof TFolder ? f : null; }
  getRoot() { return this.root; }
  getFiles() { return [...this.files.values()].filter((f) => f instanceof TFile); }
  getMarkdownFiles() { return this.getFiles().filter((f) => f.extension === 'md'); }
  getAllLoadedFiles() { return [...this.files.values()]; }
  async read(f) {
    const text = await this.adapter.read(f.path);
    this.reads.set(f.path, { mtime: f.stat.mtime, text });
    return text;
  }
  async cachedRead(f) {
    const c = this.reads.get(f.path);
    return c && c.mtime === f.stat.mtime ? c.text : this.read(f);
  }
  async create(path, data) {
    if (this.files.has(path)) throw new Error('Il file esiste già.');
    await this.adapter.write(path, data);
    return this.files.get(path);
  }
  async createBinary(path, data) { return this.create(path, data); }
  async createFolder(path) {
    await this.adapter.mkdir(path);
    if (!hidden(path)) this.trigger('create', this.addFolder(path));
  }
  async modify(f, data) { await this.adapter.write(f.path, data); }
  async modifyBinary(f, data) { await this.adapter.write(f.path, data); }
  async append(f, data) { await this.adapter.append(f.path, data); }
  async process(f, fn) {
    const text = fn(await this.read(f));
    await this.modify(f, text);
    return text;
  }
  async delete(f) {
    f instanceof TFolder ? await this.adapter.rmdir(f.path, true) : await this.adapter.remove(f.path);
  }
  async trash(f) { await this.delete(f); }
  async rename(f, newPath) {
    const old = f.path;
    await this.adapter.rename(old, newPath);
    this.trigger('rename', this.files.get(newPath), old);
  }
  getResourcePath(f) { return this.adapter.getResourcePath(f.path); }
}

/* ---------------- Dati delle note (come metadataCache) ---------------- */

const DB = 'lampada-web';
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', mode);
      const q = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(q && q.result);
      tx.onerror = () => rej(tx.error);
    };
  });
}
const idbGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch((e) => console.warn('[lampada web] cache', e));

const pos = (text, i, len) => {
  const before = text.slice(0, i);
  const line = before.split('\n').length - 1;
  const col = i - before.lastIndexOf('\n') - 1;
  return { start: { line, col, offset: i }, end: { line, col: col + len, offset: i + len } };
};

/** Frontmatter, titoli, link, incorporamenti, blocchi ^id e tag: i campi che Lampada legge. */
function parseNote(text) {
  const out = { links: [], embeds: [], headings: [], blocks: {}, tags: [] };
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm) {
    try {
      out.frontmatter = yamlParse(fm[1]) || undefined;
    } catch (e) {
      /* frontmatter illeggibile */
    }
  }
  for (const m of text.matchAll(/(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
    const link = m[2].trim();
    (m[1] ? out.embeds : out.links).push({ link, original: m[0], displayText: m[3] || link, position: pos(text, m.index, m[0].length) });
  }
  for (const m of text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)) out.headings.push({ heading: m[2], level: m[1].length, position: pos(text, m.index, m[0].length) });
  for (const m of text.matchAll(/\s\^([\w-]+)[ \t]*$/gm)) out.blocks[m[1].toLowerCase()] = { id: m[1], position: pos(text, m.index, m[0].length) };
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu)) out.tags.push({ tag: m[2], position: pos(text, m.index + m[1].length, m[2].length) });
  return out;
}

class MetadataCache extends Events {
  constructor(app) {
    super();
    this.app = app;
    this.cache = new Map();
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    this.byName = new Map();
    this.resolved = false;
  }
  getFileCache(f) { return (f && this.cache.get(f.path)?.m) || null; }
  getCache(path) { return this.cache.get(path)?.m || null; }

  /** Legge tutte le note (la prima volta; poi solo quelle cambiate, il resto viene dalla cache del browser). */
  async load(progress) {
    const vault = this.app.vault;
    const key = `meta:${vault.getName()}`;
    const saved = (await idbGet(key)) || {};
    const files = vault.getMarkdownFiles();
    let done = 0;
    const queue = [...files];
    const work = async () => {
      for (let f; (f = queue.shift()); ) {
        const s = saved[f.path];
        if (s && s.t === f.stat.mtime && s.s === f.stat.size) this.cache.set(f.path, { t: s.t, s: s.s, m: s.m });
        else {
          try {
            this.cache.set(f.path, { t: f.stat.mtime, s: f.stat.size, m: parseNote(await vault.cachedRead(f)) });
          } catch (e) {
            console.warn('[lampada web] nota illeggibile', f.path, e);
          }
        }
        if (++done % 200 === 0 && progress) progress(done, files.length);
      }
    };
    await Promise.all(Array.from({ length: 16 }, work));
    this.rebuildLinks();
    this.resolved = true;
    this.trigger('resolved');
    idbSet(key, Object.fromEntries(this.cache));
  }
  async update(f) {
    const text = await this.app.vault.cachedRead(f);
    this.cache.set(f.path, { t: f.stat.mtime, s: f.stat.size, m: parseNote(text) });
    this.rebuildLinks();
    this.trigger('changed', f, text, this.cache.get(f.path).m);
    this.trigger('resolve', f);
  }
  forget(path) {
    this.cache.delete(path);
    delete this.resolvedLinks[path];
  }
  rebuildLinks() {
    this.byName.clear();
    for (const f of this.app.vault.getFiles()) {
      for (const k of [f.name.toLowerCase(), f.basename.toLowerCase(), f.path.toLowerCase(), f.path.replace(/\.md$/, '').toLowerCase()]) {
        if (!this.byName.has(k)) this.byName.set(k, f);
      }
    }
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    for (const [path, { m }] of this.cache) {
      const r = (this.resolvedLinks[path] = {});
      const u = (this.unresolvedLinks[path] = {});
      for (const l of [...m.links, ...m.embeds]) {
        const dest = this.getFirstLinkpathDest(l.link.split('#')[0], path);
        if (dest) r[dest.path] = (r[dest.path] || 0) + 1;
        else u[l.link] = (u[l.link] || 0) + 1;
      }
    }
  }
  // ponytail: con due file dallo stesso nome vale il primo trovato (Obsidian sceglie il più vicino alla nota).
  getFirstLinkpathDest(link, sourcePath = '') {
    if (!link) return this.app.vault.getAbstractFileByPath(sourcePath);
    const k = link.trim().toLowerCase();
    const rel = sourcePath.includes('/') ? `${parentOf(sourcePath)}/${link}`.toLowerCase() : null;
    return (rel && (this.byName.get(rel) || this.byName.get(`${rel}.md`))) || this.byName.get(k) || this.byName.get(`${k}.md`) || null;
  }
  fileToLinktext(f, sourcePath, omitMd = true) {
    const name = omitMd && f.extension === 'md' ? f.basename : f.name;
    return this.byName.get(name.toLowerCase()) === f ? name : omitMd ? f.path.replace(/\.md$/, '') : f.path;
  }
}

class FileManager {
  constructor(app) { this.app = app; }
  async processFrontMatter(f, fn) {
    await this.app.vault.process(f, (text) => {
      const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
      const fm = (m && yamlParse(m[1])) || {};
      fn(fm);
      const body = m ? text.slice(m[0].length) : text;
      return Object.keys(fm).length ? `---\n${yamlStringify(fm).trimEnd()}\n---\n${body}` : body;
    });
  }
  async trashFile(f) { await this.app.vault.trash(f); }
  async renameFile(f, p) { await this.app.vault.rename(f, p); }
  generateMarkdownLink(f) { return `[[${this.app.metadataCache.fileToLinktext(f, '')}]]`; }
  getNewFileParent() { return this.app.vault.root; }
}

export { Events, handleFs, httpFs, resolveImages, idbGet, idbSet, parseNote, TAbstractFile, TFile, TFolder, Vault, MetadataCache, FileManager };

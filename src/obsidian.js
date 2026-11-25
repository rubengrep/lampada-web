/*
 * Lampada web: le parti di Obsidian che Lampada usa, rifatte per il browser. Il build (scripts/build-web.js)
 * mette questo file al posto del modulo "obsidian". Solo quello che serve a Lampada, non tutta l'API.
 */
import { marked } from 'marked';
import { parse as yamlParse } from 'yaml';
import ICONS from 'lmp-icons';
import { Events } from './vault.js';

/* ---------------- DOM: le aggiunte di Obsidian a HTMLElement ---------------- */

const splitCls = (c) => (Array.isArray(c) ? c : [c]).flatMap((x) => String(x || '').split(/\s+/)).filter(Boolean);

function applyOpts(el, o) {
  if (typeof o === 'string') o = { cls: o };
  if (!o) return el;
  if (o.cls) el.classList.add(...splitCls(o.cls));
  if (o.text != null) o.text instanceof Node ? el.appendChild(o.text) : (el.textContent = o.text);
  if (o.title != null) el.title = o.title;
  for (const k of ['type', 'value', 'placeholder', 'href']) if (o[k] != null) el.setAttribute(k, o[k]);
  if (o.value != null && 'value' in el) el.value = o.value;
  for (const [k, v] of Object.entries(o.attr || {})) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  if (o.parent) o.prepend ? o.parent.prepend(el) : o.parent.appendChild(el);
  return el;
}

function make(tag, o, cb) {
  const el = applyOpts(document.createElement(tag), o);
  if (cb) cb(el);
  return el;
}

const NP = Node.prototype;
const EP = Element.prototype;
Object.assign(NP, {
  createEl(tag, o, cb) {
    const el = make(tag, o, cb);
    typeof o === 'object' && o && o.prepend ? this.prepend(el) : this.appendChild(el);
    return el;
  },
  createDiv(o, cb) { return this.createEl('div', o, cb); },
  createSpan(o, cb) { return this.createEl('span', o, cb); },
  createSvg(tag, o = {}, cb) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (o.cls) el.classList.add(...splitCls(o.cls));
    for (const [k, v] of Object.entries(o.attr || {})) el.setAttribute(k, v);
    this.appendChild(el);
    if (cb) cb(el);
    return el;
  },
  empty() { while (this.firstChild) this.removeChild(this.firstChild); },
  detach() { this.parentNode && this.parentNode.removeChild(this); },
  appendText(t) { this.appendChild(document.createTextNode(t)); },
  setChildrenInPlace(children) { this.replaceChildren(...children); },
  instanceOf(c) { return this instanceof c; },
});
Object.assign(EP, {
  addClass(...c) { this.classList.add(...splitCls(c)); },
  removeClass(...c) { this.classList.remove(...splitCls(c)); },
  toggleClass(c, v) { for (const x of splitCls(c)) this.classList.toggle(x, v); },
  hasClass(c) { return this.classList.contains(c); },
  setText(t) { t instanceof Node ? this.replaceChildren(t) : (this.textContent = t ?? ''); },
  getText() { return this.textContent; },
  setAttr(k, v) { v == null || v === false ? this.removeAttribute(k) : this.setAttribute(k, v === true ? '' : v); },
  setAttrs(o) { for (const [k, v] of Object.entries(o)) this.setAttr(k, v); },
  getAttr(k) { return this.getAttribute(k); },
  show() { this.style.display = ''; },
  hide() { this.style.display = 'none'; },
  toggle(s) { s ? this.show() : this.hide(); },
  toggleVisibility(s) { this.style.visibility = s ? '' : 'hidden'; },
  isShown() { return this.style.display !== 'none' && !!this.offsetParent; },
  find(sel) { return this.querySelector(sel); },
  findAll(sel) { return [...this.querySelectorAll(sel)]; },
  setCssStyles(o) { Object.assign(this.style, o); },
  setCssProps(o) { for (const [k, v] of Object.entries(o)) this.style.setProperty(k, v); },
  onClickEvent(cb, opts) { this.addEventListener('click', cb, opts); },
});
Object.defineProperty(NP, 'doc', { get() { return this.ownerDocument || document; }, configurable: true });
Object.defineProperty(NP, 'win', { get() { return window; }, configurable: true });
Object.assign(window, {
  createEl: make,
  createDiv: (o, cb) => make('div', o, cb),
  createSpan: (o, cb) => make('span', o, cb),
  createFragment(cb) {
    const f = document.createDocumentFragment();
    if (cb) cb(f);
    return f;
  },
  activeDocument: document,
  activeWindow: window,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  nextFrame: () => new Promise((r) => requestAnimationFrame(r)),
});

/* ---------------- Utility ---------------- */

const isMac = /Mac/.test(navigator.platform);
const Platform = { isDesktop: true, isDesktopApp: false, isMobile: false, isMobileApp: false, isPhone: false, isTablet: false, isIosApp: false, isAndroidApp: false, isMacOS: isMac, isWin: /Win/.test(navigator.platform), isLinux: false, isSafari: false, isWeb: true };

function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').normalize('NFC') || '/';
}

const parseYaml = (s) => yamlParse(s);
const stringifyYaml = (o) => JSON.stringify(o, null, 2);

function debounce(fn, wait = 0, resetTimer = false) {
  let timer = null;
  let args;
  let self;
  const run = () => {
    timer = null;
    return fn.apply(self, args);
  };
  const d = function (...a) {
    args = a;
    self = this;
    if (timer && !resetTimer) return d;
    clearTimeout(timer);
    timer = setTimeout(run, wait);
    return d;
  };
  d.cancel = () => (clearTimeout(timer), (timer = null), d);
  d.run = () => (timer ? (clearTimeout(timer), run()) : undefined);
  return d;
}

function setIcon(el, name) {
  el.empty();
  const svg = ICONS[name];
  if (!svg) return;
  el.insertAdjacentHTML('beforeend', svg);
  el.lastElementChild.setAttribute('class', `svg-icon lucide-${name}`);
}
const getIcon = (name) => {
  const s = createSpan();
  setIcon(s, name);
  return s.firstElementChild;
};

const getLanguage = () => (navigator.language || 'it').slice(0, 2);

/** Come requestUrl di Obsidian, ma con fetch: i siti che non permettono CORS (jw.org) non si raggiungono. */
async function requestUrl(o) {
  if (typeof o === 'string') o = { url: o };
  const headers = { ...(o.headers || {}) };
  if (o.contentType) headers['Content-Type'] = o.contentType;
  let res;
  try {
    res = await fetch(o.url, { method: o.method || 'GET', headers, body: o.body });
  } catch (e) {
    throw new Error(`${new URL(o.url).host} non si raggiunge dal browser: questo si fa da Obsidian (${e.message})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  const out = {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    arrayBuffer,
    text,
    get json() { return JSON.parse(text); },
  };
  if (o.throw !== false && res.status >= 400) throw Object.assign(new Error(`Richiesta fallita, stato ${res.status}`), { status: res.status });
  return out;
}

/* ---------------- Eventi e componenti ---------------- */

class Component {
  constructor() {
    this._loaded = false;
    this._children = [];
    this._cleanups = [];
  }
  load() {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const c of this._children) c.load();
  }
  onload() {}
  unload() {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of this._children.splice(0)) c.unload();
    for (const f of this._cleanups.splice(0)) {
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
    this.onunload();
  }
  onunload() {}
  addChild(c) {
    this._children.push(c);
    if (this._loaded) c.load();
    return c;
  }
  removeChild(c) {
    const i = this._children.indexOf(c);
    if (i >= 0) this._children.splice(i, 1), c.unload();
    return c;
  }
  register(fn) { this._cleanups.push(fn); }
  registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
  registerDomEvent(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.register(() => el.removeEventListener(type, fn, opts));
  }
  registerInterval(id) {
    this.register(() => clearInterval(id));
    return id;
  }
}

/* ---------------- Tasti ---------------- */

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.keys = [];
  }
  register(modifiers, key, func) {
    const h = { scope: this, modifiers: [...(modifiers || [])].sort().join(','), key, func };
    this.keys.push(h);
    return h;
  }
  unregister(h) { this.keys = this.keys.filter((k) => k !== h); }
}

const mods = (e) => [e.altKey && 'Alt', (isMac ? e.metaKey : e.ctrlKey) && 'Mod', isMac && e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', !isMac && e.metaKey && 'Meta'].filter(Boolean).sort().join(',');

class Keymap {
  constructor(app) {
    this.app = app;
    this.stack = [];
    window.addEventListener('keydown', (e) => this.handle(e));
  }
  pushScope(s) { if (s && !this.stack.includes(s)) this.stack.push(s); }
  popScope(s) { this.stack = this.stack.filter((x) => x !== s); }
  handle(e) {
    const m = mods(e);
    let scope = this.stack[this.stack.length - 1] || this.app.workspace.activeLeaf?.view?.scope || this.app.scope;
    for (; scope; scope = scope.parent) {
      for (const h of scope.keys) {
        const keyOk = h.key == null || h.key.toLowerCase() === e.key.toLowerCase();
        const modOk = h.modifiers === m || (h.key == null && !h.modifiers);
        if (!keyOk || !modOk) continue;
        const r = h.func(e, { modifiers: m, key: e.key, vkey: e.key });
        if (r === true) continue;
        if (r === false) e.preventDefault();
        return;
      }
    }
  }
  static isModEvent(e) { return !!e && (isMac ? e.metaKey : e.ctrlKey); }
  static isModifier(e, m) { return mods(e).split(',').includes(m); }
}

/* ---------------- Avvisi, finestre, menu ---------------- */

let noticeBox = null;
class Notice {
  constructor(msg, duration = 4500) {
    if (!noticeBox) noticeBox = document.body.createDiv('notice-container');
    this.noticeEl = noticeBox.createDiv('notice');
    this.messageEl = this.noticeEl;
    this.setMessage(msg);
    this.noticeEl.addEventListener('click', () => this.hide());
    if (duration) setTimeout(() => this.hide(), duration);
  }
  setMessage(m) {
    this.noticeEl.setText(m);
    return this;
  }
  hide() { this.noticeEl.detach(); }
}

class Modal {
  constructor(app) {
    this.app = app;
    this.scope = new Scope(app.scope);
    this.scope.register([], 'Escape', () => (this.close(), false));
    this.containerEl = createDiv('modal-container mod-dim');
    this.containerEl.createDiv('modal-bg').addEventListener('click', () => this.close());
    this.modalEl = this.containerEl.createDiv('modal');
    const x = this.modalEl.createDiv('modal-close-button');
    setIcon(x, 'x');
    x.addEventListener('click', () => this.close());
    this.headerEl = this.modalEl.createDiv('modal-header');
    this.titleEl = this.headerEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
    this.shouldRestoreSelection = false;
  }
  open() {
    if (this.containerEl.isConnected) return;
    document.body.appendChild(this.containerEl);
    this.app.keymap.pushScope(this.scope);
    Promise.resolve(this.onOpen()).catch((e) => console.error(e));
  }
  close() {
    if (!this.containerEl.isConnected) return;
    this.containerEl.detach();
    this.app.keymap.popScope(this.scope);
    Promise.resolve(this.onClose()).catch((e) => console.error(e));
  }
  onOpen() {}
  onClose() {}
  setTitle(t) {
    this.titleEl.setText(t);
    return this;
  }
  setContent(c) {
    this.contentEl.setText(c);
    return this;
  }
}

class SuggestModal extends Modal {
  constructor(app) {
    super(app);
    this.limit = 100;
    this.emptyStateText = 'Nessun risultato.';
    this.modalEl.addClass('prompt');
    this.modalEl.empty();
    this.inputEl = this.modalEl.createDiv('prompt-input-container').createEl('input', { cls: 'prompt-input', attr: { type: 'text', enterkeyhint: 'done' } });
    this.resultContainerEl = this.modalEl.createDiv('prompt-results');
    this.instructionsEl = this.modalEl.createDiv('prompt-instructions');
    this.items = [];
    this.sel = 0;
    this.inputEl.addEventListener('input', () => this.update());
    this.scope.register([], 'ArrowDown', () => (this.move(1), false));
    this.scope.register([], 'ArrowUp', () => (this.move(-1), false));
    this.scope.register([], 'Enter', (e) => (this.items[this.sel] != null && this.selectSuggestion(this.items[this.sel], e), false));
  }
  setPlaceholder(p) { this.inputEl.placeholder = p; }
  setInstructions(list) {
    this.instructionsEl.empty();
    for (const i of list) {
      const d = this.instructionsEl.createDiv('prompt-instruction');
      d.createSpan({ cls: 'prompt-instruction-command', text: i.command });
      d.createSpan({ text: i.purpose });
    }
  }
  onOpen() {
    this.inputEl.focus();
    this.update();
  }
  async update() {
    const q = this.inputEl.value;
    const items = await this.getSuggestions(q);
    if (q !== this.inputEl.value) return;
    this.items = (items || []).slice(0, this.limit);
    this.sel = 0;
    const box = this.resultContainerEl;
    box.empty();
    if (!this.items.length) return this.emptyStateText && box.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
    this.items.forEach((it, i) => {
      const el = box.createDiv('suggestion-item');
      this.renderSuggestion(it, el);
      el.addEventListener('mousemove', () => this.move(i - this.sel));
      el.addEventListener('click', (e) => this.selectSuggestion(it, e));
    });
    this.move(0);
  }
  move(d) {
    const els = this.resultContainerEl.querySelectorAll('.suggestion-item');
    if (!els.length) return;
    this.sel = (this.sel + d + els.length) % els.length;
    els.forEach((el, i) => el.toggleClass('is-selected', i === this.sel));
    if (d) els[this.sel].scrollIntoView({ block: 'nearest' });
  }
  selectSuggestion(v, e) {
    this.close();
    this.onChooseSuggestion(v, e);
  }
  getSuggestions() { return []; }
  renderSuggestion(v, el) { el.setText(String(v)); }
  onChooseSuggestion() {}
}

class FuzzySuggestModal extends SuggestModal {
  getSuggestions(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return this.getItems()
      .map((item) => ({ item, text: this.getItemText(item).toLowerCase() }))
      .filter((x) => words.every((w) => x.text.includes(w)))
      .map((x) => ({ item: x.item, match: { score: 0, matches: [] } }));
  }
  renderSuggestion(m, el) { el.setText(this.getItemText(m.item)); }
  onChooseSuggestion(m, e) { this.onChooseItem(m.item, e); }
}

class MenuItem {
  constructor(menu) {
    this.menu = menu;
    this.dom = createDiv('menu-item');
    this.iconEl = this.dom.createDiv('menu-item-icon');
    this.titleEl = this.dom.createDiv('menu-item-title');
    this.dom.addEventListener('click', (e) => {
      if (this.disabled) return;
      this.menu.hide();
      if (this.cb) this.cb(e);
    });
  }
  setTitle(t) { this.titleEl.setText(t); return this; }
  setIcon(i) { i ? setIcon(this.iconEl, i) : this.iconEl.empty(); return this; }
  setChecked(c) { if (c) this.dom.createDiv('menu-item-icon mod-checked', (d) => setIcon(d, 'check')); return this; }
  setDisabled(d) { this.disabled = d; this.dom.toggleClass('is-disabled', d); return this; }
  setWarning(w) { this.dom.toggleClass('is-warning', w); return this; }
  setIsLabel(l) { this.dom.toggleClass('is-label', l); return this; }
  setSection() { return this; }
  onClick(cb) { this.cb = cb; return this; }
}

class Menu extends Component {
  constructor() {
    super();
    this.dom = createDiv('menu');
    this.items = [];
    this.hideCbs = [];
    this.close = (e) => !this.dom.contains(e.target) && this.hide();
    this.esc = (e) => e.key === 'Escape' && this.hide();
  }
  addItem(cb) {
    const it = new MenuItem(this);
    this.dom.appendChild(it.dom);
    cb(it);
    return this;
  }
  addSeparator() {
    this.dom.createDiv('menu-separator');
    return this;
  }
  setNoIcon() { this.dom.addClass('mod-no-icon'); return this; }
  setUseNativeMenu() { return this; }
  showAtMouseEvent(e) { return this.showAtPosition({ x: e.clientX, y: e.clientY }); }
  showAtPosition({ x, y }) {
    document.body.appendChild(this.dom);
    const r = this.dom.getBoundingClientRect();
    this.dom.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    this.dom.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    setTimeout(() => {
      document.addEventListener('pointerdown', this.close, true);
      document.addEventListener('keydown', this.esc, true);
    }, 0);
    return this;
  }
  hide() {
    if (!this.dom.isConnected) return this;
    this.dom.detach();
    document.removeEventListener('pointerdown', this.close, true);
    document.removeEventListener('keydown', this.esc, true);
    for (const f of this.hideCbs) f();
    return this;
  }
  onHide(cb) { this.hideCbs.push(cb); }
}

/* ---------------- Impostazioni ---------------- */

class ValueComponent {
  constructor() { this.changeCbs = []; }
  onChange(cb) { this.changeCbs.push(cb); return this; }
  changed(v) { for (const f of this.changeCbs) f(v); }
  setDisabled(d) { this.disabled = d; const el = this.inputEl || this.selectEl || this.buttonEl || this.sliderEl || this.toggleEl || this.extraSettingsEl; if (el) { el.disabled = d; el.toggleClass('is-disabled', d); } return this; }
  setTooltip(t) { const el = this.inputEl || this.selectEl || this.buttonEl || this.toggleEl || this.extraSettingsEl; if (el) el.setAttr('aria-label', t), el.setAttr('title', t); return this; }
  then(cb) { cb(this); return this; }
}

class TextComponent extends ValueComponent {
  constructor(parent, tag = 'input', type = 'text') {
    super();
    this.inputEl = parent.createEl(tag, tag === 'input' ? { attr: { type, spellcheck: 'false' } } : {});
    this.inputEl.addEventListener('input', () => this.changed(this.inputEl.value));
  }
  getValue() { return this.inputEl.value; }
  setValue(v) { this.inputEl.value = v ?? ''; return this; }
  setPlaceholder(p) { this.inputEl.placeholder = p; return this; }
  onChanged() {}
}
class TextAreaComponent extends TextComponent { constructor(p) { super(p, 'textarea'); } }
class SearchComponent extends TextComponent { constructor(p) { super(p.createDiv('search-input-container'), 'input', 'search'); } clearButtonEl = createDiv(); }
class ColorComponent extends TextComponent { constructor(p) { super(p, 'input', 'color'); } }
class MomentFormatComponent extends TextComponent { setDefaultFormat() { return this; } setSampleEl() { return this; } }

class ToggleComponent extends ValueComponent {
  constructor(parent) {
    super();
    this.toggleEl = parent.createDiv('checkbox-container');
    this.toggleEl.createEl('input', { attr: { type: 'checkbox', tabindex: '-1' } });
    this.value = false;
    this.toggleEl.addEventListener('click', () => !this.disabled && (this.setValue(!this.value), this.changed(this.value)));
  }
  getValue() { return this.value; }
  setValue(v) { this.value = !!v; this.toggleEl.toggleClass('is-enabled', this.value); return this; }
}

class DropdownComponent extends ValueComponent {
  constructor(parent) {
    super();
    this.selectEl = parent.createEl('select', 'dropdown');
    this.selectEl.addEventListener('change', () => this.changed(this.selectEl.value));
  }
  addOption(v, d) { this.selectEl.createEl('option', { text: d, attr: { value: v } }); return this; }
  addOptions(o) { for (const [v, d] of Object.entries(o)) this.addOption(v, d); return this; }
  getValue() { return this.selectEl.value; }
  setValue(v) { this.selectEl.value = v; return this; }
}

class SliderComponent extends ValueComponent {
  constructor(parent) {
    super();
    this.sliderEl = this.inputEl = parent.createEl('input', { cls: 'slider', attr: { type: 'range' } });
    this.sliderEl.addEventListener('input', () => { this.sliderEl.title = this.sliderEl.value; this.changed(+this.sliderEl.value); });
  }
  setLimits(min, max, step) { Object.assign(this.sliderEl, { min, max, step: step === 'any' ? 'any' : step }); return this; }
  getValue() { return +this.sliderEl.value; }
  setValue(v) { this.sliderEl.value = v; return this; }
  setDynamicTooltip() { return this; }
  setInstant() { return this; }
  showTooltip() {}
}

class ButtonComponent extends ValueComponent {
  constructor(parent) {
    super();
    this.buttonEl = parent.createEl('button');
    this.buttonEl.addEventListener('click', (e) => !this.disabled && this.cb && this.cb(e));
  }
  setButtonText(t) { this.buttonEl.setText(t); return this; }
  setIcon(i) { setIcon(this.buttonEl, i); return this; }
  setCta() { this.buttonEl.addClass('mod-cta'); return this; }
  removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
  setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
  setClass(c) { this.buttonEl.addClass(c); return this; }
  onClick(cb) { this.cb = cb; return this; }
}

class ExtraButtonComponent extends ButtonComponent {
  constructor(parent) {
    super(parent);
    this.extraSettingsEl = this.buttonEl;
    this.buttonEl.addClass('clickable-icon', 'extra-setting-button');
  }
}

class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl.createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
    this.components = [];
  }
  setName(n) { this.nameEl.setText(n); return this; }
  setDesc(d) { this.descEl.setText(d); return this; }
  setClass(c) { this.settingEl.addClass(c); return this; }
  setTooltip(t) { this.nameEl.title = t; return this; }
  setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
  setDisabled(d) { this.settingEl.toggleClass('is-disabled', d); for (const c of this.components) c.setDisabled(d); return this; }
  clear() { this.controlEl.empty(); this.components = []; return this; }
  add(C, cb) {
    const c = new C(this.controlEl);
    this.components.push(c);
    cb(c);
    return this;
  }
  addToggle(cb) { return this.add(ToggleComponent, cb); }
  addText(cb) { return this.add(TextComponent, cb); }
  addTextArea(cb) { return this.add(TextAreaComponent, cb); }
  addSearch(cb) { return this.add(SearchComponent, cb); }
  addDropdown(cb) { return this.add(DropdownComponent, cb); }
  addSlider(cb) { return this.add(SliderComponent, cb); }
  addButton(cb) { return this.add(ButtonComponent, cb); }
  addExtraButton(cb) { return this.add(ExtraButtonComponent, cb); }
  addColorPicker(cb) { return this.add(ColorComponent, cb); }
  addMomentFormat(cb) { return this.add(MomentFormatComponent, cb); }
  then(cb) { cb(this); return this; }
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = createDiv('vertical-tab-content');
  }
  display() {}
  hide() {}
}

/* ---------------- Viste e schede ---------------- */

class View extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.navigation = true;
    this.icon = '';
    this.scope = null;
    this.containerEl = createDiv('workspace-leaf-content');
  }
  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return this.icon; }
  getState() { return {}; }
  async setState() {}
  async onOpen() {}
  async onClose() {}
  onResize() {}
  onPaneMenu() {}
}

class ItemView extends View {
  constructor(leaf) {
    super(leaf);
    this.headerEl = this.containerEl.createDiv('view-header');
    this.actionsEl = this.headerEl.createDiv('view-actions');
    this.contentEl = this.containerEl.createDiv('view-content');
  }
  addAction(icon, title, cb) {
    const b = this.actionsEl.createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title, title } });
    setIcon(b, icon);
    b.addEventListener('click', cb);
    return b;
  }
}

class EmptyView extends ItemView {
  getViewType() { return 'empty'; }
}

class MarkdownView extends ItemView {}
class TextFileView extends ItemView {}
class FileView extends ItemView {}

/** Nota del vault, solo lettura: si apre sopra Lampada con un pulsante per chiudere. */
class NoteView extends ItemView {
  getViewType() { return 'markdown'; }
  getDisplayText() { return this.file ? this.file.basename : ''; }
  async show(file, sub) {
    this.file = file;
    const el = this.contentEl;
    el.empty();
    el.addClass('lmp-web-note', 'markdown-rendered');
    const bar = el.createDiv('lmp-web-note-bar');
    bar.createDiv({ cls: 'lmp-web-note-title', text: file.basename });
    const x = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Chiudi' } });
    setIcon(x, 'x');
    x.addEventListener('click', () => this.leaf.detach());
    const body = el.createDiv('lmp-web-note-body');
    const text = await this.app.vault.cachedRead(file);
    await MarkdownRenderer.render(this.app, text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), body, file.path, this);
    if (sub) {
      const id = sub.replace(/^#\^?/, '');
      const hit = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) => h.textContent.trim() === id) || body.querySelector(`[data-block="${CSS.escape(id)}"]`);
      if (hit) hit.scrollIntoView();
    }
  }
}

class WorkspaceLeaf extends Events {
  constructor(ws, main) {
    super();
    this.app = ws.app;
    this.workspace = ws;
    this.main = main;
    this.containerEl = createDiv(main ? 'workspace-leaf mod-active lmp-web-main' : 'workspace-leaf lmp-web-overlay');
    this.view = null;
    ws.leaves.push(this);
  }
  async setViewState(st) {
    const f = this.app.viewRegistry[st.type];
    const view = f ? f(this) : st.type === 'markdown' ? new NoteView(this) : new EmptyView(this);
    await this.open(view);
    if (st.state) await view.setState(st.state, { history: false });
    if (st.active) this.workspace.setActiveLeaf(this);
  }
  async open(view) {
    if (this.view) {
      await this.view.onClose();
      this.view.unload();
    }
    this.view = view;
    this.containerEl.replaceChildren(view.containerEl);
    view.containerEl.dataset.type = view.getViewType();
    if (!this.containerEl.isConnected) this.workspace.containerEl.appendChild(this.containerEl);
    view.load();
    await view.onOpen();
    return view;
  }
  getViewState() { return { type: this.view ? this.view.getViewType() : 'empty', state: this.view ? this.view.getState() : {} }; }
  getEphemeralState() { return {}; }
  setEphemeralState() {}
  async openFile(file, st) {
    if (file.extension !== 'md') return window.open(this.app.vault.getResourcePath(file));
    const v = this.view instanceof NoteView ? this.view : await this.open(new NoteView(this));
    await v.show(file, st && st.eState && st.eState.subpath);
    this.workspace.setActiveLeaf(this);
  }
  getRoot() { return this.workspace.rootSplit; }
  getContainer() { return this.workspace.rootSplit; }
  async loadIfDeferred() {}
  updateHeader() {}
  setPinned() {}
  togglePinned() {}
  setGroup() {}
  detach() {
    if (this.main) return;
    if (this.view) this.view.onClose(), this.view.unload();
    this.containerEl.detach();
    const ws = this.workspace;
    ws.leaves = ws.leaves.filter((l) => l !== this);
    if (ws.activeLeaf === this) ws.setActiveLeaf(ws.leaves[ws.leaves.length - 1]);
  }
}

class Workspace extends Events {
  constructor(app, containerEl) {
    super();
    this.app = app;
    this.containerEl = containerEl;
    this.leaves = [];
    this.rootSplit = { type: 'root' };
    this.leftSplit = { collapsed: true, expand() {}, collapse() {} };
    this.rightSplit = { collapsed: true, expand() {}, collapse() {} };
    this.layoutReady = false;
    this.readyCbs = [];
    this.mainLeaf = new WorkspaceLeaf(this, true);
    this.activeLeaf = this.mainLeaf;
  }
  async start() {
    await this.mainLeaf.open(new EmptyView(this.mainLeaf));
    this.layoutReady = true;
    for (const f of this.readyCbs.splice(0)) f();
    this.trigger('layout-change');
  }
  onLayoutReady(f) { this.layoutReady ? setTimeout(f, 0) : this.readyCbs.push(f); }
  /** La scheda principale se è vuota, altrimenti una sopra (note, viste che non stanno nel guscio). */
  getLeaf() { return this.mainLeaf.view instanceof EmptyView ? this.mainLeaf : new WorkspaceLeaf(this, false); }
  getRightLeaf() { return this.getLeaf(); }
  getLeftLeaf() { return this.getLeaf(); }
  createLeafBySplit() { return this.getLeaf(); }
  createLeafInParent() { return this.getLeaf(); }
  getLeavesOfType(type) { return this.leaves.filter((l) => l.view && l.view.getViewType() === type); }
  getMostRecentLeaf() { return this.activeLeaf; }
  getActiveViewOfType(C) { const v = this.activeLeaf && this.activeLeaf.view; return v instanceof C ? v : null; }
  getActiveFile() { const v = this.activeLeaf && this.activeLeaf.view; return (v && v.file) || null; }
  iterateAllLeaves(fn) { this.leaves.forEach(fn); }
  iterateRootLeaves(fn) { this.leaves.forEach(fn); }
  async revealLeaf(leaf) { if (leaf && leaf.containerEl.isConnected) this.containerEl.appendChild(leaf.containerEl); }
  setActiveLeaf(leaf) {
    if (!leaf || leaf === this.activeLeaf) return;
    this.activeLeaf = leaf;
    this.trigger('active-leaf-change', leaf);
    this.trigger('file-open', this.getActiveFile());
  }
  async openLinkText(link, sourcePath = '') {
    const [path, ...rest] = link.split('#');
    const f = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!f) return new Notice(`Nota non trovata: ${path}`);
    await this.getLeaf(true).openFile(f, { eState: { subpath: rest.length ? `#${rest.join('#')}` : '' } });
  }
  requestSaveLayout() {}
  getLayout() { return {}; }
  detachLeavesOfType(type) { this.getLeavesOfType(type).forEach((l) => l.detach()); }
  updateOptions() {}
}

/* ---------------- Plugin ---------------- */

class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.settingTabs = [];
  }
  async loadData() {
    const p = `${this.manifest.dir}/data.json`;
    return (await this.app.vault.adapter.exists(p)) ? JSON.parse(await this.app.vault.adapter.read(p)) : null;
  }
  async saveData(d) { await this.app.vault.adapter.write(`${this.manifest.dir}/data.json`, JSON.stringify(d, null, 2)); }
  registerView(type, f) { this.app.viewRegistry[type] = f; }
  addCommand(c) {
    const cmd = { ...c, id: `${this.manifest.id}:${c.id}` };
    this.app.commands.list.push(cmd);
    return cmd;
  }
  addRibbonIcon(icon, title, cb) {
    const b = make('div', { cls: 'clickable-icon side-dock-ribbon-action', attr: { 'aria-label': title } });
    setIcon(b, icon);
    b.addEventListener('click', cb);
    return b;
  }
  addStatusBarItem() { return createDiv(); }
  addSettingTab(tab) { this.settingTabs.push(tab); this.app.setting.tabs.push(tab); }
  registerEditorSuggest() {}
  registerMarkdownPostProcessor() {}
  registerMarkdownCodeBlockProcessor() {}
  registerObsidianProtocolHandler() {}
  registerExtensions() {}
  registerHoverLinkSource() {}
}

class EditorSuggest {
  constructor(app) { this.app = app; this.limit = 100; }
  setInstructions() {}
  close() {}
}

/* ---------------- Markdown ---------------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start: (s) => s.match(/!?\[\[/)?.index,
      tokenizer(src) {
        const m = /^(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], embed: !!m[1], target: m[2].trim(), alias: m[3] };
      },
      renderer(t) {
        if (t.embed) return `<span class="internal-embed" src="${esc(t.target)}" alt="${esc(t.alias || '')}"></span>`;
        return `<a class="internal-link" data-href="${esc(t.target)}" href="${esc(t.target)}">${esc(t.alias || t.target.replace(/#\^?/, ' > '))}</a>`;
      },
    },
    {
      name: 'highlight',
      level: 'inline',
      start: (s) => s.indexOf('=='),
      tokenizer(src) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    },
  ],
});

/** Note in calce [^n] e "[^n]: testo", come le mostra Obsidian (in fondo, numerate). */
function footnotes(md) {
  const defs = new Map();
  md = md.replace(/^\[\^([^\]]+)\]:[ \t]*(.*)$/gm, (m, id, text) => (defs.set(id, text), ''));
  if (!defs.size) return md;
  const order = [];
  md = md.replace(/\[\^([^\]]+)\](?!:)/g, (m, id) => {
    if (!defs.has(id)) return m;
    if (!order.includes(id)) order.push(id);
    return `<sup class="footnote-ref" data-footnote-id="fnref-${esc(id)}"><a href="#fn-${esc(id)}" class="footnote-link">${order.indexOf(id) + 1}</a></sup>`;
  });
  const items = order.map((id) => `<li id="fn-${esc(id)}" data-footnote-id="fn-${esc(id)}">${marked.parseInline(defs.get(id))}</li>`).join('');
  return `${md}\n\n<section class="footnotes"><hr><ol>${items}</ol></section>\n`;
}

/** Il vault è dell'utente, ma i testi arrivano anche da siti: niente script né gestori di eventi nell'HTML. */
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll('script, iframe, object, embed, style, link, meta, base, form')) el.remove();
  for (const el of tpl.content.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) el.setAttrs({ target: '_blank', rel: 'noopener', class: `${el.className} external-link`.trim() });
  }
  return tpl.content;
}

const IMG = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

class MarkdownRenderer extends Component {
  static async render(app, md, el, sourcePath = '', component) {
    // ^id alla fine di un paragrafo: Obsidian non lo mostra.
    md = String(md || '').replace(/[ \t]+\^([\w-]+)[ \t]*$/gm, '');
    el.appendChild(sanitize(marked.parse(footnotes(md))));
    for (const span of el.querySelectorAll('.internal-embed[src]')) {
      const [path] = span.getAttribute('src').split('#');
      const f = IMG.test(path) && app.metadataCache.getFirstLinkpathDest(path, sourcePath);
      if (!f) continue;
      span.addClass('image-embed', 'is-loaded');
      span.createEl('img', { attr: { src: app.vault.getResourcePath(f), alt: span.getAttribute('alt') || '', loading: 'lazy' } });
    }
  }
  static renderMarkdown(md, el, sourcePath, component) { return MarkdownRenderer.render(window.app, md, el, sourcePath, component); }
}

const moment = window.moment;

export {
  Platform, normalizePath, parseYaml, stringifyYaml, debounce, setIcon, getIcon, getLanguage, requestUrl,
  Events, Component, Scope, Keymap, Notice, Modal, SuggestModal, FuzzySuggestModal, Menu, MenuItem,
  Setting, PluginSettingTab, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent, SliderComponent, ButtonComponent, ExtraButtonComponent,
  View, ItemView, MarkdownView, TextFileView, FileView, NoteView, WorkspaceLeaf, Workspace, Plugin, EditorSuggest, MarkdownRenderer, moment,
};
export { TAbstractFile, TFile, TFolder } from './vault.js';

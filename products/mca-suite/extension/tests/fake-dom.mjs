// Tiny fake DOM for page-function tests (node --test, no jsdom). Supports the selectors the page functions use:
// comma lists of compound selectors made of a tag, .classes, [attr], [attr="v"], [attr*="v"] and :not([attr="v"]).
// Unknown selector parts simply never match. Document order = pre-order index (compareDocumentPosition).
export class FakeEl {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...(opts.attrs || {}) };
    this.className = opts.cls || '';
    this._text = opts.text || '';
    this.hidden = !!opts.hidden;
    // invisible: like MCA's hidden popup templates (visibility:hidden / opacity:0): still laid out (getClientRects
    // non-empty, textContent intact) but innerText '' and getComputedStyle (see installComputedStyle) says hidden.
    this.invisible = !!opts.invisible;
    this.disabled = !!opts.disabled;
    this.readOnly = !!opts.readOnly;
    this.checked = !!opts.checked;
    this.children = [];
    this.parentElement = null;
    this.clicks = 0;
    this.events = [];
    this.style = { display: '', removeProperty() { }, cssText: '', ...(opts.style || {}) };
    this._value = opts.value ?? '';
    if (opts.type) this.attrs.type = opts.type;
    if (opts.id) this.attrs.id = opts.id;
    if (opts.name) this.attrs.name = opts.name;
    if (opts.label) this.attrs['aria-label'] = opts.label;
    this.onClick = opts.onClick || null;
    for (const c of opts.children || []) this.append(c);
  }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get type() { return this.attrs.type || (this.tagName === 'INPUT' ? 'text' : ''); }
  get id() { return this.attrs.id || ''; }
  get name() { return this.attrs.name || ''; }
  get placeholder() { return this.attrs.placeholder || ''; }
  get required() { return 'required' in this.attrs; }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get childElementCount() { return this.children.length; }
  get offsetParent() { return this.isHidden() ? null : {}; }
  get textContent() { return [this._text, ...this.children.map(c => c.textContent)].filter(Boolean).join(' '); }
  get innerText() { return this.isHidden() || this.isInvisible() ? '' : this.textContent; }
  get text() { return this.textContent; }
  append(c) { c.parentElement = this; this.children.push(c); return c; }
  appendChild(c) { return this.append(c); }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter(x => x !== this); this.parentElement = null; }
  isHidden() { for (let x = this; x; x = x.parentElement) if (x.hidden) return true; return false; }
  isInvisible() {
    // opacity 0 on any ancestor hides the subtree (cannot be overridden). Visibility is inherited, but as in real CSS
    // the nearest element with an explicit style.visibility 'visible' stops the inheritance (AEM re-shows buttons so).
    let visDecided = false;
    for (let x = this; x; x = x.parentElement) {
      const st = x.style || {};
      if (String(st.opacity) === '0') return true;
      if (visDecided) continue;
      if (st.visibility === 'visible') { visDecided = true; continue; }
      if (x.invisible || st.visibility === 'hidden' || st.visibility === 'collapse') return true;
    }
    return false;
  }
  getClientRects() { return this.isHidden() || !this.root() ? [] : [{}]; }
  getBoundingClientRect() { return { width: this.isHidden() ? 0 : 100, height: 20 }; }
  root() { let x = this; while (x.parentElement) x = x.parentElement; return x.isRoot ? x : null; }
  get nodeType() { return 1; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  dispatchEvent(ev) { this.events.push(ev.type); return true; }
  scrollIntoView() { }
  focus() { }
  click() { this.clicks++; if (this.onClick) this.onClick(this); }
  contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; }
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  querySelectorAll(sel) { return this.descendants().filter(d => matches(d, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let x = this; x; x = x.parentElement) if (matches(x, sel)) return x; return null; }
  compareDocumentPosition(other) {
    const all = this.root() ? this.root().descendants() : [];
    const a = all.indexOf(this), b = all.indexOf(other);
    return b > a ? 4 : 2; // FOLLOWING : PRECEDING
  }
}

function attrTest(e, body) {
  const m = body.match(/^([\w-]+)(?:([*^$]?=)"([^"]*)")?$/);
  if (!m) return false;
  const [, k, op, v] = m;
  const has = k === 'type' ? e.type !== '' || k in e.attrs : k === 'class' ? !!e.className : k in e.attrs;
  const val = k === 'type' ? (e.attrs.type ?? (e.tagName === 'INPUT' ? '' : null)) : k === 'class' ? e.className : e.attrs[k];
  if (!op) return k === 'type' ? 'type' in e.attrs : has;
  if (op === '=') return val === v;
  if (op === '^=') return String(val || '').startsWith(v);
  if (op === '$=') return String(val || '').endsWith(v);
  return String(val || '').includes(v);
}

export function matches(e, sel) {
  return String(sel).split(',').map(s => s.trim()).some(s => {
    let rest = s;
    const tagM = rest.match(/^[a-z][a-z0-9]*/i);
    if (tagM) { if (e.tagName !== tagM[0].toUpperCase()) return false; rest = rest.slice(tagM[0].length); }
    while (rest) {
      let m;
      if ((m = rest.match(/^\.([\w-]+)/))) { if (!e.className.split(/\s+/).includes(m[1])) return false; }
      else if ((m = rest.match(/^:not\(\[([^\]]+)\]\)/))) { if (attrTest(e, m[1])) return false; }
      else if ((m = rest.match(/^\[([^\]]+)\]/))) { if (!attrTest(e, m[1])) return false; }
      else return false;
      rest = rest.slice(m[0].length);
    }
    return true;
  });
}

// Installs document / window / Node / MutationObserver / Event globals for `children`; returns helpers.
export function installDom(children = []) {
  const body = new FakeEl('body', { children });
  body.isRoot = true;
  const listeners = {};
  const observers = [];
  const doc = {
    body, readyState: 'complete', activeElement: body,
    querySelectorAll: s => body.querySelectorAll(s),
    querySelector: s => body.querySelector(s),
    getElementById: id => body.descendants().find(d => d.id === id) || null,
    createElement: tag => new FakeEl(tag),
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
  };
  const g = globalThis;
  g.document = doc;
  g.window = g.window || g;
  if (typeof g.window.addEventListener !== 'function') { g.window.addEventListener = () => { }; g.window.removeEventListener = () => { }; }
  g.Node = { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 };
  g.MutationObserver = class { constructor(cb) { this.cb = cb; this.on = false; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } };
  for (const n of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) if (!g[n]) g[n] = class { };
  // A page event as the browser would deliver it: capture listeners on document see it.
  const fire = (type, target) => { for (const f of [...(listeners[type] || [])]) f({ type, target }); };
  const listenerCount = () => Object.values(listeners).reduce((n, l) => n + l.length, 0);
  return { body, doc, fire, listeners, listenerCount, observers };
}

// Installs a global getComputedStyle(el) stub: display 'none' when the element (or an ancestor) is `hidden` or has
// inline style.display 'none'; visibility 'hidden' when it (or an ancestor) is `invisible` or has inline
// visibility hidden; opacity from inline style (default '1'). Returns the stub. Not installed by installDom, so
// existing tests keep running without it.
export function installComputedStyle() {
  const stub = el => {
    let display = 'block';
    for (let x = el; x; x = x.parentElement) if (x.hidden || (x.style && x.style.display === 'none')) { display = 'none'; break; }
    const own = (el && el.style) || {};
    let visibility = 'visible';
    for (let x = el; x; x = x.parentElement) {
      const st = x.style || {};
      if (st.visibility === 'visible') break; // an explicit 'visible' overrides an inherited hidden
      if (x.invisible || st.visibility === 'hidden') { visibility = 'hidden'; break; }
      if (st.visibility === 'collapse') { visibility = 'collapse'; break; }
    }
    const opacity = own.opacity !== undefined && own.opacity !== '' ? String(own.opacity) : '1';
    return { display, visibility, opacity, getPropertyValue(k) { return this[k] ?? ''; } };
  };
  globalThis.getComputedStyle = stub;
  if (globalThis.window) globalThis.window.getComputedStyle = stub;
  return stub;
}

// Lets pending microtasks and already-due timers run (real timers).
export const flush = () => new Promise(r => setImmediate(r));

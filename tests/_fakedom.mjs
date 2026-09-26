// Minimal stand-in for the DOM surface frontend/render.js may use:
// createElement/createTextNode, setAttribute, append, addEventListener.
class FakeText {
  constructor(v) { this.nodeType = 3; this.textContent = v; }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  append(...nodes) {
    for (const n of nodes) this.childNodes.push(typeof n === 'string' ? new FakeText(n) : n);
  }
  appendChild(n) { this.append(n); return n; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
}

export const fakeDoc = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (v) => new FakeText(v),
};

// Every element in a list of roots, depth-first.
export function allElements(roots) {
  const out = [];
  const visit = (n) => {
    if (n.nodeType !== 1) return;
    out.push(n);
    n.childNodes.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

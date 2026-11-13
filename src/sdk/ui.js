// Small UI helpers designed for an 800x480 screen driven by a rotary knob.

/**
 * Create a DOM element.  h('div', { class: 'card', onclick: fn }, 'text', child)
 */
export function h(tag, props) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const s in v) el.style[s] = v[s];
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}

function append(el, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) { child.forEach((c) => append(el, c)); return; }
  el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
}

/** Replace all children of `el`. */
export function render(el, child) {
  while (el.firstChild) el.removeChild(el.firstChild);
  append(el, child);
  return el;
}

/**
 * Knob-friendly list: rotate to move focus, press to select. Also works with touch.
 * @param {object} app  the app context (from setup)
 * @param {{items: any[], render?: (item:any)=>Node|string, onSelect?: (item:any, index:number)=>void, onFocus?: (item:any, index:number)=>void}} o
 */
export function list(app, o) {
  const root = h('div', { class: 'mzd-list' });
  let items = o.items || [];
  let index = 0;
  let rows = [];

  function draw() {
    rows = items.map((item, i) => h('div', {
      class: 'mzd-list-item' + (i === index ? ' mzd-focus' : ''),
      onclick: () => { focus(i); select(); },
    }, o.render ? o.render(item, i) : String(item)));
    render(root, rows);
    scroll();
  }

  function scroll() {
    const row = rows[index];
    if (!row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < root.scrollTop) root.scrollTop = top;
    else if (bottom > root.scrollTop + root.clientHeight) root.scrollTop = bottom - root.clientHeight;
  }

  function focus(i) {
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, i));
    if (rows[index]) rows[index].className = 'mzd-list-item';
    index = next;
    if (rows[index]) rows[index].className = 'mzd-list-item mzd-focus';
    scroll();
    if (o.onFocus) o.onFocus(items[index], index);
  }

  function select() {
    if (items.length && o.onSelect) o.onSelect(items[index], index);
  }

  const offs = [
    app.controls.on('rotate', (dir) => focus(index + dir)),
    app.controls.on('down', () => focus(index + 1)),
    app.controls.on('up', () => focus(index - 1)),
    app.controls.on('press', select),
  ];

  draw();

  return {
    el: root,
    setItems(next) { items = next || []; index = Math.min(index, Math.max(0, items.length - 1)); draw(); },
    focus: focus,
    get index() { return index; },
    destroy() { offs.forEach((off) => off()); },
  };
}

/** Format a number with fixed decimals, or a placeholder when missing. */
export function fmt(value, decimals, placeholder) {
  if (value == null || value === '' || isNaN(value)) return placeholder == null ? '--' : placeholder;
  return Number(value).toFixed(decimals || 0);
}

type ElChild = Node | string | null | undefined | false;

export interface ElOptions {
  className?: string;
  id?: string;
  /** sets textContent */
  text?: string | number;
  /** sets innerHTML (use sparingly) */
  html?: string;
  title?: string;
  type?: string;
  value?: string;
  name?: string;
  /** inline styles, merged via Object.assign(node.style, ...) */
  style?: Partial<CSSStyleDeclaration>;
  /** arbitrary attributes (aria-*, role, colspan, etc.) */
  attrs?: Record<string, string | number | boolean>;
  /** data-* entries */
  dataset?: Record<string, string>;
  /** event listeners */
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
}

/**
 * Generic element factory. Replaces the document.createElement + property
 * assignment boilerplate that recurs across the UI modules.
 *
 *   el('button', { className: 'foo', text: 'Go', on: { click: handler } })
 *   el('tr', {}, [el('td', { text: name }), el('td', { text: value })])
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: ElChild[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className !== undefined) node.className = opts.className;
  if (opts.id !== undefined) node.id = opts.id;
  if (opts.text !== undefined) node.textContent = String(opts.text);
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.title !== undefined) node.title = opts.title;
  if (opts.type !== undefined) (node as any).type = opts.type;
  if (opts.value !== undefined) (node as any).value = opts.value;
  if (opts.name !== undefined) (node as any).name = opts.name;
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  if (opts.on) {
    for (const [evt, fn] of Object.entries(opts.on)) {
      node.addEventListener(evt, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** Typed document.getElementById shorthand. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Convenience wrapper for el('button', { type: 'button', ... }). */
export function makeButton(text: string, opts: ElOptions = {}): HTMLButtonElement {
  return el('button', { type: 'button', text, ...opts });
}

/** Build an <option>, optionally pre-selected. */
export function makeOption(label: string, value?: string, selected = false): HTMLOptionElement {
  const o = new Option(label, value ?? label);
  o.selected = selected;
  return o;
}

export function makeFieldCheckbox(name: string, checked: boolean, fieldType: 'numeric' | 'categorical' = 'numeric', locked = false) {
  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.gap = '8px';
  label.style.alignItems = 'center';
  if (locked) label.style.opacity = '0.55';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.name = name;
  cb.checked = checked;
  cb.dataset.fieldType = fieldType;
  if (locked) cb.disabled = true;

  const span = document.createElement('span');
  span.textContent = name;

  label.append(cb, span);
  return label;
}

export function divider() {
  const d = document.createElement('div');
  d.className = 'divider';
  return d;
}

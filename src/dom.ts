// Tiny DOM builder. Text is only ever assigned through textContent / attributes,
// never parsed as HTML, so strings from the proxy cannot inject markup.

type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  onClick?: (e: Event) => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(props.style ?? {})) el.style.setProperty(k, v);
  if (props.onClick) el.addEventListener("click", props.onClick);
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 24×24 stroke icons (drawn for Trimbit; round caps, currentColor).
const ICONS = {
  refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  back: ["M15 18l-6-6 6-6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"],
  copy: ["M9 9h10v11H9z", "M5 15V4h10"],
  power: ["M12 3v9", "M17.7 6.3a8 8 0 1 1-11.4 0"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  bolt: ["M13 3L5 14h6l-1 7 8-11h-6z"],
  alert: ["M12 4l9 16H3z", "M12 10v4", "M12 17.5v.01"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  download: ["M12 4v11", "M7 10.5l5 5 5-5", "M5 20h14"],
  info: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 11v5", "M12 7.5v.01"],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// PaisaPilot mark: a rupee sign inside a 270° instrument dial (the "pilot" gauge).
import { SVG_NS } from './utils.js';

const PARTS = [
  ['rect', { x: 0, y: 0, width: 120, height: 120, rx: 30, fill: '#050A18' }],
  ['circle', { cx: 60, cy: 60, r: 42, fill: 'none', stroke: '#16244A', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': '197.9 263.9', transform: 'rotate(135 60 60)' }],
  ['circle', { cx: 60, cy: 60, r: 42, fill: 'none', stroke: 'url(#ppg)', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': '138 263.9', transform: 'rotate(135 60 60)' }],
  ['path', { d: 'M45 42H75M45 54H75M53 42C69 42 69 66 53 66H47L71 86', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]
];

export function logo(size = 40) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('class', 'logo'); svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVG_NS, 'defs');
  const g = document.createElementNS(SVG_NS, 'linearGradient');
  for (const [k, v] of Object.entries({ id: 'ppg', x1: '0', y1: '1', x2: '1', y2: '0' })) g.setAttribute(k, v);
  for (const [off, col] of [['0', '#2F6BFF'], ['1', '#38BDF8']]) {
    const st = document.createElementNS(SVG_NS, 'stop'); st.setAttribute('offset', off); st.setAttribute('stop-color', col); g.appendChild(st);
  }
  defs.appendChild(g); svg.appendChild(defs);
  for (const [tag, attrs] of PARTS) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
  }
  return svg;
}

import L from 'leaflet';

export const STATUS_COLOR: Record<string, string> = {
  moving: '#0ca30c', idle: '#fab219', stopped: '#d03b3b', offline: '#898781', unknown: '#898781',
};

export function makeMap(el: HTMLElement) {
  const map = L.map(el, { zoomControl: true }).setView([21, 78], 5); // India
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  return map;
}

export function vehicleIcon(status: string, heading: number | null) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.unknown;
  const arrow = status === 'moving' && heading != null
    ? `<div class="arrow" style="transform:rotate(${heading}deg)"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2 L23 24 L15 19 L7 24 Z" fill="${c}" stroke="#fff" stroke-width="2"/></svg></div>`
    : `<div class="dot" style="background:${c}"></div>`;
  return L.divIcon({ className: 'vmarker', html: arrow, iconSize: [30, 30], iconAnchor: [15, 15] });
}

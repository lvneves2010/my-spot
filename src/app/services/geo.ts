/** Cálculos geográficos simples (esfera, suficiente para distâncias a pé). */

const RAIO_TERRA_M = 6_371_000;
const rad = (graus: number) => (graus * Math.PI) / 180;
const graus = (radianos: number) => (radianos * 180) / Math.PI;

export interface Coordenada {
  lat: number;
  lng: number;
}

/** Distância em metros (fórmula de haversine). */
export function distanciaMetros(a: Coordenada, b: Coordenada): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumo inicial de "a" para "b", em graus a partir do norte (0–360, sentido horário). */
export function rumoGraus(a: Coordenada, b: Coordenada): number {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return normalizar(graus(Math.atan2(y, x)));
}

export function normalizar(angulo: number): number {
  return ((angulo % 360) + 360) % 360;
}

/** "35 m", "1,2 km". */
export function formatarDistancia(metros: number): string {
  if (metros < 1000) {
    return `${Math.round(metros)} m`;
  }
  const km = (metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: metros < 10_000 ? 1 : 0 });
  return `${km} km`;
}

/** Ponto cardeal aproximado (N, NE, L, SE, S, SO, O, NO). */
export function pontoCardeal(angulo: number): string {
  const nomes = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return nomes[Math.round(normalizar(angulo) / 45) % 8];
}

/** Link do Google Maps com rota a pé até o destino (abre o app do Maps no Android). */
export function linkRotaAPe(destino: Coordenada): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${destino.lat},${destino.lng}&travelmode=walking`;
}

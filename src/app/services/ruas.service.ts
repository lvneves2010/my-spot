import { Injectable } from '@angular/core';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { Coordenada } from './geo';

/** Uma rua (ou caminho) como uma linha de pontos. */
export interface Rua {
  pontos: Coordenada[];
  /**
   * Chave de cada ponto: a coordenada inteira global do tile (z14, extent 4096).
   * Ruas que se cruzam têm o mesmo vértice, então a mesma chave, inclusive entre
   * tiles vizinhos. É assim que o grafo da rota sabe onde elas se ligam.
   */
  chaves: number[];
  /** Calçadas, trilhas e escadas são desenhadas mais finas. */
  pedestre: boolean;
  /** Dá para andar por ela (não é rodovia nem trilho). */
  caminhavel: boolean;
  /** Corredor de estacionamento (OSM service=parking_aisle). */
  estacionamento: boolean;
  /** Ponte ou túnel: não se liga às ruas que cruza por cima ou por baixo. */
  elevada: boolean;
}

/** Tiles vetoriais do OpenFreeMap (dados do OpenStreetMap; sem chave e sem limite de uso). */
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const ZOOM = 14;
const CACHE = 'myspot-ruas';
const CHAVE_URL = 'myspot:url-tiles';
/** Raio (m) em volta da vaga baixado ao marcar: o mapa do guia aparece a menos de 1 km. */
export const RAIO_RUAS_M = 1100;

const CLASSES_CAMINHAVEIS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path']);
const CLASSES_DESENHADAS = new Set([...CLASSES_CAMINHAVEIS, 'motorway']);

/**
 * Traçado das ruas para o croqui e a rota a pé, a partir dos tiles vetoriais
 * do OpenFreeMap (camada `transportation`, esquema OpenMapTiles).
 *
 * Os tiles da região da vaga são baixados ao marcar e ficam no Cache Storage
 * da WebView, então o guia funciona mesmo sem sinal na volta. Cada tile de
 * zoom 14 cobre ~2,2 km, e o pedido não diz onde exatamente estão a vaga ou o
 * usuário.
 */
@Injectable({ providedIn: 'root' })
export class RuasService {
  private urlTiles?: Promise<string>;
  private tilesDecodificados = new Map<string, Promise<Rua[]>>();

  /** Baixa (em segundo plano) os tiles em volta da vaga recém-marcada. */
  async preparar(vaga: Coordenada): Promise<void> {
    await Promise.all(RuasService.tilesEmVolta(vaga, RAIO_RUAS_M).map(([x, y]) => this.bytesDoTile(x, y)));
  }

  /** Ruas num raio em volta do ponto (usa o que já estiver guardado). */
  async buscar(centro: Coordenada, raioM: number): Promise<Rua[]> {
    const tiles = RuasService.tilesEmVolta(centro, raioM);
    const listas = await Promise.all(tiles.map(([x, y]) => this.ruasDoTile(x, y)));
    return ([] as Rua[]).concat(...listas);
  }

  /** Apaga os tiles guardados (ao liberar a vaga). */
  async esquecer(): Promise<void> {
    this.tilesDecodificados.clear();
    try {
      await caches.delete(CACHE);
    } catch {
      // sem Cache Storage
    }
  }

  private ruasDoTile(x: number, y: number): Promise<Rua[]> {
    const chave = `${x}/${y}`;
    let ruas = this.tilesDecodificados.get(chave);
    if (!ruas) {
      ruas = this.bytesDoTile(x, y).then(bytes => decodificar(bytes, x, y));
      ruas.catch(() => this.tilesDecodificados.delete(chave));
      this.tilesDecodificados.set(chave, ruas);
    }
    return ruas;
  }

  private async bytesDoTile(x: number, y: number): Promise<ArrayBuffer> {
    const caminho = `${ZOOM}/${x}/${y}`;
    // A chave do cache não depende da versão do mapa (a URL muda a cada semana).
    const chaveCache = `https://myspot.local/tiles/${caminho}.pbf`;
    const cache = await caches.open(CACHE).catch(() => null);
    const guardado = await cache?.match(chaveCache);
    if (guardado) {
      return guardado.arrayBuffer();
    }
    const url = (await this.modeloDeUrl()).replace('{z}/{x}/{y}', caminho);
    const resposta = await buscarComLimite(url, 20_000);
    if (!resposta.ok) {
      throw new Error(`tile ${caminho}: HTTP ${resposta.status}`);
    }
    const bytes = await resposta.arrayBuffer();
    await cache?.put(chaveCache, new Response(bytes)).catch(() => {});
    return bytes;
  }

  /** Modelo de URL dos tiles (vem do TileJSON; guardado para funcionar sem rede). */
  private modeloDeUrl(): Promise<string> {
    this.urlTiles ??= buscarComLimite(TILEJSON, 10_000)
      .then(r => r.json() as Promise<{ tiles: string[] }>)
      .then(tj => {
        const url = tj.tiles[0];
        try {
          localStorage.setItem(CHAVE_URL, url);
        } catch {
          // sem armazenamento
        }
        return url;
      })
      .catch(err => {
        this.urlTiles = undefined;
        const salva = lerLocal(CHAVE_URL);
        if (salva) {
          return salva;
        }
        throw err;
      });
    return this.urlTiles;
  }

  /** Tiles (x, y) de zoom 14 que cobrem um quadrado de lado 2·raio em volta do ponto. */
  static tilesEmVolta(c: Coordenada, raioM: number): [number, number][] {
    const dLat = raioM / 111_320;
    const dLng = raioM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
    const [x0, y0] = tileDe(c.lat + dLat, c.lng - dLng);
    const [x1, y1] = tileDe(c.lat - dLat, c.lng + dLng);
    const tiles: [number, number][] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push([x, y]);
      }
    }
    return tiles;
  }
}

function tileDe(lat: number, lng: number): [number, number] {
  const n = 2 ** ZOOM;
  const r = (lat * Math.PI) / 180;
  return [
    Math.floor(((lng + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  ];
}

export function decodificar(bytes: ArrayBuffer, tx: number, ty: number): Rua[] {
  const camada = new VectorTile(new Pbf(new Uint8Array(bytes))).layers['transportation'];
  if (!camada) {
    return [];
  }
  const extent = camada.extent;
  const total = extent * 2 ** ZOOM;
  // Coordenada global inteira -> lat/lng (Web Mercator).
  const paraCoord = (gx: number, gy: number): Coordenada => {
    const lng = (gx / total) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / total))) * 180) / Math.PI;
    return { lat, lng };
  };

  const ruas: Rua[] = [];
  for (let i = 0; i < camada.length; i++) {
    const f = camada.feature(i);
    const p = f.properties as Record<string, string | number | boolean | undefined>;
    const classe = String(p['class'] ?? '');
    if (f.type !== 2 || !CLASSES_DESENHADAS.has(classe)) {
      continue;
    }
    const subclasse = String(p['subclass'] ?? '');
    const caminhavel =
      CLASSES_CAMINHAVEIS.has(classe) && p['access'] !== 'no' && !(p['ramp'] && (classe === 'trunk' || classe === 'motorway'));
    for (const linha of f.loadGeometry()) {
      if (linha.length < 2) {
        continue;
      }
      const pontos: Coordenada[] = [];
      const chaves: number[] = [];
      for (const pt of linha) {
        const gx = tx * extent + pt.x;
        const gy = ty * extent + pt.y;
        pontos.push(paraCoord(gx, gy));
        // gx, gy < 2^26: cabem juntos num número exato do JavaScript (2^53).
        chaves.push(gx * 2 ** 27 + gy);
      }
      ruas.push({
        pontos,
        chaves,
        pedestre: classe === 'path' && subclasse !== 'cycleway',
        caminhavel,
        estacionamento: p['service'] === 'parking_aisle',
        elevada: !!p['brunnel'],
      });
    }
  }
  return ruas;
}

async function buscarComLimite(url: string, ms: number): Promise<Response> {
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), ms);
  try {
    return await fetch(url, { signal: controle.signal });
  } finally {
    clearTimeout(limite);
  }
}

function lerLocal(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

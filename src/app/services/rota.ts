/**
 * Rota a pé pelas ruas, calculada no próprio celular (Dijkstra) sobre o
 * traçado do OpenStreetMap. Não usa serviço de rotas: as ruas já vêm dos
 * tiles vetoriais e o grafo de uma área de ~2 km cabe tranquilo na memória.
 *
 * Trabalha em metros num plano local (x para leste, y para o sul), com
 * origem num ponto de referência (a vaga).
 */
import { Coordenada } from './geo';
import { Rua } from './ruas.service';

const M_POR_GRAU = 111_320;
/** Ponta de rua a até esta distância (m) de outra rua é ligada a ela. */
const TOLERANCIA_PONTA_M = 4;
/** Lado (m) das células do índice espacial usado no reparo. */
const CELULA_M = 40;
/** Pedaços de rede menores que isto (nós) são ignorados ao encaixar a vaga. */
const MENOR_COMPONENTE = 30;
/** Ruas até esta distância (m) além da mais próxima também são testadas como ponto de partida. */
const CANDIDATAS_ALEM_M = 25;
const PESO_FORA_DA_RUA = 1.5;

interface Xy {
  x: number;
  y: number;
}

export interface Grafo {
  origem: Coordenada;
  kx: number;
  nos: Xy[];
  /** Vizinhos de cada nó: [nó, metros, nó, metros, ...]. */
  adj: number[][];
  /** Segmentos (pares de nós) para encaixar um ponto solto na rede. */
  segA: Int32Array;
  segB: Int32Array;
  /** 1 se o segmento é corredor de estacionamento. */
  segEstacionamento: Uint8Array;
  /** Componente conexo de cada nó, e o tamanho de cada componente. */
  componente: Int32Array;
  tamanhoComponente: number[];
}

export interface Rota {
  /** Do usuário até a vaga, passando pelas ruas. */
  pontos: Coordenada[];
  /** Comprimento total (m). */
  metros: number;
  /** Distância (m) do usuário até a rua mais próxima e da vaga até a rua mais próxima. */
  folgaInicio: number;
  folgaFim: number;
  /** Usuário e vaga encaixam em corredores de estacionamento (provavelmente o mesmo terreno). */
  dentroDeEstacionamento: boolean;
}

/**
 * Monta o grafo das ruas caminháveis.
 *
 * Os tiles vêm simplificados: numa rua reta, o vértice da esquina some, e a rua
 * lateral termina "em cima" dela sem ponto em comum. Por isso, além de juntar
 * vértices com a mesma chave, o grafo é reparado: (1) a ponta solta de uma rua
 * é ligada ao segmento a até 4 m; (2) dois segmentos que se cruzam ganham um
 * nó no cruzamento, exceto quando um deles é ponte ou túnel.
 */
export function construirGrafo(ruas: Rua[], origem: Coordenada): Grafo {
  const kx = M_POR_GRAU * Math.cos((origem.lat * Math.PI) / 180);
  const indice = new Map<number, number>();
  const nos: Xy[] = [];
  const grau: number[] = [];

  const no = (chave: number, p: Coordenada): number => {
    let i = indice.get(chave);
    if (i === undefined) {
      i = nos.length;
      indice.set(chave, i);
      nos.push({ x: (p.lng - origem.lng) * kx, y: -(p.lat - origem.lat) * M_POR_GRAU });
      grau.push(0);
    }
    return i;
  };

  // 1. Segmentos brutos.
  const brutos: { a: number; b: number; estac: boolean; elevada: boolean }[] = [];
  const pontas = new Set<number>();
  for (const rua of ruas) {
    if (!rua.caminhavel) {
      continue;
    }
    let anterior = no(rua.chaves[0], rua.pontos[0]);
    pontas.add(anterior);
    for (let k = 1; k < rua.pontos.length; k++) {
      const atual = no(rua.chaves[k], rua.pontos[k]);
      if (atual !== anterior) {
        brutos.push({ a: anterior, b: atual, estac: rua.estacionamento, elevada: rua.elevada });
        grau[anterior]++;
        grau[atual]++;
      }
      anterior = atual;
    }
    pontas.add(anterior);
  }

  // 2. Índice espacial dos segmentos.
  const celulas = new Map<string, number[]>();
  const chaveCelula = (cx: number, cy: number) => `${cx},${cy}`;
  brutos.forEach((seg, i) => {
    const a = nos[seg.a];
    const b = nos[seg.b];
    const x0 = Math.floor(Math.min(a.x, b.x) / CELULA_M);
    const x1 = Math.floor(Math.max(a.x, b.x) / CELULA_M);
    const y0 = Math.floor(Math.min(a.y, b.y) / CELULA_M);
    const y1 = Math.floor(Math.max(a.y, b.y) / CELULA_M);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = chaveCelula(cx, cy);
        let lista = celulas.get(k);
        if (!lista) {
          lista = [];
          celulas.set(k, lista);
        }
        lista.push(i);
      }
    }
  });

  // Pontos extras em cada segmento: [t (0–1), nó].
  const cortes: [number, number][][] = brutos.map(() => []);
  const novoNo = (p: Xy): number => {
    nos.push(p);
    grau.push(0);
    return nos.length - 1;
  };

  // 3. Cruzamentos sem vértice comum.
  const testados = new Set<number>();
  for (const lista of celulas.values()) {
    for (let m = 0; m < lista.length; m++) {
      for (let n = m + 1; n < lista.length; n++) {
        const i = Math.min(lista[m], lista[n]);
        const j = Math.max(lista[m], lista[n]);
        const s1 = brutos[i];
        const s2 = brutos[j];
        if (s1.elevada || s2.elevada || s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) {
          continue;
        }
        const par = i * brutos.length + j;
        if (testados.has(par)) {
          continue;
        }
        testados.add(par);
        const x = cruzamento(nos[s1.a], nos[s1.b], nos[s2.a], nos[s2.b]);
        if (x) {
          const novo = novoNo(x.ponto);
          cortes[i].push([x.t, novo]);
          cortes[j].push([x.u, novo]);
        }
      }
    }
  }

  // 4. Pontas soltas perto de outra rua.
  for (const p of pontas) {
    if (grau[p] !== 1) {
      continue;
    }
    const pt = nos[p];
    let melhor: { s: number; t: number; d: number } | null = null;
    const cx = Math.floor(pt.x / CELULA_M);
    const cy = Math.floor(pt.y / CELULA_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of celulas.get(chaveCelula(cx + dx, cy + dy)) ?? []) {
          const seg = brutos[s];
          if (seg.a === p || seg.b === p) {
            continue;
          }
          const proj = projetar(pt, nos[seg.a], nos[seg.b]);
          if (proj.distancia <= TOLERANCIA_PONTA_M && (!melhor || proj.distancia < melhor.d)) {
            melhor = { s, t: proj.t, d: proj.distancia };
          }
        }
      }
    }
    if (melhor) {
      cortes[melhor.s].push([melhor.t, p]);
    }
  }

  // 5. Arestas finais: cada segmento quebrado nos seus cortes.
  const adj: number[][] = nos.map(() => []);
  const segA: number[] = [];
  const segB: number[] = [];
  const segEstac: number[] = [];
  const ligar = (u: number, v: number, estac: boolean) => {
    if (u === v) {
      return;
    }
    const m = Math.hypot(nos[u].x - nos[v].x, nos[u].y - nos[v].y);
    adj[u].push(v, m);
    adj[v].push(u, m);
    segA.push(u);
    segB.push(v);
    segEstac.push(estac ? 1 : 0);
  };
  brutos.forEach((seg, i) => {
    let anterior = seg.a;
    for (const [, n] of cortes[i].sort((x, y) => x[0] - y[0])) {
      ligar(anterior, n, seg.estac);
      anterior = n;
    }
    ligar(anterior, seg.b, seg.estac);
  });

  // 6. Componentes conexos.
  const componente = new Int32Array(nos.length).fill(-1);
  const tamanhoComponente: number[] = [];
  for (let i = 0; i < nos.length; i++) {
    if (componente[i] >= 0) {
      continue;
    }
    const c = tamanhoComponente.length;
    let tamanho = 0;
    const pilha = [i];
    componente[i] = c;
    while (pilha.length) {
      const u = pilha.pop()!;
      tamanho++;
      const viz = adj[u];
      for (let k = 0; k < viz.length; k += 2) {
        if (componente[viz[k]] < 0) {
          componente[viz[k]] = c;
          pilha.push(viz[k]);
        }
      }
    }
    tamanhoComponente.push(tamanho);
  }

  return {
    origem,
    kx,
    nos,
    adj,
    segA: Int32Array.from(segA),
    segB: Int32Array.from(segB),
    segEstacionamento: Uint8Array.from(segEstac),
    componente,
    tamanhoComponente,
  };
}

/** Projeção de p no segmento ab: posição (0–1), ponto e distância. */
function projetar(p: Xy, a: Xy, b: Xy): { t: number; ponto: Xy; distancia: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const ponto = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, ponto, distancia: Math.hypot(p.x - ponto.x, p.y - ponto.y) };
}

/** Cruzamento no meio dos segmentos ab e cd (não nas pontas). */
function cruzamento(a: Xy, b: Xy, c: Xy, d: Xy): { t: number; u: number; ponto: Xy } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) {
    return null;
  }
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) {
    return null;
  }
  return { t, u, ponto: { x: a.x + t * rx, y: a.y + t * ry } };
}

/** Segmento mais próximo de `p`, ignorando pedaços minúsculos da rede (sobras isoladas do tile). */
function encaixar(g: Grafo, p: Xy): { s: number; t: number; ponto: Xy; distancia: number } | null {
  let melhor: { s: number; t: number; ponto: Xy; distancia: number } | null = null;
  for (let s = 0; s < g.segA.length; s++) {
    if (g.tamanhoComponente[g.componente[g.segA[s]]] < MENOR_COMPONENTE) {
      continue;
    }
    const proj = projetar(p, g.nos[g.segA[s]], g.nos[g.segB[s]]);
    if (!melhor || proj.distancia < melhor.distancia) {
      melhor = { s, ...proj };
    }
  }
  return melhor;
}

/** Distâncias pela rede de todos os nós até a vaga (Dijkstra a partir dela). */
interface Destino {
  chave: string;
  fim: { s: number; t: number; ponto: Xy; distancia: number };
  /** Metros pela rede do nó até o ponto da rua onde a vaga encaixa. */
  dist: Float64Array;
  /** Próximo nó no caminho até a vaga (-1 = ponta do segmento da vaga). */
  proximo: Int32Array;
}

const destinos = new WeakMap<Grafo, Destino>();

function destinoPara(g: Grafo, para: Coordenada): Destino | null {
  const chave = `${para.lat},${para.lng}`;
  const guardado = destinos.get(g);
  if (guardado?.chave === chave) {
    return guardado;
  }
  const fim = encaixar(g, xyDe(g, para));
  if (!fim) {
    return null;
  }
  const n = g.nos.length;
  const dist = new Float64Array(n).fill(Infinity);
  const proximo = new Int32Array(n).fill(-1);
  const heap = new Heap();
  const len = comprimentoDe(g, fim.s);
  for (const [no, d] of [
    [g.segA[fim.s], fim.t * len],
    [g.segB[fim.s], (1 - fim.t) * len],
  ] as [number, number][]) {
    if (d < dist[no]) {
      dist[no] = d;
      heap.push(no, d);
    }
  }
  while (heap.tamanho) {
    const [u, du] = heap.pop();
    if (du > dist[u]) {
      continue;
    }
    const viz = g.adj[u];
    for (let k = 0; k < viz.length; k += 2) {
      const v = viz[k];
      const dv = du + viz[k + 1];
      if (dv < dist[v]) {
        dist[v] = dv;
        proximo[v] = u;
        heap.push(v, dv);
      }
    }
  }
  const destino = { chave, fim, dist, proximo };
  destinos.set(g, destino);
  return destino;
}

const xyDe = (g: Grafo, c: Coordenada): Xy => ({ x: (c.lng - g.origem.lng) * g.kx, y: -(c.lat - g.origem.lat) * M_POR_GRAU });
const coordDe = (g: Grafo, p: Xy): Coordenada => ({ lat: g.origem.lat - p.y / M_POR_GRAU, lng: g.origem.lng + p.x / g.kx });

function comprimentoDe(g: Grafo, s: number): number {
  const a = g.nos[g.segA[s]];
  const b = g.nos[g.segB[s]];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Rota a pé do usuário até a vaga.
 *
 * As distâncias até a vaga são calculadas uma vez (Dijkstra a partir dela) e
 * reaproveitadas a cada nova posição. O usuário não é encaixado só na rua mais
 * próxima: todas as ruas até 25 m além da mais próxima são candidatas, e vale a
 * que dá o caminho total mais curto. Encaixar só na mais próxima errava, por
 * exemplo, ao pegar a outra pista de uma avenida (no teste de 2026-11-18 a rota
 * deu 360 m para um carro a 160 m, até o usuário andar alguns metros).
 */
export function calcularRota(g: Grafo, de: Coordenada, para: Coordenada): Rota | null {
  if (!g.segA.length) {
    return null;
  }
  const destino = destinoPara(g, para);
  if (!destino) {
    return null;
  }
  const { fim, dist, proximo } = destino;
  const p = xyDe(g, de);

  // Projeção em todos os segmentos alcançáveis; a mais próxima define a faixa de candidatas.
  const projecoes: { s: number; t: number; ponto: Xy; distancia: number }[] = [];
  let maisPerto = Infinity;
  for (let s = 0; s < g.segA.length; s++) {
    if (dist[g.segA[s]] === Infinity && dist[g.segB[s]] === Infinity) {
      continue;
    }
    const proj = projetar(p, g.nos[g.segA[s]], g.nos[g.segB[s]]);
    if (proj.distancia <= maisPerto + CANDIDATAS_ALEM_M) {
      projecoes.push({ s, ...proj });
      maisPerto = Math.min(maisPerto, proj.distancia);
    }
  }

  let melhor: { total: number; custo: number; ini: (typeof projecoes)[number]; no: number } | null = null;
  for (const ini of projecoes) {
    if (ini.distancia > maisPerto + CANDIDATAS_ALEM_M) {
      continue;
    }
    const len = comprimentoDe(g, ini.s);
    const opcoes: [number, number][] =
      ini.s === fim.s
        ? [[-1, ini.distancia + Math.abs(ini.t - fim.t) * len + fim.distancia]]
        : [
            [g.segA[ini.s], ini.distancia + ini.t * len + dist[g.segA[ini.s]] + fim.distancia],
            [g.segB[ini.s], ini.distancia + (1 - ini.t) * len + dist[g.segB[ini.s]] + fim.distancia],
          ];
    // O trecho fora da rua pesa 1,5x na escolha: em linha reta ele pode atravessar prédio.
    const custoExtra = (PESO_FORA_DA_RUA - 1) * ini.distancia;
    for (const [no, total] of opcoes) {
      if (!melhor || total + custoExtra < melhor.custo) {
        melhor = { total, custo: total + custoExtra, ini, no };
      }
    }
  }
  if (!melhor) {
    return null;
  }

  const caminho: Coordenada[] = [];
  for (let u = melhor.no; u >= 0; u = proximo[u]) {
    caminho.push(coordDe(g, g.nos[u]));
  }
  return {
    pontos: [de, coordDe(g, melhor.ini.ponto), ...caminho, coordDe(g, fim.ponto), para],
    metros: melhor.total,
    folgaInicio: melhor.ini.distancia,
    folgaFim: fim.distancia,
    dentroDeEstacionamento: !!g.segEstacionamento[melhor.ini.s] && !!g.segEstacionamento[fim.s],
  };
}

/** Fila de prioridade mínima (heap binário) de pares nó/distância. */
class Heap {
  private nos: number[] = [];
  private pesos: number[] = [];

  get tamanho() {
    return this.nos.length;
  }

  push(no: number, peso: number) {
    this.nos.push(no);
    this.pesos.push(peso);
    let i = this.nos.length - 1;
    while (i > 0) {
      const pai = (i - 1) >> 1;
      if (this.pesos[pai] <= this.pesos[i]) {
        break;
      }
      this.trocar(i, pai);
      i = pai;
    }
  }

  pop(): [number, number] {
    const topo: [number, number] = [this.nos[0], this.pesos[0]];
    const ultimoNo = this.nos.pop()!;
    const ultimoPeso = this.pesos.pop()!;
    if (this.nos.length) {
      this.nos[0] = ultimoNo;
      this.pesos[0] = ultimoPeso;
      let i = 0;
      for (;;) {
        const e = 2 * i + 1;
        const d = e + 1;
        let menor = i;
        if (e < this.nos.length && this.pesos[e] < this.pesos[menor]) {
          menor = e;
        }
        if (d < this.nos.length && this.pesos[d] < this.pesos[menor]) {
          menor = d;
        }
        if (menor === i) {
          break;
        }
        this.trocar(i, menor);
        i = menor;
      }
    }
    return topo;
  }

  private trocar(a: number, b: number) {
    [this.nos[a], this.nos[b]] = [this.nos[b], this.nos[a]];
    [this.pesos[a], this.pesos[b]] = [this.pesos[b], this.pesos[a]];
  }
}

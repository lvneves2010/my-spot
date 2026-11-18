import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Coordenada } from '../../services/geo';
import { Rua } from '../../services/ruas.service';

/** Diâmetros possíveis do croqui, em metros (o zoom muda em degraus, sem tremer). */
const ESCALAS = [60, 100, 150, 250, 400, 600, 800, 1000, 1300, 1600, 2000, 2500, 4000];
const M_POR_GRAU = 111_320;

interface Ponto {
  x: number;
  y: number;
}

/**
 * Croqui do caminho até o carro: só o contorno das ruas (OpenStreetMap), a rota
 * a pé destacada, a posição do usuário e a vaga. Fica num círculo que gira com
 * a bússola (`rotacao`), de modo que "para cima" é para onde o celular aponta.
 * Sem bússola, `rotacao` é 0 e o norte fica para cima.
 *
 * Coordenadas internas: metros a partir da vaga, x para leste e y para o sul.
 */
@Component({
  selector: 'app-croqui',
  standalone: true,
  templateUrl: './croqui.component.html',
  styleUrls: ['./croqui.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CroquiComponent {
  readonly vaga = input.required<Coordenada>();
  readonly usuario = input<Coordenada | null>(null);
  /** Direção para onde o usuário está virado (graus a partir do norte), se conhecida. */
  readonly direcao = input<number | null>(null);
  /** Rotação acumulada do mapa, em graus (-direção, sem saltos em 0°/360°). */
  readonly rotacao = input(0);
  readonly ruas = input<Rua[]>([]);
  /** Rota a pé pelas ruas, do usuário até a vaga. Sem ela, desenha a linha reta. */
  readonly rota = input<Coordenada[] | null>(null);
  /** Mensagem sobre o mapa das ruas (carregando, sem internet...). */
  readonly aviso = input<string | null>(null);

  private readonly projetar = computed(() => {
    const origem = this.vaga();
    const kx = M_POR_GRAU * Math.cos((origem.lat * Math.PI) / 180);
    return (p: Coordenada): Ponto => ({ x: (p.lng - origem.lng) * kx, y: -(p.lat - origem.lat) * M_POR_GRAU });
  });

  readonly eu = computed(() => {
    const u = this.usuario();
    return u ? this.projetar()(u) : null;
  });

  private readonly rotaXy = computed(() => {
    const rota = this.rota();
    return rota ? rota.map(this.projetar()) : null;
  });

  /** Centro do croqui: meio da caixa que contém a rota (ou o usuário e a vaga). */
  readonly centro = computed<Ponto>(() => {
    const pts = this.pontosDeEnquadramento();
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });

  /** Diâmetro visível, em metros: cabe tudo que precisa aparecer, com folga. */
  readonly diametro = computed(() => {
    const c = this.centro();
    const raio = Math.max(...this.pontosDeEnquadramento().map(p => Math.hypot(p.x - c.x, p.y - c.y)));
    const desejado = raio * 2 * 1.2;
    return ESCALAS.find(e => e >= desejado) ?? ESCALAS[ESCALAS.length - 1];
  });

  readonly viewBox = computed(() => {
    const c = this.centro();
    const r = this.diametro() / 2;
    return `${c.x - r} ${c.y - r} ${2 * r} ${2 * r}`;
  });

  /** Tamanho de referência dos marcadores, proporcional ao zoom. */
  readonly tamanho = computed(() => this.diametro() * 0.035);

  /** Ruas já projetadas (refeito só quando chegam ruas novas). */
  private readonly ruasXy = computed(() => {
    const projetar = this.projetar();
    return this.ruas().map(rua => {
      const pts = rua.pontos.map(projetar);
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      return {
        pontos: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        pedestre: rua.pedestre,
        caixa: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      };
    });
  });

  /** Só as ruas que encostam no círculo visível. */
  readonly linhas = computed(() => {
    const c = this.centro();
    const r = this.diametro() / 2;
    return this.ruasXy().filter(
      ({ caixa: [x0, y0, x1, y1] }) => x1 >= c.x - r && x0 <= c.x + r && y1 >= c.y - r && y0 <= c.y + r
    );
  });

  readonly rotaPontos = computed(() => {
    const rota = this.rotaXy();
    return rota ? rota.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') : null;
  });

  /** Posição do "N" na borda do croqui. */
  readonly norte = computed(() => {
    const c = this.centro();
    return { x: c.x, y: c.y - this.diametro() / 2 + this.tamanho() * 1.4 };
  });

  /** Seta do usuário (triângulo) apontando para `direcao`. */
  readonly setaUsuario = computed(() => {
    const eu = this.eu();
    const dir = this.direcao();
    if (!eu || dir === null) {
      return null;
    }
    const t = this.tamanho();
    return `translate(${eu.x} ${eu.y}) rotate(${dir}) translate(0 ${-t * 1.6}) scale(${t})`;
  });

  private pontosDeEnquadramento(): Ponto[] {
    const pts: Ponto[] = [{ x: 0, y: 0 }];
    const eu = this.eu();
    if (eu) {
      pts.push(eu);
    }
    pts.push(...(this.rotaXy() ?? []));
    return pts;
  }
}

import { Injectable, NgZone, inject } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Observable } from 'rxjs';
import { Coordenada, normalizar } from './geo';

interface EventoOrientacao extends DeviceOrientationEvent {
  /** Safari/iOS: já vem em graus a partir do norte magnético. */
  webkitCompassHeading?: number;
}

/** Plugin nativo (android/.../DeclinacaoPlugin.java). */
const Declinacao = registerPlugin<{ obter(o: Coordenada): Promise<{ graus: number }> }>('Declinacao');

/** Uma leitura da bússola, com os dados brutos do sensor. */
export interface LeituraBussola {
  /** Para onde o celular aponta, em graus a partir do norte verdadeiro (suavizado). */
  direcao: number;
  /** Mesma coisa, mas em relação ao norte magnético e sem suavizar. */
  magnetica: number;
  /** Declinação aplicada (graus; negativa = norte magnético a oeste do verdadeiro). */
  declinacao: number;
  alfa: number | null;
  beta: number | null;
  gama: number | null;
  absoluto: boolean;
  evento: string;
}

/**
 * Para onde o celular aponta, em graus a partir do norte verdadeiro (0–360).
 *
 * Usa o evento `deviceorientationabsolute` (WebView do Android), que combina
 * magnetômetro e acelerômetro e dá a direção em relação ao norte magnético.
 * A declinação vem do modelo geomagnético do Android (plugin nativo).
 * Se o aparelho não tiver bússola, o Observable nunca emite; a tela de guia
 * percebe e usa a direção de deslocamento do GPS.
 */
@Injectable({ providedIn: 'root' })
export class BussolaService {
  private zone = inject(NgZone);
  private declinacao = 0;
  private declinacaoCalculada = false;

  /** Calcula a declinação magnética do lugar (uma vez por sessão basta). */
  async definirLocal(local: Coordenada): Promise<void> {
    if (this.declinacaoCalculada || !Capacitor.isNativePlatform()) {
      return;
    }
    try {
      const { graus } = await Declinacao.obter({ lat: local.lat, lng: local.lng });
      this.declinacao = graus;
      this.declinacaoCalculada = true;
    } catch (err) {
      console.warn('Sem declinação magnética', err);
    }
  }

  direcao(): Observable<LeituraBussola> {
    return new Observable<LeituraBussola>(assinante => {
      // Média móvel do vetor (cosseno/seno), para suavizar sem "pular" em 359° → 0°.
      let x: number | null = null;
      let y = 0;
      const SUAVIZACAO = 0.2;

      const nomeEvento = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';

      const aoMudar = (e: Event) => {
        const ev = e as EventoOrientacao;
        let magnetica: number | null = null;
        if (typeof ev.webkitCompassHeading === 'number') {
          magnetica = ev.webkitCompassHeading;
        } else if (ev.absolute && ev.alpha !== null) {
          magnetica = direcaoDoCelular(ev.alpha, ev.beta ?? 0, ev.gamma ?? 0);
        }
        if (magnetica === null) {
          return;
        }
        // Compensa a rotação da tela (o app é retrato, mas por garantia).
        const anguloTela = screen.orientation?.angle ?? 0;
        const verdadeira = normalizar(magnetica + anguloTela + this.declinacao);
        const r = (verdadeira * Math.PI) / 180;
        if (x === null) {
          x = Math.cos(r);
          y = Math.sin(r);
        } else {
          x += (Math.cos(r) - x) * SUAVIZACAO;
          y += (Math.sin(r) - y) * SUAVIZACAO;
        }
        const leitura: LeituraBussola = {
          direcao: normalizar((Math.atan2(y, x) * 180) / Math.PI),
          magnetica: normalizar(magnetica + anguloTela),
          declinacao: this.declinacao,
          alfa: ev.alpha,
          beta: ev.beta,
          gama: ev.gamma,
          absoluto: !!ev.absolute,
          evento: nomeEvento,
        };
        this.zone.run(() => assinante.next(leitura));
      };

      window.addEventListener(nomeEvento, aoMudar, true);
      return () => window.removeEventListener(nomeEvento, aoMudar, true);
    });
  }
}

/**
 * Direção (graus a partir do norte) para onde o usuário está apontando o
 * celular, a partir dos ângulos de Euler do DeviceOrientation (ordem Z-X'-Y'').
 *
 * Só `360 - alfa` funciona com o celular deitado. Em pé (como uma câmera), o
 * topo aponta para o céu e quem indica a direção é a traseira. Aqui somamos a
 * projeção horizontal do eixo do topo (Y) com a da traseira (-Z): deitado
 * predomina o topo, em pé predomina a traseira, e no meio as duas concordam.
 */
export function direcaoDoCelular(alfa: number, beta: number, gama: number): number {
  const rad = Math.PI / 180;
  const cA = Math.cos(alfa * rad);
  const sA = Math.sin(alfa * rad);
  const cB = Math.cos(beta * rad);
  const sB = Math.sin(beta * rad);
  const cG = Math.cos(gama * rad);
  const sG = Math.sin(gama * rad);
  // Eixo Y (topo) no referencial da Terra: leste, norte.
  const topoLeste = -sA * cB;
  const topoNorte = cA * cB;
  // Eixo -Z (traseira) no referencial da Terra.
  const trasLeste = -cA * sG - sA * sB * cG;
  const trasNorte = -sA * sG + cA * sB * cG;
  return normalizar((Math.atan2(topoLeste + trasLeste, topoNorte + trasNorte) * 180) / Math.PI);
}

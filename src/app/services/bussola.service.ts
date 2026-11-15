import { Injectable, NgZone, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { normalizar } from './geo';

interface EventoOrientacao extends DeviceOrientationEvent {
  /** Safari/iOS: já vem em graus a partir do norte magnético. */
  webkitCompassHeading?: number;
}

/**
 * Para onde o topo do celular aponta, em graus a partir do norte (0–360).
 *
 * Usa o evento `deviceorientationabsolute` (WebView do Android), que combina
 * magnetômetro e acelerômetro. Se o aparelho não tiver bússola, o Observable
 * nunca emite; a tela de guia percebe e usa a direção de deslocamento do GPS.
 */
@Injectable({ providedIn: 'root' })
export class BussolaService {
  private zone = inject(NgZone);

  direcao(): Observable<number> {
    return new Observable<number>(assinante => {
      // Média móvel do vetor (cosseno/seno), para suavizar sem "pular" em 359° → 0°.
      let x: number | null = null;
      let y = 0;
      const SUAVIZACAO = 0.25;

      const aoMudar = (e: Event) => {
        const ev = e as EventoOrientacao;
        let bruto: number | null = null;
        if (typeof ev.webkitCompassHeading === 'number') {
          bruto = ev.webkitCompassHeading;
        } else if (ev.absolute && ev.alpha !== null) {
          bruto = 360 - ev.alpha;
        }
        if (bruto === null) {
          return;
        }
        // Compensa a rotação da tela (o app é retrato, mas por garantia).
        const anguloTela = screen.orientation?.angle ?? 0;
        const r = (normalizar(bruto + anguloTela) * Math.PI) / 180;
        if (x === null) {
          x = Math.cos(r);
          y = Math.sin(r);
        } else {
          x += (Math.cos(r) - x) * SUAVIZACAO;
          y += (Math.sin(r) - y) * SUAVIZACAO;
        }
        const direcao = normalizar((Math.atan2(y, x) * 180) / Math.PI);
        this.zone.run(() => assinante.next(direcao));
      };

      const nomeEvento = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(nomeEvento, aoMudar, true);
      return () => window.removeEventListener(nomeEvento, aoMudar, true);
    });
  }
}

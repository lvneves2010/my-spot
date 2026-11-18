import { Injectable, NgZone, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';
import { Observable } from 'rxjs';

export interface Leitura {
  lat: number;
  lng: number;
  /** metros */
  precisao: number;
  /** Direção de deslocamento (graus a partir do norte), quando o GPS informa. */
  direcao: number | null;
  /** m/s, quando o GPS informa. */
  velocidade: number | null;
}

/** Precisão igual ou melhor que esta encerra a busca ao marcar a vaga. */
const PRECISAO_BOA_M = 10;
/** Tempo máximo esperando o GPS melhorar ao marcar a vaga. */
const ESPERA_MAXIMA_MS = 15_000;

/**
 * `interval` e `minimumUpdateInterval` só valem no Android. Sem `interval`, o
 * plugin usa o `timeout` como intervalo, e o GPS só atualizava a cada 30 s.
 */
const OPCOES = {
  enableHighAccuracy: true,
  timeout: 30_000,
  maximumAge: 0,
  interval: 1000,
  minimumUpdateInterval: 500,
};

@Injectable({ providedIn: 'root' })
export class LocalizacaoService {
  private zone = inject(NgZone);

  /** Pede a permissão de localização. Devolve false se o usuário negar. */
  async garantirPermissao(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true; // no navegador, o próprio navigator.geolocation pergunta
    }
    let status = await Geolocation.checkPermissions();
    if (status.location !== 'granted') {
      status = await Geolocation.requestPermissions({ permissions: ['location'] });
    }
    return status.location === 'granted';
  }

  /**
   * Acompanha o GPS por alguns segundos e devolve a leitura mais precisa:
   * para quando chega a ~10 m ou após 15 s. `aoMelhorar` recebe cada leitura
   * melhor que a anterior, para a tela mostrar o progresso.
   */
  capturarMelhorPosicao(aoMelhorar?: (l: Leitura) => void): Promise<Leitura> {
    return new Promise((resolve, reject) => {
      let melhor: Leitura | null = null;
      let terminou = false;

      const terminar = (erro?: unknown) => {
        if (terminou) {
          return;
        }
        terminou = true;
        clearTimeout(limite);
        assinatura.unsubscribe();
        if (melhor) {
          resolve(melhor);
        } else {
          reject(erro ?? new Error('timeout'));
        }
      };

      const assinatura = this.acompanhar().subscribe({
        next: leitura => {
          if (!melhor || leitura.precisao < melhor.precisao) {
            melhor = leitura;
            aoMelhorar?.(leitura);
          }
          if (leitura.precisao <= PRECISAO_BOA_M) {
            // a assinatura ainda pode não existir na primeira leitura síncrona
            setTimeout(() => terminar());
          }
        },
        error: err => setTimeout(() => terminar(err)),
      });
      const limite = setTimeout(() => terminar(), ESPERA_MAXIMA_MS);
    });
  }

  /** Leituras contínuas do GPS enquanto houver assinante. */
  acompanhar(): Observable<Leitura> {
    return new Observable<Leitura>(assinante => {
      let id: string | undefined;
      let cancelado = false;

      Geolocation.watchPosition(OPCOES, (posicao: Position | null, erro?: unknown) => {
        this.zone.run(() => {
          if (erro) {
            assinante.error(erro);
          } else if (posicao) {
            assinante.next(LocalizacaoService.converter(posicao));
          }
        });
      })
        .then(callbackId => {
          id = callbackId;
          if (cancelado) {
            Geolocation.clearWatch({ id });
          }
        })
        .catch(err => this.zone.run(() => assinante.error(err)));

      return () => {
        cancelado = true;
        if (id) {
          Geolocation.clearWatch({ id });
        }
      };
    });
  }

  private static converter(p: Position): Leitura {
    const { latitude, longitude, accuracy, heading, speed } = p.coords;
    return {
      lat: latitude,
      lng: longitude,
      precisao: accuracy,
      direcao: heading ?? null,
      velocidade: speed ?? null,
    };
  }

  /** Mensagem amigável para os erros mais comuns do GPS. */
  static mensagemDeErro(err: unknown): string {
    const texto = String((err as { message?: string })?.message ?? err).toLowerCase();
    if (texto.includes('disabled') || texto.includes('not enabled')) {
      return 'A localização do aparelho está desligada. Ative o GPS e tente de novo.';
    }
    if (texto.includes('denied') || texto.includes('permission')) {
      return 'O My Spot precisa da permissão de localização para marcar e encontrar sua vaga.';
    }
    if (texto.includes('timeout')) {
      return 'O GPS demorou demais para responder. Tente em um lugar mais aberto.';
    }
    return 'Não foi possível obter a localização. Tente de novo.';
  }
}

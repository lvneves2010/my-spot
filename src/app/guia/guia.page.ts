import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircle,
  compassOutline,
  mapOutline,
  navigate,
  sparklesOutline,
  warningOutline,
} from 'ionicons/icons';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { Subscription } from 'rxjs';
import { FotoVagaComponent } from '../compartilhado/foto-vaga/foto-vaga.component';
import { RodapeEmpresaComponent } from '../compartilhado/rodape-empresa/rodape-empresa.component';
import { BussolaService, LeituraBussola } from '../services/bussola.service';
import { distanciaMetros, formatarDistancia, normalizar, pontoCardeal, rumoGraus } from '../services/geo';
import { Leitura, LocalizacaoService } from '../services/localizacao.service';
import { RAIO_RUAS_M, Rua, RuasService } from '../services/ruas.service';
import { Grafo, Rota, calcularRota, construirGrafo } from '../services/rota';
import { VagaService } from '../services/vaga.service';
import { abrirRotaNoMaps } from '../services/mapas';
import { CroquiComponent } from './croqui/croqui.component';

/** Sem leitura da bússola neste tempo, assume que o aparelho não tem. */
const ESPERA_BUSSOLA_MS = 3000;
/** Abaixo desta velocidade (m/s) a direção do GPS é ruído. */
const VELOCIDADE_MINIMA_DIRECAO = 0.7;
/** Acima desta velocidade (m/s, ~18 km/h) depois de chegar, o usuário já está dirigindo. */
const VELOCIDADE_DIRIGINDO = 5;

/** O mapa com a rota aparece a menos desta distância (m) do carro; acima, a seta. */
const MAPA_ATE_M = 1000;
/** Perto assim (m) do carro, volta para a seta: as ruas já não ajudam. */
const SETA_PERTO_M = 50;
/** Folga (m) para não ficar trocando de modo em cima do limite. */
const HISTERESE_M = 80;
/** Recalcula a rota quando o usuário anda isto (m) desde o último cálculo. */
const RECALCULAR_A_CADA_M = 6;

/** A partir daqui (m) o botão "Já peguei o carro" aparece na tela do guia. */
const BOTAO_PEGUEI_M = 60;
/** Parado (m/s) por este tempo (ms) perto do carro conta como chegada. */
const PARADO_M_S = 0.3;
const PARADO_POR_MS = 6000;
const PARADO_PERTO_M = 40;

/** auto = o app escolhe; mapa/bussola = o usuário escolheu. */
type Escolha = 'auto' | 'mapa' | 'bussola';
type Vista = 'mapa' | 'bussola';

/**
 * Guia de volta ao carro: seta (ou croqui das ruas) que aponta para a vaga,
 * usando a bússola do aparelho ou a direção de deslocamento do GPS quando não
 * há bússola, e a distância.
 */
@Component({
  selector: 'app-guia',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonContent,
    IonFooter,
    IonSpinner,
    RodapeEmpresaComponent,
    CroquiComponent,
    FotoVagaComponent,
  ],
  templateUrl: './guia.page.html',
  styleUrls: ['./guia.page.scss'],
})
export class GuiaPage implements OnDestroy {
  private vagas = inject(VagaService);
  private localizacao = inject(LocalizacaoService);
  private bussola = inject(BussolaService);
  private ruasService = inject(RuasService);
  private nav = inject(NavController);

  readonly vaga = this.vagas.vaga;
  readonly leitura = signal<Leitura | null>(null);
  readonly erro = signal<string | null>(null);
  /** O que o usuário escolheu no seletor (vale até sair da tela). */
  readonly escolha = signal<Escolha>('auto');
  /** O que o modo automático decidiu. */
  readonly vistaAuto = signal<Vista>('bussola');
  readonly vista = computed<Vista>(() => {
    const escolha = this.escolha();
    return escolha === 'auto' ? this.vistaAuto() : escolha;
  });

  /** Última leitura da bússola. null = sem bússola (ainda). */
  readonly leituraBussola = signal<LeituraBussola | null>(null);
  private readonly direcaoBussola = computed(() => this.leituraBussola()?.direcao ?? null);
  readonly semBussola = signal(false);
  /** Última direção de deslocamento confiável do GPS (fallback sem bússola). */
  private readonly direcaoGps = signal<number | null>(null);

  readonly ruas = signal<Rua[]>([]);
  readonly avisoRuas = signal<string | null>(null);
  private grafo: Grafo | null = null;
  /** Rota a pé pelas ruas (null = sem ruas ou sem caminho). */
  readonly rota = signal<Rota | null>(null);
  private ultimaRotaEm: { lat: number; lng: number } | null = null;
  readonly rotaTexto = computed(() => {
    const rota = this.rota();
    return rota ? `≈ ${formatarDistancia(rota.metros)} pelas ruas` : '';
  });

  readonly distancia = computed(() => {
    const vaga = this.vaga();
    const leitura = this.leitura();
    return vaga && leitura ? distanciaMetros(leitura, vaga) : null;
  });

  readonly distanciaTexto = computed(() => {
    const d = this.distancia();
    return d === null ? '' : formatarDistancia(d);
  });

  /** Rumo absoluto até o carro (graus a partir do norte verdadeiro). */
  readonly rumo = computed(() => {
    const vaga = this.vaga();
    const leitura = this.leitura();
    return vaga && leitura ? rumoGraus(leitura, vaga) : null;
  });

  /** Para onde o usuário está virado: bússola, ou direção em que está andando. */
  readonly direcaoUsuario = computed(() => this.direcaoBussola() ?? this.direcaoGps());

  readonly fonteDirecao = computed(() =>
    this.direcaoBussola() !== null ? 'bussola' : this.direcaoGps() !== null ? 'gps' : 'nenhuma'
  );

  /** Ângulo da seta na tela, de -180 a 180 (0 = em frente). */
  readonly anguloRelativo = computed(() => {
    const rumo = this.rumo();
    if (rumo === null) {
      return null;
    }
    const direcao = this.direcaoUsuario();
    // Sem nenhuma referência de direção, a seta é desenhada em relação ao norte.
    return normalizar(rumo - (direcao ?? 0) + 180) - 180;
  });

  /** Rotação acumulada da seta (evita dar a volta inteira ao passar de 179° para -179°). */
  readonly rotacao = signal(0);
  /** Rotação acumulada do croqui (-direção do usuário). */
  readonly rotacaoMapa = signal(0);

  readonly instrucao = computed(() => {
    const rumo = this.rumo();
    const angulo = this.anguloRelativo();
    if (rumo === null || angulo === null) {
      return '';
    }
    if (this.direcaoUsuario() === null) {
      return `Siga para ${pontoCardeal(rumo)} (${Math.round(rumo)}°). Comece a andar para a seta se orientar.`;
    }
    const lado = angulo > 0 ? 'direita' : 'esquerda';
    const abs = Math.abs(angulo);
    if (abs <= 20) {
      return 'Siga em frente';
    }
    if (abs <= 60) {
      return `Levemente à ${lado}`;
    }
    if (abs <= 135) {
      return `Vire à ${lado}`;
    }
    return 'O carro está atrás de você';
  });

  /**
   * Raio de chegada: soma a incerteza do GPS de agora com a da marcação da vaga
   * (as duas erram), entre 12 e 35 m.
   */
  readonly raioChegada = computed(() => {
    const leitura = this.leitura();
    const vaga = this.vaga();
    return Math.min(35, Math.max(12, (leitura?.precisao ?? 0) + (vaga?.precisao ?? 0) + 5));
  });

  /** Momento em que o usuário parou perto do carro (null = não está parado perto). */
  private paradoPertoDesde: number | null = null;
  /** Há quanto tempo (ms) está parado perto do carro; atualizado a cada leitura do GPS. */
  private readonly paradoPertoMs = signal(0);

  /** Chegou: dentro do raio, ou parado há alguns segundos perto do carro. */
  readonly chegou = computed(() => {
    const d = this.distancia();
    return d !== null && (d <= this.raioChegada() || this.paradoPertoMs() >= PARADO_POR_MS);
  });

  /** Perto o bastante para mostrar o botão "Já peguei o carro" no guia. */
  readonly perto = computed(() => (this.distancia() ?? Infinity) <= BOTAO_PEGUEI_M);

  /**
   * Tela de chegada. Depois de chegar, ela fica até o usuário tocar em "Já peguei
   * o carro" ou "Continuar procurando", mesmo que a distância volte a subir (por
   * exemplo, se ele sair dirigindo com o app aberto).
   */
  readonly naChegada = signal(false);
  /** O usuário dispensou a tela de chegada; só volta a aparecer depois de se afastar. */
  private chegadaDispensada = false;

  readonly dirigindo = computed(() => this.naChegada() && (this.leitura()?.velocidade ?? 0) >= VELOCIDADE_DIRIGINDO);

  readonly precisao = computed(() => Math.round(this.leitura()?.precisao ?? 0));

  private assinaturas = new Subscription();
  private esperaBussola?: ReturnType<typeof setTimeout>;
  private retentativa?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ checkmarkCircle, compassOutline, mapOutline, navigate, sparklesOutline, warningOutline });

    effect(() => {
      const alvo = this.anguloRelativo();
      if (alvo !== null) {
        this.rotacao.set(girarAte(untracked(this.rotacao), alvo));
      }
    });

    effect(() => {
      const direcao = this.direcaoUsuario();
      this.rotacaoMapa.set(girarAte(untracked(this.rotacaoMapa), -(direcao ?? 0)));
    });

    effect(() => {
      const chegou = this.chegou();
      const distancia = this.distancia() ?? 0;
      untracked(() => {
        if (chegou && !this.naChegada() && !this.chegadaDispensada) {
          this.naChegada.set(true);
          Haptics.notification({ type: NotificationType.Success }).catch(() => {});
        } else if (!chegou && distancia > 30) {
          this.chegadaDispensada = false;
        }
      });
    });

    // Parado perto do carro (o GPS da vaga pode ter errado mais que o raio).
    effect(() => {
      const leitura = this.leitura();
      const d = this.distancia();
      untracked(() => {
        const parado = !!leitura && d !== null && d <= PARADO_PERTO_M && (leitura.velocidade ?? 1) < PARADO_M_S;
        if (!parado) {
          this.paradoPertoDesde = null;
          this.paradoPertoMs.set(0);
        } else {
          this.paradoPertoDesde ??= Date.now();
          this.paradoPertoMs.set(Date.now() - this.paradoPertoDesde);
        }
      });
    });

    // Rota pelas ruas: recalcula quando o usuário anda alguns metros.
    effect(() => {
      const leitura = this.leitura();
      const vaga = this.vaga();
      this.ruas(); // quando as ruas chegam, calcula na hora
      untracked(() => {
        if (!leitura || !vaga || !this.grafo) {
          return;
        }
        if (this.ultimaRotaEm && distanciaMetros(this.ultimaRotaEm, leitura) < RECALCULAR_A_CADA_M) {
          return;
        }
        this.ultimaRotaEm = { lat: leitura.lat, lng: leitura.lng };
        this.rota.set(calcularRota(this.grafo, leitura, vaga));
      });
    });

    // Modo automático: mapa com a rota entre 50 m e 1 km; seta longe, perto ou no mesmo terreno.
    effect(() => {
      const d = this.distancia();
      const rota = this.rota();
      untracked(() => this.vistaAuto.set(this.decidirVista(d, rota)));
    });
  }

  /**
   * Mapa quando as ruas ajudam: entre SETA_PERTO_M e MAPA_ATE_M, com rota. Seta
   * quando longe (o mapa ficaria pequeno demais), perto, sem rota, ou quando o
   * usuário e o carro parecem estar no mesmo terreno (estacionamento grande):
   * os dois em corredores de estacionamento, ou tão longe das ruas que sair
   * para a rua e voltar daria mais que a linha reta.
   */
  private decidirVista(d: number | null, rota: Rota | null): Vista {
    if (d === null || !rota) {
      return 'bussola';
    }
    const atual = this.vistaAuto();
    // Histerese: para sair do modo atual, precisa passar o limite com folga.
    const limiteLonge = atual === 'mapa' ? MAPA_ATE_M + HISTERESE_M : MAPA_ATE_M;
    const limitePerto = atual === 'mapa' ? SETA_PERTO_M : SETA_PERTO_M + HISTERESE_M / 4;
    if (d > limiteLonge || d < limitePerto) {
      return 'bussola';
    }
    if (rota.dentroDeEstacionamento || rota.folgaInicio + rota.folgaFim > d) {
      return 'bussola';
    }
    return 'mapa';
  }

  async ionViewDidEnter() {
    await this.vagas.carregar();
    if (!this.vaga()) {
      this.nav.navigateRoot('/home');
      return;
    }
    if (!(await this.localizacao.garantirPermissao())) {
      this.erro.set(LocalizacaoService.mensagemDeErro('permission denied'));
      return;
    }
    this.iniciar();
  }

  ionViewWillLeave() {
    this.parar();
  }

  ngOnDestroy() {
    this.parar();
  }

  tentarDeNovo() {
    this.erro.set(null);
    this.parar();
    this.iniciar();
  }

  mudarEscolha(valor: unknown) {
    const escolha: Escolha = valor === 'mapa' || valor === 'bussola' ? valor : 'auto';
    this.escolha.set(escolha);
  }

  abrirMaps() {
    const vaga = this.vaga();
    if (vaga) {
      abrirRotaNoMaps(vaga);
    }
  }

  continuarProcurando() {
    this.naChegada.set(false);
    this.chegadaDispensada = true;
  }

  async peguei() {
    await this.vagas.liberar();
    this.nav.navigateRoot('/home', { animationDirection: 'back' });
  }

  /** Ruas em volta da vaga (guardadas ao marcar; senão, baixa agora). Tenta de novo se falhar. */
  private async carregarRuas(tentativa = 0) {
    const vaga = this.vaga();
    if (!vaga || this.grafo) {
      return;
    }
    this.avisoRuas.set('Carregando ruas…');
    try {
      const ruas = await this.ruasService.buscar(vaga, RAIO_RUAS_M);
      this.grafo = construirGrafo(ruas, vaga);
      this.ruas.set(ruas);
      this.avisoRuas.set(ruas.length ? null : 'Nenhuma rua mapeada por aqui.');
    } catch (err) {
      console.warn('Ruas indisponíveis', err);
      this.avisoRuas.set('Sem o mapa das ruas (sem internet?). Use a seta.');
      if (tentativa < 4 && !this.assinaturas.closed) {
        this.retentativa = setTimeout(() => this.carregarRuas(tentativa + 1), 5000 * 2 ** tentativa);
      }
    }
  }

  private iniciar() {
    this.assinaturas = new Subscription();
    let primeiraLeitura = true;
    this.assinaturas.add(
      this.localizacao.acompanhar().subscribe({
        next: leitura => {
          this.leitura.set(leitura);
          if (primeiraLeitura) {
            primeiraLeitura = false;
            this.bussola.definirLocal(leitura);
          }
          if (leitura.direcao !== null && (leitura.velocidade ?? 0) >= VELOCIDADE_MINIMA_DIRECAO) {
            this.direcaoGps.set(leitura.direcao);
          }
        },
        error: err => this.erro.set(LocalizacaoService.mensagemDeErro(err)),
      })
    );
    this.assinaturas.add(
      this.bussola.direcao().subscribe(leitura => {
        clearTimeout(this.esperaBussola);
        this.semBussola.set(false);
        this.leituraBussola.set(leitura);
      })
    );
    this.esperaBussola = setTimeout(() => {
      if (this.leituraBussola() === null) {
        this.semBussola.set(true);
      }
    }, ESPERA_BUSSOLA_MS);

    this.carregarRuas();

  }

  private parar() {
    clearTimeout(this.esperaBussola);
    clearTimeout(this.retentativa);
    this.assinaturas.unsubscribe();
  }
}

/** Próxima rotação acumulada que chega ao ângulo `alvo` pelo caminho mais curto. */
function girarAte(atual: number, alvo: number): number {
  const delta = normalizar(alvo - atual + 180) - 180;
  return Math.abs(delta) > 0.5 ? atual + delta : atual;
}

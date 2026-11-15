import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, mapOutline, navigate, warningOutline } from 'ionicons/icons';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { Subscription } from 'rxjs';
import { RodapeEmpresaComponent } from '../compartilhado/rodape-empresa/rodape-empresa.component';
import { BussolaService } from '../services/bussola.service';
import { distanciaMetros, formatarDistancia, normalizar, pontoCardeal, rumoGraus } from '../services/geo';
import { Leitura, LocalizacaoService } from '../services/localizacao.service';
import { VagaService } from '../services/vaga.service';
import { abrirRotaNoMaps } from '../services/mapas';

/** Sem leitura da bússola neste tempo, assume que o aparelho não tem. */
const ESPERA_BUSSOLA_MS = 3000;
/** Abaixo desta velocidade (m/s) a direção do GPS é ruído. */
const VELOCIDADE_MINIMA_DIRECAO = 0.7;

/**
 * Guia de volta ao carro: seta que aponta para a vaga (bússola do aparelho,
 * ou a direção de deslocamento do GPS quando não há bússola) e distância.
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
    IonContent,
    IonFooter,
    IonSpinner,
    RodapeEmpresaComponent,
  ],
  templateUrl: './guia.page.html',
  styleUrls: ['./guia.page.scss'],
})
export class GuiaPage implements OnDestroy {
  private vagas = inject(VagaService);
  private localizacao = inject(LocalizacaoService);
  private bussola = inject(BussolaService);
  private nav = inject(NavController);

  readonly vaga = this.vagas.vaga;
  readonly leitura = signal<Leitura | null>(null);
  readonly erro = signal<string | null>(null);

  /** Direção do topo do celular (bússola). null = sem bússola. */
  private readonly direcaoBussola = signal<number | null>(null);
  readonly semBussola = signal(false);
  /** Última direção de deslocamento confiável do GPS (fallback sem bússola). */
  private readonly direcaoGps = signal<number | null>(null);

  readonly distancia = computed(() => {
    const vaga = this.vaga();
    const leitura = this.leitura();
    return vaga && leitura ? distanciaMetros(leitura, vaga) : null;
  });

  readonly distanciaTexto = computed(() => {
    const d = this.distancia();
    return d === null ? '' : formatarDistancia(d);
  });

  /** Rumo absoluto até o carro (graus a partir do norte). */
  readonly rumo = computed(() => {
    const vaga = this.vaga();
    const leitura = this.leitura();
    return vaga && leitura ? rumoGraus(leitura, vaga) : null;
  });

  /** Para onde o usuário está virado: bússola, ou direção em que está andando. */
  readonly direcaoUsuario = computed(() => this.direcaoBussola() ?? this.direcaoGps());

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

  /** Rotação acumulada (evita a seta dar a volta inteira ao passar de 179° para -179°). */
  readonly rotacao = signal(0);

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

  /** Chegou: dentro do raio de incerteza do GPS (entre 8 e 20 m). */
  readonly chegou = computed(() => {
    const d = this.distancia();
    const leitura = this.leitura();
    if (d === null || !leitura) {
      return false;
    }
    const raio = Math.min(20, Math.max(8, leitura.precisao));
    return d <= raio;
  });

  readonly precisao = computed(() => Math.round(this.leitura()?.precisao ?? 0));

  private assinaturas = new Subscription();
  private esperaBussola?: ReturnType<typeof setTimeout>;
  private jaAvisouChegada = false;

  constructor() {
    addIcons({ checkmarkCircle, mapOutline, navigate, warningOutline });

    effect(() => {
      const alvo = this.anguloRelativo();
      if (alvo === null) {
        return;
      }
      const atual = untracked(this.rotacao);
      const delta = normalizar(alvo - atual + 180) - 180;
      if (Math.abs(delta) > 0.5) {
        this.rotacao.set(atual + delta);
      }
    });

    effect(() => {
      if (this.chegou() && !this.jaAvisouChegada) {
        this.jaAvisouChegada = true;
        Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      } else if (!this.chegou() && (this.distancia() ?? 0) > 30) {
        this.jaAvisouChegada = false;
      }
    });
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

  abrirMaps() {
    const vaga = this.vaga();
    if (vaga) {
      abrirRotaNoMaps(vaga);
    }
  }

  async peguei() {
    await this.vagas.liberar();
    this.nav.navigateRoot('/home', { animationDirection: 'back' });
  }

  private iniciar() {
    this.assinaturas = new Subscription();
    this.assinaturas.add(
      this.localizacao.acompanhar().subscribe({
        next: leitura => {
          this.leitura.set(leitura);
          if (leitura.direcao !== null && (leitura.velocidade ?? 0) >= VELOCIDADE_MINIMA_DIRECAO) {
            this.direcaoGps.set(leitura.direcao);
          }
        },
        error: err => this.erro.set(LocalizacaoService.mensagemDeErro(err)),
      })
    );
    this.assinaturas.add(
      this.bussola.direcao().subscribe(direcao => {
        clearTimeout(this.esperaBussola);
        this.semBussola.set(false);
        this.direcaoBussola.set(direcao);
      })
    );
    this.esperaBussola = setTimeout(() => {
      if (this.direcaoBussola() === null) {
        this.semBussola.set(true);
      }
    }, ESPERA_BUSSOLA_MS);
  }

  private parar() {
    clearTimeout(this.esperaBussola);
    this.assinaturas.unsubscribe();
  }
}

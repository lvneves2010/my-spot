import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  NavController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cameraOutline,
  carSport,
  location,
  mapOutline,
  navigate,
  refreshOutline,
  shieldCheckmarkOutline,
  trashOutline,
} from 'ionicons/icons';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { FotoVagaComponent } from '../compartilhado/foto-vaga/foto-vaga.component';
import { RodapeEmpresaComponent } from '../compartilhado/rodape-empresa/rodape-empresa.component';
import { AnunciosService } from '../services/anuncios.service';
import { FotoService } from '../services/foto.service';
import { LocalizacaoService } from '../services/localizacao.service';
import { RuasService } from '../services/ruas.service';
import { VagaService } from '../services/vaga.service';
import { abrirRotaNoMaps } from '../services/mapas';

/** Tela principal: marca a vaga ou, se já houver uma, mostra e oferece o guia de volta. */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    AsyncPipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonSpinner,
    IonTextarea,
    RodapeEmpresaComponent,
    FotoVagaComponent,
  ],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit, OnDestroy {
  private vagas = inject(VagaService);
  private localizacao = inject(LocalizacaoService);
  private fotos = inject(FotoService);
  private ruas = inject(RuasService);
  private anuncios = inject(AnunciosService);
  private alertas = inject(AlertController);
  private toasts = inject(ToastController);
  private nav = inject(NavController);

  readonly vaga = this.vagas.vaga;
  readonly precisaOpcoesPrivacidade$ = this.anuncios.precisaOpcoesPrivacidade$;

  readonly marcando = signal(false);
  readonly fotografando = signal(false);
  /** Precisão da melhor leitura enquanto marca (metros). */
  readonly precisaoAtual = signal<number | null>(null);

  private readonly agora = signal(Date.now());
  private relogio?: ReturnType<typeof setInterval>;

  readonly tempoEstacionado = computed(() => {
    const vaga = this.vaga();
    return vaga ? HomePage.tempoDesde(new Date(vaga.marcadaEm).getTime(), this.agora()) : '';
  });

  readonly horaMarcada = computed(() => {
    const vaga = this.vaga();
    return vaga
      ? new Date(vaga.marcadaEm).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  });

  constructor() {
    addIcons({ cameraOutline, carSport, location, mapOutline, navigate, refreshOutline, shieldCheckmarkOutline, trashOutline });
  }

  ngOnInit() {
    this.vagas.carregar();
    this.relogio = setInterval(() => this.agora.set(Date.now()), 30_000);
  }

  ionViewDidEnter() {
    this.agora.set(Date.now());
    this.anuncios.mostrarBanner();
  }

  ngOnDestroy() {
    clearInterval(this.relogio);
  }

  async marcar() {
    if (this.marcando()) {
      return;
    }
    this.marcando.set(true);
    this.precisaoAtual.set(null);
    try {
      if (!(await this.localizacao.garantirPermissao())) {
        throw new Error('permission denied');
      }
      const leitura = await this.localizacao.capturarMelhorPosicao(l => this.precisaoAtual.set(Math.round(l.precisao)));
      await this.vagas.salvar({
        lat: leitura.lat,
        lng: leitura.lng,
        precisao: Math.round(leitura.precisao),
        marcadaEm: new Date().toISOString(),
      });
      // Baixa já as ruas em volta (ainda com sinal), para o mapa do guia funcionar mesmo sem internet.
      this.ruas
        .esquecer()
        .then(() => this.ruas.preparar(leitura))
        .catch(err => console.warn('Ruas não baixadas agora; o guia tenta de novo', err));
      Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      this.avisar(
        leitura.precisao > 30
          ? 'Vaga marcada, mas o sinal do GPS estava fraco. Anote o piso e a vaga.'
          : 'Vaga marcada! Se quiser, tire uma foto da vaga.'
      );
    } catch (err) {
      this.avisar(LocalizacaoService.mensagemDeErro(err), 'danger');
    } finally {
      this.marcando.set(false);
    }
  }

  async remarcar() {
    if (await this.confirmar('Marcar de novo?', 'A vaga atual será substituída pela sua posição agora.', 'Marcar')) {
      await this.marcar();
    }
  }

  async liberar() {
    if (await this.confirmar('Já pegou o carro?', 'A vaga marcada será apagada.', 'Apagar')) {
      await this.vagas.liberar();
    }
  }

  async tirarFoto() {
    if (this.fotografando()) {
      return;
    }
    this.fotografando.set(true);
    try {
      const foto = await this.fotos.tirar();
      if (foto) {
        await this.vagas.definirFoto(foto);
        this.avisar('Foto da vaga salva.');
      }
    } catch (err) {
      console.warn('Foto da vaga', err);
      this.avisar('Não foi possível tirar a foto.', 'danger');
    } finally {
      this.fotografando.set(false);
    }
  }

  async removerFoto() {
    if (await this.confirmar('Remover a foto?', 'A foto da vaga será apagada.', 'Remover')) {
      await this.vagas.definirFoto(undefined);
    }
  }

  async salvarObservacao(texto: string | null | undefined) {
    if ((texto ?? '').trim() !== (this.vaga()?.observacao ?? '')) {
      await this.vagas.atualizarObservacao(texto ?? '');
      this.avisar('Anotação salva.');
    }
  }

  guiar() {
    this.nav.navigateForward('/guia');
  }

  abrirMaps() {
    const vaga = this.vaga();
    if (vaga) {
      abrirRotaNoMaps(vaga).catch(() => this.avisar('Não foi possível abrir o Google Maps.', 'danger'));
    }
  }

  privacidade() {
    this.anuncios.abrirOpcoesPrivacidade();
  }

  private async confirmar(header: string, message: string, ok: string): Promise<boolean> {
    const alerta = await this.alertas.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: ok, role: 'confirm' },
      ],
    });
    await alerta.present();
    return (await alerta.onDidDismiss()).role === 'confirm';
  }

  private async avisar(message: string, color: 'success' | 'danger' = 'success') {
    const toast = await this.toasts.create({ message, color, duration: 3000, position: 'top' });
    await toast.present();
  }

  /** "agora mesmo", "há 12 min", "há 2 h 05 min", "há 3 dias". */
  static tempoDesde(inicio: number, agora: number): string {
    const minutos = Math.max(0, Math.floor((agora - inicio) / 60_000));
    if (minutos < 1) {
      return 'agora mesmo';
    }
    if (minutos < 60) {
      return `há ${minutos} min`;
    }
    const horas = Math.floor(minutos / 60);
    if (horas < 24) {
      return `há ${horas} h ${String(minutos % 60).padStart(2, '0')} min`;
    }
    const dias = Math.floor(horas / 24);
    return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  }
}

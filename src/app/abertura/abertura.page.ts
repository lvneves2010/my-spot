import { Component, OnDestroy, inject } from '@angular/core';
import { IonContent, IonSpinner, NavController } from '@ionic/angular/standalone';
import { RodapeEmpresaComponent } from '../compartilhado/rodape-empresa/rodape-empresa.component';

/** Abertura (~3 s): ícone, nome do app e rodapé completo da HSI. Toque pula. */
@Component({
  selector: 'app-abertura',
  standalone: true,
  imports: [IonContent, IonSpinner, RodapeEmpresaComponent],
  templateUrl: './abertura.page.html',
  styleUrls: ['./abertura.page.scss'],
})
export class AberturaPage implements OnDestroy {
  private nav = inject(NavController);

  static readonly DURACAO_MS = 3000;

  private timer?: ReturnType<typeof setTimeout>;

  ionViewDidEnter() {
    this.timer = setTimeout(() => this.entrar(), AberturaPage.DURACAO_MS);
  }

  entrar() {
    clearTimeout(this.timer);
    this.nav.navigateRoot('/home', { animated: true, animationDirection: 'forward' });
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }
}

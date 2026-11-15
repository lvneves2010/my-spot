import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AnunciosService } from './services/anuncios.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor() {
    // Consentimento UMP + SDK do AdMob em segundo plano, enquanto a abertura aparece.
    inject(AnunciosService).iniciar();
  }
}

import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FotoService } from '../../services/foto.service';

/** Miniatura da foto da vaga; um toque abre em tela cheia, outro fecha. */
@Component({
  selector: 'app-foto-vaga',
  standalone: true,
  template: `
    <button type="button" class="miniatura" (click)="ampliada.set(true)" aria-label="Ampliar a foto da vaga">
      <img [src]="src()" alt="Foto da vaga" />
      <span class="dica">toque para ampliar</span>
    </button>
    @if (ampliada()) {
      <div class="tela-cheia" (click)="ampliada.set(false)" role="dialog" aria-label="Foto da vaga">
        <img [src]="src()" alt="Foto da vaga" />
        <span class="fechar">toque para fechar</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .miniatura {
      position: relative;
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      border-radius: 12px;
      overflow: hidden;
      background: #000;

      img {
        display: block;
        width: 100%;
        height: var(--altura-foto, 160px);
        object-fit: cover;
      }
    }

    .dica {
      position: absolute;
      right: 8px;
      bottom: 6px;
      padding: 2px 8px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-size: 11px;
    }

    .tela-cheia {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
      background: rgba(0, 0, 0, 0.94);

      img {
        max-width: 100%;
        max-height: 85%;
        object-fit: contain;
      }
    }

    .fechar {
      color: rgba(255, 255, 255, 0.7);
      font-size: 13px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FotoVagaComponent {
  readonly foto = input.required<string>();
  readonly src = computed(() => FotoService.src(this.foto()));
  readonly ampliada = signal(false);
}

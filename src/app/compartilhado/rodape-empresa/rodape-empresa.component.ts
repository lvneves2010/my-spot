import { booleanAttribute, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import pacote from '../../../../package.json';

/**
 * Rodapé discreto com o logo da HSI ao lado do nome e da versão
 * (mesmo padrão do PlanEvento, da KIRA e do Marcador de Jogos). [compacto] mostra só
 * o logo e o número da versão (telas internas); completo, também o nome da
 * empresa (tela de abertura).
 */
@Component({
  selector: 'app-rodape-empresa',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rodape-empresa.component.html',
  styleUrls: ['./rodape-empresa.component.scss'],
})
export class RodapeEmpresaComponent {
  @Input({ transform: booleanAttribute }) compacto = false;

  /** Fonte única: "version" do package.json (o build Android também lê de lá). */
  readonly versao = pacote.version;
}

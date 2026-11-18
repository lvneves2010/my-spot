import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { FotoService } from './foto.service';
import { Coordenada } from './geo';
import { RuasService } from './ruas.service';

/** Lugar onde o carro ficou. */
export interface Vaga extends Coordenada {
  /** Precisão do GPS no momento da marcação, em metros. */
  precisao: number;
  /** ISO 8601. */
  marcadaEm: string;
  /** Anotação livre: "Piso G2, vaga 34, perto do elevador". */
  observacao?: string;
  /** Foto da vaga: URI do arquivo na pasta do app (ou data URL no navegador). */
  foto?: string;
}

const CHAVE = 'myspot:vaga';

/**
 * Guarda a vaga atual no próprio aparelho (@capacitor/preferences:
 * SharedPreferences no Android, localStorage no navegador). Só existe uma vaga
 * por vez: marcar de novo substitui a anterior.
 */
@Injectable({ providedIn: 'root' })
export class VagaService {
  private fotos = inject(FotoService);
  private ruas = inject(RuasService);
  private readonly _vaga = signal<Vaga | null>(null);
  readonly vaga = this._vaga.asReadonly();

  private carregando?: Promise<void>;

  carregar(): Promise<void> {
    this.carregando ??= Preferences.get({ key: CHAVE }).then(({ value }) => {
      if (!value) {
        return;
      }
      try {
        this._vaga.set(JSON.parse(value) as Vaga);
      } catch {
        console.warn('Vaga salva ilegível; ignorando');
      }
    });
    return this.carregando;
  }

  async salvar(vaga: Vaga): Promise<void> {
    const fotoAnterior = this._vaga()?.foto;
    this._vaga.set(vaga);
    await Preferences.set({ key: CHAVE, value: JSON.stringify(vaga) });
    if (fotoAnterior && fotoAnterior !== vaga.foto) {
      await this.fotos.apagar(fotoAnterior);
    }
  }

  /** Troca (ou põe) a foto da vaga atual; a anterior é apagada. */
  async definirFoto(foto: string | undefined): Promise<void> {
    const atual = this._vaga();
    if (atual) {
      await this.salvar({ ...atual, foto });
    } else {
      await this.fotos.apagar(foto);
    }
  }

  async atualizarObservacao(observacao: string): Promise<void> {
    const atual = this._vaga();
    if (atual) {
      await this.salvar({ ...atual, observacao: observacao.trim() || undefined });
    }
  }

  async liberar(): Promise<void> {
    const foto = this._vaga()?.foto;
    this._vaga.set(null);
    await Preferences.remove({ key: CHAVE });
    await this.fotos.apagar(foto);
    await this.ruas.esquecer();
  }
}

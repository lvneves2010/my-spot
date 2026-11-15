import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Coordenada } from './geo';

/** Lugar onde o carro ficou. */
export interface Vaga extends Coordenada {
  /** Precisão do GPS no momento da marcação, em metros. */
  precisao: number;
  /** ISO 8601. */
  marcadaEm: string;
  /** Anotação livre: "Piso G2, vaga 34, perto do elevador". */
  observacao?: string;
}

const CHAVE = 'myspot:vaga';

/**
 * Guarda a vaga atual no próprio aparelho (@capacitor/preferences:
 * SharedPreferences no Android, localStorage no navegador). Só existe uma vaga
 * por vez: marcar de novo substitui a anterior.
 */
@Injectable({ providedIn: 'root' })
export class VagaService {
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
    this._vaga.set(vaga);
    await Preferences.set({ key: CHAVE, value: JSON.stringify(vaga) });
  }

  async atualizarObservacao(observacao: string): Promise<void> {
    const atual = this._vaga();
    if (atual) {
      await this.salvar({ ...atual, observacao: observacao.trim() || undefined });
    }
  }

  async liberar(): Promise<void> {
    this._vaga.set(null);
    await Preferences.remove({ key: CHAVE });
  }
}

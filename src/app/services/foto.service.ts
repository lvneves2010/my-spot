import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** Lado maior da foto (px). Basta para reconhecer a vaga e mantém o arquivo em ~200–400 KB. */
const LADO_MAXIMO = 1600;
const QUALIDADE = 70;

/**
 * Foto da vaga (uma só). Usa a câmera do sistema (sem permissão de câmera no
 * app) e guarda uma cópia na pasta privada do app (`Directory.Data`), que não
 * aparece na galeria. No navegador, a foto fica como data URL.
 */
@Injectable({ providedIn: 'root' })
export class FotoService {
  /** Tira a foto e devolve onde ela ficou (URI do arquivo ou data URL). null = cancelou. */
  async tirar(): Promise<string | null> {
    let resultado;
    try {
      resultado = await Camera.takePhoto({
        quality: QUALIDADE,
        targetWidth: LADO_MAXIMO,
        targetHeight: LADO_MAXIMO,
        correctOrientation: true,
        saveToGallery: false,
        editable: 'no',
      });
    } catch (err) {
      if (/cancel/i.test(String((err as { message?: string })?.message ?? err))) {
        return null;
      }
      throw err;
    }

    if (!Capacitor.isNativePlatform() || !resultado.uri) {
      const base64 = resultado.thumbnail;
      return base64 ? (base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`) : null;
    }

    // A câmera grava num arquivo temporário; copiamos para a pasta do app.
    const { data } = await Filesystem.readFile({ path: resultado.uri });
    const { uri } = await Filesystem.writeFile({
      path: `vaga-${Date.now()}.jpg`,
      data: data as string,
      directory: Directory.Data,
    });
    Filesystem.deleteFile({ path: resultado.uri }).catch(() => {});
    return uri;
  }

  /** Apaga o arquivo da foto (no navegador não há o que apagar). */
  async apagar(foto: string | undefined): Promise<void> {
    if (foto && !foto.startsWith('data:')) {
      await Filesystem.deleteFile({ path: foto }).catch(() => {});
    }
  }

  /** Endereço que o <img> da WebView consegue abrir. */
  static src(foto: string): string {
    return foto.startsWith('data:') ? foto : Capacitor.convertFileSrc(foto);
  }
}

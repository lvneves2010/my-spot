import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Coordenada, linkRotaAPe } from './geo';

/** Abre a rota a pé até o destino no Google Maps (app, se instalado; senão o navegador). */
export async function abrirRotaNoMaps(destino: Coordenada): Promise<void> {
  const url = linkRotaAPe(destino);
  if (Capacitor.isNativePlatform()) {
    await AppLauncher.openUrl({ url });
  } else {
    window.open(url, '_blank');
  }
}

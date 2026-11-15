#!/usr/bin/env node
/**
 * Gera, a partir de src/assets/icon/favicon.svg (e favicon-foreground.svg):
 *  - os ícones do Android (mipmaps + ícone adaptativo);
 *  - as imagens de splash nativas (fundo escuro com o ícone no centro);
 *  - store/icone_playstore_512.png (ícone da Play Store, 512×512).
 * Depois rode `npx cap sync android`.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COR_FUNDO = '#0d1b2a';

const raiz = path.resolve(__dirname, '..');
const svgPath = path.join(raiz, 'src/assets/icon/favicon.svg');
const foregroundSvgPath = path.join(raiz, 'src/assets/icon/favicon-foreground.svg');
for (const arquivo of [svgPath, foregroundSvgPath]) {
  if (!fs.existsSync(arquivo)) {
    console.error('SVG não encontrado:', arquivo);
    process.exit(1);
  }
}

// Tamanhos (px) do ícone de launcher por densidade
const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const outBase = path.join(raiz, 'android/app/src/main/res');
const transparente = { r: 0, g: 0, b: 0, alpha: 0 };
const svg = (arquivo) => sharp(arquivo, { density: 400 });

(async () => {
  for (const [folder, size] of Object.entries(sizes)) {
    const dir = path.join(outBase, folder);
    fs.mkdirSync(dir, { recursive: true });

    for (const nome of ['ic_launcher.png', 'ic_launcher_round.png']) {
      await svg(svgPath).resize(size, size, { fit: 'contain', background: transparente }).png().toFile(path.join(dir, nome));
    }

    // Camada da frente do ícone adaptativo (108dp => 2,25× o tamanho do launcher).
    const tamanhoAdaptativo = Math.round(size * 2.25);
    for (const nome of ['ic_launcher_foreground.png', 'ic_launcher_round_foreground.png']) {
      await svg(foregroundSvgPath)
        .resize(tamanhoAdaptativo, tamanhoAdaptativo, { fit: 'contain', background: transparente })
        .png()
        .toFile(path.join(dir, nome));
    }
    console.log('Ícones em', folder);
  }

  const adaptiveDir = path.join(outBase, 'mipmap-anydpi-v26');
  fs.mkdirSync(adaptiveDir, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
  fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), xml);
  fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher_round.xml'), xml);

  const valuesDir = path.join(outBase, 'values');
  fs.mkdirSync(valuesDir, { recursive: true });
  fs.writeFileSync(
    path.join(valuesDir, 'colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="launcher_background">${COR_FUNDO}</color>\n</resources>\n`
  );

  // Splash: substitui cada drawable*/splash.png (gerados pelo Capacitor) mantendo o tamanho.
  for (const pasta of fs.readdirSync(outBase).filter((p) => p.startsWith('drawable'))) {
    const arquivo = path.join(outBase, pasta, 'splash.png');
    if (!fs.existsSync(arquivo)) continue;
    const { width, height } = await sharp(arquivo).metadata();
    const lado = Math.round(Math.min(width, height) * 0.35);
    const icone = await svg(foregroundSvgPath).resize(lado, lado).png().toBuffer();
    const buffer = await sharp({ create: { width, height, channels: 4, background: COR_FUNDO } })
      .composite([{ input: icone, gravity: 'center' }])
      .png()
      .toBuffer();
    fs.writeFileSync(arquivo, buffer);
  }
  console.log('Splash gerada');

  // Ícone da Play Store: 512×512, quadrado cheio (a Play arredonda sozinha).
  const storeDir = path.join(raiz, 'store');
  fs.mkdirSync(storeDir, { recursive: true });
  // A camada da frente vem reduzida para a zona segura; amplia um pouco e recorta o centro.
  const conteudo = await svg(foregroundSvgPath)
    .resize(680, 680)
    .extract({ left: 84, top: 84, width: 512, height: 512 })
    .png()
    .toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: COR_FUNDO } })
    .composite([{ input: conteudo }])
    .flatten({ background: COR_FUNDO })
    .png()
    .toFile(path.join(storeDir, 'icone_playstore_512.png'));
  console.log('store/icone_playstore_512.png');

  console.log('Pronto. Rode `npx cap sync android` para levar tudo ao projeto nativo.');
})();

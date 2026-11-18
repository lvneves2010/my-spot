# My Spot

App Android para **achar o carro estacionado**, da **Help Soluções em Informática (HSI)**. Ao estacionar, o usuário aperta um botão e o app marca o lugar com o GPS. Depois, outro botão guia a pessoa de volta: uma seta aponta para o carro e mostra a distância. Funciona sem conta e sem backend, e a vaga fica só no celular. A única chamada de rede é o traçado das ruas (tiles vetoriais do OpenFreeMap, dados do OpenStreetMap): baixado ao marcar a vaga, por tiles de ~2,2 km, sem revelar o ponto exato.

- Repo: https://github.com/lvneves2010/my-spot. O push funciona pelo Git Credential Manager da máquina.
- applicationId: `br.com.hsi.myspot`. **Não pode mudar depois de publicado na Play.**
- Pasta de trabalho: `C:\repos\HSI\my-spot`.
- Projetos irmãos em `C:\repos\HSI`: `kira` (mesma stack standalone, serviu de modelo para a abertura, o rodapé, o AdMob, a versão e a assinatura), `planevento` (mesma stack com NgModules), `marcador-jogos` (Flutter, a origem do padrão de rodapé HSI) e `leoneves-site` (onde vai ficar a política de privacidade).

## Stack

- Ionic 8 + Angular 20 com **componentes standalone** e signals + **Capacitor 8**.
- **O Capacitor 8 exige Node 22.** O Node global da máquina é o 20 (nvm-windows). Não troque o global: use `export PATH=/c/nvm/v22.23.2:$PATH`.
- Gradle precisa de JDK 21: `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`.
- Android: minSdk 24, compile/target 36 (`android/variables.gradle`). O app fica travado em retrato (`screenOrientation="portrait"` no manifest), o que simplifica a bússola.
- Plugins: `@capacitor/geolocation`, `@capacitor/preferences`, `@capacitor/haptics`, `@capacitor/app-launcher` (abre o Google Maps), `@capacitor/camera` + `@capacitor/filesystem` (foto da vaga) e `@capacitor-community/admob`. Libs: `@mapbox/vector-tile` + `pbf` (decodificar os tiles).

## Estrutura

- `src/app/abertura`: tela de abertura (~3 s; um toque pula) com ícone, nome e rodapé completo da HSI. A rota `''` redireciona para ela.
- `src/app/home`: sem vaga, mostra o botão redondo "Marcar minha vaga". Com vaga, mostra há quanto tempo o carro está lá, um campo de anotação (piso, número da vaga), a foto da vaga ("Tirar foto da vaga" / "Trocar foto" / "Remover") e os botões "Me leve até o carro", "Rota a pé no Google Maps", "Marcar de novo" e "Já peguei o carro". Rodapé compacto em `ion-footer`; ao entrar, mostra o banner do AdMob.
- `src/app/guia`: guia de volta. Seletor **Auto / Mapa / Seta** (padrão Auto, vale até sair da tela).
  - **Auto** mostra o **Mapa** (croqui `guia/croqui`: contorno das ruas, a **rota a pé** destacada em verde, você e a vaga, girando com a bússola) entre 50 m e 1 km do carro, e a **Seta** nos outros casos. Também usa a Seta quando você e o carro parecem estar no mesmo terreno: os dois em corredores de estacionamento, ou tão longe das ruas que sair para a rua e voltar daria mais que a linha reta. Tem histerese de 80 m para não ficar trocando.
  - A distância grande é sempre em linha reta; no mapa aparece também "≈ X pelas ruas".
  - **Chegada**: raio = precisão do GPS agora + precisão da marcação + 5 m (entre 12 e 35 m), **ou** parado (< 0,3 m/s) por 6 s a até 40 m. No teste de 2026-11-17 a vaga ficou ~18 m deslocada com GPS ±3 m, e o raio antigo (8 m) nunca disparava. A tela "Você chegou!" vibra e **fica presa** até "Já peguei o carro" ou "continuar", mesmo que a distância volte a subir (ele pode sair dirigindo com o app aberto).
  - A menos de 60 m aparece o botão grande "Cheguei, já peguei o carro". O botão "Peguei" fica sempre no topo.
- `src/app/services/vaga.service.ts`: **uma vaga por vez**, gravada em `@capacitor/preferences` na chave `myspot:vaga` (JSON com lat, lng, precisão, data, anotação e `foto`). Exposta como signal. Marcar de novo, trocar a foto ou liberar a vaga apaga o arquivo da foto anterior.
- `src/app/services/foto.service.ts`: **uma foto por vaga**. `Camera.takePhoto` abre a câmera do sistema (o app não declara a permissão `CAMERA`, e nem precisa) e a foto é copiada para `Directory.Data` como `vaga-<timestamp>.jpg` (privada, fora da galeria; lado maior 1600 px, JPEG 70). O `<img>` usa `Capacitor.convertFileSrc`.
- `src/app/compartilhado/foto-vaga`: miniatura da foto que abre em tela cheia ao toque. Aparece na home, no guia e, maior, na tela "Você chegou!".
- `src/app/services/localizacao.service.ts`: GPS. `capturarMelhorPosicao()` escuta o GPS por até 15 s e fica com a leitura mais precisa (para antes, se chegar a ±10 m). `acompanhar()` é um Observable com o `watchPosition`. O `watchPosition` pede `interval: 1000`. Sem isso, o plugin usa o `timeout` (30 s) como intervalo no Android.
- `src/app/services/bussola.service.ts`: direção do celular pelo evento `deviceorientationabsolute` da WebView, suavizada. **Se o aparelho não tiver bússola**, a tela de guia usa a direção de deslocamento do GPS (só acima de 0,7 m/s). Sem nenhuma das duas, a seta é desenhada em relação ao norte, com um "N" no topo do mostrador.
  - A direção usa alfa, beta e gama (`direcaoDoCelular`): com o celular deitado vale o topo, em pé vale a traseira. Só `360 - alfa` erra com o celular inclinado.
  - A WebView dá o norte **magnético**. O plugin nativo `DeclinacaoPlugin.java` (registrado no `MainActivity`) usa o `GeomagneticField` do Android para converter ao norte verdadeiro. Em SP a declinação passa de 20°.
- `src/app/services/ruas.service.ts`: ruas pelos **tiles vetoriais do OpenFreeMap** (`tiles.openfreemap.org`, sem chave e sem limite; esquema OpenMapTiles, camada `transportation`, zoom 14). Ao marcar a vaga, a home baixa os tiles num raio de 1,1 km e guarda no **Cache Storage** da WebView (`myspot-ruas`); o guia lê de lá e funciona sem sinal. Liberar a vaga apaga. Cada ponto ganha uma chave inteira global (coordenada do tile), igual entre tiles vizinhos. **Exige o crédito "© OpenFreeMap © colaboradores do OpenStreetMap"**.
  - **Não use a Overpass API**: em 2026-11-17 os quatro servidores públicos falharam (502/504/sem resposta) e o principal recusa (406) clientes que não são navegador.
- `src/app/services/rota.ts`: rota a pé calculada no celular (Dijkstra). Os tiles vêm simplificados (o vértice da esquina some em rua reta), então o grafo é **reparado**: ponta solta a até 4 m de outra rua é ligada a ela, e segmentos que se cruzam ganham um nó (exceto pontes e túneis). Num tile da Paulista: 8 mil nós, 1 componente principal, grafo em ~70 ms. As distâncias até a vaga saem de um Dijkstra feito uma vez; depois, cada recálculo só testa as ruas perto do usuário (todas até 25 m além da mais próxima, com o trecho fora da rua pesando 1,5×) e fica com o menor caminho. Encaixar só na rua mais próxima pegava a pista errada da avenida: no teste de 2026-11-18 a rota deu 360 m para um carro a 160 m.Encaixa a vaga no maior pedaço da rede e o usuário no mesmo pedaço.
- `src/app/services/geo.ts`: haversine, rumo, formatação e o link de rota a pé do Google Maps. `mapas.ts` abre esse link.
- `src/app/compartilhado/rodape-empresa`: logo HSI + versão. Com `compacto`, mostra só o logo e o número.
- `src/app/services/anuncios.service.ts`: AdMob, cópia do kira/planevento.

## Versão

Fonte única: `"version"` do `package.json` (e o `package-lock.json`, que repete o número duas vezes). O rodapé lê de lá e o `android/app/build.gradle` também: `versionName` é a versão e `versionCode` = MAJOR·10000 + MINOR·100 + PATCH. **Suba a versão no package.json a cada build instalado ou enviado à Play.**

**Regra do bump:** só o PATCH sobe, de 1 em 1, até 99 (1.0.3 → 1.0.4 → … → 1.0.99). Depois de 1.0.99 vem **1.1.0**, e assim por diante (1.1.99 → 1.2.0). Isso também mantém o `versionCode` crescente, porque o PATCH nunca passa de 99.

## Environments

- `src/environments/environment.ts` e `environment.prod.ts` estão no `.gitignore`. Para criá-los, copie dos `.example`. O único valor é `admobBannerAndroid` (vazio = ID de teste do Google).

## Publicidade (AdMob)

- Fluxo igual ao do kira e do planevento: consentimento UMP (GDPR/LGPD) → `AdMob.initialize()` (no `AppComponent`) → banner 320×50 ancorado embaixo, a partir da home e nunca na abertura. O banner é nativo e fica por cima da WebView. O evento `SizeChanged` grava `--altura-anuncio`, e `ion-app` ganha esse `margin-bottom` (`global.scss`).
- O botão "Privacidade dos anúncios" (escudo no topo da home) só aparece quando o UMP exige.
- IDs: fora do build de produção, ou com `admobBannerAndroid` vazio no `environment.prod.ts`, o app usa o **ID de teste do Google**. O App ID real vai em `android/gradle.properties` (`admobAppId=`). Sem ele, o manifest recebe o App ID de teste.

## Ícone

- Fonte: `src/assets/icon/favicon.svg` (pino de mapa verde-azulado com "P" sobre fundo #0d1b2a) e `favicon-foreground.svg` (camada da frente do ícone adaptativo).
- `npm run generate:icons` gera os mipmaps, o ícone adaptativo, as imagens de splash nativas e o ícone da Play Store (`store/icone_playstore_512.png`). Depois rode `npx cap sync android`.
- O logo HSI não é o ícone do app. Ele aparece só no rodapé (`src/assets/logo_hsi.png`). Desde 2026-11-15 é o logo novo da HSI, só a esfera (sem o texto "HSI", ilegível nesse tamanho), exportado em 128 px de `hsi-site/public/logo-hsi-mark.svg` (pasta irmã; ver `hsi-site/scripts/gerar_logo.py`).

## Comandos

```bash
export PATH=/c/nvm/v22.23.2:$PATH
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"

npm install
npm start                                  # navegador (o GPS do navegador funciona; bússola não)
npm run lint
npm run build:android                      # ng build (produção) + cap sync android
cd android && ./gradlew assembleDebug      # APK de debug
cd android && ./gradlew bundleRelease      # AAB para a Play (exige key.properties)
```

O celular de testes é um Xiaomi. Ele pede confirmação na tela a cada `adb install`.

## Limitações conhecidas

- **Garagem coberta/subsolo**: o GPS perde precisão ou some. Por isso o app pede para anotar piso e vaga, e avisa quando a marcação saiu com mais de 30 m de incerteza.
- A bússola de celular sofre interferência perto de carros e estruturas metálicas. A instrução de texto e a distância continuam valendo.
- A tela pode apagar durante o guia (não há keep-awake). Se fizer falta, avaliar `@capacitor-community/keep-awake` só na tela de guia.

## Play Store (pendências)

- **Upload key**: gerar um `.jks` com `keytool` e criar `android/key.properties` com `storeFile` (relativo a `android/`), `storePassword`, `keyAlias` e `keyPassword`. Os dois estão no `.gitignore`; **nunca commitar**. Guarde backup fora do repo.
- Conta da Play de **organização** em nome da HSI (LEONARDO VINICIUS NEVES LTDA), a mesma do kira, do planevento e do marcador-jogos.
- Antes do primeiro envio:
  - criar o app no AdMob e preencher `admobAppId` e `admobBannerAndroid`;
  - marcar "Contém anúncios";
  - preencher o Data safety: **localização precisa**, usada só no aparelho e só com o app aberto (a vaga não sai do celular; o mapa baixa tiles de ~2,2 km do OpenFreeMap, o que revela só a região aproximada), e ID de publicidade (AdMob);
  - ter uma política de privacidade que cite localização e AdMob;
  - **sem localização em segundo plano**: o app só pede `ACCESS_FINE_LOCATION`/`COARSE`, então não precisa da declaração de background location.
- Backup: a vaga fica no SharedPreferences, coberto pelo backup automático do Android (`allowBackup="true"`).

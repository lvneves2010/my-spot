# My Spot

Nunca mais esqueça onde estacionou. Ao parar o carro, toque em **Marcar minha vaga** e o app guarda o lugar com o GPS. Na volta, toque em **Me leve até o carro**: uma seta aponta para o carro e mostra quantos metros faltam. Também dá para anotar o piso e a vaga e abrir a rota a pé no Google Maps.

Funciona sem conta e sem servidor; a vaga fica guardada só no próprio aparelho.

Um app da **Help Soluções em Informática (HSI)**, feito com Ionic + Angular + Capacitor.

## Rodando

Requer Node 22+ e, para Android, JDK 21 e o Android SDK.

```bash
npm install
npm start                               # navegador
npm run build:android                   # build + sincroniza o projeto Android
cd android && ./gradlew assembleDebug   # APK de debug
```

Detalhes de arquitetura, anúncios e publicação: [CLAUDE.md](CLAUDE.md).

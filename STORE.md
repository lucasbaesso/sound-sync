# Store submission (Chrome Web Store / Microsoft Edge Add-ons)

Build the upload: `npm run fetch-models` (first time), then `npm run package` → `release/sound-sync-<version>.zip`.

## Listing

**Name:** Sound Sync

**Short description (≤132 chars)**
- EN: Check if a music stream's voice, lips and backing are in sync, and get step-by-step OBS fixes.
- PT-BR: Veja se a voz, os lábios e a base de uma live de música estão sincronizados, com o passo a passo para corrigir no OBS.

**Description — English**

Sound Sync checks whether a music stream is in sync, right in your browser's side panel.

- Voice and lips: compares the singer's mouth with the voice and tells you which one is late, and by how much.
- Sync tests with illustrated steps: clap test (mic vs camera), instrument test (instrument vs camera) and backing track test (voice vs backing track, with a click track).
- Clear OBS instructions: which source to delay (Render Delay, Sync Offset) and by how many milliseconds.
- Works with Twitch, YouTube, TikTok, Instagram, Kick, Facebook and any tab playing video, live or recorded.
- Everything runs on your computer: nothing is uploaded. English and Portuguese (Brazil).
- Performance settings: choose whether it may use the graphics card, so it doesn't slow down your stream.

Experimental: an estimate of voice vs backing track over a whole stream (after about 12 songs). For an exact number, use the backing track test.

**Descrição — Português (Brasil)**

O Sound Sync verifica se uma live de música está sincronizada, no painel lateral do navegador.

- Voz e lábios: compara a boca de quem canta com a voz e diz qual está atrasado, e quanto.
- Testes de sincronia com passo a passo ilustrado: teste das palmas (microfone x câmera), teste do instrumento (instrumento x câmera) e teste da base (voz x base, com uma faixa de cliques).
- Instruções claras para o OBS: qual fonte atrasar (Atraso de renderização, Deslocamento de sincronização) e em quantos milissegundos.
- Funciona com Twitch, YouTube, TikTok, Instagram, Kick, Facebook e qualquer aba com vídeo, ao vivo ou gravado.
- Tudo roda no seu computador: nada é enviado. Em português e inglês.
- Opções de desempenho: escolha se pode usar a placa de vídeo, para não pesar na sua live.

Experimental: uma estimativa de voz x base ao longo da live inteira (depois de umas 12 músicas). Para um número exato, use o teste da base.

**Category:** Tools (Chrome) / Productivity (Edge)

**Images:** 128×128 icon (dist/icons/128.png), at least one 1280×800 screenshot of the side panel next to a stream, and a 440×280 promo tile (Chrome).

## Privacy tab

**Single purpose:** check the audio/video synchronization of a stream the user chooses, and explain how to fix it in OBS.

**Permission justifications**
- `sidePanel`: shows the extension's interface in the browser side panel.
- `storage`: saves the user's settings and sync test results on their computer.
- Content script on Twitch, YouTube, TikTok, Instagram, Kick and Facebook (`https://www.twitch.tv/*`, `https://www.youtube.com/*`, `https://www.tiktok.com/*`, `https://www.instagram.com/*`, `https://kick.com/*`, `https://www.facebook.com/*`): reads where the live video player is on the page and whether it is playing, so the analysis looks at the stream and not at chat, comments or the rest of the page. It reads nothing else and changes nothing on the page.

**Remote code:** none. All code, WebAssembly and models are inside the package.

**Data usage:** the extension does not collect or transmit any user data. Tab audio/video (shared by the user through the browser's own picker) is analyzed locally and never stored or sent. Check: "I do not sell or transfer user data…", "…not used for unrelated purposes", "…not used for creditworthiness".

**Privacy policy URL:** host `PRIVACY.md` publicly (for example a GitHub Pages page or a public gist) and paste its link.

## Before each upload

1. Raise `version` in `public/manifest.json`.
2. `npm test` and `npm run e2e`.
3. `npm run package`; upload `release/sound-sync-<version>.zip`.
4. First release: publish as **Unlisted** (Chrome) / hidden, test with a few people, then make it public.

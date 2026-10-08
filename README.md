# Sound Sync

A Chrome extension that checks whether a music stream's **voice**, **instruments** and **video** are in sync, and tells the streamer exactly what to change in OBS. English and Português (Brasil).

It runs in Chrome's side panel next to the stream (Twitch, YouTube, or any tab playing video). Everything is analyzed on the computer; nothing is uploaded.

## What it measures

| | How | Precision |
|---|---|---|
| **Clap test** (mic vs camera) | Finds each clap in the picture (hands stop) and in the sound, and pairs them | about one frame; checked end to end within ±5 ms |
| **Instrument test** (instrument input vs camera) | Same, with a hard hit on the strings while the mic is muted | same |
| **Backing track test** (voice vs backing track) | A downloadable click track is played through the backing-track player; after two beeps an ear cup is held against the mic, so every click reaches the stream twice. The gap between the copies is exactly how late a voice sung in time with the headphones arrives | ±1 ms end to end |
| **Live: voice and lips** | Tracks mouth opening (MediaPipe face landmarks) and lines it up with the singing; with AI voice separation on, uses note starts of the separated voice | estimate; needs a visible face singing and ~15 face readings/s |
| **Voice and backing track (experimental)** | Needs AI voice separation. Every 10 s the worker rebuilds the separated voice, finds the beat grid from the music only and pitched vocal entries from the voice only, and scores each candidate delay over the last 30 s. Songs (told apart by tempo) are combined over the stream (`src/core/backingSession.ts`) | per 30 s window: unreliable (~coin flip); after ~12 songs it answered 56% of the time and was within ±60 ms 90% of those times (median error ~20 ms), on 25 held-out songs with the bundled Spleeter model (97% with the larger MDX-Net model, which couldn't be shipped) |
| **Live: instruments and hands** | Lines up movement of the playing hand with instrument attacks | estimate; needs a visible strumming hand |
| **Voice and instruments** | Difference of the two above | estimate |

Live cards show the value from the last few analysis windows when they agree ("now"), the average with its confidence, and a dot per recent window so you can see whether they agree. *Analysis* picks the timing: Fast (8 s windows every 2 s), Normal (10 s every 2.5 s, last 30 s) or Steady (last minute); *Start over* forgets earlier results, which also happens when a VOD jumps.

Offsets are always *sound time minus picture time*: positive means the sound is late. Results say this in plain words ("The voice is heard 140 ms after the lips move") and mark which side is early and which is late.

The fix follows from one rule: OBS can only add delay, so every source is delayed to match the latest one. The camera gets a **Render Delay** filter; audio sources get a **Sync Offset** (Advanced Audio Properties). Test results take priority over live estimates.

## Install (development build)

```bash
npm install
npm run fetch-models   # downloads the face model (3.7 MB) and the Spleeter voice/accompaniment models (2 × 20 MB) into models/
npm run build          # builds the extension into dist/
```

Then in Chrome: `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `dist/`. Pin the extension and click its icon to open the side panel.

Requires Chrome 116 or newer (or Edge). The store package is about 50 MB.

### AI voice separation and performance

Voice separation uses Spleeter 2-stems (Deezer, MIT license; ONNX fp16 export by sherpa-onnx), bundled with the extension. It is light: about 3% of real time on the processor (WebAssembly, measured in Chromium). Help → *Performance*: **Use the graphics card (GPU)** (face tracking and separation; turn it off if OBS or a game stutters) and **AI voice separation** on/off.

Models tried and dropped: MDX-Net Kim_Vocal_2 (no clear license for redistributing the weights) and HT-Demucs (MIT, but its ONNX export needs ~4.6 GB of working memory per 7.8 s chunk, over WebAssembly's 4 GB limit).

## Publishing

`npm run package` builds the production version (no developer tools, no source maps) and writes `release/sound-sync-<version>.zip`. Listing texts, permission justifications and the steps are in [STORE.md](STORE.md); the privacy policy is [PRIVACY.md](PRIVACY.md) (host it publicly and link it in the store). `npm run build:dev` builds the developer version with the recording tools and the `window.soundSync` hook used by `scripts/record.mjs`.

## Use

1. Open the stream (live or VOD) in a tab, at normal speed.
2. In the side panel, click **Choose the stream tab**, pick that tab, and keep **Also share tab audio** on.
3. **Monitor** shows live estimates. **Sync tests** walks through the clap, instrument and backing track tests, with illustrations.
4. To check a recording (for example from OBS), drag the video file into a new Chrome tab, play it, and choose that tab.

## Develop

```bash
npm run watch       # rebuild on change
npm run typecheck
npm test            # unit tests: signal processing, matching, fixes, translations
npm run e2e         # real Chromium: screenshots of every screen in both languages,
                    # plus synthetic streams with known delays through the real pipeline

# Developer tools
node scripts/record.mjs <url> <seconds> <out.json>   # play a stream/VOD/file with the extension, save its signals
node tests/e2e/separationCheck.mjs <audio.f32> <out.json> [wasm|webgpu]   # run the vocal model in Chromium
node scripts/face-track.mjs <video.webm> <out.json>   # mouth opening on every frame, exact media times
```

The full UI flow through Chrome's real tab sharing needs a visible browser (headless Chromium shares tab audio as silence) and test videos with a known delay:

```bash
FFMPEG=/path/to/ffmpeg python3 tests/e2e/make_sync_video.py 0   videos/sync0.webm
FFMPEG=/path/to/ffmpeg python3 tests/e2e/make_sync_video.py 120 videos/sync120.webm
npx esbuild tests/e2e/makeBackingAudio.ts --bundle --platform=node --format=esm --outfile=/tmp/mba.mjs
node /tmp/mba.mjs 150 videos/backing150.wav   # then mux with any picture into videos/backing150.webm
HEADED=1 SYNC_VIDEOS=videos npm run e2e
```

### Layout

- `src/core/`: signal processing with no browser APIs, fully unit tested (audio features, cross-correlation, event detection, verdicts and OBS fix plan).
- `src/capture/`: tab capture, clock alignment, face tracking, and the per-frame pipeline.
- `src/separation/`: the voice-separation worker (STFT, model, features) and its client.
- `src/sidepanel/`: the Preact UI and the session that drives measurements.
- `src/content.ts`: on Twitch, YouTube, TikTok, Instagram, Kick and Facebook, reports where the player's picture is (handling fitted and cropped videos) so analysis ignores chat, comments and the rest of the page. Other sites still work, using the whole tab picture.
- `src/i18n/`: `en.ts` defines every string; `ptBR.ts` must match it (enforced by types and tests).

### What real streams taught us

Measured on a real VOD (singing over a backing track at 20:00, guitar at 46:00):

- A single 15 s window can match lips and voice at a wrong lag by coincidence, because music repeats. Live results therefore average the last minute of windows and base confidence on how many windows agree (`CurveTracker`). On the real clip, the true pairing gave 80–100% agreement at +270 ms; audio from other moments of the same song never passed 56%. A regression test (`tests/realStream.test.ts`) runs on this data when `.temp/fixtures/` has it (kept out of the repository).
- Lips results need ~15 face readings per second; at 6 they fall apart. The panel warns when face tracking is too slow.
- Stream timing can change during a stream: the same VOD measured +270 ms at 20:00 and about −15 ms at 46:00.
- Window length: on the real clips, 10 s windows every 2.5 s gave a first correct result after ~18 s and fewer false results from mismatched audio (4–6%) than 15 s windows every 5 s (30 s, 13%).
- **Voice vs music can't be measured from the mixed stream** with separated stems, so that estimate was removed. Test: separate a clip into voice and music, rebuild it with the voice moved by a known amount, separate again, measure. On the guitar song the result stayed at about +10 ms whether the voice was moved +150 ms or −100 ms: bleed between the separated stems lines up at 0 ms and wins. On the ballad the song's rhythm adds look-alike answers half a beat and a beat away (−239 and −600 ms around a real value near +135 ms). Use the backing track test (click track) for voice vs backing.
- Moving the voice by several amounts (±100 to ±250 ms) and re-separating, to keep only answers that move with the voice, also failed: only one of six shifts behaved as expected; the rest stayed in the bleed zone near 0 ms. Subtracting the bleed's predicted shape (each stem's own autocorrelation) left beat-sized look-alikes that didn't move with the voice either.
- A headphone-to-mic leak would make voice vs backing measurable automatically (the stream would carry each backing note twice), but an averaged-cepstrum search found none in either clip.

### Validating voice vs backing

Ground truth comes from MUSDB18 (research multitracks: real vocal and instrument recordings): the vocal is delayed by known amounts, mixed, AAC-coded, separated by the same model, then analyzed. Tuned on 10 songs, tested with frozen settings on 25 others. Within 20–30 s no method tested beat chance (rhythm grid: false alarms 66–70% at 0 ms; harmony against bass notes: 14% within ±60 ms), which is why the card only gives a stream-level verdict. Beat placement was calibrated on clicks (`ONSET_PLACE`), which cut the median error from ~25–40 ms to 15 ms.

### Timing notes

- Audio and video frame timestamps are mapped to arrival time separately; in Chromium their raw stamps were found up to ~110 ms apart.
- Chrome drops audio chunks from a full `MediaStreamTrackProcessor` queue; with face tracking on the same thread this lost ~70% of the audio until the queue was deepened to 10 s. `audioGaps` in the status counts breaks.
- Tab sharing delivers the picture about one frame after the sound. Measured with a video whose sound is exactly in sync, this is 30 ms and is subtracted automatically (`TAB_CAPTURE_BIAS_MS`). The Help tab has a per-computer correction on top of that.

# Browser feasibility of music-analysis models (Chrome/Edge extension, WebGPU/WASM) for near-real-time analysis of a live stream's mono mix

Research date: 2026-10-07. Target: a typical streamer's Windows PC with a discrete GPU, running Chrome or Edge. The input is mono mixed audio. Versions and dates are given where the sources state them. Speed figures come from model cards and READMEs, not from my own benchmarks.

## Q1. Singing voice separation in the browser (Demucs/HTDemucs ONNX, MDX-Net/UVR, Open-Unmix, Spleeter, demucs-web, freemusicdemixer)

### Takeaway
HTDemucs runs in the browser today. Several MIT-licensed ONNX/WebGPU exports exist, about 126–172 MB per 4-stem model. One WebGPU export reports roughly 22x realtime throughput on a mid-range AMD GPU (Radeon RX 7600), and about 8x when paced so the UI stays smooth. WASM-only (CPU) Demucs is far slower, and on long tracks it can fall below realtime. The model works on fixed windows of about 7.8 s (343,980 samples at 44.1 kHz), so live use needs chunking with at least several seconds of latency. It cannot be low-latency. HTDemucs is also a stereo model, so mono input has to be duplicated into both channels.

### Cited Findings
- **monteslu/htdemucs-web-onnx** (Hugging Face): HTDemucs 4-stem model exported for onnxruntime-web on WebGPU. It is mixed precision (fp16, with Conv/ConvTranspose kept in fp32), **126 MB total**; the fp32 reference is 173 MB and about 2.4x slower. The model is split into **21 chained ONNX pieces** (each GPU submission is 10–30 ms) so it can run while the same GPU renders a UI. Reported throughput: **"~22x realtime run back-to-back, ~8x with compositor-friendly pacing"**, tested on a **Radeon RX 7600**. The monolithic graph caused 330 ms UI freezes. Input is a stereo waveform [1,2,343980] at 44.1 kHz plus a spectrogram [1,4,2048,336]. Per-stem correlation with the fp32 output is ≥0.9998. **MIT license.** — [HF model card](https://huggingface.co/monteslu/htdemucs-web-onnx)
- **monteslu/htdemucs-ft-webgpu**: the fine-tuned htdemucs_ft variant, which uses four specialist models (one per stem) at **~84 MB each, fp16**. STFT/iSTFT are taken out of the graph, and normalization falls back to CPU. For vocals-only use you would need only the vocals model, about 84 MB. The card gives no speed numbers. MIT. — [HF model card](https://huggingface.co/monteslu/htdemucs-ft-webgpu)
- **demucs-web** (timcsy, npm `demucs-web`): HTDemucs in the browser via ONNX Runtime Web with a WebGPU/WASM fallback. The ONNX model is **~172 MB**, input is 44.1 kHz stereo, FFT 4096 / hop 1024 / segment 343,980 samples. It needs SharedArrayBuffer. It offers session options that reduce memory (disabling the CPU memory arena and memory pattern). The README gives no RTF numbers. MIT. — [GitHub timcsy/demucs-web](https://github.com/timcsy/demucs-web)
- Other ports: **demucs-js** (bakkot) is a port of Meta's MIT-licensed Demucs to JS+ONNX, usable via npm — [GitHub](https://github.com/bakkot/demucs-js). **demucs-rs** runs in the browser via WASM+WebGPU and natively via Vulkan/Metal — [GitHub](https://github.com/nikhilunni/demucs-rs). There is also a `demucs-wasm` npm package (v0.1.5) — [jsDelivr README](https://cdn.jsdelivr.net/npm/demucs-wasm@0.1.5/README.md). Exported Demucs ONNX graphs are at [HRSadeghi/demucs-onnx](https://huggingface.co/HRSadeghi/demucs-onnx).
- **free-music-demixer** (sevagh): demucs.cpp, a C++/Eigen3 transliteration compiled to WASM with Emscripten (CPU only). It runs htdemucs (**81 MB**, fp16 weights) and htdemucs_6s (53 MB). Timings: a ~7-minute track took **~41 min single-threaded and ~9 min with 8 workers**. Another track took ~20 min single-threaded and ~5 min with 8 workers. That is slower than realtime on a single thread. The code (WASM/JS) is MIT, but **"the AI model weights and other website assets are proprietary."** The repository was **archived on Apr 26, 2025**. — [GitHub sevagh/free-music-demixer](https://github.com/sevagh/free-music-demixer)
- **UVR / MDX-Net license.** The UVR GUI code is MIT. The README says: "For all third-party application developers who wish to use our models, please honor the MIT license by providing credit to UVR and its developers." Anjok07 and aufr33 trained most of the bundled models (excluding Demucs v3/v4 4-stem). ZFTurbo trained the MDX23C weights. KimberleyJSN helped with the MDX-Net/Demucs training scripts. **The README has no separate, explicit license file for the model weights.** — [GitHub Anjok07/ultimatevocalremovergui](https://github.com/Anjok07/ultimatevocalremovergui). The python-audio-separator project repeats the same "honor the MIT license by providing credit to UVR" guidance — [PyPI audio-separator](https://pypi.org/project/audio-separator/0.1.5); [UVR credits summary](https://github.com/BrykVlasta87/ultimatevocalremovergui).
- MDX-Net models such as Kim_Vocal_2 and UVR-MDX-NET-Voc_FT are listed in the UVR model registries/mappers, but none of the files I found states a separate license — [HF uvr_models.json](https://huggingface.co/NeoPy/Ultimate-Models/blob/main/json/uvr_models.json); [UVR5 model_name_mapper](https://huggingface.co/spaces/YetNak/UVR5/blob/main/models/MDX_Net_Models/model_data/model_name_mapper.json)
- **Spleeter**: Deezer's TensorFlow model has been converted to run in the browser (2019 coverage) — [waxy.org](https://waxy.org/2019/11/fast-and-free-music-separation-with-deezers-machine-learning-library/). **Open-Unmix** is PyTorch from SigSep/INRIA — [JOSS paper](https://joss.theoj.org/papers/10.21105/joss.02154.pdf). A blog post describes a vocal-separation model compiled to ONNX and run with onnxruntime-web WASM+SIMD for browser karaoke — [dev.to](https://dev.to/elavarasan_shankar_d8cfcf/how-i-built-a-prompt-to-music-ai-agent-browser-based-karaoke-separator-with-react-onnx-12j3).

### Inferences
- The HTDemucs window is 343,980 samples, about 7.8 s at 44.1 kHz. A live pipeline therefore buffers at least about 8 s, more if it uses overlap-add, before vocals for a segment are available. With 22x throughput, one window takes roughly 0.35 s of GPU time. Continuous separation is compute-feasible on a mid-range GPU, but it adds about 8–10 s of algorithmic latency. If the goal is "singer timing" against lyrics already known, a delay of a few seconds may be acceptable.
- For a streamer, a GPU that is also encoding video and running a game has less headroom. monteslu's piece-chaining design exists because a monolithic graph freezes the UI. Expect less than the reported 22x in practice.
- On UVR MDX-Net weights (Kim_Vocal_2, Voc_FT): the only licensing signal is UVR's "honor the MIT license by providing credit" request. That suggests distribution with attribution is intended, but there is no formal LICENSE file covering the weights. The training data provenance (commercial music) is also unclear, so legal risk for a commercial extension is not zero. Kim_Vocal_2 was trained by a community member (Kimberley Jensen), not the UVR core team, and I found no statement from her about licensing. Treat it as "probably OK with attribution, unverified." HTDemucs (Meta, MIT code and weights) is the cleaner licensing choice.
- free-music-demixer's own weights are proprietary, so do not reuse its hosted weights. Use Meta's MIT weights through an MIT ONNX export instead.

### Gaps
- I found no published WebGPU vs WASM RTF numbers for MDX-Net (Kim_Vocal_2 / Voc_FT) ONNX in the browser. Those models are distributed as ONNX (≈50–65 MB is commonly cited, but I did not verify that).
- I found no browser benchmarks for Open-Unmix (UMX-L) ONNX, and no current maintained Spleeter TF.js package.
- I found no streaming or causal HTDemucs variant for the browser. Every export uses offline 7.8 s windows.
- The SDR of each separator on vocals was not collected here. Use the original papers (HTDemucs MUSDB18 ≈9 dB SDR overall) from another researcher's notes; it is not verified here.

## Q2. Pitch / f0 tracking (CREPE / ml5, SPICE, pYIN, SwiftF0, RMVPE, FCPE)

### Takeaway
Monophonic f0 trackers are cheap enough to run continuously in a browser. SwiftF0 has about 96k parameters and CREPE-tiny about 487k. But they assume a monophonic or clean source, so on a mixed stream they need vocal separation first. RMVPE is the model designed for vocal pitch directly from polyphonic mixtures. It is much larger (about 90M parameters), and FCPE's license is non-commercial.

### Cited Findings
- **CREPE** (2018): **RPA (50 cents) 99.98% on RWC-synth and 99.40% on MDB-stem-synth**. It beats pYIN/SWIPE by more than 8 pp at a 10-cent tolerance. Capacities run from tiny (**487k parameters**) to full (**22.2M parameters**). Hop is 10 ms, with 360 bins of 20 cents. — [CREPE paper, arXiv 1802.06182](https://arxiv.org/pdf/1802.06182); [marl/crepe](https://github.com/marl/crepe)
- **SwiftF0** (Aug 2025): **95,842 parameters**. Clean audio: RPA 90.07%, RCA 90.13%, harmonic mean 94.07%. At 10 dB SNR: RPA 89.90%, HM 91.80%, more than 12 pp above CREPE. It runs **42x faster than CREPE on CPU** (132.6 ms vs 5508.3 ms for 5 s of audio). Range is 46.875–2093.75 Hz, with a 16 ms hop (256 samples at 16 kHz). **License CC BY 4.0.** It is monophonic only. — [SwiftF0 arXiv 2508.18440](https://arxiv.org/html/2508.18440v1). The authors' demo reportedly runs client-side with WASM and ONNX — [search summary of the SwiftF0 PDF](https://arxiv.org/pdf/2508.18440); a pip package exists, [swift-f0](https://pypi.org/project/swift-f0/).
- **FCPE** (Sept 2025) gives a comparison table on MIR-1K, clean, monophonic singing:
  - FCPE: 10.64M parameters, RPA 96.79%, RTF 0.0062 on an RTX 4090
  - RMVPE: 90.42M parameters, RPA 97.77%, RTF 0.0329
  - CREPE: 22.24M parameters, RPA 97.90%, RTF 0.4775
  - PESTO: 0.13M parameters, RPA 98.47%, RTF 0.0164
  
  **FCPE license: CC BY-NC-SA 4.0 (non-commercial).** — [FCPE arXiv 2509.15140](https://arxiv.org/html/2509.15140v1)
- **RMVPE** (Interspeech 2023) is "A Robust Model for Vocal Pitch Estimation in Polyphonic Music". It extracts vocal pitch directly from mixtures and the authors report it beats baselines on RPA/RCA at all SNR levels. — [arXiv 2306.15412](https://arxiv.org/abs/2306.15412); [ISCA PDF](https://www.isca-archive.org/interspeech_2023/wei23b_interspeech.pdf)
- **SPICE** (self-supervised pitch estimation, Google) — [arXiv 1910.11664](https://arxiv.org/pdf/1910.11664)
- **essentia.js** includes classical f0 estimators: PitchYin, PitchYinFFT, PitchMelodia, **PredominantPitchMelodia** (predominant melody from polyphonic audio), and MultiPitchMelodia. — [essentia.js API docs](https://mtg.github.io/essentia.js/docs/api/Essentia.html)

### Inferences
- If you separate first, SwiftF0 (CC BY 4.0, about 100k parameters) is the most attractive commercial-OK, browser-light f0 tracker. It is reported 42x faster than CREPE and more noise-robust, and it would run on WASM without needing the GPU. PESTO (0.13M parameters) is another very small option. Its license was not checked here.
- To skip separation, RMVPE is the purpose-built model for vocal f0 in mixtures. At about 90M parameters it would likely need WebGPU. essentia.js PredominantPitchMelodia (DSP, no neural network) is a cheap baseline, but it is AGPL (see Q4).
- FCPE is out for a commercial extension because of its NC license.

### Gaps
- I could not get RMVPE's numeric RPA on mixtures: the PDF text was not extractable in this environment.
- I did not confirm RMVPE's license, its ONNX size, or any browser benchmark.
- I did not verify current ml5.js pitchDetection (CREPE TF.js) model size or status, or SPICE TF.js Hub model size or status.
- I found no maintained pure-JS pYIN package.

## Q3. Note transcription (Spotify basic-pitch TS/TF.js)

### Takeaway
Basic Pitch is officially available for the browser as `@spotify/basic-pitch` (TypeScript + TF.js, Apache-2.0). The model is tiny, about 17k parameters. Its accuracy on vocals is moderate: note F-no-offset of 64.3% on the Molina vocal set.

### Cited Findings
- `@spotify/basic-pitch` (basic-pitch-ts) is **Apache-2.0**. It takes a Web Audio AudioBuffer. The API includes `evaluateModel()` (frames/onsets/contours via callbacks), `outputToNotesPoly()`, `addPitchBendsToNoteEvents()` and `noteFramesToTime()`. — [GitHub spotify/basic-pitch-ts](https://github.com/spotify/basic-pitch-ts)
- Paper (ICASSP 2022): **16,782 parameters**. On a 7:45 file, peak memory was 951 MB and runtime 24 s, versus MI-AMT at 3.3 GB and 96 s. Note F-measure without offset:

  | Dataset | Basic Pitch | MI-AMT |
  |---|---|---|
  | MAESTRO | 70.9% | 53.4% |
  | GuitarSet | 81.0% | 69.8% |
  | Slakh | 68.2% | 58.1% |
  | **Molina (vocals)** | **64.3%** | 52.7% |

  Onsets&Frames gets 95.2% on piano. — [arXiv 2203.09893 (ar5iv)](https://ar5iv.labs.arxiv.org/html/2203.09893)

### Inferences
- Basic Pitch is fast enough for continuous use in a worker on WASM or WebGL. For "singer timing" it is best used on separated vocals. On a full mix it transcribes every instrument, which makes it hard to isolate the singer.

### Gaps
- No published browser RTF for basic-pitch-ts, and no current npm version or date captured.
- The paper's vocal results are on isolated vocals (Molina), not on mixes.

## Q4. Beat/downbeat tracking (Beat This! ONNX, BeatNet, madmom, essentia.js) and essentia.js capabilities

### Takeaway
Beat This! (ISMIR 2024, MIT) has a WebGPU ONNX export. It is state of the art (GTZAN beat F1 89.1, downbeat F1 78.3 at ±70 ms) but it is offline: it uses 30 s windows, and WASM is about 12x slower than WebGPU. BeatNet is the main online/causal option, but it has no JS port. essentia.js (AGPL-3.0) provides classic DSP beat, onset, pitch, key and chord algorithms in WASM.

### Cited Findings
- **Beat This! paper** (Foscarin, Schlüter, Widmer; ISMIR 2024). On GTZAN, without DBN: **beat F1 89.1 ± 0.3, downbeat F1 78.3 ± 0.4**. With DBN: 88.1 / 77.4. Prior SOTA (Hung et al.): 88.7 / 75.6. The **small model (~2M parameters)** gets 88.8 / 77.2. The full model is about 20M parameters. Tolerance is **±70 ms**. Input is 30 s chunks of mono audio at 22.05 kHz. It is **offline/non-causal**. Ballroom beat F1 is 97.5; RWC Classical is 77.1. The authors note weaker continuity metrics and failures on underrepresented genres. — [arXiv 2407.21658 HTML](https://arxiv.org/html/2407.21658); [abstract](https://arxiv.org/abs/2407.21658)
- **musetric/beat-this-onnx** (HF): main graph **120.3 MB**, 20.25M parameters. Mel filterbank is 262.7 KB. Input is a log-mel spectrogram (22,050 Hz mono, n_fft 1024, hop 441, 128 mels). Each call takes exactly **513 frames** ([1,513,128], about 10.3 s); the host overlaps windows (chunkSize 513, borderSize 6). **WebGPU is about 12x faster than the WASM EP**, with identical results. Parity against PyTorch on 20 stems: beat F 0.9982, downbeat 0.9962; this is a port-fidelity check, not benchmark accuracy. A 2026-09-12 update fixed WebGPU problems on mobile Adreno GPUs. **MIT**, inherited from the JKU weights. — [HF musetric/beat-this-onnx](https://huggingface.co/musetric/beat-this-onnx)
- Another Beat This! ONNX set (final and small, three seeds each) reports **~80 MB main and ~10 MB small**. It warns that batching all windows of a 5-minute track would allocate about **2.9 GB** of attention tensors, so it runs one window per call. — [HF ashudesai/songbird-models](https://huggingface.co/ashudesai/songbird-models). The two sources disagree on main-model size, 80 MB vs 120.3 MB, which is likely an export or precision difference. A Rust crate `beat-this` (v1.0.0) also exists — [docs.rs](https://docs.rs/crate/beat-this/1.0.0).
- **BeatNet** has four modes: streaming (microphone), real-time, online (causal, faster than realtime) and offline. It reports top results on online beat/downbeat tracking on GTZAN. **CC BY 4.0.** It depends on librosa, madmom and PyAudio, and **has no ONNX or JS port mentioned**. — [GitHub mjhydri/BeatNet](https://github.com/mjhydri/BeatNet)
- **essentia.js** is **AGPL-3.0**, with commercial licensing available from UPF/MTG. It is a WASM build of Essentia C++ plus TF.js models. Its own README says it is "under rapid development" and "some of the algorithms are not yet manually tested on the JavaScript front." — [GitHub MTG/essentia.js](https://github.com/MTG/essentia.js). Algorithms confirmed in the API docs:
  - Beat/tempo: **BeatTrackerMultiFeature, BeatTrackerDegara, RhythmExtractor2013, RhythmExtractor, PercivalBpmEstimator**
  - Onset: **OnsetDetection, NoveltyCurve**
  - Pitch: **PitchYin, PitchYinFFT, PitchMelodia, PredominantPitchMelodia, MultiPitchMelodia**
  - Key/chords: **Key, KeyExtractor, HPCP, ChordsDetection**
  - Other: **Loudness**
  
  `Onsets`, `SuperFluxExtractor`, `TempoCNN` and `LoudnessEBUR128` were not found in the JS API docs. — [essentia.js API docs](https://mtg.github.io/essentia.js/docs/api/Essentia.html)
- The essentia.js paper (TISMIR 2021) benchmarked the library on two browsers, Node.js and four devices including Android and iOS, against native Essentia and Meyda. — [UPF repository record](https://repositori.upf.edu/handle/10230/45451?show=full); [ISMIR 2020 poster](https://program.ismir2020.net/poster_4-18.html)

### Inferences
- For live streams, Beat This! can run on a sliding window, for example re-running the 10.3 s window every 1–2 s on WebGPU. Beats near the right edge of the window will be less reliable, because the model is non-causal and expects future context. The small model (about 10 MB, 2M parameters, only about 0.3 F1 worse) is a good fit for repeated re-inference, and is likely tolerable even on WASM.
- essentia.js under AGPL-3.0 is a real problem for a closed-source distributed extension. You would need to open-source the extension under AGPL or buy a commercial license.

### Gaps
- No numeric essentia.js per-algorithm browser timings were captured. The TISMIR paper has them but was not fetched.
- I found no maintained madmom JS/WASM port.
- I did not get BeatNet's exact online GTZAN F1 numbers.

## Q5. Lyrics / word alignment (Whisper via transformers.js, wav2vec2 forced alignment ONNX)

### Takeaway
Whisper runs in the browser through transformers.js on WebGPU. However, word-level timestamps on the WebGPU path have a long-standing open issue (#820, reported June 2024). Whisper's default word timestamps are also coarse: only about 40% of words fall within 50 ms on speech benchmarks. For singer timing against known lyrics, a CTC forced aligner (wav2vec2 ONNX, INT8) on separated vocals is the more accurate and cheaper option.

### Cited Findings
- transformers.js issue #820, opened 2024-06-24: the v3 Whisper pipeline "does not support retrieving word-level timestamps using WebGPU". A partial fix in a fork was never merged, and the issue was open when fetched. — [GitHub transformers.js #820](https://github.com/huggingface/transformers.js/issues/820). Related: [#551](https://github.com/huggingface/transformers.js/issues/551).
- Remotion's `@remotion/whisper-web` notes that word-level timestamps arrive only after transcription finishes; transformers.js does not stream word-aligned updates. — [Remotion whisper-webgpu docs](https://www.remotion.dev/docs/whisper-webgpu/transcribe)
- Word-timestamp accuracy, measured as F1 within **50 ms** with Whisper medium:

  | Method | TIMIT | LibriSpeech dev-clean | AMI |
  |---|---|---|---|
  | Whisper default | 41.2% | 39.8% | 28.5% |
  | WhisperX | 79.9% | 79.5% | 63.5% |
  | Proposed attention-head filtering + character teacher forcing | 80.7% | 80.6% | 61.9% |
  | MFA forced aligner (TIMIT only) | 91.0% | | |

  — [Whisper Has an Internal Word Aligner, arXiv 2509.09987](https://arxiv.org/html/2509.09987v1)
- Lyrics alignment is usually scored by average absolute error (AAE, seconds) on JamendoLyrics; JamendoLyrics++ extends it. — [mir_eval alignment docs](https://mir-eval.readthedocs.io/latest/api/alignment.html); [arXiv 2306.07744](https://arxiv.org/pdf/2306.07744); [NeurIPS 2024 contrastive lyrics alignment](https://neurips.cc/virtual/2024/105750)
- Browser-ready forced-alignment ONNX:
  - **charsiu-js**: INT8 wav2vec2 frame-classification aligners for English and Mandarin, HuBERT phoneme-CTC for Japanese; works in Node and browser — [HF](https://huggingface.co/mnaoizyyy/charsiu-js-models)
  - **wav2vec2-espeak-ctc**: IPA phoneme CTC in ONNX — [HF](https://huggingface.co/sadda-speech/wav2vec2-espeak-ctc)
  - **singscope-align**: INT8 ONNX built from wav2vec2-large-960h-lv60-self, aimed at singing — [HF](https://huggingface.co/shinjibass/singscope-align)
  - **Fast Aligner**: 60M-parameter Conformer, INT8 ONNX, about 57.9 MB, with a TypeScript helper — [HF](https://huggingface.co/RandomThingsIDo/fast-aligner)
  - The CTC forced-alignment algorithm is documented in a torchaudio tutorial — [PyTorch tutorial](https://docs.pytorch.org/audio/2.0.0/tutorials/forced_alignment_tutorial.html)

### Inferences
- If you need word-level Whisper timings on WebGPU, plan either to patch transformers.js (cross-attention DTW) or to run the timestamp pass on the WASM backend. Do not rely on the stock WebGPU pipeline.
- For known lyrics, CTC alignment avoids ASR errors entirely. INT8 wav2vec2 ONNX models of about 60–300 MB are browser-feasible. Separated vocals improve alignment considerably, but that is an inference: no source here measured it.

### Gaps
- No Whisper word-timestamp error measured on singing (JamendoLyrics) was found in a fetchable source.
- No browser RTF numbers for Whisper (tiny/base/small) on WebGPU vs WASM.
- The licenses of the community aligner ONNX repos (charsiu-js, singscope, fast-aligner) were not checked.

## Q6. Audio fingerprinting in JS (Chromaprint/AcoustID, Panako) and lookup services

### Takeaway
Chromaprint runs in the browser via several WASM/JS packages that produce AcoustID-compatible fingerprints. But AcoustID is designed to match full files, not snippets from the middle of a live stream, and its free API is **non-commercial only**.

### Cited Findings
- JS/WASM ports:
  - `rusty-chromaprint-wasm` (v0.1.5): preset test2, compatible with fpcalc and AcoustID. Takes Int16Array input at e.g. 44.1 kHz, mono or stereo, and outputs a base64 fingerprint — [jsDelivr README](https://cdn.jsdelivr.net/npm/rusty-chromaprint-wasm@0.1.5/README.md)
  - `chromaprint.js`, a pure JS implementation — [npm](https://www.npmjs.com/package/chromaprint.js)
  - `@unimusic/chromaprint`, Chromaprint compiled to WASM — [jsDelivr README](https://cdn.jsdelivr.net/npm/@unimusic/chromaprint@0.1.4/README.md)
  - Example browser tools feed up to 120 s of audio — [rapidtoolset](https://rapidtoolset.com/en/tool/audio-fingerprint-calculator)
- Chromaprint's stated use cases are full-file identification, duplicate detection and **long audio stream monitoring** — [GitHub acoustid/chromaprint](https://github.com/acoustid/chromaprint)
- AcoustID web service terms:
  - Free for **non-commercial use only**; commercial use requires signing up at acoustid.biz
  - **At most 3 requests per second**
  - Requires an application API key
  - Lookups need fingerprint plus **duration of the whole audio file**
  - JSONP is supported
  
  — [acoustid.org/webservice](https://acoustid.org/webservice)

### Inferences
- AcoustID lookup needs the whole-file duration and matches from the start of a track. That fits a live stream's arbitrary mid-song capture poorly. Chromaprint's own stream-monitoring use case usually means server-side matching against known references.
- Extensions can make cross-origin fetches with host permissions, so JSONP is not needed.

### Gaps
- Not researched within the tool budget: Panako JS ports, and commercial snippet-ID APIs (ACRCloud, AudD, Shazam/ShazamKit) and their pricing and terms.

## Q7. Extension platform pitfalls (cross-origin isolation, WebGPU in extension workers, memory, AudioWorklet vs worker)

### Takeaway
Use an **offscreen document** (MV3) or an extension page as the compute host. It can be cross-origin isolated through manifest keys, which enables SharedArrayBuffer and WASM threads, and it has WebGPU. The service worker is a poor host: it is not cross-origin isolated, and it is ephemeral. Large attention models need per-window inference to avoid multi-GB allocations.

### Cited Findings
- Extensions opt into cross-origin isolation with the manifest keys `cross_origin_embedder_policy: {"value":"require-corp"}` and `cross_origin_opener_policy: {"value":"same-origin"}`. That enables SharedArrayBuffer. **"Not all extension contexts will be cross-origin isolated"**: service workers and shared workers are not (not fully implemented), and neither are web-accessible subframes embedded in web pages. — [Chrome docs: Cross-origin isolation](https://developer.chrome.com/docs/extensions/mv3/cross-origin-isolation)
- onnxruntime-web needs COEP require-corp and COOP same-origin for multithreaded WASM. It checks `crossOriginIsolated` to decide on threads. All JS/WASM files must be hosted locally. — [ORT web API summary (mintlify)](https://www.mintlify.com/microsoft/onnxruntime/api/javascript/web)
- WebGPU has been available in **service workers and shared workers since Chrome 124**. — [Chrome blog: New in WebGPU 124](https://developer.chrome.com/blog/new-in-webgpu-124). For extensions, one pattern is an offscreen.html that runs WebGPU and exchanges messages with the background service worker. Chrome also provides a WebGPU-in-extension-service-worker sample and a WebLLM extension example — [same blog](https://developer.chrome.com/blog/new-in-webgpu-124); [beaufortfrancois gist](https://gist.github.com/beaufortfrancois/4795c20bc4d147e0400303d0b8ec02d6); [Medium: transformers.js + ORT WebGPU in Chrome extension](https://medium.com/@GenerationAI/transformers-js-onnx-runtime-webgpu-in-chrome-extension-13b563933ca9)
- `chrome.tabCapture` returns a MediaStream of a tab's audio and must be triggered by a user gesture (the action click). Capturing mutes the tab for the user unless the stream is routed back to an AudioContext destination. — [Chrome tabCapture reference](https://developer.chrome.com/docs/extensions/mv2/reference/tabCapture)
- Memory: Beat This! would need about 2.9 GB if all windows of a 5-minute track were batched, so it runs per window — [HF songbird-models](https://huggingface.co/ashudesai/songbird-models). demucs-web lists ORT session options that reduce memory (CPU memory arena and memory pattern off) — [GitHub timcsy/demucs-web](https://github.com/timcsy/demucs-web). Basic Pitch's Python version used 951 MB peak on a 7:45 file — [ar5iv 2203.09893](https://ar5iv.labs.arxiv.org/html/2203.09893).
- GPU contention: a monolithic HTDemucs WebGPU graph caused 330 ms UI freezes and 12–18 fps. Chaining 21 pieces kept a steady 30 fps — [HF monteslu/htdemucs-web-onnx](https://huggingface.co/monteslu/htdemucs-web-onnx)

### Inferences
- Recommended architecture:
  1. The action click triggers `tabCapture`, and the stream ID goes to an offscreen document (reason USER_MEDIA or AUDIO_PLAYBACK).
  2. A small AudioWorklet in the offscreen document copies 128-sample frames into a SharedArrayBuffer ring buffer. This requires the extension to be cross-origin isolated.
  3. A dedicated Worker spawned from the offscreen document runs the ORT WebGPU or WASM sessions on chunks. Dedicated workers of an isolated document should inherit isolation, but that is an inference I did not verify.
  4. Never run inference inside the AudioWorklet render thread, which has a deadline of about 2.7 ms per quantum at 48 kHz.
- Pick ONNX models whose operators are supported by the ORT WebGPU EP. monteslu's export moved STFT/iSTFT and normalization to the host or CPU for this reason.
- On a streamer PC, OBS NVENC, the game and the browser all compete for the GPU. Pace GPU submissions and prefer small models (Beat This small, SwiftF0, vocals-only HTDemucs_ft).

### Gaps
- No primary source captured that confirms dedicated workers spawned from a cross-origin-isolated offscreen document get `crossOriginIsolated === true` in current Chrome or Edge. This needs a quick test.
- I did not verify Edge-specific differences in WebGPU or offscreen API parity, or exact per-tab or per-extension memory limits (the wasm32 4 GB address space limit is general knowledge, not sourced here).
- ORT-web version numbers and dates as of late 2026 were not captured.

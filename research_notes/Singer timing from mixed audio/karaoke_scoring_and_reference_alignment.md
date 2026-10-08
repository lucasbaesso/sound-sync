# Karaoke scoring, singing assessment, and reference-based alignment for measuring voice-vs-backing latency from a mixed stream

Scope note: our input is one compressed mono stream with the voice and the backing mixed together. The backing may be a karaoke version of a known song, and songs may be slow ballads. The goal is a constant offset of the voice relative to the backing, expected at 50–300 ms. Each section below follows a key question.

## Q1. How do commercial and academic karaoke and singing-assessment systems judge timing? Do they measure in ms, what tolerance do they use, and do they rely on a separate mic signal?

### Takeaway
Every commercial scoring system I found compares a **separately captured mic signal** with a **symbolic reference**: MIDI or a hand-made note track holding pitch, onset and duration, plus lyric timing. None scores from a mixed recording. Tolerances are mainly stated as **pitch** tolerances (semitones). Timing is handled loosely or deliberately *offset-tolerant*: Sony's SingStar patent correlates over ±3 "note clock" periods so that a constant lag is absorbed and not penalised. No commercial ms timing tolerance was found in public sources. Academic "singing quality" work measures rhythm with DTW against a reference singer (MFCC features) or by comparing with other singers, not as ms latency.

### Cited Findings
- **Yamaha patent, US5889224A (1999)**: a karaoke scoring apparatus extracts time data and reference pitch and volume from the karaoke song's **MIDI** messages. It compares the singer's detected pitch and volume with that MIDI reference. — [Google Patents US5889224A](https://patents.google.com/patent/US5889224A)
- **Sony, US8634759 "Timing offset tolerant karaoke game"** (SingStar lineage; filed 2004, granted 2014):
  - The song file "defines the lyrics for display and the pitch and note lengths that the user is expected to sing. It does not define the backing track."
  - Mic audio from a USB microphone goes through pitch detection on its own path.
  - At the start of each song section, the detected note sequence is correlated against the target notes over **±3 note clock periods**. The offset with the highest correlation is applied as a time shift to the user's notes for the rest of that section.
  - Pitch thresholds are about **±2.5 MIDI notes** for scoring and 2 semitones for the correlation test, varying with difficulty.
  - In short, the system deliberately *removes* a constant timing offset rather than measuring or penalising it. — [Google Patents US8634759](https://patents.google.com/patent/US8634759)
- **SingStar** used a hand-made note track for every song ("every note, every syllable, all mapped manually"). Pitch matching ignores the octave, and the mic input is separate from the backing. **UltraStar** (open source) uses text note files ("NoteType StartBeat Duration Pitch Syllable") with a **1-semitone** tolerance, modulo octave. — [akitaonrails.com, "Turning YouTube into a Karaoke App" (2026, secondary/blog)](https://akitaonrails.com/en/2026/04/05/turning-youtube-into-a-karaoke-app-frank-karaoke/)
- **Japanese DAM/Joysound** score three things: pitch accuracy (音感), rhythm/timing (リズム感) and expressiveness/volume (表現力). All are based on operator-supplied MIDI data. The source gives no ms tolerances. — [akitaonrails.com (secondary)](https://akitaonrails.com/en/2026/04/05/turning-youtube-into-a-karaoke-app-frank-karaoke/)
- **The same hobby project (Frank Karaoke, 2026) works with the mic picking up speaker bleed.** It isolates the voice with a 200–3500 Hz band-pass and an RMS gate requiring ≥1.3× the baseline. Pitch comes from YIN, discarding frames with confidence <0.3. Video position is polled every ~250 ms. This is a crude bleed-rejection heuristic, not real separation. — [akitaonrails.com](https://akitaonrails.com/en/2026/04/05/turning-youtube-into-a-karaoke-app-frank-karaoke/)
- **A second hobby scorer** reports that "a timing offset of just 0.2 seconds at the start was enough to tank the score". The author proposes DTW plus onset detection to "absorb timing offsets". — [lilting.ch "karaoke scoring revenge"](https://lilting.ch/en/articles/karaoke-scoring-revenge)
- **C-Media patent US11017754B2 (priority 2019)**, streaming-media karaoke scoring:
  - Input is the mic signal. The reference is a digital score with pitch and timing.
  - It tracks Δt₁ (player start vs recording start) and Δt₂ (streaming playback delay or advance, measured every **0.1 s** by default). Expected note times are shifted to Tₖ − Δt₁ + Δt₂.
  - Coarse limits: 5 s before restart and a ±3 s drift threshold.
  - It does **not** separate vocals from accompaniment. — [Google Patents US11017754](https://patents.google.com/patent/US11017754)
- **Academic work by Gupta, Li & Wang (NUS)**:
  - "Automatic leaderboard: evaluation of singing quality without a standard reference" (IEEE/ACM TASLP, 2020) ranks singers without a reference. It combines absolute measures (pitch histogram) with relative measures (inter-singer similarity in pitch, rhythm and timbre). Spearman correlation with human judgments is **0.71** (10-fold CV). — [IEEE SPS summary](https://signalprocessingsociety.org/publications-resources/ieee-transactions-audio-speech-and-language-processing/2020/02/automatic-leaderboard-evaluation-singing-quality-without-standard-reference)
  - Their earlier "Perceptual evaluation of singing quality" (APSIPA 2017) uses as a rhythm measure the RMS error of a linear fit to the DTW path, computed on MFCC vectors between the test and reference singer. It notes that karaoke rhythm "is determined by the pace of the background music and the lyrics cue on the screen". — [NUS PDF 2017](https://smcnus.comp.nus.edu.sg/archive/pdf/2017-2018/2017_Perceptual_Evaluation_of_Singing_Quality.pdf) (via search snippet)
- **DTW alignment between two singers often fails** when either voice has vibrato or pitch bends. This motivated canonical time warping for singing voice correction (Yong & Nam, ICASSP 2018). — [arXiv 1711.08600](https://arxiv.org/pdf/1711.08600) (via search snippet)
- **Onset detection on solo singing is hard.** One cited system finds about **85% of onsets within 50 ms** of ground truth. — search snippet referencing [ISMIR 2012 paper 511](https://ismir2012.ismir.net/event/papers/511_ISMIR_2012.pdf) (not opened; treat as unverified)

### Inferences
- Commercial scoring sidesteps our problem. It has a clean mic channel, it has symbolic reference timing, and it removes constant lag on purpose (SingStar's per-section ±3-clock correlation). We can borrow the *method*: correlate the detected singer events against the reference event times over a lag window and pick the argmax, which is in effect a constant-latency estimator. We cannot borrow the *signal setup*.
- No system found works from a mix alone. Our approach needs a separation step, or a reference subtraction or alignment step, before any scoring-style logic applies.

### Gaps
- I found no published ms rhythm tolerances for DAM, Joysound, SingStar, Smule or StarMaker. Yousician and StarMaker scoring internals were not found in public technical sources.
- I could not verify Yamaha's "3 tolerance bands" in ms terms; only a secondary blog mentions them.

## Q2. Can audio fingerprinting identify a song from a live mix of someone singing over a karaoke or instrumental version, and how robust is it to the added live vocal?

### Takeaway
Landmark fingerprinting (Shazam-style, which Dejavu and Panako also follow) holds up well against strong interfering sound, including voices and other music. It also returns the **time offset** of the query within the reference. The catch is that it is **version-specific**. The fingerprint database must contain the *exact* karaoke or instrumental recording used as the backing. A re-recorded karaoke version will not match the original studio master. Chromaprint/AcoustID is designed for whole-file identification and is a poor fit for short live excerpts.

### Cited Findings
- **Wang (Shazam), "An Industrial-Strength Audio Search Algorithm", ISMIR 2003**:
  - It identifies music "in the presence of voices, traffic noise, dropout, and even other music". From a heavily corrupted 15 s sample, a significant match needs only **~1–2% of hash tokens** surviving.
  - "Transparency": it can "correctly identify each of several tracks mixed together, including multiple versions of the same piece."
  - Pub noise test (10,000-track database, 8 kHz mono): **50% recognition at about −9, −6 and −3 dB SNR** for 15, 10 and 5 s excerpts. With added GSM 6.10 compression, 50% recognition is at about −3, 0 and +4 dB.
  - The match is a cluster in a histogram of δt = t_db − t_sample, which yields the **time offset** of the sample in the reference track.
  - It is "very sensitive to which particular version of a track has been sampled… can pick the correct one even if they are virtually indistinguishable by the human ear". It is "not expected to generalize to live recordings".
  - — [Wang 2003 PDF (Columbia mirror)](https://www.ee.columbia.edu/~dpwe/papers/Wang03-shazam.pdf)
- **Fingerprinting usually treats cover versions as different songs.** Cover-song identification needs other representations. Modified peak fingerprints can identify different versions and performances if the query is **≥15 s** long (Grosche & Müller, ICASSP 2012). — [US10803119B2](https://patents.google.com/patent/US10803119); [Grosche & Müller 2012 PDF](https://www.audiolabs-erlangen.com/content/05_fau/professor/00_mueller/03_publications/2012_GroscheMueller_Fingerprinting_ICASSP.pdf) (via snippet)
- **Panako (Six & Leman, ISMIR 2014)** is open source. A query returns the **start time in the reference audio** plus any pitch shift or time stretch, and handles time-scale and pitch changes of up to **~10%**. It was tested on 30,000+ songs and is robust to GSM compression, several effects and band-pass filtering. — [Panako paper (author version)](https://0110.be/publications/Panako_%E2%80%93_A_Scalable_Acoustic_Fingerprinting_System_Handling_Time-Scale_and_Pitch_Modification); [GitHub JorenSix/Panako](https://github.com/JorenSix/Panako)
- **Chromaprint/AcoustID** summarises roughly the first two minutes of a file as 12 chroma bands at about 8 frames per second. AcoustID "can identify entire songs but not short snippets". — [Wikipedia: AcoustID](https://en.wikipedia.org/wiki/AcoustID); [Essentia Chromaprint tutorial](https://essentia.upf.edu/tutorial_fingerprinting_chromaprint.html)

### Inferences
- A live singer over a backing is, from the fingerprinter's view, additive interference. Vocal-to-backing ratio in a karaoke mix is typically about 0 to +6 dB (my assumption), so the backing's "SNR" is roughly 0 to −6 dB. Wang's curves say this is well within the working range for 10–15 s excerpts, especially since streaming codecs at normal bitrates are much milder than GSM 6.10.
- **Version problem.** If the backing is a *re-recorded* karaoke version (Sing King, KaraFun and similar often re-record), fingerprinting against the original studio track will likely fail. The reference library needs the karaoke version itself. An official instrumental from the same multitrack session may share many spectral peaks with the original master in vocal-free regions; that is a hypothesis.
- The fingerprint time offset (δt) is a **coarse** alignment of stream time to reference time, with resolution of about one fingerprint frame (tens of ms, depending on implementation). It is good for initialising a finer alignment (Q3), not for measuring 50–300 ms latency by itself.
- **Key subtlety.** Fingerprinting the mix locates the **backing** (the recording in the database). It does not by itself say where the **singer** is. Latency must come from comparing singer event times with the backing's reference timeline (Q4/Q5).

### Gaps
- I found no published experiment on fingerprinting a karaoke instrumental with a live amateur vocal on top, and no study of whether Shazam or ACRCloud match karaoke tracks to originals.
- Exact frame hop and offset resolution for Dejavu and Panako were not verified.

## Q3. How precise is audio-to-audio alignment (accompaniment to reference) in ms, and can it detect a constant offset of the backing in the stream?

### Takeaway
DTW-based music synchronization with chroma plus onset features (DLNCO or spectral flux; Sync Toolbox, MATCH) reaches typical errors of **tens of ms** (MATCH: mean 41 ms, median 20 ms on piano). It degrades when the singing voice dominates the signal. When the backing in the stream is the *identical* recording as the reference, a much simpler and more precise tool applies: cross-correlation (GCC-PHAT) of the stream against the reference instrumental, or against a separated accompaniment stem. That gives sample-level offsets, but it is fragile to any tempo or mix mismatch.

### Cited Findings
- **MATCH (Dixon & Widmer, ISMIR 2005)**, online and offline DTW: average alignment error **41 ms (median 20 ms)**, with only 2 of 683 test cases failing (Classical/Romantic piano). In a later comparison on Mazurka data, MATCH placed **79.5%** of events within 100 ms. — [MATCH page](https://www.eecs.qmul.ac.uk/~simond/match/); [arXiv 2206.00454](https://arxiv.org/pdf/2206.00454) (via search snippet)
- **Ewert, Müller & Grosche (ICASSP 2009)** introduced DLNCO (decaying locally adaptive normalized chroma onset) features. They combine onset-level time accuracy with chroma robustness and give a significant accuracy gain, especially for piano, "while not collapsing for music that does not contain clear note attacks". — [Ewert et al. 2009 PDF](https://www.audiolabs-erlangen.com/content/resources/MIR/SyncRWC60/2009_EwertMuellerGrosche_HighResAudioSync_ICASSP.pdf)
- **Sync Toolbox (Müller et al., JOSS 2021)** is an open-source Python package: memory-restricted multiscale DTW with DLNCO on the finest layer. — [JOSS paper](https://joss.theoj.org/papers/10.21105/joss.03434.pdf); [GitHub synctoolbox](https://github.com/meinardmueller/synctoolbox)
- **Özer, Krause & Müller (ISMIR 2021 LBD)** used the Sync Toolbox on the Schubert Winterreise Dataset (voice plus piano):
  - Chroma plus spectral flux matches chroma plus DLNCO accuracy, and both beat chroma alone.
  - Synchronization "of the recordings, in which the singing voice is dominant, e.g., song No. 6, No. 14, and No. 23, are worse".
  - Repetitive accompaniment (song 17) hurts chroma-only alignment.
  - Misalignment rate is reported for thresholds from 30 ms to 1 s; numeric values are only in a figure. — [ISMIR 2021 LBD PDF](https://archives.ismir.net/ismir2021/latebreaking/000025.pdf)
- **"Live Vocal Extraction from K-pop Performances" (arXiv 2508.20273, Aug 2025)**:
  - HT Demucs separates both the live performance and the studio recording.
  - **GCC-PHAT on the two instrumental stems** estimates the delay over a search range of **±20 s**.
  - A least-squares gain match follows, then frame-wise GCC-PHAT refinement limited to **±0.25 s**, then the aligned studio vocal is subtracted.
  - There are no quantitative metrics, only informal listening tests by the authors.
  - Failure modes: "even the slightest tempo mismatch would nullify the effectiveness", and crowd noise and reverb leave "chorus effect" residues. — [arXiv 2508.20273](https://arxiv.org/html/2508.20273v1)

### Inferences
- **Two regimes.**
  - (i) The stream's backing is the identical recording to the reference, as with a known karaoke file. Then the backing–reference relation is a pure delay plus possibly gain, EQ and codec effects. Cross-correlation (GCC-PHAT) of the reference against the stream, or against a Demucs accompaniment stem of the stream, should give the backing's offset to about one sample or one frame. Precision is far better than DTW's tens of ms.
  - (ii) Different versions, or tempo drift such as a re-encoded file with slight resampling. Then DTW (Sync Toolbox) is needed, with typical errors around 20–50 ms on clean music and worse with dominant vocals.
- A *constant* backing offset is easy to detect in regime (i): the GCC-PHAT peak is stable across windows. In regime (ii), averaging the DTW path offset over many frames reduces random error, but the vocal-dominance bias reported by Özer et al. remains.
- Since our stream contains the live vocal, computing correlation against the reference instrumental directly treats the vocal as noise. A long window (≥10 s) should still give a clear peak, because the live vocal is uncorrelated with the instrumental. This is an inference to verify experimentally.

### Gaps
- I could not extract Ewert 2009's numeric ms results from the PDF (text extraction failed beyond page 1).
- No paper was found that quantifies GCC-PHAT offset accuracy of "mix vs identical instrumental" with a live vocal on top.

## Q4. How precise is lyrics-to-audio or singing-to-reference alignment (word or phoneme onset error), and is it precise enough to estimate a 50–300 ms constant latency after averaging?

### Takeaway
On polyphonic mixes, state-of-the-art lyrics-to-audio alignment reaches **mean** absolute word-onset errors of about **0.10–0.22 s** and **median** errors of about **0.04–0.10 s**, with 90%+ of words within 0.3 s. The mean is inflated by occasional gross errors, so a median or trimmed estimator over many words should land well below 100 ms of random error. Systematic biases in the aligner (onset definition, annotation convention) and the singer's own expressive timing are the limiting factors. Distinguishing 50 ms from 100 ms is borderline; distinguishing 100 ms from 300 ms looks feasible.

### Cited Findings
- **MIREX 2019 lyrics-to-audio alignment**, mean AAE / median AE:

  | System | Hansen (mix) | Hansen (a cappella) | Mauch (mix) | Jamendo (mix) |
  |---|---|---|---|---|
  | GYL1 (Gupta, Li, Yilmaz, NUS; = NUSAutoLyrixAlign) | **0.10 s / 0.04 s** | 0.13 s / 0.03 s | 0.19 s / 0.10 s | 0.22 s / 0.05 s |
  | Stoller–Durand–Ewert end-to-end (SDE2) | 0.39 s / 0.09 s | — | 0.26 s / 0.11 s | 0.38 s / 0.10 s |

  — [MIREX 2019 results](https://music-ir.org/mirex/wiki/2019:Automatic_Lyrics-to-Audio_Alignment_Results)
- **NUSAutoLyrixAlign "outperformed all other systems in MIREX 2019"**, with mean absolute word alignment error <200 ms on all test sets. — search snippet citing [arXiv 1906.10369](https://arxiv.org/pdf/1906.10369)
- **MIREX 2020**, mean AAE / median AE / % correct onsets:

  | System | Hansen | Mauch | Jamendo |
  |---|---|---|---|
  | GGL2 (NUS) | 0.10 s / 0.04 s / 97% | 0.19 s / 0.10 s / 91% | 0.22 s / 0.05 s / 94% |
  | GGL1 | — | — | 0.33 s / 0.04 s / 94% |
  | DDA1 | 0.17 s / 0.05 s / 93% | — | 0.50 s / 0.09 s / 84% |

  — [MIREX 2020 results](https://music-ir.org/mirex/wiki/2020:Automatic_Lyrics-to-Audio_Alignment_Results)
- **Standard metrics** are Average Absolute Error (AAE) and the percentage of correct onsets within a **0.3 s** tolerance. Some work also reports the percentage of word starts within 250 ms. — [mir_eval alignment docs](https://mir-eval.readthedocs.io/latest/api/alignment.html); [arXiv 2202.01646](https://arxiv.org/pdf/2202.01646) (via snippet)
- **Durand et al., "Contrastive learning-based audio to lyrics alignment for multiple languages" (ICASSP 2023)**: the first system with mean AE **<0.2 s** on Jamendo. The previous state of the art cited (GC1) was mean AE 0.22 s, median 0.05 s, PCS 0.94. — [arXiv 2306.07744](https://arxiv.org/html/2306.07744v1)
- **Whisper on singing**: naive Whisper-large on full mixes reaches about **28–36% WER** on Jam-ALT. It tends to omit lyrics or hallucinate, especially on separated vocals. This concerns transcription; no word-timing accuracy figures for Whisper on singing were found. — [lyrics-bench research brief](https://lyrics-bench.onrender.com/papers/research_brief.html) (secondary)
- **Real-time lyrics alignment for classical vocal performance** with chroma plus phonetic features (2024) exists, but I did not extract numbers. — [arXiv 2401.09200](https://arxiv.org/pdf/2401.09200)

### Inferences
- **How to turn alignment into a latency estimate.** (a) Align the known lyrics to the live mix to get the singer's word onsets in stream time. (b) Get the *expected* word times on the backing's timeline, from the original studio vocal aligned the same way, or from karaoke LRC/CDG timing. (c) Map the backing's timeline to stream time (Q2/Q3). (d) Latency = median over words of (singer onset − expected onset).
- **Error budget.** Median aligner error is about 40–100 ms, and amateur singers show human timing scatter of perhaps ±50–150 ms, more in ballads with rubato. That is my assumption, not sourced. Over N≈100 words, the standard error of a median shrinks to roughly 10–20 ms. The **bias** terms do not average out:
  - the aligner tends to fire at the vowel versus the consonant onset;
  - the singer's habitual lead or lag (expressive phrasing);
  - the karaoke lyric file's own timing convention (lyric cues often lead the vocal).
- Using the **same aligner** on the reference vocal and the live mix cancels the aligner's onset-definition bias to first order. This favours "singing-to-reference-vocal" over "singing-to-lyric-file".
- Slow ballads make this harder: long held notes give fewer word onsets per minute, and soft legato onsets give larger onset uncertainty.

### Gaps
- I found no study of lyrics-alignment accuracy on *amateur karaoke singing over a backing* (MIREX sets are professional studio mixes). The DAMP / Smule datasets could support such tests, but no ms results were found.
- I found no quantitative data on systematic bias (signed mean error) of lyrics aligners; MIREX reports only absolute errors.
- Whisper or WhisperX word-timestamp accuracy on singing was not found.

## Q5. Is there work on latency estimation in karaoke apps or networked music (Smule calibration, auto-sync in Smule, BandLab, Soundtrap), and how do they estimate the user's vocal latency?

### Takeaway
Smule's patents describe two latency estimators.
- **(1) Active calibration**: a speaker-to-mic pulse train, correlated peaks, repeated and averaged.
- **(2) Passive, crowd-sourced estimation** from real performances: the offset that best aligns detected **vocal syllable peaks** with detected **backing-track beats** is found by statistical scoring over **~300+ performances per device model**, because a single performance gives too imprecise a correspondence.

Point (2) is the closest published analogue to our task, and Smule itself treats a single performance as noisy. BandLab uses a click-based round-trip latency test.

### Cited Findings
- **Smule US9412390B1** (priority 2010, published 2016):
  - A 4 Hz pulse train lasting 5 s plays through the device speaker and is recorded by its mic. Correlated peaks are found at the expected period.
  - Latency comes from the time of the first correlated peak minus whole pulse periods, until the value is ≤ 2 pulse periods.
  - The test runs 5 times, outliers are discarded, and the rest are averaged.
  - The resulting round-trip latency (output plus input) is applied as **preroll** to shift captured vocals into alignment with the backing.
  - Perceptual threshold: "If this time difference is large enough (e.g., over 20 milliseconds), the user's performance will perceptibly lag." — [Google Patents US9412390](https://patents.google.com/patent/US9412390)
- **Smule US11146901B2 "Crowd-sourced device latency estimation for synchronization of recordings in vocal capture applications"** (priority 2013):
  - It also analyses real vocal performances against known backing tracks, "determining temporal positions in the song where syllables computationally identified in … the captured vocal performance match beats computationally identified in the backing track."
  - It measures "the time between the peak of an identified syllable in the vocal track and the identified beat in the backing track" at candidate offsets.
  - "given the somewhat lesser precision of correspondence, in any given sample, between audio features of the backing track and those of captured vocals, statistical scoring may be employed."
  - Samples from "typically 300+" like devices characterise latency for 3,000+ or 30,000+ devices.
  - No accuracy figures are given. — [Google Patents US11146901](https://patents.google.com/patent/US11146901)
- **Smule also patents latency-tolerant synchronisation** of performances captured on geographically separated devices (duets, wide-area broadcast). — [Justia: Smule patents](https://patents.justia.com/assignee/smule-inc); [US 11032602 latency management](https://patents.justia.com/patent/11032602)
- **BandLab** has a latency test that listens for loud clicks to measure round-trip latency. Users report results of around **100–200 ms** (Android/web). — [BandLab Studio FAQ](https://blog.bandlab.com/studio-faq/) (via search snippet; the 100–200 ms figure may come from a forum or user report)
- **The C-Media streaming karaoke patent** compensates measured playback delay in 0.1 s steps (see Q1). — [US11017754](https://patents.google.com/patent/US11017754)

### Inferences
- Smule's crowd-sourced method is essentially our problem: estimate a constant offset from vocal onsets versus backing beats. They needed **hundreds of performances** to get a reliable per-device estimate, which implies single-performance estimates were too noisy for their needs (they wanted roughly 20 ms precision). With one song of 3–4 minutes, we should expect a usable but coarse estimate, perhaps ±30–50 ms rather than ±10 ms. Using **lyrics or reference-vocal alignment** (expected word times) instead of generic beats should be considerably more informative than syllable-to-beat matching, because singers do not sing on every beat.
- Their syllable-peak versus beat matching yields a periodic score over candidate offsets (beat period ambiguity). With lag candidates limited to 0–300 ms and a typical beat period of 400–800 ms, the ambiguity can mostly be resolved, though in fast songs a half-beat ambiguity remains possible.

### Gaps
- Public engineering descriptions of Smule, BandLab, Soundtrap or StarMaker "auto-sync" or "auto-align vocals" features (post-hoc audio alignment of a user take to the backing) were not found. VocAlign (Synchro Arts) aligns a vocal to a guide vocal, but I found no published accuracy figures.
- No ms accuracy numbers were found for any vocal-to-backing auto-sync.

## Q6. Score-informed and reference-informed source separation: how well can the voice be separated from the backing, and how does leakage behave?

### Takeaway
Two families apply.
- **Blind or learned separation** (Demucs and similar) leaves some cross-talk. Its interference is measured by SIR in BSS-Eval, and SIR correlates reasonably with perceived interference.
- **Reference-informed subtraction** subtracts a time-aligned and gain-matched copy of the known backing or vocal stem. It can in principle cancel almost perfectly, but in practice it fails with any tempo, mix or mastering mismatch, leaving "chorus" or comb residues.

For latency estimation the main risk is **leakage of the backing into the vocal stem**. Leakage carries the backing's timing, so it biases any vocal-onset estimate toward zero latency.

### Cited Findings
- **Separation quality is reported with BSS-Eval SDR, SIR and SAR.** Accompaniment interference in vocal separation shows up as artefacts. Adversarial (SVSGAN-style) training has been used to suppress accompaniment interference. — [SVSGAN arXiv 1710.11428](https://arxiv.org/pdf/1710.11428); [Deep Karaoke arXiv 1504.04658](https://arxiv.org/pdf/1504.04658)
- **Perceptual relevance**: in a listening study, BSS-Eval's SIR showed correlations with human interference ratings comparable to PEASS. — [Gupta et al. 2015 (Georgia Tech)](https://musicinformatics.gatech.edu/wp-content_nondefault/uploads/2015/10/Gupta-et-al_2015_On-the-Perceptual-Relevance-of-Objective-Source-Separation-Measures-for-Singing.pdf); [Ward et al. WIMP 2018](https://research.hud.ac.uk/media/assets/document/research/7-Ward-wimp2018.pdf)
- **Reference subtraction in practice** (K-pop live vocal extraction, 2025): Demucs, then GCC-PHAT alignment, least-squares gain, frame-wise fine alignment (±0.25 s) and subtraction. It worked only partially: "chorus effect" residues appeared under reverb or crowd noise, and "even the slightest tempo mismatch would nullify the effectiveness". — [arXiv 2508.20273](https://arxiv.org/html/2508.20273v1)
- **Practitioners note** that regular and karaoke versions "are usually completely different recordings with different mixing and mastering, so subtraction rarely works in the real world." — [lalal.ai blog (vendor)](https://www.lalal.ai/blog/how-to-remove-vocals-from-a-song-2026-step-by-step-guide/) (via search snippet)
- **Score-informed separation** (using MIDI or score timing to guide separation) is a recognised technique, with karaoke track creation as one application. — [McGill thesis](https://escholarship.mcgill.ca/downloads/wp988q23b) (via search snippet; not opened)

### Inferences
- In our case the backing is the known karaoke track, so reference subtraction is attractive. If the backing in the stream is bit-identical up to delay, gain, EQ and codec, an adaptive filter (time-aligned via Q3, then NLMS or Wiener per frequency band) can subtract it. The **residual is mostly the live vocal**, and vocal onsets can then be measured cleanly. Codec artefacts and any resampling drift will leave residue. That residue is time-locked to the backing, so it biases onset estimates toward the backing timing.
- **Practical mitigation.** Estimate latency only from onsets with strong vocal energy relative to the predicted backing at that time-frequency bin. Alternatively, use the reference *instrumental* to build a mask (score- or reference-informed Wiener mask) rather than subtracting raw waveforms.
- Demucs-only separation of the mix (with no reference) leaks transients such as drums and piano attacks into the vocal stem. That again pulls onset-based latency toward zero, which matters most when the true latency is small (50 ms).

### Gaps
- I found no quantitative leakage (SIR) numbers for reference-informed subtraction with a compressed stream, and no studies on how separation leakage biases onset or latency estimates.
- Score-informed separation papers with SIR numbers specific to singing voice were not opened (tool budget).

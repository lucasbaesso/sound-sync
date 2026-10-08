# MIR methods for measuring singing-voice timing relative to the accompaniment/beat inside a single polyphonic mixture

Scope note: research done 2026-10-07 by web search and fetch (about 30 tool calls). Several primary PDFs could not be parsed by the fetch tool, so some numbers come from arXiv HTML renderings or from later papers' comparison tables. Those cases are marked. Unit conversions are mine: at 80 BPM, 1 beat = 750 ms, a 1/8 note = 375 ms and a 1/16 note = 187.5 ms.

## Q1. Best singing-voice onset detection / note transcription methods for mixtures, and their onset accuracy

### Takeaway
On polyphonic pop, the best singing-transcription systems reach about 75-78% onset F1 (COn) at a ±50 ms tolerance on MIR-ST500. Generic onset detection on separated vocal stems (SuperFlux on HTDemucs vocals) gets about 0.74 F1 at ±50 ms. Self-supervised music frontends (MERT, wav2vec2) add only 2-3 points. No paper I found reports a signed mean onset bias in ms; these F-measures cannot show whether a detector is systematically early or late by tens of ms.

### Cited Findings
- **Standard metric definitions.** Singing-transcription work reports COn (correct onset), COnP (onset + pitch) and COnPOff (onset + pitch + offset). Tolerances are 50 ms for onsets, 50 cents for pitch, and max(50 ms, 0.2 × note duration) for offsets, all via mir_eval — [Yang et al. 2023, arXiv 2306.12714](https://arxiv.org/html/2306.12714); [VOCANO / MIR-ST500 description](https://arxiv.org/pdf/2306.12714). mir_eval's note-level metric matches onsets within 50 ms by default — [mir_eval transcription docs](https://mir-eval.readthedocs.io/latest/api/transcription.html).
- **MIR-ST500 benchmark.** 500 Chinese pop songs with manually annotated vocal notes, split 400 train / 100 test. It is the main benchmark for "singing transcription from polyphonic music" — [wizwand MIR-ST500 summary](https://www.wizwand.com/dataset/mir-st500); [york135 ICASSP2021 repo](https://github.com/york135/singing_transcription_ICASSP2021).
- **Results on MIR-ST500 (COn / COnP / COnPOff F1, %)**, from the comparison table in [arXiv 2306.12714 (2023)](https://arxiv.org/html/2306.12714):
  - EfficientNet-b0 baseline (Wang & Jang, ICASSP 2021): 75.4 / 66.6 / 45.8
  - JDCnote (Kum et al. 2022): 76.2 / 69.7 / 42.2
  - Wav2Vec2-Large frontend: 78.3 / 70.7 / 52.4
  - MERT frontend: 78.2 / 71.6 / 46.7
  - MapMusic2Vec frontend: 77.9 / 70.0 / 50.7
  - wav2vec2.0: 76.3 / 67.0 / 44.8
  - WavLM: 76.9 / 67.3 / 44.4
- **Wang & Jang ICASSP 2021.** The pipeline uses Spleeter singing-voice separation as an optional preprocessing step (`-s` flag). The authors warn that a post-processing bug means the published numbers may not be exactly reproducible — [york135/singing_transcription_ICASSP2021](https://github.com/york135/singing_transcription_ICASSP2021).
- **VOCANO (2021).**
  - Splits transcription into pitch extraction (pre-trained Patch-CNN) and note segmentation (PyramidNet-110 with ShakeDrop).
  - Uses semi-supervised virtual adversarial training on both clean vocals and accompanied vocals.
  - Accompanied vocals are first passed through singing-voice separation.
  - Sources: [VOCANO GitHub](https://github.com/B05901022/VOCANO); [Zenodo record](https://zenodo.org/record/5624383).
- **Teacher-student pseudo-labelling (Kum et al. 2022).** "Pseudo-Label Transfer from Frame-Level to Note-Level in a Teacher-Student Framework for Singing Transcription from Polyphonic Music" — [arXiv 2203.13422](https://arxiv.org/abs/2203.13422). I could not extract its numbers; the closest related figure is JDCnote's 76.2 COn in the table above.
- **Basic Pitch (Spotify, ICASSP 2022).** Instrument-agnostic and lightweight, with a hop of about 11 ms.
  - On the Molina monophonic vocal test set: note F-no-offset 76.3%, F (with offset) 67.9%.
  - VOCANO on the same set: F-no-offset 81.4%, F 73.1%.
  - The authors attribute the gap mainly to onset detection, not pitch.
  - Basic Pitch was "not trained on multi-instrument mixtures."
  - Source: [Bittner et al. 2022, arXiv 2203.09893](https://arxiv.org/html/2203.09893).
- **MusicYOLO.** Detects whole note objects on the spectrogram image instead of frame-wise transients, aimed at sight-singing. Reported 94.16% onset F1 on the ISMIR2014 dataset, which is a solo/a cappella sung-melody set, not mixtures — [MDPI Appl. Sci. 12(15):7391](https://www.mdpi.com/2076-3417/12/15/7391); [ICASSP 2022 talk](https://rc.signalprocessingsociety.org/conferences/icassp-2022/spsicassp22vid0707).
- **ROSVOT (ACL 2024).** A multi-scale note segmentation model with an attention-based pitch decoder. Claims "state-of-the-art transcription accuracy with either clean or noisy inputs." I could not see the specific onset numbers — [Li et al. 2024, arXiv 2405.09940](https://arxiv.org/abs/2405.09940).
- **Separated-stem onset detection, large scale ("Vocal Eras Tour", TISMIR, published 2026-04-30).**
  - Pipeline: HTDemucs vocals, then librosa SuperFlux. Tuning: 4th-order Butterworth smoothing with an 8 Hz cutoff and a symmetric ±30 ms window.
  - On 90 manually annotated 10 s vocal stems: F = 0.742, P = 0.750, R = 0.765 at ±50 ms.
  - Estimated and annotated onsets differ significantly only at the "+" subdivision (KS = 0.280, p = 0.0038).
  - Source: [Georgieva et al., TISMIR](https://transactions.ismir.net/articles/278).
- **Syllable onsets on separated vocals (Hindustani, 2025).** Sub-band energy (640-2800 Hz) on separated vocals gives P 82.5%, R 77.9%, F1 80.1% at ±50 ms on 2,041 syllable onsets; differential MFCCs give F1 73.7%. Failure modes:
  - liquids, semivowels, nasals and voiced stops have weak energy transitions;
  - pitch ornamentation causes false positives.
  - Source: [Bhake & Rao, arXiv 2503.21142](https://arxiv.org/html/2503.21142).
- **Joint beat + vocal onset model (ISMIR 2017).** Dzhambazov, Holzapfel, Srinivasamurthy and Serra extend a beat-tracking Bayesian model to jointly track beats and vocal note onsets. It "reasonably improves" vocal onset accuracy over a metrical-position-agnostic baseline on English pop and Turkish makam. I did not obtain exact F-values — [arXiv 1707.06163](https://arxiv.org/abs/1707.06163); [UPF repository](https://repositori.upf.edu/items/5d2c3606-0da2-4561-b713-7d52b82438c1). Older than 2018, so possibly superseded, but conceptually the closest to "vocal onsets conditioned on the beat grid."
- **Lyrics-to-audio alignment as a coarse vocal-timing source.** NUS AutoLyrixAlign won MIREX 2019 with mean absolute word-start error under 200 ms on all test sets. The PCS metric uses a 0.3 s tolerance — [Gupta et al. 2019, arXiv 1906.10369](https://arxiv.org/pdf/1906.10369); [mir_eval alignment docs](https://mir-eval.readthedocs.io/latest/api/alignment.html).

### Inferences
- **The 50 ms window hides constant offsets.** A detector with a constant 30-40 ms bias can still score well. The F1 figures above therefore do not show whether the methods can measure a constant 50-300 ms offset. What matters is the signed bias of the onset estimate, and nobody reports it.
- **Expect noisy single onsets.** With about 75% onset F1 on mixtures, roughly a quarter of detected onsets are spurious or missing. Constant-offset estimation must aggregate hundreds of onsets robustly (median or mode of a phase histogram), not rely on individual events.
- **Systematic bias between definitions.** Vocal onset definition (consonant burst vs vowel onset vs pitch onset) creates a systematic bias that could reach tens of ms. The Hindustani paper notes energy-based detectors fail on nasals and liquids. This bias would be confounded with any path offset unless the same detector is applied to a reference with known alignment.
- **Lyrics alignment is too coarse.** At about 200 ms mean absolute error it cannot resolve a 50 ms constant offset per word, but averaging over many words could still add independent evidence.

### Gaps
- None of the papers found reports a mean signed onset error (bias) or ms error distribution for vocal onsets in mixtures; only tolerance-window F-measures.
- I found no CREPE or pYIN onset-accuracy numbers on mixtures. Both are f0 trackers, not onset detectors.
- I found no published "HTDemucs + basic-pitch" evaluation on MIR-ST500.
- I could not retrieve exact F-values for Dzhambazov et al. 2017, Kum et al. 2022 or ROSVOT.

## Q2. Best beat/downbeat trackers on mixtures, their timing precision, and behaviour on slow ballads

### Takeaway
Beat This! (ISMIR 2024) and All-In-One (WASPAA 2023) are the state of the art: beat F1 about 0.95-0.975 on pop (Harmonix/GTZAN-like) at ±70 ms. Their frame grids are coarse (Beat This! runs at 50 fps, 20 ms frames), and accuracy drops sharply on expressive or slow material (SMC beat F1 62.7). Madmom-style DBNs default to a 55 BPM minimum and produce double-tempo errors on slow music. Precision tighter than about ±20 ms per beat is not demonstrated by any reported metric.

### Cited Findings
- **Beat This! (Foscarin, Schlüter, Widmer, ISMIR 2024).**
  - Architecture: convolutions alternating with transformers, no DBN postprocessing.
  - Runs at 50 fps (hop 441 samples at 22.05 kHz).
  - Loss: shift-tolerant weighted BCE, max-pooling predictions over 7 frames (±3 frames, about ±70 ms).
  - Postprocessing: peak picking within ±3 frames with threshold 0.5; downbeats snapped to the nearest beat.
  - GTZAN: beat F1 89.1, downbeat F1 78.3 (Hung et al.: 88.7 / 75.6).
  - Per dataset: SMC 62.7, RWC Classical 77.1, Simac 77.9, HJDB 98.2, Candombe 99.7.
  - Beat CMLt (79.8) is below Hung et al. (81.2) because the frame-level loss lacks periodicity constraints and yields "non-periodic beats."
  - Sources: [arXiv 2407.21658](https://arxiv.org/html/2407.21658); [JKU record](https://research.jku.at/en/publications/beat-this-accurate-beat-tracking-without-dbn-postprocessing/).
- **Beat This! on pop in the Vocal Eras Tour study:** beat F = 0.975, downbeat F = 0.920 — [TISMIR 2026](https://transactions.ismir.net/articles/278).
- **All-In-One (Kim & Nam, WASPAA 2023).** Takes HTDemucs-demixed spectrograms as input, uses neighbourhood attention, and jointly does beats, downbeats and structure, at 70 ms tolerance — [arXiv 2307.16425](https://arxiv.org/html/2307.16425); [allin1 on PyPI](https://pypi.org/project/allin1).

  | Model (Harmonix) | Beat F1 | Downbeat F1 |
  |---|---|---|
  | All-In-One | 0.958 | 0.915 |
  | Böck & Davies TCN (madmom lineage) | 0.946 | 0.894 |
  | SpecTNT-TCN | 0.953 | 0.908 |
  | Beat Transformer | 0.954 | 0.898 |

- **Slow-tempo failure mode (2026).** "The SMC Blind Spot" reports that the standard DBN's default minimum tempo of 55 BPM blocks the correct tempo for 21% of SMC tracks, forcing double-tempo output. Lowering min_bpm to 30 helps. Octave (half/double) errors and continuity errors are distinct failure modes; models give "confident-but-wrong" activations on SMC — [Ahn, Hwang, Jung, arXiv 2605.12287](https://arxiv.org/abs/2605.12287).
- **Half-tempo errors.** A practitioner write-up attributes 10.1% of beat errors to half tempo. The mechanism: the tempogram peaks at both the perceived tempo and half of it. Non-peer-reviewed source — [dev.to post](https://dev.to/birrings/half-time-vs-double-time-bpm-detection-how-we-fixed-spotifys-known-accuracy-gap-3fi6).
- **Evaluation conventions.** madmom's evaluation module builds double- and half-tempo variants for the AMLt metrics, so octave errors are "forgiven" in AMLt but not in F1/CMLt — [madmom docs](https://madmom.readthedocs.io/en/v0.16/modules/evaluation/beats.html).
- **Precision of percussive onsets is far finer than beat-tracker precision.** Hand-tuned cymbal onset extraction reached "millisecond precision." Inter-beat-interval SD was 14.3 ms in jazz and 11.9 ms in rock/pop (unpaced) — [Sogorski, Geisel, Priesemann 2017, arXiv 1710.05608](https://ar5iv.arxiv.org/html/1710.05608).

### Inferences
- **What "F1 0.95 at ±70 ms" does and does not say.** Most beats fall within ±70 ms, but it says nothing about a constant ms bias. A 20 ms frame grid limits raw resolution to about ±10 ms unless peaks are interpolated.
- **Systematic bias against drum hits.** Beat-tracker output may carry a systematic offset relative to true drum hits (annotation conventions, network latency, shift-tolerant loss). It should be calibrated, for example against a percussive-onset detector on the drum/accompaniment stem. Beat This!'s loss explicitly allows ±3 frames of slop.
- **Ballads (~80 BPM) are risky.** Slow, sparse, often drumless (piano/strings) material resembles SMC-style data, where trackers degrade most. Above min_bpm, 80 BPM can still be tracked as 160 (double tempo). For offset estimation, a double-tempo grid halves the alias period (375 ms at 80 BPM), which directly overlaps the 50-300 ms range of interest.
- **All-In-One's demixed input has a cost.** Its beats are inferred partly from the vocal stem, so a vocal-path offset could pull the grid slightly. For grid estimation independent of the vocal, run Beat This! (or All-In-One) on the accompaniment stem rather than the mixture. Leakage remains a concern (see Q4).

### Gaps
- No paper found reports beat-placement error in ms (mean or SD of signed error) for Beat This!, All-In-One, BeatNet or madmom on pop. Only F-measure at ±70 ms is reported.
- I did not retrieve BeatNet (online, ISMIR 2021) numbers.
- No study isolated ballads around 80 BPM as a subgroup.
- Robustness of these trackers to AAC/Opus compression was not found.

## Q3. Published measurements of vocal microtiming / singer timing relative to the beat: typical values and variance

### Takeaway
Measured singer deviations in pop are small on average:
- Mean vocal onset deviations of about −0.01 beat (slightly early) on beats 1 and 3, and about −0.002 to −0.003 beat on beats 2 and 4, across 88,357 tracks. At 80 BPM that is about 7-9 ms early.
- Rap is the latest genre. Deviations shrink over 1965-2010.
- Jazz soloists delay downbeats by about 30 ms typically, up to about 100 ms.
- "Laid-back" drummers delay by about 17 ms.

A constant offset of 50-300 ms (0.07-0.4 beat at 80 BPM) is therefore well outside typical mean expressive deviations, though individual phrases can deviate by a full beat in rubato styles.

### Cited Findings
- **"The Vocal Eras Tour: Microtiming Trends Across Decades and Genres" (Georgieva, Fernandes, Menezes, Coelho, Fuentes, Ripollés, McFee; TISMIR, 2026).**
  - Corpus and pipeline: 88,357 vocal tracks (1965-2010, Million Song Dataset excerpts of 30-60 s); HTDemucs vocal stems; SuperFlux onsets; Beat This! grid.
  - Deviations are expressed as beat fractions; ±0.06 is about a 16th note.
  - Mean deviations: beat 1 = −0.0123, beat 3 = −0.0110, beats 2 and 4 = −0.0028 and −0.0021.
  - Pop and Country are placed slightly earlier; Rap has the most onsets and arrives later.
  - Year trend: β = 0.000109/yr (beat 2) and 0.000160/yr (beat 3), i.e. entries drift toward metrical targets. The authors suggest digital editing as a possible cause.
  - Limitations: excerpt bias; MSD skewed to North American/European music; Rock over-represented.
  - Sources: [TISMIR article](https://transactions.ismir.net/articles/278); [reference-global mirror](https://reference-global.com/article/10.5334/tismir.278).
- **Hindustani vocal (Bhake & Rao 2025).** Singers often start a line late and compress later syllables to land on sam/khali. Deviations reach up to one matra (beat), occasionally two, with clusters near exactly one matra. Deviation shrinks approaching cycle landmarks. Beats were manually annotated — [arXiv 2503.21142](https://arxiv.org/html/2503.21142); companion [arXiv 2508.04430](https://arxiv.org/pdf/2508.04430).
- **Jazz soloists vs rhythm section.**
  - Soloists are delayed relative to the drummer on downbeats and synchronized on upbeats at medium tempi.
  - Delays are of order 30 ms (about 9% of a quarter note) at intermediate tempi and can reach about 100 ms.
  - The original study (Friberg & Sundström) is older than 2015 (2002) but was confirmed in a 2023 study.
  - Sources: [KTH "Ensemble Swing"](https://www.speech.kth.se/music/performance/Texts/ensemble_swing.htm); [Nature Comms Physics 2022/23 s42005-022-00995-z](https://www.nature.com/articles/s42005-022-00995-z).
- **Swing perception experiment.** Jazz musicians were 7.48× more likely to rate versions with downbeat delays as swinging — [bibliojazz record of "Downbeat delays are a key component of the swing feel in jazz"](https://bibliojazz-collegium-musicae.huma-num.fr/s/bibliojazz-eng/item/13900); [NPR/WFAE coverage](https://www.wfae.org/2023-01-23/encore-what-makes-that-song-swing-at-last-physicists-unravel-a-jazz-mystery).
- **"Laid-back" vs "on" vs "pushed" (Danielsen/Câmara, RITMO Oslo).** Ten expert drummers at 96 BPM with a click delayed laid-back snare strokes by 17.4 ms on average, and also played them louder and with different timbre — [Câmara thesis/paper PDF](https://duo.uio.no/bitstream/handle/10852/79965/MP3801_01_Camara.pdf?sequence=1).
- **Pop form-dependent "pocket."** Hosken (IASPM 2020) studies "tight verses and loose choruses," i.e. vocal timing varying across song sections. Abstract only; I did not verify any numbers — [IASPM 2020 abstract](https://london-calling-iaspm2020.com/session-3-theme-analysing-popular-music/tight-verses-and-loose-choruses-the-shaping-of-the-metric-pocket-across-pop-forms).
- **Sinatra.** In "The Way You Look Tonight" he starts on the beat and progressively falls behind (qualitative, not measured) — [Learn Jazz Standards](https://www.learnjazzstandards.com/?p=196828). Low-authority source.

### Inferences
- **Expressive mean offsets are an order of magnitude smaller than the target range.** Converting Vocal Eras means to 80 BPM gives −9.2 ms (beat 1), −8.3 ms (beat 3) and about −2 ms (beats 2/4). Jazz laid-back of 30 ms and drummers' 17 ms are similar in scale. A track-wide constant offset ≥50 ms in the vocal-onset-phase histogram is therefore strong evidence of a path delay, not style.
  - Exception 1: rap.
  - Exception 2: rubato singers with late phrase entries. These are phrase-local and should show high within-song variance, whereas a path delay is a constant shift.
- **Shift vs widening.** A constant path delay shifts the entire phase distribution, including onsets that are normally tightly locked (beats 2/4, phrase-final syllables landing on the downbeat). Expressive lag mostly widens and skews the distribution. Using the mode, or the "tightest-locked" onsets (e.g. those landing near beat landmarks), is a plausible robust statistic.
- **Pipeline bias risk.** The Vocal Eras pipeline (HTDemucs → SuperFlux → Beat This!) is essentially what sound-sync would use. Its reported mean deviations near zero suggest the pipeline has little gross bias on pop, but this was not explicitly validated in ms.

### Gaps
- No study found reports per-song SD of vocal deviations in ms for pop. The Vocal Eras study reports means and regressions in beat fractions; I could not extract variance values.
- No study found quantifies typical rap lateness in ms.
- I found no published singer-specific (e.g. ballad) laid-back measurements in ms from commercial recordings.

## Q4. Estimating audio-to-audio or stem-to-stem lag inside a mixture, and leakage-robust methods

### Takeaway
I found no MIR paper that estimates a constant time offset between the vocal and the accompaniment *within a single mono mixture*. The closest neighbours are:
- multichannel time-delay estimation (DUET/DEMIX, GCC-PHAT), which needs ≥2 channels;
- multi-recording synchronization (fingerprint/energy/harmonic cross-correlation between separate recordings);
- karaoke device-latency compensation, which measures the device round-trip, not the content;
- event-based multitrack alignment, which needs the separate tracks.

Separation leakage is documented (Demucs "suffers from some bleeding, especially between the vocals and other source"). That explains the zero-lag peak: the correlated components shared by both stems are leaked copies of the same mixture content, so they are perfectly aligned.

### Cited Findings
- **DEMIX Anechoic (Arberet et al., EPFL).** Estimates the number of sources plus attenuation and time delay of each source in underdetermined anechoic multichannel mixtures. Delay estimation is GCC-PHAT-like and can exceed one sample, unlike DUET. Requires stereo or multichannel; older than 2015 — [EPFL infoscience](https://infoscience.epfl.ch/record/150461/); [ICASSP07 paper](https://infoscience.epfl.ch/record/165877/files/sArberetICASSP07.pdf?version=1).
- **Self-supervised time-delay estimation** for sound localization (2022) is a learned alternative to GCC-PHAT. It is binaural/multichannel, not single-channel — [arXiv 2204.12489](https://arxiv.org/pdf/2204.12489).
- **Multi-recording synchronization.** Patents use cross-correlation of spectral peak maps, energy vectors, or harmonic/pitch representations to find Δt between *separate* recordings of the same event — [US 9972294 (harmonics)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9972294); [US 10043536 (energy vectors)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10043536); [US 9368151](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9368151).
- **Event-based multitrack alignment.** A Bayesian framework (Surrey) represents multitrack audio as time-stamped onset and harmonic events and aligns them probabilistically — [Surrey Open Research](https://openresearch.surrey.ac.uk/esploro/outputs/journalArticle/Event-based-Multitrack-Alignment-using-a-Probabilistic/99514677202346); [academia.edu copy](https://www.academia.edu/80772736/Event_based_Multitrack_Alignment_using_a_Probabilistic_Framework).
- **Fingerprint-based alignment of distorted occurrences (DAFx 2011, older than 2015).** Uses item-restricted fingerprinting and segment detection to estimate temporal distortion between occurrences — [IP Paris record](https://researchportal.ip-paris.fr/en/publications/automatic-alignment-of-audio-occurrences-application-to-the-verif/).
- **Karaoke latency.**
  - Smule-style patents estimate device round-trip latency with test pulses or crowd-sourced per-device values, then shift captured vocals relative to the backing track — [US 9412390](https://patents.google.com/patent/US9412390); [US 10284985](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10284985).
  - Another patent addresses the "dual sound" caused by singing delayed relative to accompaniment — [EP3493198A1](https://patents.google.com/patent/EP3493198).
  - All of these assume access to the separate vocal capture and backing track, not a mixture.
- **Leakage/bleeding.**
  - Original Demucs: "suffers from some bleeding, especially between the vocals and other source" — [Défossez et al. 2019, arXiv 1911.13254](https://arxiv.org/abs/1911.13254).
  - Hybrid Demucs reduces bleeding "by a large amount," with human ratings on artifacts and bleeding — [arXiv 2111.03600](https://arxiv.org/pdf/2111.03600).
  - The MDX23 challenge added robustness to label noise and bleeding in training data as a track — [arXiv 2308.06979](https://arxiv.org/pdf/2308.06979); TFC-TDF-UNet v3 report [arXiv 2306.09382](https://arxiv.org/pdf/2306.09382).
- **Leakage metric and alignment sensitivity.**
  - A leakage power ratio (LPR) measured in silent intervals has been proposed to quantify leakage.
  - Delays of ≥20 ms between reference and output measurably affect separation metrics.
  - Source: [MAPSS, arXiv 2509.09212](https://arxiv.org/pdf/2509.09212) (from search snippet, not fully verified).
- **Lead-vs-ensemble vocal separation with phoneme alignment (2026)** uses alignment as side information, which shows joint alignment-and-separation formulations exist — [arXiv 2609.06488](https://arxiv.org/html/2609.06488).
- **Survey reference.** Lead/accompaniment separation overview (Rafii et al. 2018): TF masking applies 0-1 gains per TF bin. f0-informed and time-warping-based separation methods exist — [HAL lirmm-01766781](https://hal-lirmm.ccsd.cnrs.fr/lirmm-01766781/document).

### Inferences
- **Why the cross-correlation peaks at 0 ms.** Write the separated stems as vocal = V(t−d) + a·A(t) + artifacts and accompaniment = A(t) + b·V(t−d), where d is the path offset. The cross-term a·A ⋆ A + b·V ⋆ V both peak at lag 0, so the zero-lag peak comes from leaked copies, not true sync. The true-lag term V ⋆ A is only weakly correlated, because the vocal and accompaniment onsets are different events, and a ±d peak exists only through the shared beat. So the 0 ms peak is the expected outcome whenever leakage exists. It is not specific to MDX-Net.
- **Leakage-robust directions** (my synthesis; none is published for this exact task):
  1. **Don't correlate the two stems with each other.** Compare each stem's events to an *independent* model of the grid. Example: vocal onset phase relative to a beat grid derived from percussive/bass events with vocal-band energy excluded (drum + bass stems only, which carry little vocal leakage), and score the phase-histogram peak.
  2. **Remove the zero-lag leakage term explicitly.** Whiten or orthogonalize each stem against the other (e.g. regress the accompaniment envelope out of the vocal envelope at lag 0) before correlating, or use GCC-PHAT on residuals. The leaked components are coherent at lag 0, so a lag-0 projection removes them.
  3. **Use features that leakage barely carries.** Use vocal-specific cues (f0 voicing onsets from CREPE/pYIN, consonant/formant features, lyric-aligned word starts) and accompaniment cues (drum transients from the drum stem). Leakage of drums into a vocal model's output is typically small in energy but sharp; band-limiting and voicing gating reduce it.
  4. **Synthesize the hypothesis and re-score the mixture.** For each candidate offset d, shift the vocal stem by d, remix with the accompaniment, and score the result. Note: with leaked stems this tends to favour d = 0 as well, so it needs leakage-free features.
- **Separation models may "assume" alignment.** I believe common training uses random remixing of stems from different songs (Uhlich 2017; Demucs augmentation), which would imply separators do not depend on vocal/accompaniment sync. Unverified here; see Gaps.

### Gaps
- No published method was found for single-channel, within-mixture estimation of a constant offset between vocal and accompaniment. This appears to be an unaddressed problem; terms tried: "stem alignment", "multitrack time alignment", "detecting latency between tracks in a mix", "time-delay estimation between sources in a mixture".
- I could not verify whether Demucs/MDX training uses cross-song random remixing. The fetched Demucs abstract only mentions "proper data augmentation."
- No quantitative study of leakage magnitude vs lag-0 correlation in separated stems was found.

## Q5. Using the vocal f0 trajectory vs the accompaniment's chord/onset structure for alignment, and handling beat-periodic ambiguity

### Takeaway
No paper found aligns a vocal f0 trajectory against accompaniment harmony to recover a time offset within a mixture. Related work uses metrical position as a prior for vocal onsets and harmonic/pitch features to synchronize separate recordings. Rhythm-only evidence is inherently ambiguous modulo the beat, or the tatum (1/16 note = 187.5 ms at 80 BPM). The 50-300 ms search range therefore spans more than one 16th-note alias at 80 BPM, so harmonic or lyric cues, or priors, are needed to break the ambiguity.

### Cited Findings
- **Metrical position as a prior for vocal note onsets.** The joint beat + vocal onset model (ISMIR 2017) shows metrical position is informative — [arXiv 1707.06163](https://arxiv.org/abs/1707.06163).
- **Harmonic/pitch alignment between recordings.** Patents use pitch of harmonic sound and harmonic energy per window to estimate Δt — [US 9972294](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9972294).
- **f0-informed separation via time warping** is listed among lead/accompaniment separation methods — [Rafii et al. overview](https://hal-lirmm.ccsd.cnrs.fr/lirmm-01766781/document).
- **Octave/alias errors in rhythm analysis.** Half/double-tempo errors are a principal failure mode of beat trackers — [arXiv 2605.12287](https://arxiv.org/abs/2605.12287); [madmom evaluation docs](https://madmom.readthedocs.io/en/v0.16/modules/evaluation/beats.html).
- **Singers' phrase-level shifts can be exactly one beat.** Hindustani singers' deviations cluster near exactly one matra, which shows that a whole-beat "alias" can be a genuine musical event — [arXiv 2503.21142](https://arxiv.org/html/2503.21142).
- **Jazz soloists show different offsets on downbeats (delayed) and upbeats (synchronized).** A beat-position-dependent analysis can separate style from a constant shift, which affects all positions equally — [KTH](https://www.speech.kth.se/music/performance/Texts/ensemble_swing.htm).
- **The same position-dependent pattern in pop.** Vocal Eras finds systematically different mean deviations on beats 1/3 vs 2/4 — [TISMIR](https://transactions.ismir.net/articles/278).

### Inferences
- **Alias-breaking cues** (my synthesis):
  - **Harmonic consistency.** Vocal sustained-note pitch classes should be consonant with the concurrent chord. Score a chroma-vs-vocal-pitch-class consonance function over candidate offsets d. Chord changes typically occur on beats or bars (750-3000 ms at 80 BPM), so this cue disambiguates the 1/16 and 1/8 aliases that rhythm-only scoring cannot. It is also less affected by leakage if the accompaniment chroma is computed with the vocal f0 harmonics masked out.
  - **Phrase-boundary landing.** Phrase-final long notes and phrase starts tend to coincide with downbeats. A downbeat-anchored histogram (bar-level, 3 s period at 80 BPM 4/4) has much less aliasing than a beat-level one.
  - **Position-invariance test.** A constant path delay shifts beats 1-4 and the subdivisions by the same ms. Expressive timing is position-dependent (Vocal Eras: beats 1/3 differ from 2/4; jazz: downbeats delayed, upbeats synced). Fitting "constant shift + position-specific expressive term" separates the two.
  - **Prior.** Expressive means are about 0-10 ms (pop) and up to 30-100 ms (jazz downbeats), so a Bayesian prior centred near 0 with small width on the style term will push large constant shifts into the "path delay" term.
- **Pitch onsets vs energy onsets.** Vocal f0 onsets (voicing start, note transitions) from CREPE/pYIN on the separated vocal are less contaminated by drum leakage than spectral-flux onsets. Leaked drums are unpitched, though leaked pitched instruments can still trigger voicing.

### Gaps
- No published f0-vs-harmony alignment method for within-mixture offset estimation was found.
- No empirical study was found quantifying how often rhythm-only phase estimation picks the wrong alias on ballads.
- Compressed-audio (AAC/Opus) effects on any of these measures were not covered by any source found. Codec frame and pre-echo effects on onset timing (typically a few ms) remain unquantified here.

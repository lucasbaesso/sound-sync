"""Makes a test video where the sound of each "clap" comes a known number of ms after the picture.

A white block slides and stops dead every 1.7 s; a click sounds `delay` ms after it stops.
Usage: FFMPEG=/path/to/ffmpeg python3 tests/e2e/make_sync_video.py <delay_ms> <out.webm>
"""
import math, os, random, struct, subprocess, sys, tempfile, wave

delay_ms = float(sys.argv[1])
out = sys.argv[2]
ffmpeg = os.environ.get("FFMPEG", "ffmpeg")
W, H, FPS, SECONDS, SR = 640, 360, 30, 24, 48000
PERIOD_FRAMES = 51  # 1.7 s
MOVE_FRAMES = 6     # 200 ms of movement before each stop
hits = [f for f in range(45, SECONDS * FPS - 10, PERIOD_FRAMES)]

def block_y(frame):
    for i, h in enumerate(hits):
        if h - MOVE_FRAMES <= frame <= h:
            top, bottom = (40, 260) if i % 2 == 0 else (260, 40)
            return round(top + (bottom - top) * (frame - (h - MOVE_FRAMES)) / MOVE_FRAMES)
    # At rest where the last move ended.
    done = [i for i, h in enumerate(hits) if h < frame]
    if not done:
        return 40
    return 260 if done[-1] % 2 == 0 else 40

with tempfile.TemporaryDirectory() as tmp:
    wav = os.path.join(tmp, "a.wav")
    n = SECONDS * SR
    samples = [0.0] * n
    rnd = random.Random(1)
    for h in hits:
        start = round((h / FPS + delay_ms / 1000) * SR)
        for k in range(int(SR * 0.12)):
            if 0 <= start + k < n:
                samples[start + k] += 0.3 * (rnd.random() * 2 - 1) * math.exp(-k / (SR * 0.02))
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))

    cmd = [ffmpeg, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav, "-c:v", "libvpx", "-b:v", "2M", "-deadline", "realtime", "-c:a", "libopus", "-shortest", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    bg = bytes([32]) * W
    for f in range(SECONDS * FPS):
        y = block_y(f)
        rows = []
        for r in range(H):
            if y <= r < y + 80:
                rows.append(bytes([32]) * 380 + bytes([240]) * 140 + bytes([32]) * (W - 520))
            else:
                rows.append(bg)
        p.stdin.write(b"".join(rows))
    p.stdin.close()
    sys.exit(p.wait())

"""Differential harness: Audio_Analysis_Suite v0.01.02 vs original DROffline 2.2.3 golden report,
plus a model of the original pipeline decoded from libMAATDROffline2.dll / DROffline MkII.exe.

Usage: python parity_harness.py <app.pyw> <fixture dir> <golden.json> <reference log> <out dir>
Fixtures are only read. App data is redirected to <out dir>/appdata.
"""
import importlib.machinery, importlib.util, json, math, struct, subprocess, sys, threading
from pathlib import Path
import numpy as np
from scipy.signal import lfilter

APP, FIX, GOLD, REFLOG, OUT = map(Path, sys.argv[1:6])
OUT.mkdir(parents=True, exist_ok=True)

loader = importlib.machinery.SourceFileLoader('suite', str(APP))
spec = importlib.util.spec_from_loader('suite', loader)
app = importlib.util.module_from_spec(spec); sys.modules['suite'] = app; loader.exec_module(app)
app.data_root = lambda: OUT / 'appdata'          # keep the user's Documents untouched
ff, fp = app.ffmpeg_paths()

golden = json.loads(GOLD.read_text(encoding='utf-8'))
grows = {r['name']: r for r in golden['rows']}

# ---------------------------------------------------------------- original model
def rint(x):            # x + 1.5*2^52 trick == round half to even
    return int(np.rint(x))

def f32(h):
    return struct.unpack('<f', struct.pack('<I', h))[0]

def dr_channel(x, sr, include_partial=True):
    bs = rint(sr * 132480.0 / 44100.0)
    peak_h = np.zeros(10000, np.int64); rms_h = np.zeros(10000, np.int64)
    n = len(x)
    starts = range(0, n, bs)
    for s in starts:
        blk = x[s:s + bs]
        if len(blk) < bs and not include_partial:
            continue
        sq = (blk.astype(np.float32) * blk.astype(np.float32)).astype(np.float64)
        # peak with the "0.9999 and exactly two equal repeats" rule (FUN_180051ea0)
        mx = 0.0; rep = 0; flag = False
        for v in sq:  # exact emulation (blocks are short enough at these lengths)
            if v == mx and flag: rep += 1
            elif v <= mx: flag = False
            else: flag = True; mx = v
        if mx > 0.9999 and rep == 2: mx = 1.0
        rms2 = 2.0 * float(sq.sum()) / len(blk)
        for val, h in ((mx, peak_h), (rms2, rms_h)):
            i = 9999 if val <= 1e-8 else int(math.log10(val) * -1000.0)
            h[min(max(i, 0), 9000)] += 1
    # second-highest peak bin
    cum = 0; idx2 = 10000
    for i in range(10000):
        if cum + peak_h[i] > 1: idx2 = i; break
        cum += peak_h[i]
    total = int(rms_h.sum()); n20 = int(total * 0.2) or 1
    rem = n20; acc = 0.0
    for i in range(10000):
        if rms_h[i]:
            take = min(rms_h[i], rem); acc += math.pow(10.0, i * -0.001) * take; rem -= take
        if rem == 0: break
    return idx2 * -0.01 - math.log10(acc / n20) * 10.0

SHELF = {44100.0: (1.5308834, -2.6509206, 1.1689888, 1.0, -1.6635852, 0.7125369),
         48000.0: (1.5351661, -2.6916447, 1.1983099, 1.0, -1.6905942, 0.7324256),
         96000.0: (1.5597497, -2.9267397, 1.3782268, 1.0, -1.8445746, 0.85581124)}
HPF = {44100.0: (0.9945922, -1.9891844, 0.9945922, 1.0, -1.9891697, 0.98919904),
       48000.0: (0.9950299, -1.9900599, 0.9950299, 1.0, -1.9900475, 0.99007225),
       96000.0: (0.9975103, -1.9950206, 0.9975103, 1.0, -1.9950175, 0.9950238)}

def lufs_original(pcm, sr):
    if float(sr) not in SHELF: return None
    y = pcm.astype(np.float64)
    for c in (SHELF[float(sr)], HPF[float(sr)]):
        y = lfilter(c[:3], c[3:], y, axis=0)
    win = rint(0.4 * sr); hop = rint(0.1 * sr)
    sq = (y * y).sum(axis=1)                   # unweighted channel sum (stereo/mono)
    cs = np.concatenate([[0.0], np.cumsum(sq)])
    ends = np.arange(win, len(sq) + 1, hop)
    if not len(ends): return -128.0
    p = (cs[ends] - cs[ends - win]) / win
    with np.errstate(divide='ignore'):
        L = np.where(p > 0, np.float32(10 * np.log10(np.where(p > 0, p, 1))) - np.float32(0.691), -128.0)
    absg = p[L > -70.0]
    gr = (10 * math.log10(absg.mean()) - 0.691 if len(absg) and absg.mean() > 0 else -128.0) - 10.0
    inc = p[L > gr]                             # relative gate over ALL windows (no AND with -70)
    m = inc.mean() if len(inc) else 0.0
    return 10 * math.log10(m) - 0.691 if m > 0 else -128.0

TAPS4 = [[0x3ae00000,0x3c340000,0xbca10000,0x3d080000,0xbd738000,0x3e0ca000,0x3f78e000,0xbdd18000,0x3d430000,0xbcda0000,0x3c740000,0xbc080000],
         [0xbcef0000,0x3cf00000,0xbd540000,0x3db68000,0xbe2a8000,0x3eee2000,0x3f47a000,0xbe4d2000,0x3dd00000,0xbd6e8000,0x3d078000,0xbc9b0000],
         [0xbc9b0000,0x3d078000,0xbd6e8000,0x3dd00000,0xbe4d2000,0x3f47a000,0x3eee2000,0xbe2a8000,0x3db68000,0xbd540000,0x3cf00000,0xbcef0000],
         [0xbc080000,0x3c740000,0xbcda0000,0x3d430000,0xbdd18000,0x3f78e000,0x3e0ca000,0xbd738000,0x3d080000,0xbca10000,0x3c340000,0x3ae00000]]
TAPS2 = [0xbc0c010d,0x3b58a3e5,0xbb80e372,0x3b9891e7,0xbbb27387,0x3bcf9484,0xbbf07371,0x3c0a76ca,0xbc1ec464,0x3c3595e3,
         0xbc4f41aa,0x3c6c330f,0xbc868747,0x3c994fc0,0xbcaefbe9,0x3cc853e5,0xbce66f31,0x3d057008,0xbd1c0b10,0x3d39035d,
         0xbd5fc426,0x3d8b6391,0xbdb5f863,0x3e00d78a,0xbe585fb0,0x3f22e5b9]

def tp_original(pcm, sr):
    x = pcm.astype(np.float64)
    if sr <= 48000:
        m = max(float(np.max(np.abs(lfilter([f32(h) for h in ph], [1.0], x, axis=0)))) for ph in TAPS4)
    elif sr <= 96000:
        c = np.array([f32(h) for h in TAPS2])          # half-band odd taps, centre-most last
        h = np.concatenate([c, c[::-1]])               # symmetric 52-tap interpolating phase (model)
        mid = lfilter(h, [1.0], x, axis=0)
        m = max(float(np.max(np.abs(x))), float(np.max(np.abs(mid))))
    else:
        m = float(np.max(np.abs(x)))
    return -100.0 if m <= 0 else max(-100.0, 20 * math.log10(m))

# ---------------------------------------------------------------- run
def decode(path, info, tmp):
    dst = tmp / 'dec.f32'; app.spawn_decode(path, dst, info, ff, threading.Event())
    a = np.fromfile(dst, '<f4').reshape(-1, info['channels']); return a

rows = []; results = []
tmp = OUT / 'tmp'; tmp.mkdir(exist_ok=True)
for path in sorted(p for p in FIX.iterdir() if p.is_file()):
    r = app.analyze_one(path, True, False, ff, fp, threading.Event()); results.append(r)
    info = app.probe_audio(path, ff, fp); pcm = decode(path, info, tmp); sr = info['rate']
    row = {'file': path.name, 'app_status': r.status, 'app_detail': r.detail,
           'app_dr': r.dr, 'app_lufs': r.lufs, 'app_tp': r.peak, 'duration_s': len(pcm) / sr}
    if len(pcm) / sr >= 10.0:
        dA = [dr_channel(pcm[:, c], sr, True) for c in range(pcm.shape[1])]
        dB = [dr_channel(pcm[:, c], sr, False) for c in range(pcm.shape[1])]
        row.update(model_dr_partial=float(np.mean(dA)), model_dr_full_only=float(np.mean(dB)),
                   model_lufs=lufs_original(pcm, sr), model_tp=tp_original(pcm, sr))
    g = grows.get(path.stem)
    if g: row['golden'] = g
    rows.append(row)

report = app.dr_folder_report(str(FIX), results)
(OUT / 'app_v0.01.02_report.txt').write_bytes(report)
(OUT / 'harness_rows.json').write_text(json.dumps(rows, indent=1, ensure_ascii=False, default=float), encoding='utf-8')
print('rows', len(rows))

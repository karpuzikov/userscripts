"""Headless regression tests for Audio Analysis Suite v0.01.00.

Run: py -m unittest discover -s tests -p "test_*.py"
These do NOT establish DROffline / AudioChecker parity or Windows GUI acceptance.
"""
import importlib.machinery
import importlib.util
import math
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from pathlib import Path

import numpy as np

ENTRY = Path(__file__).resolve().parents[1] / "Audio_Analysis_Suite_v0.01.00.pyw"
loader = importlib.machinery.SourceFileLoader("audio_suite_v001", str(ENTRY))
spec = importlib.util.spec_from_loader(loader.name, loader)
suite = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = suite
loader.exec_module(suite)


def write_wav(path, seconds=12, channels=2, signal="sine"):
    rate = 44100
    t = np.arange(rate * seconds, dtype=np.float64) / rate
    if signal == "silence":
        y = np.zeros_like(t)
    elif signal == "square":
        y = .5 * np.sign(np.sin(2 * np.pi * 1000 * t))
    elif signal == "dc":
        y = np.full_like(t, .25)
    else:
        y = .5 * np.sin(2 * np.pi * 1000 * t)
    samples = np.rint(np.broadcast_to(y[:,None],(len(y),channels)) * 32767).astype("<i2")
    with wave.open(str(path),"wb") as f:
        f.setnchannels(channels)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(samples.tobytes())


class AudioSuiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ff, cls.fp = suite.ffmpeg_paths()

    def test_synthetic_dr_and_loudness(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, expected_dr in (("sine",0),("silence",0),("square",-3),("dc",-3)):
                p=Path(folder)/(name+".wav")
                write_wav(p,signal=name)
                r=suite.analyze_one(p,True,False,self.ff,self.fp,threading.Event())
                self.assertEqual(r.status,"Done",repr(r))
                self.assertEqual(r.dr,expected_dr)
                self.assertIsNotNone(r.lufs)
                self.assertIsNotNone(r.peak)
                if name=="silence":
                    self.assertEqual(r.lufs,-128)
                    self.assertEqual(r.peak,-100)
                if name=="sine":
                    self.assertAlmostEqual(r.lufs,-6.06,delta=.2)

    def test_lossy_file_and_short_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder)
            wav=folder/"input.wav"
            mp3=folder/"input.mp3"
            short=folder/"short.wav"
            write_wav(wav)
            write_wav(short,seconds=3)
            child=subprocess.run([self.ff,"-hide_banner","-loglevel","error","-i",str(wav),
                                  "-c:a","libmp3lame","-b:a","192k","-y",str(mp3)],
                                 capture_output=True)
            self.assertEqual(child.returncode,0,child.stderr)
            r=suite.analyze_one(mp3,True,True,self.ff,self.fp,threading.Event())
            self.assertEqual(r.status,"Done",repr(r))
            self.assertEqual(r.authenticity,"Lossy codec")
            s=suite.analyze_one(short,True,False,self.ff,self.fp,threading.Event())
            self.assertEqual(s.status,"Rejected")
            report=folder/"test.tsv"
            suite.save_report([r],report)
            self.assertIn(b"\r\n",report.read_bytes())


if __name__=="__main__":
    unittest.main()

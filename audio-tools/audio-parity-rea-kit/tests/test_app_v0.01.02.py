"""Contract regression for the supplied VULTURES 2 text (not native-engine parity)."""
import importlib.machinery
import importlib.util
import pathlib
import sys
import tempfile
import unittest


def load_app():
    file = pathlib.Path(__file__).resolve().parents[1] / "Audio_Analysis_Suite_v0.01.02.pyw"
    loader = importlib.machinery.SourceFileLoader("audio_suite_v00102", str(file))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    app = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = app
    loader.exec_module(app)
    return app


class AudioCheckerContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = load_app()

    def test_engine_output_parser(self):
        self.assertEqual(self.app.parse_aucdtect("This track looks like MPEG with probability 95%"), ("MPEG",95))
        self.assertEqual(self.app.parse_aucdtect("This track looks like CDDA with probability 99%"), ("CDDA",99))
        self.assertEqual(self.app.parse_aucdtect("source of track cannot be qualified."), ("UNKNOWN",None))

    def test_album_summary_and_report_collisions(self):
        classifications = [(1,100),(1,100),(1,100),(1,100),(0,95),(1,100),(0,100),(1,99),
                           (1,100),(1,100),(1,100),(1,100),(1,94),(1,100),(1,100),(1,100)]
        with tempfile.TemporaryDirectory() as root:
            folder=pathlib.Path(root)/"2024-08-03T00_00_00Z - VULTURES 2"
            folder.mkdir()
            results=[]
            for i,(c,p) in enumerate(classifications,1):
                results.append(self.app.Result(path=str(folder/f"{i:02d} track.flac"),status="Done",
                    authenticity="CDDA" if c else "MPEG",auth_probability=p,
                    auth_engine="auCDtect 0.8.2",dr=4,rate=44100,channels=2,word_length="16",
                    lufs=-9.21,peak=0.23))
            auth=self.app.authenticity_folder_report(folder,results)
            self.assertIn(b"Summary 87,38% CDDA",auth)
            self.assertIn(b"05 -=- 05 track.flac -=- MPEG (95%)",auth)
            self.assertEqual(auth.count(b" -=- "),32)
            self.assertNotIn(b"86168036",auth)
            self.assertEqual(self.app._report_number(-0.0),"-0.00")
            self.assertEqual(self.app._report_number(0.0),"+0.00")
            dr=self.app.dr_folder_report(folder,results)
            self.assertIn(b"Number of EP/Album Files: 16",dr)
            original=folder/"audiochecker.log"
            original.write_bytes(b"user original report")
            saved=self.app.write_album_reports(results,True,True)
            self.assertEqual(original.read_bytes(),b"user original report")
            self.assertEqual(len(saved),2)
            self.assertEqual(self.app.write_album_reports(results,True,True),saved)

    def test_missing_classifier_cannot_fabricate_percent(self):
        app=self.app
        with tempfile.TemporaryDirectory() as root:
            folder=pathlib.Path(root)
            r=app.Result(path=str(folder/"01 track.flac"),status="Partial",dr=4,
                         authenticity="ERROR",detail="auCDtect unavailable")
            self.assertIn(b"Summary unavailable",app.authenticity_folder_report(folder,[r]))
            self.assertIn(b"Number of EP/Album Files: 1",app.dr_folder_report(folder,[r]))


if __name__ == "__main__":
    unittest.main()

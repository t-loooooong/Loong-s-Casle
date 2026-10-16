import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from collect_prices import inputs, analyse_video

class BatchTests(unittest.TestCase):
    def test_zip_metadata_and_cli(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            file_name = 'BV1CVdmB5E8P.srt'
            subtitle = '1\n00:00:01,000 --> 00:00:03,000\nHG柯西 券后247元'
            archive_path = root / 'subbatch.zip'
            with zipfile.ZipFile(archive_path, 'w') as archive:
                archive.writestr(file_name, subtitle)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'videos': [{'file': file_name, 'bvid': 'BV1CVdmB5E8P', 'sourceUid': '382486276', 'publishedAt': '2026-10-16T12:00:00+08:00', 'page': 2}]}), encoding='utf-8')
            output = root / 'out'
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('collect_prices.py')), str(archive_path), '--manifest', str(manifest), '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads((output / 'candidates.json').read_text(encoding='utf-8'))
            self.assertEqual(data['candidates'][0]['priceCents'], 24700)
            self.assertEqual(data['candidates'][0]['page'], 2)
            self.assertIn('?p=2', data['candidates'][0]['videoUrl'])
            again = subprocess.run([sys.executable, str(Path(__file__).with_name('collect_prices.py')), str(archive_path), '--output', str(output)], capture_output=True)
            self.assertNotEqual(again.returncode, 0)

    def test_collection_bundle_and_missing_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'bundle.json'
            path.write_text(json.dumps({'schemaVersion': 1, 'videos': [{'bvid': 'BV1CVdmB5E8P', 'page': 2, 'subtitleText': 'RG海牛到手三百元'}], 'skipped': [{'reason': '没有字幕'}]}), encoding='utf-8')
            rows, skipped = inputs(path, None)
            candidates, _ = analyse_video(rows[0][0], rows[0][1])
            self.assertEqual(candidates[0]['priceCents'], 30000)
            self.assertIn('missing_source_uid', candidates[0]['issues'])
            self.assertEqual(len(skipped), 1)

if __name__ == '__main__':
    unittest.main()

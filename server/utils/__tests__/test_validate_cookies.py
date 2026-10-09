"""Regression coverage against the actual yt-dlp zipimport cookie loader.

Requires python3 and yt-dlp on PATH, or YOUTARR_TEST_YTDLP pointing to the
zipimport executable (the same distribution used by the Docker image).
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class CookieValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.executable = os.environ.get("YOUTARR_TEST_YTDLP") or shutil.which("yt-dlp")
        if not cls.executable:
            raise RuntimeError("Install yt-dlp or set YOUTARR_TEST_YTDLP to its zipimport executable")
        cls.helper = Path(__file__).resolve().parents[1] / "validate-cookies.py"

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.snapshot = Path(self.directory.name) / "cookies.txt"

    def validate(self, contents):
        self.snapshot.write_text(contents, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(self.helper), self.executable, str(self.snapshot)],
            capture_output=True, text=True, timeout=10, check=True,
        )
        self.assertNotIn("SECRET", result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout)

    def test_accepts_httponly_whitespace_and_fractional_expiration(self):
        result = self.validate(
            "# Netscape HTTP Cookie File\r\n   \r\n"
            "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2000000000.5\tSID\tSECRET\r\n"
        )
        self.assertTrue(result["valid"])
        self.assertIn("SID\tSECRET", self.snapshot.read_text())

    def test_skips_malformed_records_and_normalizes_the_snapshot(self):
        result = self.validate(
            "# Netscape HTTP Cookie File\n"
            "malformed SECRET record\n"
            ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tACCEPTED\n"
        )
        self.assertEqual(result, {"valid": True, "warnings": True})
        normalized = self.snapshot.read_text()
        self.assertNotIn("malformed", normalized)
        self.assertIn("SID\tACCEPTED", normalized)

    def test_rejects_json_without_exposing_cookie_values(self):
        self.assertEqual(self.validate('[{"value":"SECRET"}]'), {"valid": False, "error": "invalid"})

    def test_rejects_header_only_and_all_skipped_records(self):
        for contents in ["# Netscape HTTP Cookie File\n", "# Netscape HTTP Cookie File\nmalformed SECRET\n"]:
            with self.subTest(contents=contents):
                self.assertEqual(self.validate(contents), {"valid": False, "error": "empty"})

    def test_rejects_parser_errors_without_leaking_records_or_tracebacks(self):
        result = self.validate(
            "# Netscape HTTP Cookie File\n"
            ".youtube.com\tFALSE\t/\tTRUE\t0\tSID\tSECRET\n"
        )
        self.assertEqual(result, {"valid": False, "error": "invalid"})


if __name__ == "__main__":
    unittest.main()

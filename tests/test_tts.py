from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import tts
from backend.app import app


class NarrationApiTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_missing_model_reports_setup(self):
        with patch.object(tts, "available", return_value=False):
            self.assertFalse(self.client.get("/api/tts").json()["available"])
            self.assertEqual(self.client.post("/api/tts", json={"text": "Hello"}).status_code, 503)

    def test_valid_request_returns_uncached_wav(self):
        audio = b"RIFF\x00\x00\x00\x00WAVE"
        with patch.object(tts, "available", return_value=True), patch.object(tts, "synthesize", return_value=audio) as synthesize:
            response = self.client.post("/api/tts", json={"text": " Hello ", "voice": "bf_emma", "speed": .9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(response.content, audio)
        synthesize.assert_called_once_with(tts.NarrationRequest(text="Hello", voice="bf_emma", speed=.9))

    def test_invalid_requests_do_not_invoke_model(self):
        with patch.object(tts, "synthesize") as synthesize:
            for payload in ({"text": "..."}, {"text": "a" * 1001},
                            {"text": "hi", "voice": "unknown"}, {"text": "hi", "speed": 3}):
                with self.subTest(payload=payload):
                    self.assertEqual(self.client.post("/api/tts", json=payload).status_code, 422)
        synthesize.assert_not_called()

    def test_busy_engine_and_failed_generation(self):
        with patch.object(tts, "available", return_value=True):
            with tts._generation_lock:
                self.assertEqual(self.client.post("/api/tts", json={"text": "hi"}).status_code, 429)
            with patch.object(tts, "synthesize", side_effect=RuntimeError("private engine error")):
                response = self.client.post("/api/tts", json={"text": "hi"})
                self.assertEqual(response.status_code, 500)
                self.assertNotIn("private engine error", response.text)
            with patch.object(tts, "synthesize", return_value=b"RIFF"):
                self.assertEqual(self.client.post("/api/tts", json={"text": "hi"}).status_code, 200)

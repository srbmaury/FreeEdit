import importlib.util
import io
import wave
from unittest import TestCase, skipUnless
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend.media import tts
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


class NarrationTimingTests(TestCase):
    def test_common_sentence_fits_one_inference(self):
        sentence = "Imagine sailing from the Black Sea to the Mediterranean."
        self.assertEqual(list(tts.sentence_chunks(sentence)), [sentence])

    def test_join_pause_counts_existing_silence(self):
        self.assertEqual(tts._join_pause(300, 200, 1000, 0.22), (190, 90, 0))
        self.assertEqual(tts._join_pause(35, 30, 1000, 0.22), (0, 0, 155))
        self.assertEqual(tts._join_pause(5, 300, 1000, 0.06), (0, 245, 0))

    @skipUnless(importlib.util.find_spec("numpy"), "optional narration dependency")
    def test_join_removes_model_padding_without_cutting_speech(self):
        import numpy as np

        first = np.r_[np.zeros(80), np.full(100, 0.25), np.zeros(300)]
        second = np.r_[np.zeros(200), np.full(150, -0.25), np.zeros(90)]
        engine = Mock()
        engine.create.side_effect = [(first, 1000), (second, 1000)]

        with patch.object(tts, "_engine", engine):
            output = tts.synthesize(tts.NarrationRequest(text="First. Second."))

        with wave.open(io.BytesIO(output)) as wav:
            pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        self.assertEqual(np.flatnonzero(pcm > 0).tolist(), list(range(80, 180)))
        self.assertEqual(np.flatnonzero(pcm < 0).tolist(), list(range(400, 550)))
        self.assertEqual(len(pcm), 640)

    @skipUnless(importlib.util.find_spec("numpy"), "optional narration dependency")
    def test_soft_breaks_and_sentence_breaks_use_different_pause_targets(self):
        import numpy as np

        clip = np.full(100, 0.25)
        engine = Mock()
        engine.create.return_value = (clip, 1000)
        script = "This is a full first clause, followed by a longer ending. Next."
        with patch.object(tts, "_engine", engine), patch.object(tts, "MAX_CHUNK_CHARS", 45):
            output = tts.synthesize(tts.NarrationRequest(text=script))
        with wave.open(io.BytesIO(output)) as wav:
            self.assertEqual(wav.getnframes(), 3 * 100 + 110 + 220)

"""Streaming envelope tests: fragmented reads, sample edges and bounded storage."""
import io
import struct
import unittest
from backend.waveform import pcm_peaks


class Fragmented(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 3))


class WaveformTests(unittest.TestCase):
    def test_fragmented_samples_and_partial_bins(self):
        raw = struct.pack('<7h', 0, -32768, 100, 200, -16000, 10, 20)
        self.assertEqual(pcm_peaks(Fragmented(raw), 1, rate=7, bins=3), [1, .4883, .0006])

    def test_short_audio_preserves_source_time_axis(self):
        self.assertEqual(pcm_peaks(io.BytesIO(struct.pack('<2h', 2, 4)), 4, rate=2, bins=4), [1, 0, 0, 0])

    def test_silent_audio(self):
        self.assertEqual(pcm_peaks(io.BytesIO(bytes(16)), 1, rate=8, bins=4), [0] * 4)

    def test_reads_remain_bounded(self):
        class Checked(io.BytesIO):
            def read(self, size=-1):
                self_check.assertLessEqual(size, 65536)
                return super().read(size)
        self_check = self
        self.assertEqual(len(pcm_peaks(Checked(bytes(200000)), 100000, bins=4096)), 4096)


if __name__ == '__main__':
    unittest.main()

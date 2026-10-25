"""Bounded PCM envelope reduction, independent of media duration and storage."""
import array
import math
import sys


def pcm_peaks(stream, duration: float, rate: int = 8000, bins: int = 4096) -> list[float]:
    """Consume little-endian mono PCM in at most 64 KiB blocks.

    Read boundaries need not align with samples or bins. Keep only one peak
    per bin; never spool a recording's decoded audio to a temporary file.
    """
    if not math.isfinite(duration) or duration <= 0 or bins <= 0 or rate <= 0:
        raise ValueError("Invalid waveform dimensions")
    per_bin = max(1, math.ceil(duration * rate / bins))
    expected_bins = math.ceil(duration * rate / per_bin)
    peaks = []
    pending = b""
    count = peak = 0
    while len(peaks) < expected_bins:
        chunk = stream.read(65536)
        if not chunk:
            break
        chunk = pending + chunk
        pending = chunk[-1:] if len(chunk) % 2 else b""
        samples = array.array("h")
        samples.frombytes(chunk[:len(chunk) - len(pending)])
        if sys.byteorder != "little":
            samples.byteswap()
        for value in samples:
            peak = max(peak, abs(value))
            count += 1
            if count == per_bin:
                peaks.append(peak)
                count = peak = 0
                if len(peaks) == expected_bins:
                    break
    if count and len(peaks) < expected_bins:
        peaks.append(peak)
    # Preserve the source-time axis when a damaged/short audio stream ends early.
    peaks.extend([0] * (expected_bins - len(peaks)))
    maximum = max(peaks, default=0) or 1
    return [round(value / maximum, 4) for value in peaks]

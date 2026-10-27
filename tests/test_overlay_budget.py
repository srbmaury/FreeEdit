"""Compressed PNG size must not bypass aggregate decoded-image admission."""
import base64
import struct
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from backend import models


def png(width, height):
    # Only a header is needed to exercise admission; rendering tests use real PNGs.
    raw = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)
    return "data:image/png;base64," + base64.b64encode(raw).decode()


class OverlayBudgetTests(unittest.TestCase):
    def test_combined_text_annotations_and_background_share_one_budget(self):
        text = {"type": "text", "start": 0, "end": 1, "x": 0, "y": 0, "image": png(100, 100)}
        annotation = {**text, "type": "annotation"}
        with patch.object(models, "MAX_OVERLAY_PIXELS", 20_000):
            models.ProcessRequest(edits=[text, annotation])
            with self.assertRaisesRegex(ValidationError, "total pixel budget"):
                models.ProcessRequest(edits=[text, annotation],
                                      background={"mode": "image", "image": png(1, 1)})

    def test_repeated_small_payloads_cannot_expand_past_the_budget(self):
        edit = {"type": "text", "start": 0, "end": 1, "x": 0, "y": 0, "image": png(2000, 2000)}
        self.assertLess(len(edit["image"]), 100)
        with patch.object(models, "MAX_OVERLAY_PIXELS", 16_000_000):
            models.ProcessRequest(edits=[edit] * 4)
            with self.assertRaisesRegex(ValidationError, "total pixel budget"):
                models.ProcessRequest(edits=[edit] * 5)

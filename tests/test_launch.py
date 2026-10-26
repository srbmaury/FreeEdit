"""Startup checks must explain conflicts without disturbing other listeners."""
import argparse
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from backend.launch import available_port, check_port
from backend.runtime_info import source_info


class LaunchTests(unittest.TestCase):
    def test_validates_port_before_launch(self):
        for value in ('abc', '0', '65536', '-1'):
            with self.assertRaises(argparse.ArgumentTypeError):
                available_port(value)
        self.assertEqual(available_port('8029'), 8029)

    def test_occupied_port_explains_alternative_and_preserves_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'PORT='):
                check_port(port)
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass

    def test_source_identity_changes_with_code_and_works_without_git(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'frontend').mkdir()
            code = root/'frontend'/'app.js'
            code.write_text('first')
            with patch('backend.runtime_info.subprocess.run', side_effect=FileNotFoundError):
                first = source_info(root)
                self.assertIsNone(first['revision'])
                self.assertEqual(first, source_info(root))
                code.write_text('second')
                self.assertNotEqual(first['source_id'], source_info(root)['source_id'])
                self.assertNotIn(str(root), str(first))

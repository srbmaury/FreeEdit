"""Cancellation shared by the job worker and its child processes."""

import os
import signal
import subprocess
import threading
from contextlib import contextmanager

local = threading.local()


class Cancelled(Exception):
    pass


class JobControl:
    def __init__(self):
        self.cancelled = threading.Event()
        self.lock = threading.Lock()
        self.processes = []

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled()

    def attach(self, process):
        with self.lock:
            self.processes.append(process)
            if self.cancelled.is_set() and process.poll() is None:
                kill_process(process)

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            for process in self.processes:
                if process.poll() is None:
                    kill_process(process)


@contextmanager
def cancellation_scope(control):
    local.control = control
    try:
        control.check()
        yield
        control.check()
    finally:
        del local.control


def check_cancelled():
    control = getattr(local, 'control', None)
    if control:
        control.check()


def kill_process(process):
    try:
        if os.name == "posix" and os.getpgid(process.pid) == process.pid:
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass


def start_process(*args, **kwargs):
    check_cancelled()
    if os.name == "posix":
        kwargs.setdefault("start_new_session", True)
    process = subprocess.Popen(*args, **kwargs)
    control = getattr(local, 'control', None)
    if control:
        control.attach(process)
    return process


def run_process(args, *, capture_output=False, timeout=None, **kwargs):
    if capture_output:
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    process = start_process(args, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException:
        kill_process(process)
        process.communicate()
        check_cancelled()
        raise
    check_cancelled()
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)

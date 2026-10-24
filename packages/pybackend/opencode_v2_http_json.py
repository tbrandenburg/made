"""Bound synchronous JSON decode work before calling the stdlib decoder.

Per response: <=100,000 structural punctuation bytes, depth <=64, primitive
tokens <=128 bytes. Quoted text has no separate size cap: the HTTP operation's
32MiB byte budget applies. Check/yield to the operation deadline between 1KiB
lexical batches, independently of network chunk size. json.loads is not preemptible;
these limits bound its remaining work, not a hard real-time CPU deadline.
"""

import asyncio
from collections.abc import Callable
import re

MAX_JSON_STRUCTURES = 100_000
MAX_JSON_DEPTH = 64
MAX_JSON_ATOM_BYTES = 128
SCAN_BYTES = 1024
_STRING_SPECIAL = re.compile(rb'["\\]')


class JsonComplexityError(ValueError):
    """The response exceeds the deliberately supported JSON complexity."""


class JsonBudget:
    """A lexical work preflight, not a replacement JSON syntax validator."""

    def __init__(self) -> None:
        self.quoted = False
        self.escaped = False
        self.structures = 0
        self.depth = 0
        self.atom = 0

    def _quoted_end(self, chunk: bytes, position: int) -> int:
        if self.escaped:
            self.escaped = False
            return position + 1
        # C-backed linear search, bounded by one lexical batch. Huge tool text
        # must not incur a Python operation (or coverage probe) for every byte.
        special = _STRING_SPECIAL.search(chunk, position)
        if special is None:
            return len(chunk)
        self.escaped = chunk[special.start()] == 92
        self.quoted = self.escaped
        return special.end()

    def _structure(self, value: int) -> None:
        self.atom = 0
        self.structures += 1
        self.depth += 1 if value in b"[{" else -1 if value in b"]}" else 0
        if self.structures > MAX_JSON_STRUCTURES or self.depth > MAX_JSON_DEPTH:
            raise JsonComplexityError(
                "OpenCode history exceeded its JSON complexity limit"
            )

    async def feed(self, chunk: bytes, checkpoint: Callable[[], object]) -> None:
        # A network chunk can take longer than the deadline under tracing.
        for position in range(0, len(chunk), SCAN_BYTES):
            checkpoint()
            self._feed(chunk[position : position + SCAN_BYTES])
            await asyncio.sleep(0)
        checkpoint()

    def _feed(self, chunk: bytes) -> None:
        position = 0
        while position < len(chunk):
            if self.quoted:
                position = self._quoted_end(chunk, position)
                continue
            value = chunk[position]
            position += 1
            if value == 34:
                self.quoted = True
                self.atom = 0
                continue
            if value in b"{}[],: \t\r\n":
                if value in b"{}[],:":
                    self._structure(value)
                self.atom = 0
                continue
            self.atom += 1
            if self.atom > MAX_JSON_ATOM_BYTES:
                raise JsonComplexityError(
                    "OpenCode history exceeded its JSON token limit"
                )

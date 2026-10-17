"""Owned, authenticated loopback service for public V2 history tests."""

import base64
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
import socket
from urllib.parse import urlsplit


@dataclass
class Reply:
    body: object = field(default_factory=dict)
    status: int = 200
    headers: dict[str, str] = field(default_factory=dict)
    delay: float = 0
    trickle: float = 0
    disconnect: bool = False


@dataclass
class Service:
    directory: Path
    requests: list[str] = field(default_factory=list)
    authenticated: list[bool] = field(default_factory=list)
    password: str = "synthetic-history-password"
    url: str = ""
    respond: Callable[[str, int], Reply] | None = None

    def register(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"url": self.url, "password": self.password}))

    def reply(self, path: str) -> Reply:
        if self.respond:
            return self.respond(path, len(self.requests))
        identifier = urlsplit(path).path.split("/")[-1]
        if identifier == "message":
            return Reply({"data": [], "cursor": {"previous": None, "next": None}})
        return Reply(
            {
                "data": {
                    "id": identifier,
                    "location": {"directory": str(self.directory.resolve())},
                }
            }
        )


@contextmanager
def serve(
    directory: Path, password: str = "synthetic-history-password"
) -> Iterator[Service]:
    service = Service(directory, password=password)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            service.requests.append(self.path)
            expected = (
                "Basic "
                + base64.b64encode(f"opencode:{service.password}".encode()).decode()
            )
            authenticated = self.headers.get("Authorization") == expected
            service.authenticated.append(authenticated)
            reply = service.reply(self.path) if authenticated else Reply({}, 401)
            if reply.disconnect:
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            time.sleep(reply.delay)
            body = (
                reply.body
                if isinstance(reply.body, bytes)
                else json.dumps(reply.body).encode()
            )
            try:
                self.send_response(reply.status)
                self.send_header("Content-Length", str(len(body)))
                for name, value in reply.headers.items():
                    self.send_header(name, value)
                self.end_headers()
                if reply.trickle:
                    for byte in body:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        time.sleep(reply.trickle)
                    return
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                return  # Deadline tests intentionally disconnect owned clients.

        def log_message(self, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    service.url = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield service
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

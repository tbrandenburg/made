"""Exercise readiness against an actual listener, including startup TCP reset."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket
import struct
from threading import Thread

from run import ready


def test_readiness_survives_reset_before_healthy_response() -> None:
    requests: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            requests.append(self.path)
            if len(requests) == 1:
                self.connection.setsockopt(
                    socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0)
                )
                self.close_connection = True
                return
            self.send_response(200)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        ready(f"http://127.0.0.1:{server.server_port}/readiness")
        assert len(requests) == 2
        assert requests == ["/readiness", "/readiness"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert not thread.is_alive()

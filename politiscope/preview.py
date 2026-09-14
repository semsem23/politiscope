"""Aperçu local de l'artifact — l'équivalent d'un `npm run dev` pour ce projet.

L'artifact est un unique fichier HTML autonome : il n'y a ni build, ni bundler,
ni dépendance à installer. Ce serveur existe seulement parce que certaines
fonctionnalités (polices Google, module d3 depuis le CDN) se comportent mieux
servies en http:// qu'ouvertes en file://.
"""
from __future__ import annotations

import http.server
import socketserver
import threading
import webbrowser
from functools import partial
from pathlib import Path

from .config import settings


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Journal compact : une ligne par requête, sans le bruit habituel."""

    def log_message(self, fmt, *args):  # noqa: A003
        code = args[1] if len(args) > 1 else "?"
        print(f"  {code}  {self.path}")

    def end_headers(self):
        # Empêche le navigateur de servir une version périmée après republication.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def serve(port: int = 8000, open_browser: bool = True) -> int:
    artifact = settings.artifact_file
    if not artifact.exists():
        raise SystemExit(f"Artifact introuvable : {artifact}")

    handler = partial(_QuietHandler, directory=str(artifact.parent))
    socketserver.TCPServer.allow_reuse_address = True

    try:
        httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    except OSError as e:
        raise SystemExit(f"Port {port} indisponible ({e}). Essayez --port {port + 1}.")

    url = f"http://127.0.0.1:{port}/{artifact.name}"
    size = artifact.stat().st_size / 1024
    print(f"Politiscope — aperçu local")
    print(f"  fichier  {artifact.name} ({size:.0f} Ko, autonome)")
    print(f"  adresse  {url}")
    print(f"  arrêt    Ctrl+C\n")

    if open_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\narrêté")
    finally:
        httpd.server_close()
    return 0

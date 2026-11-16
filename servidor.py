#!/usr/bin/env python3
"""
Servidor Autónomo para Meteo Diário Pro (PWA)
Porta: 8105 (independente de todos os outros serviços).
"""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

DIR_WEB = Path(__file__).resolve().parent
PORTA = 8105


class ManipuladorMeteo(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR_WEB), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(DIR_WEB)
    servidor = HTTPServer(("0.0.0.0", PORTA), ManipuladorMeteo)
    print(f"[*] Meteo Diário Pro ativo em http://0.0.0.0:{PORTA}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Servidor terminado.")
        sys.exit(0)

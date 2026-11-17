"""TO:R Save Editor: a small local server for editing Tactics Ogre: Reborn saves.

    python serve_saves.py [--saves "<folder with GAME-*.SAV>"] [--data "<game Data folder>"] [--port 8650]

The page is served from save-editor/web. Names, classes and items come from the
game's own data files (read only), decoded in the browser by the TO:R Editor's
modules bundled with this package. Saves are only written on request, after:
  - the game is confirmed closed,
  - the file on disk is checked to be the one that was loaded,
  - a copy of the file is kept in save-editor/backups/<time>/,
  - the rebuilt file is decoded again and compared with what was asked for.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import socket
import struct
import subprocess
import sys
import tempfile
import time
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from savecodec import MAIN_TAG, SUMMARY_TAG, SaveFile, SaveFormatError  # noqa: E402

ROOT = HERE.parent
EDITOR_WEB = HERE / "web"
API_HEADER = "X-TOR-Editor"
SAVE_NAME = re.compile(r"^GAME-\d{8}\.SAV$", re.I)
# Ports the TO:R Editor uses; never share them.
EDITOR_PORTS = {8642, 8643, 8644, 8645}

# Main-payload facts used for the save list (the page does the full decode).
UNIT_START, UNIT_SIZE, UNIT_SLOTS = 0xC6, 0x7B5, 105
GOTH = 0x50
SUMMARY_NAME, SUMMARY_NAME_SIZE = 0x1BD, 37


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def default_saves_dir() -> Path | None:
    base = Path.home() / "Documents" / "My Games" / "Tactics Ogre Reborn"
    if not base.is_dir():
        return None
    found = sorted(base.glob("*/*/GAME-*.SAV"), key=lambda p: p.stat().st_mtime, reverse=True)
    return found[0].parent if found else None


def game_running() -> bool:
    if os.name != "nt":
        return False
    command = "$ErrorActionPreference='Stop'; @(Get-Process | Where-Object ProcessName -eq 'Tactics Ogre Reborn').Count"
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, text=True, check=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return int(result.stdout.strip()) > 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise PermissionError("Could not check whether Tactics Ogre: Reborn is running.") from exc


def atomic_write(path: Path, data: bytes) -> None:
    handle, temporary = tempfile.mkstemp(prefix=".tor-save-editor-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def summarize(path: Path) -> dict:
    info = {"name": path.name, "size": path.stat().st_size,
            "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
            "slot": int(re.search(r"\d{8}", path.name).group())}
    try:
        save = SaveFile(path.read_bytes())
        main = save.payload(MAIN_TAG)
        units = [main[UNIT_START + i * UNIT_SIZE] for i in range(UNIT_SLOTS)
                 if UNIT_START + (i + 1) * UNIT_SIZE <= len(main)]
        leader = main[UNIT_START + 1:UNIT_START + 38].split(b"\0")[0].decode("utf-8", "replace")
        info.update(ok=True, version=main[:4].hex(), mainSize=len(main), units=sum(1 for u in units if u),
                    goth=struct.unpack_from("<I", main, GOTH)[0], leader=leader)
    except (SaveFormatError, OSError, IndexError, struct.error) as e:
        info.update(ok=False, error=str(e))
    return info


class Config:
    def __init__(self, saves: Path, data: Path, backups: Path):
        self.saves, self.data, self.backups = saves, data, backups

    def save_path(self, name: str) -> Path:
        if not SAVE_NAME.match(name or ""):
            raise PermissionError("not a game save file name")
        return self.saves / name

    def data_path(self, rel: str) -> Path:
        rel = unquote(rel).replace("\\", "/").lstrip("/")
        path = (self.data / rel).resolve()
        if self.data.resolve() not in path.parents and path != self.data.resolve():
            raise PermissionError("path escapes the data folder")
        return path


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128  # the page loads many modules at once; a backlog of 5 resets some


class Handler(SimpleHTTPRequestHandler):
    config: Config
    protocol_version = "HTTP/1.1"  # keep-alive for the many small module reads

    def log_message(self, fmt, *args):  # keep the console quiet except errors
        if args and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers -------------------------------------------------------
    def _query(self) -> dict:
        return {k: v[-1] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _json(self, value, status=HTTPStatus.OK):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json({"error": message}, status)

    def _bytes(self, data: bytes, extra: dict | None = None):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _static(self, path: Path):
        if not path.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        data = path.read_bytes()
        kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix == ".js":
            kind = "text/javascript"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @staticmethod
    def _inside(base: Path, rel: str) -> Path | None:
        path = (base / unquote(rel)).resolve()
        return path if base.resolve() in path.parents else None

    # ---- routing -------------------------------------------------------
    def do_GET(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/"):
            if route in ("/", "/index.html"):
                return self._static(HERE / "web" / "index.html")
            for prefix, base in (("/js/", EDITOR_WEB / "js"), ("/data/", EDITOR_WEB / "data"),
                                 ("/app/", HERE / "web" / "app")):
                if route.startswith(prefix):
                    path = self._inside(base, route[len(prefix):])
                    return self._static(path) if path else self._error(HTTPStatus.FORBIDDEN, "bad path")
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        if self.headers.get(API_HEADER) != "1":
            return self._error(HTTPStatus.FORBIDDEN, "missing editor header")
        try:
            if route == "/api/info":
                # the subset of the TO:R Editor's /api/info that its table loader reads
                return self._json({"dataRoot": str(self.config.data), "readOnly": True, "customCharacters": [],
                                   "specialClassChangeEnabled": False, "levelCap99Enabled": False,
                                   "trapAiProfile": 0, "savesRoot": str(self.config.saves)})
            if route == "/api/file":
                path = self.config.data_path(self._query().get("path", ""))
                data = path.read_bytes()
                limit = int(self._query().get("max", len(data)))
                return self._bytes(data[:limit], {"X-File-Size": str(len(data))})
            if route == "/api/saves":
                files = sorted((p for p in self.config.saves.glob("GAME-*.SAV") if SAVE_NAME.match(p.name)),
                               key=lambda p: p.name)
                return self._json({"folder": str(self.config.saves), "gameRunning": game_running(),
                                   "saves": [summarize(p) for p in files]})
            if route == "/api/save":
                path = self.config.save_path(self._query().get("name", ""))
                raw = path.read_bytes()
                save = SaveFile(raw)
                return self._bytes(save.payload(MAIN_TAG), {"X-Save-Sha256": sha256(raw)})
            if route == "/api/backups":
                return self._json({"folder": str(self.config.backups), "backups": self._backups()})
            return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except PermissionError as e:
            return self._error(HTTPStatus.FORBIDDEN, str(e))
        except FileNotFoundError:
            return self._error(HTTPStatus.NOT_FOUND, "file not found")
        except SaveFormatError as e:
            return self._error(HTTPStatus.UNPROCESSABLE_ENTITY, str(e))

    def do_POST(self):
        route = urlparse(self.path).path
        if self.headers.get(API_HEADER) != "1":
            return self._error(HTTPStatus.FORBIDDEN, "missing editor header")
        try:
            if route == "/api/save":
                return self._write_save()
            return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except PermissionError as e:
            return self._error(HTTPStatus.FORBIDDEN, str(e))
        except FileNotFoundError:
            return self._error(HTTPStatus.NOT_FOUND, "file not found")
        except SaveFormatError as e:
            return self._error(HTTPStatus.UNPROCESSABLE_ENTITY, str(e))

    # ---- writing -------------------------------------------------------
    def _write_save(self):
        """Body: JSON {main: base64 payload, expectSha256, leaderName?}."""
        q = self._query()
        source = self.config.save_path(q.get("name", ""))
        target = self.config.save_path(q.get("target") or q.get("name", ""))
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length))
        main = base64.b64decode(body["main"])
        if game_running():
            return self._error(HTTPStatus.CONFLICT, "Close Tactics Ogre: Reborn before saving. The game keeps "
                                                    "its own copy and would overwrite or ignore the edit.")
        raw = source.read_bytes()
        if sha256(raw) != body.get("expectSha256"):
            return self._error(HTTPStatus.CONFLICT, f"{source.name} changed on disk since it was opened "
                                                    "(the game saved again?). Reload it before saving.")
        save = SaveFile(raw)
        replacements = {MAIN_TAG: main}
        leader = body.get("leaderName")
        if leader is not None and SUMMARY_TAG in save.blocks:
            summary = bytearray(save.payload(SUMMARY_TAG))
            if len(summary) >= SUMMARY_NAME + SUMMARY_NAME_SIZE:
                encoded = leader.encode("utf-8")[:SUMMARY_NAME_SIZE - 1]
                summary[SUMMARY_NAME:SUMMARY_NAME + SUMMARY_NAME_SIZE] = encoded.ljust(SUMMARY_NAME_SIZE, b"\0")
                replacements[SUMMARY_TAG] = bytes(summary)
        rebuilt = save.rebuild(replacements)
        if rebuilt == raw and target == source:
            return self._json({"written": False, "message": "No changes to save."})
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        folder = self.config.backups / stamp
        folder.mkdir(parents=True, exist_ok=True)
        backed = []
        for path in {source, target}:
            if path.exists():
                data = path.read_bytes()
                (folder / path.name).write_bytes(data)
                if (folder / path.name).read_bytes() != data:
                    return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "Backup could not be verified; nothing written.")
                backed.append(path.name)
        (folder / "backup.json").write_text(json.dumps({
            "time": stamp, "savesFolder": str(self.config.saves), "files": backed,
            "editedFrom": source.name, "writtenTo": target.name}, indent=2), encoding="utf-8")
        before_target = target.read_bytes() if target.exists() else None
        try:
            atomic_write(target, rebuilt)
            check = SaveFile(target.read_bytes())
            if check.payload(MAIN_TAG) != main:
                raise SaveFormatError("written file did not read back the same")
        except BaseException:
            if before_target is not None:
                atomic_write(target, before_target)
            raise
        written = target.read_bytes()
        return self._json({"written": True, "target": target.name, "backup": str(folder),
                           "sha256": sha256(written), "message": f"Saved {target.name}. Backup: {folder}"})

    def _backups(self):
        out = []
        if self.config.backups.is_dir():
            for d in sorted(self.config.backups.iterdir(), reverse=True):
                meta = d / "backup.json"
                if meta.is_file():
                    out.append(json.loads(meta.read_text(encoding="utf-8")) | {"folder": str(d)})
        return out


def free_port(preferred: int) -> int:
    port = preferred
    while True:
        if port not in EDITOR_PORTS:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(("127.0.0.1", port)) != 0:
                    return port
        port += 1


def main():
    parser = argparse.ArgumentParser(description="TO:R Save Editor")
    parser.add_argument("--saves", type=Path, help="folder holding GAME-*.SAV (default: your Documents save folder)")
    parser.add_argument("--data", type=Path, help="the game's Data folder, for names and art")
    parser.add_argument("--backups", type=Path, default=HERE / "backups")
    parser.add_argument("--port", type=int, default=8650)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    saves = args.saves or default_saves_dir()
    if not saves or not saves.is_dir():
        sys.exit("No save folder found. Pass --saves \"<folder with GAME-*.SAV>\".")
    candidates = [args.data] if args.data is not None else [ROOT / "Data", ROOT / "Tactics Ogre Reborn" / "Data"]
    data = next((path for path in candidates if (path / "FileTable.bin").is_file()), None)
    if data is None:
        sys.exit('Could not find the game Data folder. Place the save-editor folder beside Data or use --data.')
    Handler.config = Config(saves.resolve(), data.resolve(), args.backups.resolve())
    port = free_port(args.port)
    server = Server(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"TO:R Save Editor: {url}\n  saves: {saves}\n  data:  {data}\n  backups: {args.backups}")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the card-image index from Scryfall Oracle bulk data.

The index is the name-and-token keyed artwork table shipped by both the product
server and the browser asset build. It is regenerated when Scryfall publishes a
set whose cards are not yet indexed; see
[docs/specs/browser-local-card-images.md](../docs/specs/browser-local-card-images.md).
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import io
import json
import os
import sqlite3
import tempfile
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator

BULK_METADATA_URL = "https://api.scryfall.com/bulk-data/oracle-cards"
CDN_PREFIX = "https://cards.scryfall.io/"
REQUEST_HEADERS = {
    "Accept": "application/json;q=0.9,*/*;q=0.8",
    "User-Agent": "forge-web-card-images/1.0 (https://forgeweb.app)",
}


def fetch_json(url: str) -> object:
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def fetch_jsonl_gzip(url: str) -> Iterator[object]:
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(request) as response:
        with gzip.GzipFile(fileobj=response) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8") as lines:
                for line in lines:
                    if line.strip():
                        yield json.loads(line)


def normal_image_url(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    normal = value.get("normal")
    return normal if isinstance(normal, str) else None


def candidate_rows(card: dict[str, object]) -> list[tuple[str, int, str, str | None, str, str]]:
    """Name-and-token keyed artwork rows for one Oracle card, faces included."""
    name = card.get("name")
    if not isinstance(name, str):
        return []

    layout = str(card.get("layout", ""))
    token = int(layout == "token" or layout.endswith("_token"))
    source_id = str(card.get("id", ""))
    released_at = str(card.get("released_at", ""))
    normal = normal_image_url(card.get("image_uris"))
    rows = [(name, token, normal, None, source_id, released_at)] if normal else []

    faces = card.get("card_faces")
    if isinstance(faces, list):
        face_rows: list[tuple[str, str, bool]] = []
        for face in faces:
            if not isinstance(face, dict) or not isinstance(face.get("name"), str):
                continue
            face_normal = normal_image_url(face.get("image_uris"))
            if face_normal or normal:
                face_rows.append((face["name"], face_normal or normal, face_normal is not None))
        if face_rows:
            back = face_rows[1][1] if len(face_rows) > 1 and face_rows[1][2] else None
            rows.extend(
                (face_name, token, face_normal, back if index == 0 else None, source_id, released_at)
                for index, (face_name, face_normal, _has_own_image) in enumerate(face_rows)
            )
            if not normal:
                rows.append((name, token, face_rows[0][1], back, source_id, released_at))
    return rows


def build_index(cards: Iterable[object], output: Path, source_uri: str, source_updated_at: str) -> int:
    """Write the index to [output] and return its artwork identity count."""
    selected: dict[tuple[str, int], tuple[str, str | None, str, str]] = {}
    for value in cards:
        if not isinstance(value, dict):
            continue
        for name, token, normal, back, source_id, released_at in candidate_rows(value):
            key = (name.strip().lower(), token)
            candidate = (normal, back, source_id, released_at)
            previous = selected.get(key)
            # Newest printing wins so a name maps to its current illustration.
            if previous is None or (released_at, source_id) > (previous[3], previous[2]):
                selected[key] = candidate

    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(temporary) as database:
            database.executescript(
                """
                PRAGMA journal_mode = OFF;
                PRAGMA synchronous = OFF;
                CREATE TABLE metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                ) WITHOUT ROWID;
                CREATE TABLE card_images (
                    lookup_name TEXT NOT NULL,
                    is_token INTEGER NOT NULL CHECK (is_token IN (0, 1)),
                    normal_url TEXT NOT NULL,
                    back_url TEXT,
                    PRIMARY KEY (lookup_name, is_token)
                ) WITHOUT ROWID;
                """,
            )
            database.executemany(
                "INSERT INTO metadata(key, value) VALUES (?, ?)",
                [
                    ("schema_version", "1"),
                    ("source_uri", source_uri),
                    ("source_updated_at", source_updated_at),
                    ("generated_at", dt.datetime.now(dt.UTC).isoformat()),
                ],
            )
            database.executemany(
                """
                INSERT INTO card_images(
                    lookup_name, is_token, normal_url, back_url
                ) VALUES (?, ?, ?, ?)
                """,
                [
                    (lookup_name, token, normal, back)
                    for (lookup_name, token), (normal, back, _source_id, _released_at) in selected.items()
                ],
            )
            database.execute("ANALYZE")
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    return len(selected)


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=repo / "server/src/main/resources/card-images.sqlite",
    )
    parser.add_argument("--input-json", type=Path, help="Reuse an Oracle bulk JSON file instead of downloading it")
    args = parser.parse_args()

    if args.input_json:
        with args.input_json.open(encoding="utf-8") as source:
            cards = json.load(source)
        source_uri = str(args.input_json)
        source_updated_at = dt.datetime.fromtimestamp(args.input_json.stat().st_mtime, dt.UTC).isoformat()
    else:
        metadata = fetch_json(BULK_METADATA_URL)
        if not isinstance(metadata, dict) or not isinstance(metadata.get("jsonl_download_uri"), str):
            raise RuntimeError("Scryfall bulk metadata did not contain jsonl_download_uri")
        source_uri = metadata["jsonl_download_uri"]
        cards = fetch_jsonl_gzip(source_uri)
        source_updated_at = str(metadata.get("updated_at", ""))

    count = build_index(cards, args.output, source_uri, source_updated_at)
    print(f"Wrote {count} image identities to {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the deterministic Forge resource archive used by the browser engine."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import sqlite3
import subprocess
import zipfile
from pathlib import Path
from typing import Iterable


# Arena prefixes a rebalanced card's name with this marker; Scryfall publishes no
# printing under the prefixed name.
REBALANCED_NAME_PREFIX = "A-"

RESOURCE_FILES = (
    "formats/Sanctioned/Standard.txt",
    "formats/Sanctioned/Pioneer.txt",
    "formats/Sanctioned/Modern.txt",
    "formats/Casual/Commander.txt",
    "formats/Casual/Oathbreaker.txt",
    "formats/Casual/Brawl.txt",
    "lists/TypeLists.txt",
    "lists/NonStackingKWList.txt",
    "languages/en-US.properties",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def zip_bytes(entries: list[tuple[str, bytes]]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def git_revision(path: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()


def rebalanced_card_names(card_source: bytes) -> set[str]:
    name_prefix = b"Name:"
    rebalanced_prefix = name_prefix + REBALANCED_NAME_PREFIX.encode()
    return {
        line[len(name_prefix) :].decode("utf-8", errors="ignore").strip()
        for line in card_source.splitlines()
        if line.startswith(rebalanced_prefix)
    }


def card_entries(cards_root: Path) -> tuple[list[tuple[str, bytes]], set[str]]:
    entries: list[tuple[str, bytes]] = []
    rebalanced: set[str] = set()
    for path in sorted(cards_root.rglob("*.txt")):
        data = path.read_bytes()
        entries.append((path.relative_to(cards_root).as_posix(), data))
        rebalanced.update(rebalanced_card_names(data))
    return entries, rebalanced


def write_image_index(source: Path, output: Path, rebalanced_names: Iterable[str] = ()) -> None:
    with sqlite3.connect(source) as database:
        schema = database.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone()
        if schema != ("1",):
            raise ValueError("Unsupported card image index schema")
        images = {
            f"{token}:{name}": [normal, back]
            for name, token, normal, back in database.execute(
                "SELECT lookup_name, is_token, normal_url, back_url FROM card_images"
            )
        }
    # A rebalanced name has no printing of its own. The browser engine composes the
    # face from engine metadata, so the original illustration is safe to borrow;
    # an existing entry under the prefixed name always wins.
    for rebalanced in rebalanced_names:
        source = (
            rebalanced[len(REBALANCED_NAME_PREFIX) :]
            if rebalanced.startswith(REBALANCED_NAME_PREFIX)
            else rebalanced
        )
        source_name = source.strip().lower()
        alias = rebalanced.strip().lower()
        for token in ("0", "1"):
            original = images.get(f"{token}:{source_name}")
            if original is not None:
                images.setdefault(f"{token}:{alias}", original)
    payload = json.dumps(images, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    write_atomic(output, gzip.compress(payload, mtime=0))


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--forge-res", type=Path, default=repo / "leyline/forge/forge-gui/res")
    parser.add_argument("--output", type=Path, default=repo / "public/browser-engine/catalog")
    args = parser.parse_args()

    forge_res = args.forge_res.resolve()
    cards_root = forge_res / "cardsfolder"
    card_files, rebalanced = card_entries(cards_root)
    card_archive = zip_bytes(card_files)

    entries: list[tuple[str, bytes]] = [("res/cardsfolder/cardsfolder.zip", card_archive)]
    entries.extend((f"res/{name}", (forge_res / name).read_bytes()) for name in RESOURCE_FILES)
    for directory, pattern in (("ai", "*.ai"), ("editions", "*.txt"), ("blockdata", "*.txt"), ("tokenscripts", "*.txt")):
        root = forge_res / directory
        entries.extend(
            (f"res/{directory}/{path.relative_to(root).as_posix()}", path.read_bytes())
            for path in sorted(root.glob(pattern))
        )

    archive = zip_bytes(entries)
    manifest = {
        "schemaVersion": 1,
        "forgeCommit": git_revision(repo / "leyline/forge"),
        "archive": {
            "file": "catalog.zip",
            "sha256": sha256(archive),
            "compressedBytes": len(archive),
            "entryCount": len(entries),
        },
    }
    write_atomic(args.output / "catalog.zip", archive)
    write_atomic(args.output / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    write_image_index(
        repo / "server/src/main/resources/card-images.sqlite",
        args.output / "card-images.json.gz",
        rebalanced,
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

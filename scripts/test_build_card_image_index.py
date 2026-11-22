#!/usr/bin/env python3

import runpy
import sqlite3
import tempfile
import unittest
from pathlib import Path


index = runpy.run_path(str(Path(__file__).with_name("build-card-image-index.py")))
build_index = index["build_index"]


class BuildCardImageIndexTest(unittest.TestCase):
    def test_builds_normal_token_and_face_lookups(self) -> None:
        cards = [
            {
                "id": "spell-old",
                "name": "Treasure",
                "layout": "normal",
                "released_at": "2024-01-01",
                "image_uris": {"normal": "https://cards.scryfall.io/normal/spell.jpg"},
            },
            {
                "id": "token-new",
                "name": "Treasure",
                "layout": "token",
                "released_at": "2025-01-01",
                "image_uris": {
                    "normal": "https://cards.scryfall.io/normal/token.jpg",
                    "art_crop": "https://cards.scryfall.io/art_crop/token.jpg",
                },
            },
            {
                "id": "two-face",
                "name": "Front // Back",
                "layout": "transform",
                "released_at": "2025-02-01",
                "card_faces": [
                    {"name": "Front", "image_uris": {"normal": "https://cards.scryfall.io/normal/front.jpg"}},
                    {"name": "Back", "image_uris": {"normal": "https://cards.scryfall.io/normal/back.jpg"}},
                ],
            },
            {
                "id": "adventure",
                "name": "Creature // Adventure",
                "layout": "adventure",
                "released_at": "2025-03-01",
                "image_uris": {"normal": "https://cards.scryfall.io/normal/adventure.jpg"},
                "card_faces": [{"name": "Creature"}, {"name": "Adventure"}],
            },
            {
                "id": "double-faced-token",
                "name": "Incubator // Phyrexian",
                "layout": "double_faced_token",
                "released_at": "2025-04-01",
                "card_faces": [
                    {"name": "Incubator", "image_uris": {"normal": "https://cards.scryfall.io/normal/incubator.jpg"}},
                    {"name": "Phyrexian", "image_uris": {"normal": "https://cards.scryfall.io/normal/phyrexian.jpg"}},
                ],
            },
        ]

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "images.sqlite")
            self.assertEqual(11, build_index(cards, output, "fixture", "2025-02-01"))
            with sqlite3.connect(output) as database:
                rows = {
                    (name, token): (normal, back)
                    for name, token, normal, back in database.execute(
                        "SELECT lookup_name, is_token, normal_url, back_url FROM card_images"
                    )
                }
                metadata = dict(database.execute("SELECT key, value FROM metadata"))
                self.assertEqual(("https://cards.scryfall.io/normal/spell.jpg", None), rows[("treasure", 0)])
                self.assertEqual(("https://cards.scryfall.io/normal/token.jpg", None), rows[("treasure", 1)])
                self.assertEqual(
                    ("https://cards.scryfall.io/normal/front.jpg", "https://cards.scryfall.io/normal/back.jpg"),
                    rows[("front", 0)],
                )
                self.assertEqual(("https://cards.scryfall.io/normal/back.jpg", None), rows[("back", 0)])
                self.assertEqual(
                    ("https://cards.scryfall.io/normal/front.jpg", "https://cards.scryfall.io/normal/back.jpg"),
                    rows[("front // back", 0)],
                )
                self.assertEqual(
                    ("https://cards.scryfall.io/normal/adventure.jpg", None),
                    rows[("creature", 0)],
                )
                self.assertEqual(
                    ("https://cards.scryfall.io/normal/adventure.jpg", None),
                    rows[("adventure", 0)],
                )
                self.assertEqual(
                    ("https://cards.scryfall.io/normal/incubator.jpg", "https://cards.scryfall.io/normal/phyrexian.jpg"),
                    rows[("incubator", 1)],
                )
                self.assertEqual("1", metadata["schema_version"])
                self.assertEqual("fixture", metadata["source_uri"])
                self.assertEqual("2025-02-01", metadata["source_updated_at"])
                self.assertIn("generated_at", metadata)

    def test_newest_printing_wins_for_a_name(self) -> None:
        cards = [
            {
                "id": "new-printing",
                "name": "Lightning Bolt",
                "layout": "normal",
                "released_at": "2026-11-01",
                "image_uris": {"normal": "https://cards.scryfall.io/normal/new.jpg"},
            },
            {
                "id": "old-printing",
                "name": "Lightning Bolt",
                "layout": "normal",
                "released_at": "2010-07-01",
                "image_uris": {"normal": "https://cards.scryfall.io/normal/old.jpg"},
            },
        ]

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "images.sqlite")
            self.assertEqual(1, build_index(cards, output, "fixture", "2026-11-01"))
            with sqlite3.connect(output) as database:
                self.assertEqual(
                    "https://cards.scryfall.io/normal/new.jpg",
                    database.execute(
                        "SELECT normal_url FROM card_images WHERE lookup_name = 'lightning bolt' AND is_token = 0"
                    ).fetchone()[0],
                )


if __name__ == "__main__":
    unittest.main()

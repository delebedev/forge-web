import gzip
import json
import runpy
import sqlite3
import tempfile
import unittest
from pathlib import Path


catalog = runpy.run_path(str(Path(__file__).with_name("build-browser-catalog.py")))
write_image_index = catalog["write_image_index"]
rebalanced_card_names = catalog["rebalanced_card_names"]


def write_images(directory, statements):
    source = Path(directory, "images.sqlite")
    output = Path(directory, "card-images.json.gz")
    with sqlite3.connect(source) as database:
        database.executescript(
            "CREATE TABLE metadata (key TEXT, value TEXT);"
            "INSERT INTO metadata VALUES ('schema_version', '1');"
            "CREATE TABLE card_images (lookup_name TEXT, is_token INTEGER, normal_url TEXT, back_url TEXT);"
            + statements
        )
    return source, output


class BrowserImageIndexTest(unittest.TestCase):
    def test_exports_normal_and_token_images_deterministically(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = write_images(
                directory,
                "INSERT INTO card_images VALUES ('treasure', 0, 'https://cards.scryfall.io/card.jpg', NULL);"
                "INSERT INTO card_images VALUES ('treasure', 1, 'https://cards.scryfall.io/token.jpg', NULL);",
            )
            write_image_index(source, output)
            first = output.read_bytes()
            write_image_index(source, output)
            self.assertEqual(first, output.read_bytes())
            self.assertEqual(
                {
                    "0:treasure": ["https://cards.scryfall.io/card.jpg", None],
                    "1:treasure": ["https://cards.scryfall.io/token.jpg", None],
                },
                json.loads(gzip.decompress(first)),
            )

    def test_finds_rebalanced_names_in_card_sources(self):
        self.assertEqual(
            {"A-Baleful Beholder"},
            rebalanced_card_names(
                b"Name:A-Baleful Beholder\nManaCost:3\nTypes:Creature Beholder\n\nName:Baleful Beholder\n"
            ),
        )

    def test_borrows_original_artwork_for_rebalanced_names(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = write_images(
                directory,
                "INSERT INTO card_images VALUES ('baleful beholder', 0, 'https://cards.scryfall.io/original.jpg', 'https://cards.scryfall.io/original-back.jpg');"
                "INSERT INTO card_images VALUES ('a-town', 0, 'https://cards.scryfall.io/town.jpg', NULL);",
            )
            write_image_index(source, output, ["A-Baleful Beholder", "A-Town", "A-Missing Card"])
            self.assertEqual(
                {
                    "0:baleful beholder": [
                        "https://cards.scryfall.io/original.jpg",
                        "https://cards.scryfall.io/original-back.jpg",
                    ],
                    "0:a-baleful beholder": [
                        "https://cards.scryfall.io/original.jpg",
                        "https://cards.scryfall.io/original-back.jpg",
                    ],
                    "0:a-town": ["https://cards.scryfall.io/town.jpg", None],
                },
                json.loads(gzip.decompress(output.read_bytes())),
            )


if __name__ == "__main__":
    unittest.main()

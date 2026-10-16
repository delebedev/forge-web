import tempfile
import unittest
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).with_name("package_runtime.py")
SPEC = importlib.util.spec_from_file_location("package_runtime", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class PackageRuntimeTest(unittest.TestCase):
    def make_source(self, root, reverse=False):
        source = root / "source"
        directories = (*MODULE.RESOURCE_DIRECTORIES, "cardsfolder", "languages", "adventure")
        for name in reversed(directories) if reverse else directories:
            (source / name).mkdir(parents=True)
            (source / name / "kept.dat").write_text(name)
        (source / "languages/en-US.properties").write_text("key=value")
        (source / "languages/fr-FR.properties").write_text("cle=valeur")
        return source

    @staticmethod
    def files(root):
        return {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}

    def test_packages_headless_resources_with_canonical_card_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.make_source(root)
            destination = root / "destination"
            expected = {
                "ai",
                "blockdata",
                "cardsfolder",
                "deckgendecks",
                "defaults",
                "draft",
                "editions",
                "formats",
                "languages",
                "licenses",
                "lists",
                "setlookup",
                "tokenscripts",
            }
            (source / "cardsfolder/a").mkdir()
            (source / "cardsfolder/upcoming").mkdir()
            (source / "cardsfolder/a/card.txt").write_text("Name:Canonical")
            (source / "cardsfolder/upcoming/card.txt").write_text("Name:Stale")
            (source / "cardsfolder/upcoming/future.txt").write_text("Name:Future")
            source_before = self.files(source)

            MODULE.package_resources(source, destination)

            self.assertEqual(expected, {path.name for path in destination.iterdir()})
            self.assertEqual(["en-US.properties"], [path.name for path in (destination / "languages").iterdir()])
            self.assertEqual(b"Name:Canonical", (destination / "cardsfolder/a/card.txt").read_bytes())
            self.assertFalse((destination / "cardsfolder/upcoming/card.txt").exists())
            self.assertEqual(b"Name:Future", (destination / "cardsfolder/upcoming/future.txt").read_bytes())
            self.assertEqual(self.files(source / "tokenscripts"), self.files(destination / "tokenscripts"))
            self.assertEqual(source_before, self.files(source))

    def test_card_output_is_stable_across_source_creation_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outputs = []
            for index, reverse in enumerate((False, True)):
                source = self.make_source(root / str(index), reverse)
                paths = (
                    ("cardsfolder/a/card.txt", "Name:Canonical"),
                    ("cardsfolder/upcoming/card.txt", "Name:Stale"),
                    ("cardsfolder/upcoming/future.txt", "Name:Future"),
                )
                for path, contents in reversed(paths) if reverse else paths:
                    target = source / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(contents)
                destination = root / f"destination-{index}"
                MODULE.package_resources(source, destination)
                outputs.append(self.files(destination / "cardsfolder"))

            self.assertEqual(outputs[0], outputs[1])

    def test_rejects_duplicate_non_upcoming_basenames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.make_source(root)
            for folder in ("a", "b"):
                path = source / "cardsfolder" / folder / "card.txt"
                path.parent.mkdir()
                path.write_text(f"Name:{folder}")

            with self.assertRaisesRegex(ValueError, "Duplicate canonical card script"):
                MODULE.package_resources(source, root / "destination")

    def test_rejects_an_empty_card_script_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            (source / "cardsfolder").mkdir(parents=True)

            with self.assertRaisesRegex(ValueError, "No card scripts found"):
                MODULE.package_resources(source, Path(directory) / "destination")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Package the Forge resources used by the headless product runtime."""

from pathlib import Path
import shutil
import sys


RESOURCE_DIRECTORIES = (
    "ai",
    "blockdata",
    "deckgendecks",
    "defaults",
    "draft",
    "editions",
    "formats",
    "licenses",
    "lists",
    "setlookup",
    "tokenscripts",
)


def package_resources(source: Path, destination: Path) -> None:
    card_source = source / "cardsfolder"
    scripts = sorted(card_source.rglob("*.txt"))
    if not scripts:
        raise ValueError(f"No card scripts found in {card_source}")

    canonical = {}
    for script in scripts:
        if script.relative_to(card_source).parts[0] == "upcoming":
            continue
        if previous := canonical.get(script.name):
            raise ValueError(f"Duplicate canonical card script: {previous.name}")
        canonical[script.name] = script
    shadowed_upcoming = {
        script
        for script in scripts
        if script.relative_to(card_source).parts[0] == "upcoming" and script.name in canonical
    }

    destination.mkdir(parents=True)
    for name in RESOURCE_DIRECTORIES:
        shutil.copytree(source / name, destination / name)

    languages = destination / "languages"
    languages.mkdir()
    shutil.copy2(source / "languages/en-US.properties", languages)

    # Released scripts take precedence over same-named upcoming scripts.
    shutil.copytree(
        card_source,
        destination / "cardsfolder",
        ignore=lambda directory, names: [
            name for name in names if Path(directory, name) in shadowed_upcoming
        ],
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: package_runtime.py SOURCE_RES DESTINATION_RES")
    package_resources(Path(sys.argv[1]), Path(sys.argv[2]))

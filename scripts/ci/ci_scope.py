"""Select runtime gates independently of deployment scope."""
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys


ASSET_SUFFIXES = {'.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
                  '.woff', '.woff2', '.ttf', '.otf', '.eot'}


# Markdown that a build, test or release step reads stays on the full path.
MARKDOWN_INPUTS = ('scripts/', 'src/', 'public/')

# Release tooling and repository settings that no Web CI runtime job reads. The
# changes job still runs the script unit tests.
TOOLING_INPUTS = ('scripts/release/notes/', 'scripts/release/release_notes.py',
                  'scripts/release/test_release_notes.py',
                  'scripts/release/frontend-release-scope.py',
                  'scripts/release/test_frontend_release_scope.py',
                  'scripts/release/build-full-release.sh',
                  '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/')

# Browser suites whose proof breadth is selected per suite.
SUITES = ('product', 'gre', 'catalog')

MANIFEST = json.loads((Path(__file__).resolve().parents[2] / 'e2e/suites.json').read_text())
SUITE_SPECS = {spec for specs in MANIFEST.values() for spec in specs}


def ui_only(path):
    if path.startswith(('docs/', '.storybook/')):
        return True
    if path.endswith('.md') and not path.startswith(MARKDOWN_INPUTS):
        return True
    if path.startswith('src/') and path.endswith(('.d.ts', '.test.ts', '.test.tsx',
                                                '.stories.ts', '.stories.tsx')):
        return True
    return path.startswith(('src/', 'public/')) and PurePosixPath(path).suffix in ASSET_SUFFIXES


def tooling_only(path):
    if path.startswith('.github/workflows/'):
        return path != '.github/workflows/web-ci.yml'
    return path.startswith(TOOLING_INPUTS)


def classify_paths(paths):
    # Unknown inputs and executable source require the real runtime gates.
    light = paths and all(ui_only(path) or tooling_only(path) for path in paths)
    return 'web' if light else 'full'


def path_breadth(path, suite):
    """Changed specs run in full, so product inputs need only representative proof."""
    if ui_only(path) or tooling_only(path) or path == 'leyline':
        return 'pr'
    if path.startswith(('src/', 'browser-engine/')) or path in SUITE_SPECS:
        return 'pr'
    # The product lane owns the server's player journeys; gameplay lanes only need to
    # reach the server through their representatives.
    if path.startswith(('server/', 'e2e/server-parity/')):
        return 'full' if suite == 'product' else 'pr'
    # Control inputs, helpers, fixtures loaded by name and unknown files reach every gate.
    return 'full'


def proof_breadth(paths, suite=None):
    """Breadth for one suite, or `full` only when every suite runs in full."""
    if not paths:
        return 'full'
    if suite is None:
        breadths = {proof_breadth(paths, name) for name in SUITES}
        return 'full' if breadths == {'full'} else 'pr'
    if suite not in SUITES:
        raise ValueError(f'Unknown suite {suite}')
    return 'full' if any(path_breadth(path, suite) == 'full' for path in paths) else 'pr'


def changed(checkout, base):
    paths = subprocess.check_output(
        ['git', '-C', checkout, 'diff', '--no-renames', '--name-only', '-z', base, 'HEAD', '--'],
        text=True, stderr=subprocess.DEVNULL,
    ).split('\0')
    return [path for path in paths if path]


def classify(checkout, base, breadth=False, suite=None):
    try:
        paths = changed(checkout, base)
    except subprocess.CalledProcessError:
        return 'full'
    return proof_breadth(paths, suite) if breadth else classify_paths(paths)


if __name__ == '__main__':
    options = sys.argv[3:]
    suite = next((option.split('=', 1)[1] for option in options
                  if option.startswith('--breadth=')), None)
    breadth = suite is not None or '--breadth' in options
    print(classify(*sys.argv[1:3], breadth=breadth, suite=suite))

"""Select runtime gates independently of deployment scope."""
from pathlib import PurePosixPath
import subprocess
import sys


ASSET_SUFFIXES = {'.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
                  '.woff', '.woff2', '.ttf', '.otf', '.eot'}


def ui_only(path):
    if path.startswith(('docs/', '.storybook/')):
        return True
    if path.startswith('src/') and path.endswith(('.d.ts', '.test.ts', '.test.tsx',
                                                '.stories.ts', '.stories.tsx')):
        return True
    return path.startswith(('src/', 'public/')) and PurePosixPath(path).suffix in ASSET_SUFFIXES


def classify_paths(paths):
    # Unknown inputs and executable source require the real runtime gates.
    return 'web' if paths and all(ui_only(path) for path in paths) else 'full'


def proof_breadth(paths):
    """Known product inputs get representative proof; control inputs require every gate."""
    if not paths:
        return 'full'
    for path in paths:
        if ui_only(path) or path == 'leyline' or path.startswith('src/'):
            continue
        if path.startswith('e2e/') and path.endswith('.spec.ts') and path.split('/')[-1] in PR_SPECS:
            continue
        return 'full'
    return 'pr'


PR_SPECS = {
    'auth-passwordless.spec.ts', 'bootstrap.spec.ts', 'deck-import.spec.ts',
    'decks.spec.ts', 'draft.spec.ts', 'product-smoke.spec.ts',
    'react-challenge.spec.ts', 'whats-new.spec.ts', 'gre-play.spec.ts',
    'gre-partner-decks.spec.ts', 'gre-modal-cancel.spec.ts', 'gre-search-owner.spec.ts', 'gre-prompts.spec.ts', 'gre-recovery.spec.ts', 'gre-priority.spec.ts',
    'gre-sounds.spec.ts', 'gre-equip-cost.spec.ts', 'gre-repeatable-cost.spec.ts', 'gre-alternate-life-cost.spec.ts', 'gre-cost-choice.spec.ts', 'forge-catalog.spec.ts',
    'match-route.spec.ts', 'gre-known-opponent-hand.spec.ts', 'gre-warp.spec.ts', 'gre-library-permissions.spec.ts', 'gre-player-counters.spec.ts', 'gre-mana-payment.spec.ts',
}


def classify(checkout, base, breadth=False):
    try:
        paths = subprocess.check_output(
            ['git', '-C', checkout, 'diff', '--no-renames', '--name-only', '-z', base, 'HEAD', '--'],
            text=True, stderr=subprocess.DEVNULL,
        ).split('\0')
    except subprocess.CalledProcessError:
        return 'full'
    return (proof_breadth if breadth else classify_paths)([path for path in paths if path])


if __name__ == '__main__':
    print(classify(*sys.argv[1:3], breadth='--breadth' in sys.argv[3:]))

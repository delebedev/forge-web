#!/usr/bin/env python3
"""Reject frontend-only releases that change backend or unknown build inputs."""
import re
import subprocess
import sys


def check_scope(checkout, backend):
    if not re.fullmatch(r'[0-9a-f]{40}', backend):
        raise ValueError('Invalid running backend revision')
    subprocess.run(['git', '-C', checkout, 'cat-file', '-e', f'{backend}^{{commit}}'], check=True,
                   capture_output=True)
    changed = subprocess.check_output(
        ['git', '-C', checkout, 'diff', '--name-only', '-z', backend, 'HEAD'], text=True,
    ).split('\0')
    allowed_files = {'index.html', 'package.json', 'bun.lock', 'vite.config.ts',
                     'eslint.config.js', 'playwright.config.ts', 'AGENTS.md', 'README.md', 'DESIGN.md',
                     'scripts/seo.ts', 'scripts/check-seo.ts',
                     'scripts/frontend-release-scope.py', 'scripts/test_frontend_release_scope.py',
                     '.github/workflows/publish-web.yml', '.github/workflows/web-ci.yml',
                     'browser-engine/web/engine-worker.js', 'browser-engine/web/runtime-preload.json'}
    rejected = [p for p in changed if p and not (
        p.startswith(('src/', 'public/', 'e2e/', 'docs/', '.storybook/', 'browser-engine/src/')) or p in allowed_files or
        re.fullmatch(r'tsconfig(?:\.[\w-]+)?\.json', p)
    )]
    if rejected:
        raise ValueError('Full deployment required for: ' + ', '.join(rejected))


def classify(checkout, backend):
    try:
        check_scope(checkout, backend)
    except (ValueError, subprocess.CalledProcessError):
        return 'full'
    return 'web'


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--classify':
        print(classify(*sys.argv[2:]))
    else:
        check_scope(*sys.argv[1:])
        print('Frontend scope verified against running backend')

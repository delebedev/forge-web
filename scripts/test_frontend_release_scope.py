import importlib.util
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('frontend_scope', Path(__file__).with_name('frontend-release-scope.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)

ROOT = Path(__file__).resolve().parent.parent
RELATIVE_IMPORT = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}/.+?)\1''')


def server_inputs():
    """Repository files reachable from the product server entry point through relative imports."""
    found, pending = set(), [ROOT / 'server/main.ts']
    while pending:
        path = pending.pop()
        if path in found:
            continue
        found.add(path)
        if path.suffix not in ('.ts', '.tsx', '.js', '.mjs'):
            continue
        for _, specifier in RELATIVE_IMPORT.findall(path.read_text()):
            target = (path.parent / specifier).resolve()
            candidates = [target, Path(f'{target}.ts'), Path(f'{target}.tsx'), target / 'index.ts']
            resolved = next((c for c in candidates if c.is_file()), None)
            if resolved is None:
                raise AssertionError(f'Unresolved server import {specifier} in {path}')
            pending.append(resolved)
    return {str(path.relative_to(ROOT)) for path in found}


class FrontendScopeTest(unittest.TestCase):
    def test_compares_all_changes_against_running_backend(self):
        with tempfile.TemporaryDirectory(prefix='frontend-scope-') as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()

            git('init', '-q')
            git('config', 'user.name', 'Scope Test')
            git('config', 'user.email', 'scope@example.test')
            (root / 'server').mkdir()
            (root / 'src').mkdir()
            (root / 'server/main.kt').write_text('initial')
            (root / 'src/app.ts').write_text('initial')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            (root / 'src/app.ts').write_text('frontend change')
            git('commit', '-qam', 'frontend')
            scope.check_scope(directory, base)
            (root / '.github/workflows').mkdir(parents=True)
            (root / '.github/workflows/web-ci.yml').write_text('frontend routing')
            (root / '.storybook').mkdir()
            (root / '.storybook/preview.css').write_text('card art mode')
            git('add', '.')
            git('commit', '-qm', 'ci routing')
            scope.check_scope(directory, base)
            (root / 'scripts').mkdir()
            for name in ['seo.ts', 'check-seo.ts']:
                (root / 'scripts' / name).write_text('static page build')
            git('add', '.')
            git('commit', '-qm', 'static routes')
            scope.check_scope(directory, base)
            (root / 'browser-engine/worker').mkdir(parents=True)
            (root / 'browser-engine/worker/engine-worker.js').write_text('frontend worker')
            (root / 'browser-engine/worker/runtime-preload.json').write_text('{}')
            (root / 'browser-engine/src').mkdir(parents=True)
            (root / 'browser-engine/src/runtime.kt').write_text('browser runtime')
            git('add', '.')
            git('commit', '-qm', 'browser worker')
            scope.check_scope(directory, base)
            self.assertEqual('web', scope.classify(directory, base))
            # The product server builds without Leyline, so engine inputs ship as a frontend release.
            git('update-index', '--add', '--cacheinfo', f'160000,{base},leyline')
            (root / 'browser-engine/src/projector.kt').write_text('card text')
            (root / 'browser-engine/build.gradle.kts').write_text('engine build')
            (root / 'browser-engine/gradle').mkdir()
            (root / 'browser-engine/gradle/libs.versions.toml').write_text('engine versions')
            (root / 'scripts/build-browser-catalog.py').write_text('catalog')
            git('add', 'browser-engine', 'scripts')
            git('commit', '-qm', 'engine pin')
            self.assertEqual('web', scope.classify(directory, base))
            frontend = git('rev-parse', 'HEAD')
            git('checkout', '-qb', 'squashed', base)
            git('cherry-pick', '--no-commit', frontend)
            git('commit', '-qm', 'squashed frontend')
            scope.check_scope(directory, frontend)
            (root / 'server/main.kt').write_text('backend change')
            git('commit', '-qam', 'backend')
            with self.assertRaisesRegex(ValueError, 'server/main.kt'):
                scope.check_scope(directory, base)
            self.assertEqual('full', scope.classify(directory, base))
            backend = git('rev-parse', 'HEAD')
            (root / 'scripts').mkdir(exist_ok=True)
            (root / 'scripts/server-build.ts').write_text('unknown build input')
            git('add', '.')
            git('commit', '-qm', 'unknown script')
            with self.assertRaisesRegex(ValueError, 'scripts/server-build.ts'):
                scope.check_scope(directory, backend)
            self.assertEqual('full', scope.classify(directory, '0' * 40))

    def test_server_frontend_inputs_match_server_imports(self):
        inputs = server_inputs()
        self.assertIn('server/platform/resources.ts', inputs)
        self.assertEqual(scope.SERVER_FRONTEND_INPUTS, {path for path in inputs if scope.frontend_only(path)})

    def test_a_frontend_file_the_server_bundles_requires_a_full_release(self):
        with tempfile.TemporaryDirectory(prefix='frontend-scope-') as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()

            git('init', '-q')
            git('config', 'user.name', 'Scope Test')
            git('config', 'user.email', 'scope@example.test')
            (root / 'src/shared/api').mkdir(parents=True)
            (root / 'src/shared/api/wire-schemas.ts').write_text('initial')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            (root / 'src/shared/api/wire-schemas.ts').write_text('contract change')
            git('commit', '-qam', 'contract')
            self.assertEqual('web', scope.classify(directory, base))
            original = scope.SERVER_FRONTEND_INPUTS
            scope.SERVER_FRONTEND_INPUTS = frozenset({'src/shared/api/wire-schemas.ts'})
            try:
                with self.assertRaisesRegex(ValueError, 'src/shared/api/wire-schemas.ts'):
                    scope.check_scope(directory, base)
                self.assertEqual('full', scope.classify(directory, base))
            finally:
                scope.SERVER_FRONTEND_INPUTS = original


if __name__ == '__main__':
    unittest.main()

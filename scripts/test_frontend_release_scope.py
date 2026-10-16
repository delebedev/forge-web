import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('frontend_scope', Path(__file__).with_name('frontend-release-scope.py'))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


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
            (root / 'browser-engine/web').mkdir(parents=True)
            (root / 'browser-engine/web/engine-worker.js').write_text('frontend worker')
            (root / 'browser-engine/web/runtime-preload.json').write_text('{}')
            (root / 'browser-engine/src').mkdir(parents=True)
            (root / 'browser-engine/src/runtime.kt').write_text('browser runtime')
            git('add', '.')
            git('commit', '-qm', 'browser worker')
            scope.check_scope(directory, base)
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
            # A changed submodule entry must also require a full deployment.
            git('update-index', '--add', '--cacheinfo', f'160000,{base},leyline')
            git('commit', '-qm', 'runtime pin')
            with self.assertRaisesRegex(ValueError, 'leyline'):
                scope.check_scope(directory, backend)
            self.assertEqual('full', scope.classify(directory, backend))
            self.assertEqual('full', scope.classify(directory, '0' * 40))


if __name__ == '__main__':
    unittest.main()

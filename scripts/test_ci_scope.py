from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts import ci_scope


class CiScopeTest(unittest.TestCase):
    def test_only_non_runtime_inputs_take_the_light_path(self):
        for path in ['src/ui/Board.module.css', 'src/ui/Board.module.css.d.ts',
                     'src/engine/runtime/gre-store.test.ts', 'src/ui/Board.stories.tsx',
                     'src/shared/Card.test.tsx', 'public/icon.svg', 'docs/architecture.md',
                     '.storybook/preview.ts']:
            with self.subTest(path=path):
                self.assertEqual('web', ci_scope.classify_paths([path]))
        for path in ['src/engine/runtime/gre-store.ts', 'src/browser-engine/main.tsx',
                     'src/shell/AppShell.tsx', 'src/shared/react/create-external-store.ts',
                     'src/new-feature.ts', 'public/challenges/bolt.pzl',
                     'public/browser-engine/release.json', 'browser-engine/web/engine-worker.js',
                     'server/src/main.kt', 'leyline', 'package.json', 'bunfig.toml',
                     'scripts/ci_scope.py', 'index.html', 'unknown-input']:
            with self.subTest(path=path):
                self.assertEqual('full', ci_scope.classify_paths(['src/ui/Board.module.css', path]))
        self.assertEqual('full', ci_scope.classify_paths([]))

    def test_git_range_includes_deleted_and_renamed_runtime_source(self):
        with tempfile.TemporaryDirectory(prefix='ci-scope-') as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], text=True).strip()

            def commit():
                git('add', '.')
                git('commit', '-qm', 'scope fixture')
                return git('rev-parse', 'HEAD')

            git('init', '-q')
            git('config', 'user.name', 'CI Scope Test')
            git('config', 'user.email', 'scope@example.test')
            (root / 'src').mkdir()
            (root / 'src/runtime.ts').write_text('runtime')
            (root / 'src/board.css').write_text('board')
            base = commit()
            (root / 'src/board.css').write_text('changed board')
            commit()
            self.assertEqual('web', ci_scope.classify(directory, base))
            (root / 'docs').mkdir()
            git('mv', 'src/runtime.ts', 'docs/runtime.md')
            commit()
            self.assertEqual('full', ci_scope.classify(directory, base))
            self.assertEqual('full', ci_scope.classify(directory, '0' * 40))
            self.assertEqual('full', ci_scope.classify(directory, git('rev-parse', 'HEAD')))


class ProofBreadthTest(unittest.TestCase):
    def test_product_changes_and_engine_pins_keep_representative_pr_proof(self):
        for paths in [['leyline'], ['src/engine/runtime/gre-store.ts'],
                      ['src/features/gre/board/Board.tsx', 'e2e/gre-priority.spec.ts'],
                      ['e2e/gre-cost-choice.spec.ts'], ['e2e/gre-mana-payment.spec.ts'],
                      ['e2e/gre-library-permissions.spec.ts'], ['e2e/gre-player-counters.spec.ts'],
                      ['src/shared/audio.test.ts'],
                      ['src/features/gre/MatchRoute.tsx', 'e2e/match-route.spec.ts']]:
            self.assertEqual('pr', ci_scope.proof_breadth(paths))

    def test_control_inputs_helpers_fixtures_and_unknown_specs_force_full(self):
        for path in ['scripts/ci_scope.py', 'scripts/ci-browser-selection.mjs',
                     '.github/workflows/web-ci.yml', 'playwright.config.ts',
                     'e2e/gre-acceptance.ts', 'e2e/gre-test.ts', 'e2e/new-family.spec.ts',
                     'e2e/fixtures/new.pzl', 'server/src/main.kt', 'browser-engine/web/index.js',
                     'package.json', 'unknown-input']:
            self.assertEqual('full', ci_scope.proof_breadth(['leyline', path]))
        self.assertEqual('full', ci_scope.proof_breadth([]))
        self.assertEqual('full', ci_scope.proof_breadth(
            ['e2e/fixtures/new.pzl', 'e2e/gre-priority.spec.ts']))


if __name__ == '__main__':
    unittest.main()

from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.ci import ci_scope


class CiScopeTest(unittest.TestCase):
    def test_only_non_runtime_inputs_take_the_light_path(self):
        for path in ['src/ui/Board.module.css', 'src/ui/Board.module.css.d.ts',
                     'src/engine/runtime/gre-store.test.ts', 'src/ui/Board.stories.tsx',
                     'src/shared/Card.test.tsx', 'public/icon.svg', 'docs/architecture.md',
                     '.storybook/preview.ts', 'README.md', 'e2e/AGENTS.md',
                     '.github/pull_request_template.md', 'scripts/release/notes/history.md',
                     'scripts/release/release_notes.py', '.github/CODEOWNERS',
                     '.github/workflows/release-notes.yml', '.github/workflows/chromatic.yml']:
            with self.subTest(path=path):
                self.assertEqual('web', ci_scope.classify_paths([path]))
        for path in ['src/engine/runtime/gre-store.ts',
                     'src/shell/AppShell.tsx', 'src/shared/react/create-external-store.ts',
                     'src/new-feature.ts', 'public/challenges/bolt.pzl',
                     'public/browser-engine/release.json', 'browser-engine/worker/engine-worker.js',
                     'server/app.ts', 'leyline', 'package.json', 'bunfig.toml',
                     'scripts/ci/ci_scope.py', 'index.html', 'unknown-input',
                     'public/whats-new.md', '.github/workflows/web-ci.yml',
                     '.github/actions/playwright-browsers/action.yml',
                     'scripts/release/build-server.sh',
                     'scripts/release/check-server-distribution.sh', 'e2e/suites.json']:
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
                      ['src/features/match/board/Board.tsx', 'e2e/match/gre-priority.spec.ts'],
                      ['e2e/match/gre-cost-choice.spec.ts'], ['e2e/match/gre-mana-payment.spec.ts'],
                      ['e2e/match/gre-library-permissions.spec.ts'], ['e2e/match/gre-player-counters.spec.ts'],
                      ['e2e/match/gre-hand-reach.spec.ts'], ['e2e/product/limited-course.spec.ts'],
                      ['src/features/match/board/audio.test.ts'],
                      ['src/features/match/MatchRoute.tsx', 'e2e/match/match-route.spec.ts'],
                      ['browser-engine/worker/index.js'], ['scripts/release/notes/history.md']]:
            for suite in ci_scope.SUITES:
                with self.subTest(paths=paths, suite=suite):
                    self.assertEqual('pr', ci_scope.proof_breadth(paths, suite))
            self.assertEqual('pr', ci_scope.proof_breadth(paths))

    def test_server_changes_run_the_product_lane_in_full_and_gameplay_representatives(self):
        for path in ['server/app.ts', 'server/contract/wire-schemas.ts', 'e2e/server-parity/auth.test.ts']:
            with self.subTest(path=path):
                self.assertEqual('full', ci_scope.proof_breadth([path], 'product'))
                self.assertEqual('pr', ci_scope.proof_breadth([path], 'gre'))
                self.assertEqual('pr', ci_scope.proof_breadth([path], 'catalog'))
                self.assertEqual('pr', ci_scope.proof_breadth([path]))

    def test_control_inputs_helpers_fixtures_and_unknown_specs_force_full(self):
        for path in ['scripts/ci/ci_scope.py', 'scripts/ci/ci-browser-selection.mjs',
                     '.github/workflows/web-ci.yml', 'playwright.config.ts', 'e2e/suites.json',
                     'e2e/support/gre-acceptance.ts', 'e2e/support/gre-test.ts', 'e2e/new-family.spec.ts',
                     'e2e/fixtures/new.pzl', 'package.json', 'unknown-input']:
            with self.subTest(path=path):
                for suite in ci_scope.SUITES:
                    self.assertEqual('full', ci_scope.proof_breadth(['leyline', path], suite))
                self.assertEqual('full', ci_scope.proof_breadth(['leyline', path]))
        self.assertEqual('full', ci_scope.proof_breadth([]))
        self.assertEqual('full', ci_scope.proof_breadth(
            ['e2e/fixtures/new.pzl', 'e2e/match/gre-priority.spec.ts']))

    def test_manifest_lists_existing_specs(self):
        root = Path(__file__).resolve().parents[2]
        for spec in ci_scope.SUITE_SPECS:
            with self.subTest(spec=spec):
                self.assertTrue((root / spec).is_file())


if __name__ == '__main__':
    unittest.main()

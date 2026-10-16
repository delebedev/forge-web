import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('notes', Path(__file__).with_name('release_notes.py'))
notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notes)


class ReleaseNotesTest(unittest.TestCase):
    def test_evidence_coverage_and_carry_forward(self):
        manifest = {'changes': [{'id': 'web:a'}, {'id': 'carried:0', 'title': 'Earlier fix remains available.'}]}
        candidate = {'headline': 'Clearer cards', 'bullets': [{'text': 'Earlier fix remains available.', 'sources': ['carried:0']}],
                     'coverage': [{'id': 'web:a', 'audience': 'internal', 'fact': 'CI changed.', 'reason': 'No player effect.'},
                                  {'id': 'carried:0', 'audience': 'player', 'fact': 'Earlier fix.', 'reason': 'Already approved.'}]}
        notes.validate_candidate(candidate, manifest)
        for mutate in (lambda c: c['coverage'].pop(), lambda c: c['coverage'][0].update(id='invented'),
                       lambda c: c['bullets'].clear(), lambda c: c['bullets'][0].update(sources=['web:a'])):
            invalid = copy.deepcopy(candidate); mutate(invalid)
            with self.assertRaises(ValueError):
                notes.validate_candidate(invalid, manifest)

    def test_patch_equivalent_merge_is_not_announced_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            def git(*args):
                return notes.run('git', *args, cwd=repo)
            git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
            file = repo / 'game.txt'
            file.write_text('base\n'); git('add', '.'); git('commit', '-qm', 'Base')
            base = git('rev-parse', 'HEAD')
            file.write_text('base\nland fix\n'); git('commit', '-qam', 'Deployed land fix')
            deployed = git('rev-parse', 'HEAD')
            git('checkout', '-q', '--detach', base)
            file.write_text('base\nland fix\n'); git('commit', '-qam', 'Merged land fix')
            file.write_text('base\nland fix\ntreasure fix\n'); git('commit', '-qam', 'Treasure fix')
            items = notes.changes(repo, deployed, git('rev-parse', 'HEAD'), 'leyline')
            self.assertEqual([item['title'] for item in items], ['Treasure fix'])
            git('tag', 'deployed', deployed)
            with tempfile.TemporaryDirectory() as shallow_directory:
                notes.run('git', 'clone', '-q', '--depth=1', '--no-local', repo.as_uri(), shallow_directory)
                shallow = Path(shallow_directory)
                self.assertEqual(notes.run('git', 'rev-parse', '--is-shallow-repository', cwd=shallow), 'true')
                items = notes.changes(shallow, deployed, git('rev-parse', 'HEAD'), 'leyline')
                self.assertEqual([item['title'] for item in items], ['Treasure fix'])

    def test_redeploy_without_changes_spends_nothing(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'model_candidate', side_effect=AssertionError('Model should not run')):
            result = notes.generate({'day': '2026-10-01', 'changes': []}, Path(directory))
            self.assertEqual(result['total_cost'], 0)
            self.assertFalse(result['candidate']['bullets'])
            carried = {'day': '2026-09-30', 'carried_headline': 'Already shipped',
                       'changes': [{'id': 'carried:0', 'title': 'Existing approved fix.'}]}
            result = notes.generate(carried, Path(directory))
            self.assertEqual(result['total_cost'], 0)
            notes.validate_candidate(result['candidate'], carried)

    def test_failed_draft_cannot_be_published(self):
        manifest = {'day': '2026-10-01', 'changes': [{'id': 'web:a'}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'model_candidate', return_value={'error': 'Missing coverage'}):
            output = Path(directory)
            with self.assertRaisesRegex(ValueError, 'Missing coverage'):
                notes.generate(manifest, output)
            self.assertTrue((output / 'draft.json').exists())
            self.assertFalse((output / 'draft.md').exists())

    def test_budget_applies_to_model_input_not_archived_diffs(self):
        manifest = {'day': '2026-10-02', 'changes': [
            {'id': f'web:{index}', 'diff': 'x' * 24000, 'diff_truncated': False}
            for index in range(26)]}
        candidate = {'headline': 'No player changes', 'bullets': [], 'coverage': [
            {'id': item['id'], 'audience': 'internal', 'fact': 'Internal change.', 'reason': 'No player effect.'}
            for item in manifest['changes']]}
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'model_candidate', return_value={'candidate': candidate}) as model:
            notes.generate(manifest, Path(directory))
            model.assert_called_once()
            model.reset_mock()
            manifest['changes'][0]['files'] = ['x' * 600000]
            with self.assertRaisesRegex(ValueError, 'Evidence exceeds draft budget'):
                notes.generate(manifest, Path(directory))
            model.assert_not_called()

    def test_automatic_retry_reuses_generated_copy(self):
        deployment = {'frontend': 'a'*40, 'run_id': 20}
        run_info = {'conclusion': 'success', 'head_branch': 'main', 'path': '.github/workflows/publish-web.yml', 'head_sha': 'a'*40}
        published = {'tag_name': 'deploy-20', 'draft': False, 'body': 'Already published copy'}
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'api', return_value=run_info), patch.object(notes, 'releases', return_value=[published]), patch.object(notes, 'generate', side_effect=AssertionError('No regeneration')):
            output = Path(directory)
            notes.draft(deployment, output, reuse_existing=True)
            self.assertEqual((output / 'draft.md').read_text(), published['body'])
            with self.assertRaisesRegex(ValueError, 'immutable'):
                notes.draft(deployment, output)
            published['draft'] = True
            notes.draft(deployment, output, reuse_existing=True)
            self.assertEqual((output / 'draft.md').read_text(), published['body'])

    def test_public_snapshot_excludes_source_descriptions_diffs_and_model_diagnostics(self):
        manifest = {'schema': 1, 'day': '2026-10-16', 'frontend': 'a'*40, 'backend': 'b'*40,
                    'run_id': 20, 'kind': 'web', 'deployed_at': '2026-10-16T12:00:00Z',
                    'baseline': {'frontend': 'c'*40, 'private': 'private reference'},
                    'changes': [{'id': 'web:abcd1234', 'title': 'Private title', 'description': 'Private reference', 'diff': 'Private diff'},
                                {'id': 'carried:0', 'title': 'Already public outcome'}],
                    'private': 'Private reference'}
        candidate = {'headline': 'Clearer gameplay', 'bullets': [{'text': 'Already public outcome', 'sources': ['carried:0'], 'internal_explanation': 'Private bullet sentinel'}],
                     'coverage': [{'id': 'web:abcd1234', 'audience': 'internal', 'fact': 'Private fact', 'reason': 'Private reason'},
                                  {'id': 'carried:0', 'audience': 'player', 'fact': 'Public outcome', 'reason': 'Retained'}]}
        notes.validate_candidate(candidate, manifest)
        public, draft = notes.publication_snapshot(manifest, candidate)
        notes.validate_candidate(draft['candidate'], public)
        self.assertEqual(public['changes'], [{'id': 'web:abcd1234'}, {'id': 'carried:0', 'title': 'Already public outcome'}])
        self.assertNotIn('Private', str((public, draft)))
        self.assertNotIn('private', str((public, draft)))
        self.assertEqual(set(draft), {'candidate'})
        self.assertEqual(public['frontend'], manifest['frontend'])
        self.assertEqual(public['baseline'], {'frontend': 'c'*40})

    def test_internal_only_release_leaves_public_feed_unchanged(self):
        manifest = {'changes': [{'id': 'web:a'}]}
        candidate = {'headline': 'No player changes', 'bullets': [], 'coverage': [{'id': 'web:a', 'audience': 'internal', 'fact': 'CI changed.', 'reason': 'No player effect.'}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'asset', side_effect=lambda tag, name: manifest if name == 'manifest.json' else {'candidate': candidate}):
            output = Path(directory)
            notes.feed('deploy-20', output)
            self.assertFalse((output / 'whats-new.md').exists())

    def test_inventory_uses_backend_pin_and_london_date(self):
        deployment = {'frontend': 'f'*40, 'backend': 'b'*40, 'run_id': 30,
                      'deployed_at': '2026-09-30T23:30:00Z', 'kind': 'web'}
        baseline = {'day': '2026-09-29', 'frontend': 'a'*40, 'backend': 'c'*40}
        calls = []
        def changes(repo, before, after, label):
            calls.append((label, before, after))
            return [{'id': label + ':' + after}]
        with patch.object(notes, 'releases', return_value=[]), patch.object(notes, 'changes', side_effect=changes), patch.object(notes, 'pin', side_effect=lambda sha: sha):
            manifest = notes.collect(deployment, base=baseline)
        self.assertEqual(manifest['day'], '2026-10-01')
        self.assertIn(('leyline', 'c'*40, 'b'*40), calls)
        self.assertIn(('leyline', 'c'*40, 'f'*40), calls)
        self.assertEqual({label for label, _, _ in calls}, {'web', 'leyline'})
        self.assertEqual(len({item['id'] for item in manifest['changes']}), len(manifest['changes']))

    def test_published_headlines_inform_the_next_day(self):
        previous = {'day': '2026-10-01', 'frontend': 'a'*40, 'backend': 'a'*40, 'run_id': 40,
                    'changes': [{'id': 'web:old', 'title': 'Yesterday only'}], 'baseline': {'changes': ['Older history']}}
        release = {'tag_name': 'deploy-40', 'draft': False, 'body': '## 2026-10-01\n\n### Easier deck choices\n\n- A fix.'}
        deployment = {'frontend': 'b'*40, 'backend': 'b'*40, 'run_id': 50, 'deployed_at': '2026-10-02T10:00:00Z', 'kind': 'full'}
        with patch.object(notes, 'releases', return_value=[release]), patch.object(notes, 'asset', return_value=previous), patch.object(notes, 'changes', return_value=[]), patch.object(notes, 'pin', return_value='0'*40):
            manifest = notes.collect(deployment)
        self.assertEqual(manifest['recent_headlines'][0], 'Easier deck choices')
        self.assertEqual(manifest['baseline'], {key: previous[key] for key in ('day', 'frontend', 'backend', 'run_id')})

    def test_same_day_replaces_entry_and_newer_publication_blocks_stale_draft(self):
        manifest = {'day': '2026-09-30', 'run_id': 20, 'changes': [{'id': 'web:a'}]}
        candidate = {'headline': 'Two fixes', 'bullets': [{'text': 'Both fixes are available.', 'sources': ['web:a']}],
                     'coverage': [{'id': 'web:a', 'audience': 'player', 'fact': 'Two fixes.', 'reason': 'Visible.'}]}
        published = [{'tag_name': 'deploy-10', 'draft': False, 'body': '## 2026-09-30\n- Earlier fix.'}]
        def asset(tag, name):
            if name == 'draft.json':
                return {'candidate': candidate}
            return manifest if tag == 'deploy-20' else {**manifest, 'run_id': 10}
        with tempfile.TemporaryDirectory() as directory, patch.object(notes, 'releases', return_value=published), patch.object(notes, 'asset', side_effect=asset):
            output = Path(directory)
            notes.feed('deploy-20', output)
            feed = (output / 'whats-new.md').read_text()
            self.assertEqual(feed.count('## 2026-09-30'), 1)
            self.assertIn('Both fixes', feed)
            self.assertIn('## 2026-09-28', feed)
            manifest['run_id'] = 5
            with self.assertRaises(ValueError):
                notes.feed('deploy-20', output)


if __name__ == '__main__':
    unittest.main()

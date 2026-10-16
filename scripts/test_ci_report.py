import tempfile
from pathlib import Path
import unittest

from scripts import ci_report


class CiReportTest(unittest.TestCase):
    def test_bun_playwright_and_gradle_failures_and_skips_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, xml in {
                'test-results/junit.xml': '<testsuites><testsuite><testcase time="1"/></testsuite></testsuites>',
                'ci/gre/junit.xml': '<testsuites><testsuite><testcase time="9"><failure/></testcase><testcase><skipped/></testcase></testsuite></testsuites>',
                'server/build/test-results/test/TEST-X.xml': '<testsuite><testcase time="4"><error/></testcase></testsuite>',
            }.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(xml)
            counts, slow, warnings = ci_report.test_results(root)
            self.assertEqual(dict(counts), {'Unit (Bun)': [1, 0, 0], 'gre': [0, 1, 1], 'server': [0, 1, 0]})
            self.assertEqual(slow[0][:2], (9, 'gre'))
            self.assertEqual(warnings, [])

    def test_retry_queue_and_container_lifetime_peaks_do_not_mislead(self):
        self.assertIsNone(ci_report.seconds('2026-10-04T12:43:40Z', '2026-10-04T12:35:09Z'))
        memory, cpu, events = ci_report.resources({
            'samples': [{'cgroup': {'memory.current': str(2**30)}}],
            'cgroupBefore': {'memory.peak': str(9 * 2**30), 'cpu.stat': 'usage_usec 9000000', 'memory.events': 'max 8\noom 1\noom_kill 1'},
            'cgroupAfter': {'memory.max': str(3 * 2**30), 'cpu.stat': 'usage_usec 11000000', 'memory.events': 'max 10\noom 1\noom_kill 1'},
        })
        self.assertEqual(memory, '1.00 GiB / 3 GiB')
        self.assertEqual(cpu, 2)
        self.assertEqual(events, '2 / 0 / 0')

    def test_focused_browser_proof_is_not_reported_as_a_full_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            metadata = {
                'run': {'head_sha': 'a' * 40, 'created_at': '', 'run_attempt': 1},
                'scope': 'full', 'breadth': 'pr', 'leyline': 'b' * 40, 'jobs': [],
            }
            report = ci_report.render(Path(directory), metadata)
            self.assertIn('Runtime builds', report)
            self.assertIn('representative + changed specs', report)
            self.assertNotIn('full regressions', report)
            self.assertNotIn('Full gate', report)
            metadata['breadth'] = 'full'
            self.assertIn('full regressions', ci_report.render(Path(directory), metadata))

    def test_reused_proof_without_test_artifacts_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            report = ci_report.render(Path(directory), {
                'run': {'head_sha': 'abcdef0123456789', 'created_at': '2026-10-04T12:00:00Z', 'run_attempt': 2},
                'scope': 'full', 'sourceRun': '123', 'leyline': 'fedcba',
                'jobs': [{'name': 'CI gate', 'status': 'completed', 'conclusion': 'success',
                          'completed_at': '2026-10-04T12:01:00Z'}],
            })
            self.assertIn('Reuses tested-tree proof from run **123**', report)
            self.assertIn('includes earlier attempts and retry delay', report)
            self.assertIn('No JUnit results available', report)


if __name__ == '__main__':
    unittest.main()

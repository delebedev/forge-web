"""Summarise reported tests, job timing and sampled CI resource usage."""
import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def seconds(start, end):
    if not start or not end:
        return None
    elapsed = (datetime.fromisoformat(end.replace('Z', '+00:00')) -
               datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()
    return elapsed if elapsed >= 0 else None


def duration(value):
    return '—' if value is None else f'{value:.0f}s'


def suite(path):
    parts = path.parts
    if path.name == 'junit.xml':
        return 'Unit (Bun)' if path.parent.name == 'test-results' else path.parent.name
    for module in ['server', 'browser-engine', 'card-presentation']:
        if module in parts:
            return module + (' / OpenAPI export' if 'generateOpenApi' in parts else '')
    return path.parent.name


def test_results(root):
    counts = defaultdict(lambda: [0, 0, 0])
    slow = []
    warnings = []
    for path in sorted(root.rglob('*.xml')):
        if path.name != 'junit.xml' and not path.name.startswith('TEST-'):
            continue
        try:
            cases = ET.parse(path).getroot().iter('testcase')
            for case in cases:
                label = suite(path)
                failed = case.find('failure') is not None or case.find('error') is not None
                skipped = case.find('skipped') is not None
                counts[label][1 if failed else 2 if skipped else 0] += 1
                elapsed = float(case.get('time', '0'))
                if not skipped:
                    slow.append((elapsed, label, case.get('name', 'unnamed')))
        except (ET.ParseError, ValueError) as error:
            warnings.append(f'Unreadable test report {path.name}: {error}')
    return counts, sorted(slow, reverse=True), warnings


def counters(value):
    return {key: int(number) for key, number in
            (line.split() for line in value.splitlines())}


def resources(metric):
    before, after = metric.get('cgroupBefore', {}), metric.get('cgroupAfter', {})
    samples = [sample.get('cgroup', {}) for sample in metric.get('samples', [])]
    peak = max((int(sample['memory.current']) for sample in samples
                if 'memory.current' in sample), default=None)
    limit = after.get('memory.max')
    memory = '—' if peak is None else f'{peak / 2**30:.2f} GiB'
    if limit and limit != 'max':
        memory += f' / {int(limit) / 2**30:.0f} GiB'
    cpu = None
    if 'cpu.stat' in before and 'cpu.stat' in after:
        cpu = (counters(after['cpu.stat'])['usage_usec'] -
               counters(before['cpu.stat'])['usage_usec']) / 1e6
    events = '—'
    if 'memory.events' in before and 'memory.events' in after:
        old, new = counters(before['memory.events']), counters(after['memory.events'])
        events = ' / '.join(str(new.get(key, 0) - old.get(key, 0))
                            for key in ['max', 'oom', 'oom_kill'])
    return memory, cpu, events


def render(root, metadata):
    run = metadata['run']
    scope = {'full': 'Runtime builds', 'web': 'UI-only'}.get(metadata['scope'], metadata['scope'])
    breadth = {'pr': 'representative + changed specs', 'full': 'full regressions'}.get(
        metadata.get('breadth'), 'breadth unavailable')
    lines = ['## Forge Web CI', '',
             f"Validation: **{cell(scope)}** · browser proof: **{cell(breadth)}** · "
             f"attempt **{run['run_attempt']}**",
             f"Tested checkout: `{metadata.get('checkout', run['head_sha'])[:12]}` · "
             f"PR/branch head: `{run['head_sha'][:12]}` · Leyline: `{metadata['leyline'][:12]}`", '']
    if metadata.get('sourceRun'):
        lines += [f"Reuses tested-tree proof from run **{cell(metadata['sourceRun'])}**.", '']
    jobs = [job for job in metadata['jobs'] if job['name'] != 'Test report']
    gate = next((job for job in jobs if job['name'] == 'CI gate'), {})
    wall = seconds(run['created_at'], gate.get('completed_at'))
    if wall is not None:
        lines += [f"Trigger → gate: **{duration(wall)}**" +
                  (' (includes earlier attempts and retry delay)' if run['run_attempt'] > 1 else ''), '']
    lines += ['| Job | Result | Runner | Queue | Occupancy |',
              '| --- | --- | --- | ---: | ---: |']
    for job in jobs:
        queue = seconds(job.get('created_at'), job.get('started_at'))
        occupancy = seconds(job.get('started_at'), job.get('completed_at'))
        name = cell(job['name'])
        if job.get('html_url'):
            name = f"[{name}]({job['html_url']})"
        lines.append(f"| {name} | {cell(job.get('conclusion') or job['status'])} | "
                     f"{cell(job.get('runner_name') or '—')} | {duration(queue)} | {duration(occupancy)} |")
    lines += ['', 'Queue starts when GitHub creates the job; dependency waiting is separate. '
              'Reused jobs can have unavailable queue timing. Occupancy includes setup and cleanup.', '']
    counts, slow, warnings = test_results(root)
    if counts:
        lines += ['### Reported test outcomes', '',
                  '| Suite | Passed | Failed | Skipped |', '| --- | ---: | ---: | ---: |']
        for label, values in sorted(counts.items()):
            lines.append(f"| {cell(label)} | {values[0]} | {values[1]} | {values[2]} |")
        lines += ['', 'These are reported outcomes, including Gradle cached results. '
                  'OpenAPI export is a separate invocation, not additional unique tests.', '']
    else:
        lines += ['No JUnit results available for this scope or attempt.', '']
    metrics = []
    for path in sorted(root.rglob('*.json')):
        if path.name == 'timings.json':
            continue
        value = json.loads(path.read_text())
        if isinstance(value, dict) and 'samples' in value and 'exitCode' in value:
            metrics.append(value)
    if metrics:
        lines += ['### Command timing and resources', '',
                  '| Command | Producer attempt | Time | CPU used | Sampled memory / limit | Limit hits / OOM / kills | Exit |',
                  '| --- | ---: | ---: | ---: | --- | --- | ---: |']
        for metric in metrics:
            memory, cpu, events = resources(metric)
            lines.append(f"| {cell(metric['label'])} | {cell(metric.get('attempt') or '—')} | "
                         f"{duration(metric['seconds'])} | {duration(cpu)} | {memory} | "
                         f"{events} | {metric['exitCode']} |")
        lines += ['', 'Memory is sampled once per second. CPU and event counts are deltas '
                  'for each command, not billed minutes. Browser Local reports a command '
                  'result rather than a JUnit test count.', '']
    if slow:
        lines += ['<details><summary>Slowest reported unit/server tests and browser journeys</summary>', '']
        for browser in [False, True]:
            rows = [row for row in slow if (row[1] in
                    ['product', 'gre', 'forge-catalog', 'release-drain', 'transport']) == browser][:5]
            if rows:
                lines += [('Browser journeys' if browser else 'Unit/server tests') + ':', '']
                lines += [f'- {cell(label)}: {cell(name)} ({duration(elapsed)})'
                          for elapsed, label, name in rows]
                lines += ['']
        lines += ['</details>', '']
    lines += ['Extended qualification is separate from this gate. Coverage and historical '
              'flake rates are not measured by this report.', '']
    lines += [f'**Report warning:** {cell(warning)}' for warning in warnings]
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('artifacts', type=Path)
    parser.add_argument('metadata', type=Path)
    args = parser.parse_args()
    print(render(args.artifacts, json.loads(args.metadata.read_text())), end='')

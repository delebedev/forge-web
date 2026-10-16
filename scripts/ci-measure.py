#!/usr/bin/env python3
"""Run a CI command with timing and credential-free process/cgroup samples."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def cgroup():
    root = Path('/sys/fs/cgroup')
    return {name: (root / name).read_text().strip() for name in
            ['memory.current', 'memory.peak', 'memory.max', 'memory.events',
             'memory.swap.current', 'memory.swap.peak', 'cpu.max', 'cpu.stat']
            if (root / name).exists()}


def processes():
    result = subprocess.run(['ps', '-eo', 'rss,args'], capture_output=True, text=True)
    totals = {}
    for line in result.stdout.splitlines()[1:]:
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        rss, command = parts
        role = next((role for marker, role in [
            ('KotlinCompileDaemon', 'kotlin'), ('GradleDaemon', 'gradle'),
            ('forge.web.server.ServerKt', 'server'), ('chrom', 'chromium'),
            ('vite', 'vite'), ('playwright/test/cli', 'playwright'),
        ] if marker in command), None)
        if role:
            totals[role] = totals.get(role, 0) + int(rss)
    return totals


def main():
    label, *command = sys.argv[1:]
    directory = Path(os.environ.get('FORGE_CI_REPORT_DIR', 'test-results/ci'))
    directory.mkdir(parents=True, exist_ok=True)
    started = time.time()
    before = cgroup()
    proc = subprocess.Popen(command, start_new_session=True)
    def stop(signum, _frame):
        if proc.poll() is None:
            os.killpg(proc.pid, signum)
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, stop)
    samples = []
    while proc.poll() is None:
        samples.append({'elapsed': round(time.time() - started, 3),
                        'cgroup': cgroup(), 'rssKiB': processes()})
        time.sleep(1)
    report = {'label': label, 'start': started, 'seconds': time.time() - started,
              'exitCode': proc.returncode, 'cgroupBefore': before, 'cgroupAfter': cgroup(),
              'runId': os.environ.get('GITHUB_RUN_ID'),
              'attempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'samples': samples}
    (directory / f'{label}.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'{label}: {report["seconds"]:.1f}s, exit {proc.returncode}', file=sys.stderr)
    return proc.returncode if proc.returncode >= 0 else 128 - proc.returncode


if __name__ == '__main__':
    sys.exit(main())

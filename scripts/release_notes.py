#!/usr/bin/env python3
"""Deployment evidence, a release-note draft, and one public entry per day."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'scripts/release-notes'
REPO = 'delebedev/forge-web'
MODEL = 'qwen/qwen3.8-flash'
SHA = re.compile(r'[0-9a-f]{40}\Z')
TAG = re.compile(r'deploy-[0-9]+\Z')


def run(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def gh(*args):
    return run('gh', *args, '--repo', REPO)


def api(path):
    return json.loads(run('gh', 'api', path))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def releases():
    pages = json.loads(run('gh', 'api', '--paginate', '--slurp', f'repos/{REPO}/releases'))
    return [r for page in pages for r in page if TAG.fullmatch(r['tag_name'])]


def asset(tag, name):
    if not TAG.fullmatch(tag):
        raise ValueError('Invalid deployment tag')
    with tempfile.TemporaryDirectory() as directory:
        gh('release', 'download', tag, '--pattern', name, '--dir', directory)
        return json.loads((Path(directory) / name).read_text())


def pin(revision, path='leyline'):
    return run('git', 'rev-parse', f'{revision}:{path}')


def changes(repo, before, after, label):
    if before == after:
        return []
    for sha in (before, after):
        if not SHA.fullmatch(sha):
            raise ValueError('Invalid source SHA')
        if subprocess.run(['git', 'cat-file', '-e', f'{sha}^{{commit}}'], cwd=repo, capture_output=True).returncode:
            run('git', 'fetch', '--no-tags', 'origin', sha, cwd=repo)
    if run('git', 'rev-parse', '--is-shallow-repository', cwd=repo) == 'true':
        run('git', 'fetch', '--no-tags', '--unshallow', 'origin', before, after, cwd=repo)
    if subprocess.run(['git', 'merge-base', before, after], cwd=repo, capture_output=True).returncode:
        raise ValueError('Source histories have no common baseline')
    rows = run('git', 'log', '--left-right', '--cherry-pick', '--reverse',
               '--format=%m%H%x09%s', f'{before}...{after}', cwd=repo)
    result = []
    for row in rows.splitlines():
        marked_sha, title = row.split('\t', 1)
        removed, sha = marked_sha[0] == '<', marked_sha[1:]
        diff = run('git', 'show', '--format=', '--no-ext-diff', '--no-renames',
                   *(['-R'] if removed else []), sha, cwd=repo)
        match = re.search(r'\(#(\d+)\)$', title)
        pr = {}
        if match:
            owner = 'delebedev/leyline' if label == 'leyline' else REPO
            pr = api(f'repos/{owner}/pulls/{match[1]}')
        result.append({'id': f'{label}:{sha[:8]}', 'title': ('Removed deployed change: ' if removed else '') + title,
                       'removed': removed, 'revision': sha,
                       'pr': pr.get('html_url'), 'description': pr.get('body', ''),
                       'files': run('git', 'diff-tree', '--no-commit-id', '--name-only', '-r', sha, cwd=repo).splitlines(),
                       'diff': diff[:24000], 'diff_truncated': len(diff) > 24000})
    return result


def collect(deployment, base=None):
    # Python 3.8 runners use the system timezone database.
    previous_timezone = os.environ.get('TZ')
    try:
        os.environ['TZ'] = 'Europe/London'
        time.tzset()
        day = datetime.fromisoformat(deployment['deployed_at'].replace('Z', '+00:00')).astimezone().date().isoformat()
    finally:
        if previous_timezone is None:
            os.environ.pop('TZ', None)
        else:
            os.environ['TZ'] = previous_timezone
        time.tzset()
    bootstrap = json.loads((DATA / 'bootstrap.json').read_text())
    published = [r for r in releases() if not r['draft']]
    previous = []
    prior_headlines = []
    same_day = []
    for release in published:
        manifest = asset(release['tag_name'], 'manifest.json')
        if manifest['day'] < day:
            previous.append(manifest)
            prior_headlines.append((manifest['day'], manifest['run_id'], re.findall(r'^### (.+)$', release['body'], re.M)))
        elif manifest['day'] == day:
            same_day.append((manifest['run_id'], release['body']))
    baseline = max(previous, key=lambda m: (m['day'], m['run_id'])) if previous else bootstrap
    if base:
        baseline = base if isinstance(base, dict) else {'frontend': base, 'backend': base, 'day': '0001-01-01'}
    if baseline['day'] > day:
        raise ValueError('Deployment predates notes checkpoint; supply an explicit baseline')
    items = changes(ROOT, baseline['frontend'], deployment['frontend'], 'web')
    seen = {item['id'] for item in items}
    items += [item for item in changes(ROOT, baseline['backend'], deployment['backend'], 'web') if item['id'] not in seen]
    old_pin, new_pin = pin(baseline['backend']), pin(deployment['backend'])
    items += changes(ROOT / 'leyline', old_pin, new_pin, 'leyline')
    # Browser runtime also ships in the frontend bundle. Usually the pins match.
    frontend_pin = pin(deployment['frontend'])
    if frontend_pin != new_pin:
        seen = {item['id'] for item in items}
        items += [item for item in changes(ROOT / 'leyline', old_pin, frontend_pin, 'leyline') if item['id'] not in seen]
    carried = re.findall(r'^[-*] (.+)$', max(same_day)[1], re.M) if same_day else (bootstrap['bullets'] if bootstrap['day'] == day else [])
    for index, text in enumerate(carried):
        items.append({'id': f'carried:{index}', 'title': text, 'evidence': 'Previously published public entry for this day'})
    headlines = [headline for _, _, values in sorted(prior_headlines, reverse=True) for headline in values]
    headlines += re.findall(r'^### (.+)$', (DATA / 'history.md').read_text(), re.M)
    baseline = {key: baseline[key] for key in ('day', 'frontend', 'backend', 'run_id', 'deployed_at', 'kind') if key in baseline}
    return {'schema': 1, 'day': day, **deployment, 'baseline': baseline,
            'changes': items, 'recent_headlines': list(dict.fromkeys(headlines))[:7],
            'carried_headline': re.findall(r'^### (.+)$', max(same_day)[1] if same_day else (DATA / 'history.md').read_text(), re.M)[0]}


def validate_candidate(candidate, manifest):
    if set(candidate) != {'headline', 'bullets', 'coverage'}:
        raise ValueError('Unexpected candidate fields')
    def text(value):
        if not isinstance(value, str) or not value.strip() or '\n' in value or len(value) > 600:
            raise ValueError('Invalid text')
    text(candidate['headline'])
    ids = {item['id'] for item in manifest['changes']}
    coverage = candidate['coverage']
    if len(coverage) != len(ids) or {row['id'] for row in coverage} != ids:
        raise ValueError(f'Coverage must have exactly one row per ID: {sorted(ids)}')
    audiences = {}
    for row in coverage:
        if row['audience'] not in ('player', 'internal', 'uncertain'):
            raise ValueError('Invalid audience')
        text(row['fact']); text(row['reason'])
        audiences[row['id']] = row['audience']
    covered = set()
    for bullet in candidate['bullets']:
        text(bullet['text'])
        if not bullet['sources'] or any(audiences.get(source) != 'player' for source in bullet['sources']):
            raise ValueError(f'Bullet cites an internal, uncertain or absent source: {bullet}')
        covered.update(bullet['sources'])
    carried = {i for i in ids if i.startswith('carried:')}
    texts = {bullet['text'].strip() for bullet in candidate['bullets']}
    covered.update(item['id'] for item in manifest['changes'] if item['id'] in carried and item['title'].strip() in texts)
    if not carried <= covered:
        raise ValueError(f'Public bullets must retain earlier published changes and cite these missing carried IDs: {sorted(carried - covered)}')


def model_evidence(manifest):
    packet = dict(manifest)
    packet['changes'] = []
    for item in manifest['changes']:
        compact = dict(item)
        if 'diff' in compact:
            compact['diff'] = item['diff'][:4000]
            compact['diff_truncated'] = item['diff_truncated'] or len(item['diff']) > 4000
        if 'description' in compact:
            compact['description'] = item['description'][:4000]
            compact['description_truncated'] = len(item['description']) > 4000
        packet['changes'].append(compact)
    return packet


def response_schema(manifest):
    ids = [item['id'] for item in manifest['changes']]
    def obj(properties):
        return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}
    string = {'type': 'string'}
    identifier = {'type': 'string', 'enum': ids}
    bullet = obj({'text': string, 'sources': {'type': 'array', 'items': identifier}})
    coverage = obj({'audience': {'type': 'string', 'enum': ['player', 'internal', 'uncertain']},
                    'fact': string, 'reason': string})
    return {'type': 'json_schema', 'json_schema': {'name': 'release_notes', 'strict': True,
            'schema': obj({'headline': string, 'bullets': {'type': 'array', 'items': bullet},
                           'coverage': obj({identifier: coverage for identifier in ids})})}}


def model_candidate(model, manifest):
    started = time.monotonic()
    result, candidate, attempts = {}, None, []
    try:
        payload = {'model': model, 'messages': [
            {'role': 'system', 'content': (DATA / 'prompt.md').read_text()},
            {'role': 'user', 'content': json.dumps({'evidence': model_evidence(manifest), 'editorial_examples': json.loads((DATA / 'taste.json').read_text())})}],
            'response_format': response_schema(manifest), 'max_tokens': 12000,
            'reasoning': {'enabled': False},
            'provider': {'require_parameters': True}}
        for attempt in range(2):
            request = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
                data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + os.environ['OPEN_ROUTER_API_KEY'],
                'Content-Type': 'application/json', 'HTTP-Referer': 'https://forgeweb.app', 'X-Title': 'Forge Web release notes'})
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
            attempts.append({'usage': result.get('usage', {}), 'response': result.get('choices', [])})
            content = result['choices'][0]['message']['content']
            candidate = json.loads(content)
            candidate['coverage'] = [{'id': key, **value} for key, value in candidate['coverage'].items()]
            try:
                validate_candidate(candidate, manifest)
                return {'model': model, 'candidate': candidate, 'usage': result.get('usage', {}),
                        'total_cost': sum(a['usage'].get('cost', 0) for a in attempts), 'attempts': attempts,
                        'seconds': round(time.monotonic() - started, 2)}
            except ValueError as error:
                if attempt:
                    raise
                payload['messages'] += [{'role': 'assistant', 'content': content},
                    {'role': 'user', 'content': f'Validation failed: {error}. Correct the complete JSON. Preserve every published carried change in public bullets.'}]
    except Exception as error:
        return {'model': model, 'error': str(error), 'usage': result.get('usage', {}),
                'total_cost': sum(a['usage'].get('cost', 0) for a in attempts), 'attempts': attempts,
                'raw_candidate': candidate, 'seconds': round(time.monotonic() - started, 2)}


def entry(day, candidate):
    return f"## {day}\n\n### {candidate['headline']}\n\n" + ''.join(f"- {b['text']}\n" for b in candidate['bullets'])


def generate(manifest, output):
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'manifest.json', manifest)
    write_json(output / 'model-evidence.json', model_evidence(manifest))
    if len(json.dumps(model_evidence(manifest))) > 600000:
        raise ValueError('Evidence exceeds draft budget; publish the backlog in smaller verified bundles')
    if any(not item['id'].startswith('carried:') for item in manifest['changes']):
        result = model_candidate(MODEL, manifest)
    else:
        candidate = {'headline': manifest.get('carried_headline', 'No new player changes'),
                     'bullets': [{'text': item['title'], 'sources': [item['id']]} for item in manifest['changes']],
                     'coverage': [{'id': item['id'], 'audience': 'player', 'fact': item['title'],
                                   'reason': 'Previously published copy retained unchanged.'} for item in manifest['changes']]}
        result = {'model': MODEL, 'skipped': 'No shipped changes', 'usage': {}, 'total_cost': 0, 'seconds': 0,
                  'candidate': candidate}
    write_json(output / 'draft.json', result)
    if 'error' in result:
        raise ValueError('Draft failed; inspect draft.json: ' + result['error'])
    validate_candidate(result['candidate'], manifest)
    (output / 'draft.md').write_text(entry(manifest['day'], result['candidate']))
    return result


def publication_snapshot(manifest, candidate):
    fields = ('schema', 'day', 'frontend', 'backend', 'run_id', 'deployed_at', 'kind')
    public = {key: manifest[key] for key in fields if key in manifest}
    public['baseline'] = {key: value for key, value in manifest.get('baseline', {}).items() if key in fields}
    public['changes'] = [{'id': item['id'], **({'title': item['title']} if item['id'].startswith('carried:') else {})}
                         for item in manifest['changes']]
    draft = {'candidate': {'headline': candidate['headline'],
        'bullets': [{'text': bullet['text'], 'sources': bullet['sources']} for bullet in candidate['bullets']],
        'coverage': [
        {'id': row['id'], 'audience': row['audience'], 'fact': 'Source classified.', 'reason': 'Source classified.'}
        for row in candidate['coverage']]}}
    return public, draft


def draft(deployment, output, base=None, reuse_existing=False):
    run_info = api(f"repos/{REPO}/actions/runs/{deployment['run_id']}")
    if (run_info['conclusion'] != 'success' or run_info['head_branch'] != 'main'
            or run_info['path'] != '.github/workflows/publish-web.yml'
            or run_info['head_sha'] != deployment['frontend']):
        raise ValueError('Notes require a successful main deployment of this frontend SHA')
    tag = f"deploy-{deployment['run_id']}"
    existing = next((r for r in releases() if r['tag_name'] == tag), None)
    if existing and reuse_existing:
        output.mkdir(parents=True, exist_ok=True)
        (output / 'draft.md').write_text(existing['body'])
        print(f'Reusing generated notes for {tag}')
        return
    if existing and not existing['draft']:
        raise ValueError('Published release is immutable to regeneration; create a new deployment draft')
    if base is None and existing:
        base = asset(tag, 'manifest.json')['baseline']
    manifest = collect(deployment, base)
    generate(manifest, output)
    if any(r['tag_name'] == tag for r in releases()):
        gh('release', 'edit', tag, '--notes-file', str(output / 'draft.md'))
    else:
        gh('release', 'create', tag, '--target', deployment['frontend'], '--draft', '--title', manifest['day'], '--notes-file', str(output / 'draft.md'))
    public = output / 'public'
    public.mkdir(exist_ok=True)
    manifest_snapshot, draft_snapshot = publication_snapshot(manifest, json.loads((output / 'draft.json').read_text())['candidate'])
    write_json(public / 'manifest.json', manifest_snapshot)
    write_json(public / 'draft.json', draft_snapshot)
    gh('release', 'upload', tag, str(public / 'manifest.json'), str(public / 'draft.json'), '--clobber')
    print(f'Draft {tag}: {output / "draft.md"}')


def feed(tag, output):
    manifest = asset(tag, 'manifest.json')
    candidate = asset(tag, 'draft.json')['candidate']
    validate_candidate(candidate, manifest)
    if not candidate['bullets']:
        print('No player changes; public feed unchanged')
        return
    all_releases = releases()
    entries = {}
    for release in all_releases:
        if release['draft'] or release['tag_name'] == tag:
            continue
        other = asset(release['tag_name'], 'manifest.json')
        day = other['day']
        if day == manifest['day'] and other['run_id'] > manifest['run_id']:
            raise ValueError('A newer deployment for this day was already published')
        if day not in entries or entries[day][0] < other['run_id']:
            entries[day] = (other['run_id'], release['body'])
    selected = entry(manifest['day'], candidate)
    entries[manifest['day']] = (manifest['run_id'], selected)
    history = re.split(r'(?=^## )', (DATA / 'history.md').read_text(), flags=re.M)
    for block in history:
        if block.strip():
            entries.setdefault(block.splitlines()[0][3:], (0, block))
    output.mkdir(parents=True, exist_ok=True)
    (output / 'selected.md').write_text(selected)
    (output / 'whats-new.md').write_text('\n\n'.join(entries[day][1].strip() for day in sorted(entries, reverse=True)) + '\n')
    print(f'Ready: {output / "whats-new.md"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    draft_parser = sub.add_parser('draft')
    draft_parser.add_argument('--deployment', type=Path, required=True)
    draft_parser.add_argument('--base')
    draft_parser.add_argument('--reuse-existing', action='store_true')
    draft_parser.add_argument('--output', type=Path, required=True)
    feed_parser = sub.add_parser('feed')
    feed_parser.add_argument('--tag', required=True)
    feed_parser.add_argument('--output', type=Path, required=True)
    feedback = sub.add_parser('feedback')
    feedback.add_argument('kind', choices=['like', 'dislike', 'bs'])
    feedback.add_argument('--text', required=True)
    feedback.add_argument('--reason', required=True)
    args = parser.parse_args()
    if args.command == 'draft':
        deployment = json.loads(args.deployment.read_text())
        if set(deployment) != {'frontend', 'backend', 'run_id', 'deployed_at', 'kind'}:
            raise ValueError('Unexpected deployment fields')
        draft(deployment, args.output.resolve(), args.base, args.reuse_existing)
    elif args.command == 'feed':
        feed(args.tag, args.output.resolve())
    else:
        examples = json.loads((DATA / 'taste.json').read_text())
        examples.append({'kind': args.kind, 'text': args.text, 'reason': args.reason})
        write_json(DATA / 'taste.json', examples)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Read-only source inventory. Private JSONL output; stdout never includes paths."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOTS = {
    'Внутренняя база знаний ЭВО': 'internal',
    'Клиентская база знаний ЭВО': 'approved-client-knowledge',
    'Сырой архив ЭВО': 'raw',
    'Секреты и доступы ЭВО': 'secrets',
}
CHUNK = 4 * 1024 * 1024


def signature(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]


def private_output(path: Path, source: Path):
    # Reject symlinked ancestors before resolve, including an existing output file.
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('output_symlink')
    resolved = path.resolve()
    if resolved == source or source in resolved.parents:
        raise ValueError('output_inside_source')
    if any((p / '.git').exists() for p in [resolved.parent, *resolved.parents]):
        raise ValueError('output_inside_git')
    resolved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(resolved.parent, 0o700)
    return resolved


def write_json(path, data):
    temp = path.with_name(path.name + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def is_key(path):
    return any('ключи' in part.casefold() or part.casefold() in {'keys', '.ssh'} for part in path.parts) or path.suffix in {'.key', '.pem'}


def proposal(scope, relative):
    parts = list(relative.parts)
    if scope == 'secrets':
        return ['Секреты и доступы', *parts[:-1]]
    if scope == 'raw':
        return ['Сырой архив', *parts[:-1]]
    if any(p.startswith('.') for p in parts):
        return ['Сырой архив', 'Служебные файлы локальной базы', scope, *parts[:-1]]
    topic = {
        'О компании и услугах': ['Компания', 'Услуги и условия EVO'],
        'Компания': ['Компания'],
        'О компании': ['Компания', 'О компании'],
        'FAQ и шаблоны ответов': ['ИИ-ассистент', 'Вопросы и ответы'],
        'О базе и правила ответов': ['ИИ-ассистент', 'Правила ответов'],
        'Стоимость и услуги': ['Компания', 'Услуги и условия EVO'],
        'Страны': ['Страны и поступление'],
        'Университеты': ['Страны и поступление', 'Университеты'],
        'Визы': ['Страны и поступление', 'Общие условия и виза'],
        'Поступление и документы': ['Процессы и инструкции', 'Поступление'],
    }
    for index, part in enumerate(parts[:-1]):
        if part in topic:
            return ['Внутренняя база EVO', *topic[part], *parts[index + 1:-1]]
    return ['Внутренняя база EVO', *parts[:-1]]


def inventory(args):
    source = Path(args.source).absolute()
    if source.is_symlink():
        raise ValueError('source_symlink')
    source = source.resolve(strict=True)
    output = private_output(Path(args.output).absolute(), source)
    journal = output.with_name(output.name + '.journal')
    summary_path = output.with_name(output.name + '.summary.json')
    for p in (journal, summary_path):
        private_output(p, source)
    prior = {}
    for p in (output, journal):
        if p.exists():
            valid_end = 0
            truncate_at = None
            with p.open('rb') as stream:
                for line in stream:
                    try:
                        row = json.loads(line)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        # Only the incomplete final journal write is recoverable.
                        if p != journal or line.endswith(b'\n') or stream.read():
                            raise ValueError('inventory_corrupt')
                        truncate_at = valid_end
                        break
                    if row.get('sourceRoot') != str(source):
                        raise ValueError('inventory_source_mismatch')
                    prior[row['relativePath']] = row
                    valid_end += len(line)
            if truncate_at is not None:
                with p.open('r+b') as stream:
                    stream.truncate(truncate_at)
    rows = []
    counts = Counter()
    boundary = {}
    interrupted = False
    fd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as log:
        os.fchmod(log.fileno(), 0o600)
        for root_name, scope in ROOTS.items():
            root = source / root_name
            boundary[scope] = Counter()
            if not root.is_dir() or root.is_symlink():
                rows.append({'sourceRoot': str(source), 'relativePath': root_name, 'scope': scope, 'status': 'missing_or_unsafe_root'})
                counts['errors'] += 1
                continue
            walk_errors = []
            for directory, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: walk_errors.append(e.filename)):
                links = [n for n in dirs if (Path(directory) / n).is_symlink()]
                dirs[:] = sorted(n for n in dirs if n not in links)
                for name in sorted([*files, *links]):
                    path = Path(directory) / name
                    relative = path.relative_to(source).as_posix()
                    within = path.relative_to(root)
                    base = {'sourceRoot': str(source), 'relativePath': relative, 'scope': scope,
                            'proposedFolder': proposal(scope, within),
                            'analysis': 'none' if scope in {'raw', 'secrets'} else 'pending_content_review'}
                    try:
                        before = path.lstat()
                        base.update({'bytes': before.st_size, 'signature': signature(before), 'extension': path.suffix.casefold()})
                        if not stat.S_ISREG(before.st_mode):
                            row = {**base, 'status': 'excluded_non_regular'}
                        elif scope == 'secrets' and is_key(within):
                            row = {**base, 'status': 'retained_key_outside_export'}
                        elif (old := prior.get(relative)) and old.get('signature') == signature(before) and old.get('status') == 'hashed':
                            row = {**base, 'status': 'hashed', 'sha256': old['sha256']}
                            counts['reused'] += 1
                        else:
                            digest = hashlib.sha256()
                            file_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                            with os.fdopen(file_fd, 'rb') as stream:
                                if signature(os.fstat(stream.fileno())) != signature(before):
                                    raise ValueError('source_changed')
                                while chunk := stream.read(CHUNK):
                                    digest.update(chunk)
                                after = os.fstat(stream.fileno())
                            if signature(before) != signature(after) or signature(path.lstat()) != signature(before):
                                raise ValueError('source_changed')
                            row = {**base, 'status': 'hashed', 'sha256': digest.hexdigest()}
                            counts['newlyHashed'] += 1
                    except (OSError, ValueError) as exc:
                        row = {**base, 'status': 'error', 'error': 'source_changed' if isinstance(exc, ValueError) else 'source_unreadable'}
                    rows.append(row)
                    counts[row['status']] += 1
                    boundary[scope]['files'] += 1
                    boundary[scope]['bytes'] += row.get('bytes', 0)
                    boundary[scope][row['status']] += 1
                    log.write(json.dumps(row, ensure_ascii=False) + '\n')
                    log.flush()
                    os.fsync(log.fileno())
                    if args.max_files and len(rows) >= args.max_files:
                        interrupted = True
                        break
                if interrupted:
                    break
            for error_path in walk_errors:
                rows.append({'sourceRoot': str(source), 'relativePath': os.path.relpath(error_path, source), 'scope': scope, 'status': 'directory_unreadable'})
                counts['errors'] += 1
            if interrupted:
                break
    unique = {(r['scope'], r['sha256']) for r in rows if r['status'] == 'hashed'}
    summary = {'schema': 'evo-knowledge-inventory/v1', 'at': datetime.now(timezone.utc).isoformat(),
               'complete': not interrupted and not counts['error'] and not counts['errors'] and not counts['excluded_non_regular'],
               'interrupted': interrupted, 'counts': dict(counts), 'boundaries': boundary,
               'uniqueBoundaryBlobs': len(unique), 'duplicateLocations': counts['hashed'] - len(unique),
               'imported': 0, 'sorted': False}
    if not interrupted:
        temp = output.with_name(output.name + '.tmp')
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, output)
        journal.unlink()
    write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary['complete'] else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--max-files', type=int, help='Stop after a real control batch; rerun without this option to resume.')
    args = parser.parse_args()
    try:
        return inventory(args)
    except (OSError, ValueError):
        print(json.dumps({'error': 'inventory_failed', 'complete': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

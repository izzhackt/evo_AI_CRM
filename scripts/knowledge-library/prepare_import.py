#!/usr/bin/env python3
"""Build a private, deterministic filing plan from the verified inventory.
Reads path metadata and headings/status of explicitly reviewed Markdown. Does not publish facts or alter sources.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import uuid
from inventory import private_output, write_json

AREA = {'Внутренняя база EVO': 'internal', 'Сырой архив': 'raw', 'Секреты и доступы': 'secrets'}
TOPICS = {
    'компан': 'Компания', 'услуг': 'Компания', 'стоимост': 'Компания',
    'регламент': 'Процессы и инструкции', 'процесс': 'Процессы и инструкции', 'инструкц': 'Процессы и инструкции',
    'команд': 'Команда и партнёры', 'партнёр': 'Команда и партнёры', 'партнер': 'Команда и партнёры',
    'шаблон': 'Шаблоны документов', 'договор': 'Шаблоны документов',
    'термин': 'Словарь EVO', 'словар': 'Словарь EVO',
    'стран': 'Страны и поступление', 'университет': 'Страны и поступление', 'программ': 'Страны и поступление',
    'ассистент': 'ИИ-ассистент', 'faq': 'ИИ-ассистент', 'вопросы и ответы': 'ИИ-ассистент',
}

def clean(name):
    # New CRM folders follow the agreed human-facing convention. Original paths are retained verbatim.
    value = re.sub(r'^\d+[_ .-]+', '', name).strip()
    return value or name


def plan(row):
    relative = Path(row['relativePath'])
    within = relative.parts[1:]
    if row['status'] != 'hashed':
        return {**row, 'importStatus': row['status'], 'action': 'retain_outside_crm', 'reason': 'Ключ или небезопасный тип файла не переносится в библиотеку.'}
    proposed = row['proposedFolder']
    area = AREA[proposed[0]]
    folders = [clean(p) for p in proposed[1:]]
    classification = 'source_archive'
    editable = False
    question = ''
    if row['scope'] == 'approved-client-knowledge':
        area = 'internal'
        classification = 'historically_approved_general_client_knowledge'
        editable = row['extension'] == '.md' and row['bytes'] <= 2_097_152 and not any(p.startswith('.') for p in within)
        if not folders:
            folders = ['ИИ-ассистент', 'Правила базы']
    elif row['scope'] == 'internal' and area == 'internal':
        if 'Утверждено для внутреннего ИИ' in within:
            classification = 'historically_approved_internal_knowledge'
            editable = row['extension'] == '.md' and row['bytes'] <= 2_097_152
            if folders and folders[0] == 'Утверждено для внутреннего ИИ':
                folders = ['Внутренние знания', *folders[1:]]
        elif 'Внутренние знания' in within:
            classification = 'internal_working_material'
            editable = row['extension'] == '.md' and row['bytes'] <= 2_097_152
        elif 'Входящие кандидаты' in within:
            classification = 'unapproved_candidate'
            if 'Извлеченный текст' in within or 'Извлечённый текст' in within:
                area = 'raw'
                folders = ['Производные исходников', *folders[1:]]
            else:
                folders = ['Процессы и инструкции', 'Подготовка базы знаний', *folders[1:]]
            question = 'Материал был кандидатом. Нужна проверка источника и актуальности; перенос не означает утверждение.'
        elif 'Закрытые производные материалы' in within:
            classification = 'restricted_derivative'
            area = 'raw'
            folders = ['Производные исходников', 'Закрытые производные материалы', *folders[1:]]
            question = 'Уточнить назначение и подтверждённую принадлежность закрытой производной переписки. Это не утверждённое общее знание.'
        elif 'Архив версий' in within:
            classification = 'historical_version'
        else:
            classification = 'local_workspace_documentation'
        if not folders:
            folders = ['Процессы и инструкции', 'Устройство базы знаний']
        # Use existing topic labels; never infer a person's case from their name.
        if folders and folders[0] == 'Внутренние знания' and len(folders) > 1 and folders[1] != 'Закрытые производные материалы':
            topic = next((target for token, target in TOPICS.items() if token in folders[1].casefold()), None)
            if topic: folders = [topic, *folders[1:]]
    elif row['scope'] == 'secrets':
        classification = 'protected_source'
    key = hashlib.sha256(('evo-local-2026-09-19\0' + row['relativePath']).encode()).hexdigest()
    return {**row, 'sourceKey': key, 'nodeId': str(uuid.uuid5(uuid.NAMESPACE_URL, 'evo-knowledge:' + key)), 'area': area, 'folders': folders,
            'kind': 'page' if editable else 'file', 'title': relative.stem if editable else relative.name,
            'classification': classification, 'reviewQuestion': question,
            'action': 'protected_import' if area == 'secrets' else 'import',
            'reason': 'Исходная область, статус и названия папок; содержимое не анализировалось.',
            'authority': 'preserved_from_source_no_new_approval', 'importStatus': 'pending'}



def classify_reviewed_text(entry, root):
    # Only the 2-MiB-capped, approved/working Markdown already admitted as pages.
    # Raw exports, Trash/Spam, applicant files and closed derivatives are never opened.
    if entry.get('kind') != 'page' or entry.get('area') != 'internal':
        return entry
    source = root / entry['relativePath']
    if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
        raise ValueError('source_path_invalid')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise ValueError('source_changed')
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return {**entry, 'kind': 'file', 'title': source.name, 'reason': 'Текст не является UTF-8; сохранён исходный файл.'}
    lines = text.splitlines()
    frontmatter = []
    if lines and lines[0].strip() == '---':
        for line in lines[1:100]:
            if line.strip() == '---': break
            frontmatter.append(line)
    title = entry['title']
    start = len(frontmatter) + 2 if frontmatter else 0
    fence = None
    for line in lines[start:]:
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            current = marker.group(1)[0]
            fence = None if fence == current else current if fence is None else fence
            continue
        heading = re.match(r'^#\s+(.+?)(?:\s+#+)?\s*$', line) if fence is None else None
        if heading:
            candidate = heading.group(1).strip()
            if 1 <= len(candidate) <= 240 and not re.search(r'[\x00-\x1f/\\]', candidate):
                title = candidate
            break
    headings = [line.lstrip('# ').strip().lower() for line in lines if line.startswith('#')][:30]
    heading_text = ' '.join([entry['title'].lower(), *headings])
    topics = {topic for token, topic in TOPICS.items() if token in heading_text}
    folders = entry['folders']
    if len(topics) == 1 and folders and folders[0] in {'Внутренние знания','Процессы и инструкции'}:
        topic = next(iter(topics))
        if folders[0] == 'Внутренние знания': folders = [topic, *folders[1:]]
    review = entry.get('reviewQuestion','')
    if any(re.search(r'^(?:status|статус)\s*:.*(?:conflict|needs.review|на уточнении|конфликт)', line, re.I) for line in frontmatter):
        review = 'В исходной странице отмечен конфликт или необходимость проверки. Требуется подтверждение.'
    return {**entry, 'title': title, 'folders': folders, 'reviewQuestion': review,
            'reason': 'Существующая группировка, заголовки и статус разрешённой текстовой страницы; факты и признаки утверждения сохранены.'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--inventory', required=True); ap.add_argument('--output', required=True)
    args = ap.parse_args()
    input_path = Path(args.inventory).resolve(strict=True)
    rows = [json.loads(line) for line in input_path.read_text().splitlines() if line.strip()]
    if not rows or any(x['status'] not in {'hashed', 'retained_key_outside_export'} for x in rows):
        raise SystemExit('inventory_not_complete')
    output = private_output(Path(args.output).absolute(), Path(rows[0]['sourceRoot']))
    planned = [classify_reviewed_text(plan(row), Path(rows[0]['sourceRoot'])) for row in rows]
    result = {'version': 1, 'inventorySha256': hashlib.sha256(input_path.read_bytes()).hexdigest(),
              'preparedAt': datetime.now(timezone.utc).isoformat(), 'sourceRoot': rows[0]['sourceRoot'],
              'entries': planned}
    write_json(output, result)
    counts = Counter((r['area'] if 'area' in r else 'outside', r.get('kind','key'),r['action']) for r in planned)
    summary = {'sourceEntries': len(rows), 'plannedEntries': len(planned), 'imported': 0,
               'classification': 'archive_metadata_and_reviewed_text_headings',
               'groups': [{'area': k[0], 'kind': k[1], 'action': k[2], 'count': n} for k,n in sorted(counts.items())]}
    write_json(output.with_suffix('.summary.json'), summary)
    print(json.dumps(summary, ensure_ascii=False))

if __name__ == '__main__': main()

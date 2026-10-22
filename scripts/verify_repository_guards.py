#!/usr/bin/env python3
"""Read-only public repository guards: migrations and tracked secrets."""
from __future__ import annotations
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import subprocess
import sys

MIN_REQUIRED_MIGRATION = 38
MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")
BLOCKED_NAMES = {'.dev.vars', '.env', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519'}
BLOCKED_SUFFIXES = {'.pem', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db'}


def verify_migrations(root: Path, minimum: int = MIN_REQUIRED_MIGRATION) -> int:
    folder = root / 'migrations'
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError('Migration directory is missing or unsafe')
    entries = sorted(p for p in folder.iterdir() if p.suffix == '.sql')
    if len(entries) < minimum:
        raise ValueError(f'Expected at least {minimum} migration files, found {len(entries)}')
    seen: set[int] = set()
    for p in entries:
        m = MIGRATION_NAME.fullmatch(p.name)
        if m is None or p.is_symlink() or not p.is_file():
            raise ValueError(f'Invalid or unsafe migration file: {p.name}')
        number = int(m.group(1))
        if number in seen:
            raise ValueError(f'Duplicate migration number: {number:04d}')
        seen.add(number)
        if not p.read_bytes().strip():
            raise ValueError(f'Empty migration file: {p.name}')
    count = max(seen)
    if seen != set(range(1, count + 1)):
        missing = sorted(set(range(1, count + 1)) - seen)
        raise ValueError(f'Migration sequence has gaps: {missing}')
    return count




def verify_pinned_migrations(root: Path, manifest_path: Path | None = None) -> int:
    """Reject silent edits or renames of migrations 0001-0038.

    Git blob object IDs are pinned to the audited development commit.
    Later additive migrations remain possible; this lock covers only the
    38 existing migrations. It does not execute any SQL or access D1.
    """
    manifest_file = manifest_path or root / 'scripts' / 'pinned-migrations.json'
    document = json.loads(manifest_file.read_text(encoding='utf-8'))
    if not isinstance(document, dict) or document.get('schema') != 1:
        raise ValueError('Invalid pinned migrations manifest')
    entries = document.get('git_blobs')
    if not isinstance(entries, dict) or len(entries) != MIN_REQUIRED_MIGRATION:
        raise ValueError('Pinned migration inventory must contain exactly 38 files')
    expected = {}
    for index, (relative, sha) in enumerate(sorted(entries.items()), start=1):
        if (not isinstance(relative, str) or
                not re.fullmatch(r'migrations/\d{4}_[a-z0-9_]+\.sql', relative) or
                int(relative.split('/')[1][:4]) != index or
                not isinstance(sha, str) or
                re.fullmatch(r'[0-9a-f]{40}', sha) is None):
            raise ValueError('Invalid pinned migration path or Git blob SHA')
        expected[relative] = sha
    current = {
        f'migrations/{p.name}'
        for p in (root / 'migrations').iterdir()
        if p.suffix == '.sql' and p.name[:4].isdigit()
        and int(p.name[:4]) <= MIN_REQUIRED_MIGRATION
    }
    if current != set(expected):
        raise ValueError('Pinned migration filenames were changed')
    for relative, original_sha in expected.items():
        file = root / relative
        if not file.is_file() or file.is_symlink():
            raise ValueError(f'Pinned migration missing or unsafe: {relative}')
        content = file.read_bytes()
        blob = b'blob ' + str(len(content)).encode('ascii') + b'\0' + content
        if hashlib.sha1(blob).hexdigest() != original_sha:
            raise ValueError(f'Pinned migration content changed: {relative}')
    return len(expected)


def is_blocked_tracked_path(name: str) -> bool:
    path = PurePosixPath(name)
    base = path.name.lower()
    if base in {'.dev.vars.example', '.env.example'}:
        return False
    if base in BLOCKED_NAMES or base.startswith('.dev.vars.') or base.startswith('.env.'):
        return True
    if any(base.endswith(ext) for ext in BLOCKED_SUFFIXES):
        return True
    return name.lower().startswith('.aws/') and base == 'credentials'


def verify_tracked_secrets(root: Path) -> None:
    proc = subprocess.run(['git', 'ls-files', '-z'], cwd=root,
                          check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    names = [name.decode('utf-8') for name in proc.stdout.split(b'\0') if name]
    unsafe = [name for name in names if is_blocked_tracked_path(name)]
    if unsafe:
        # Only paths, never the actual secret values.
        raise ValueError('Sensitive file paths committed: ' + ', '.join(sorted(unsafe)))


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        n = verify_migrations(root)
        pinned_count = verify_pinned_migrations(root)
        verify_tracked_secrets(root)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'REPOSITORY GUARD FAILED: {error}', file=sys.stderr)
        return 1
    print(f'REPOSITORY GUARD OK: migrations 0001-{n:04d}, {pinned_count} locked; no blocked tracked secret filenames')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

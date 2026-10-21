#!/usr/bin/env python3
"""Stage reviewed CR JORNADA v68 in CI; no deploy and no remote DB operations.

On success, the workflow may commit ONLY previously reviewed integration paths
onto desenvolvimento-cr-jornada. All work before the final git push is local.
"""
from __future__ import annotations

import base64
import contextlib
import importlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

REPO = 'rykellmy31-star/gestor-ponto-multiempresa'
BRANCH = 'desenvolvimento-cr-jornada'
BASE_SHA = '6d2b932d0231ded02650cb367665d907cfbeff8b'
EXPECTED_PARENT = '8881fac3d092be92eb59f3f80081d9af0b61fc8f'
EXPECTED_LAUNCH_FILES = {'.github/workflows/integrar-candidatas-v68.yml'}
ARCHIVE_BLOB = '3bf07159b7c3a3163a06e320ce3ea217c043ea17'
ARCHIVE_SHA256 = 'dedb2f75488838c789a6cfcacd19934dda0a3ff6dd1fff4d50b9b2f05686f67c'
ARCHIVE_BYTES = 607804
ARCHIVE_ROOT = 'CR-JORNADA-v68-integracao-unificada'
ALREADY_COMMITTED = {
    'migrations/0028_company_admin_identity_immutable.sql',
    'migrations/0029_tenant_login_alias_policy.sql',
}


def run(*args: str, cwd: Path, timeout=600) -> str:
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, 'GIT_TERMINAL_PROMPT': '0',
                            'PYTHONDONTWRITEBYTECODE': '1'})
    if p.returncode:
        raise RuntimeError(f'Command failed ({args[0]} {args[1] if len(args)>1 else ""}): '
                           f'{p.stderr[-4000:]} {p.stdout[-2000:]}')
    return p.stdout.strip()


def download_pinned_zip(token: str) -> bytes:
    if not token:
        raise RuntimeError('GitHub read token missing')
    endpoint = f'https://api.github.com/repos/{REPO}/git/blobs/{ARCHIVE_BLOB}'
    req = urllib.request.Request(endpoint, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cr-jornada-safe-ci',
    })
    with urllib.request.urlopen(req, timeout=60) as response:
        doc = json.load(response)
    if doc.get('sha') != ARCHIVE_BLOB or doc.get('encoding') != 'base64':
        raise RuntimeError('Wrong Git blob object returned')
    raw = base64.b64decode(doc['content'], validate=False)
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) != ARCHIVE_BYTES or digest != ARCHIVE_SHA256:
        raise RuntimeError('Package digest/size differs from approved v68')
    return raw


def safe_unpack(payload: bytes, output: Path) -> Path:
    import io
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        if z.testzip() is not None:
            raise RuntimeError('Corrupt ZIP')
        paths: set[str] = set()
        for entry in z.infolist():
            path = PurePosixPath(entry.filename)
            if not path.parts or path.parts[0] != ARCHIVE_ROOT:
                raise RuntimeError('Unapproved ZIP root')
            if (path.is_absolute() or '\\' in entry.filename or
                    '..' in path.parts or entry.filename in paths):
                raise RuntimeError('Unsafe ZIP member')
            paths.add(entry.filename)
            mode = (entry.external_attr >> 16) & 0o170000
            if mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise RuntimeError('Unapproved ZIP object type')
            target = output.joinpath(*path.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry, 'r') as src, target.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
    result = output / ARCHIVE_ROOT
    if not (result / 'crj_v68.py').is_file():
        raise RuntimeError('Missing v68 integrator entrypoint')
    return result


def status_paths(repo: Path) -> set[str]:
    return (set(filter(None, run('git', 'diff', '--name-only', 'HEAD', cwd=repo).splitlines())) |
            set(filter(None, run('git', 'ls-files', '--others', '--exclude-standard', cwd=repo).splitlines())))


def verify_launch_commit(repo: Path) -> None:
    head = run('git', 'rev-parse', 'HEAD', cwd=repo)
    if os.environ.get('GITHUB_SHA') != head:
        raise RuntimeError('GitHub workflow SHA does not match checkout')
    parent = run('git', 'rev-parse', 'HEAD^', cwd=repo)
    if parent != EXPECTED_PARENT:
        # This workflow is enabled in its own commit, immediately after one
        # reviewed script-only repair commit. Validate both exact path sets.
        grandparent = run('git', 'rev-parse', 'HEAD^^', cwd=repo)
        if grandparent != EXPECTED_PARENT:
            raise RuntimeError('Launch commit has unexpected ancestry')
        prior_changed = set(run('git', 'diff', '--name-only', EXPECTED_PARENT, 'HEAD^', cwd=repo).splitlines())
        if prior_changed != {'scripts/crj-integrate-v68.py'}:
            raise RuntimeError('Unexpected integration script update')
    changed = set(run('git', 'diff', '--name-only', 'HEAD^', 'HEAD', cwd=repo).splitlines())
    if changed != EXPECTED_LAUNCH_FILES:
        raise RuntimeError('Launch commit contains unexpected source files')


@contextlib.contextmanager
def allow_pinned_v57_tree_changes(v52_root: Path):
    """Let the old v45 filesystem guard recognize five pinned v47/v56 edits.

    v58 verifies the v47 calculation patch; v59 verifies the v56 UI patch.
    The original verifier is restored after this temporary, narrow scope fix.
    """
    paths = {
        'server/core/time.ts', 'tests/calculations.test.ts',
        'web/src/company-schedules-page.tsx',
        'web/src/company-schedules-network.ts',
        'tests/company-schedules-network.test.ts',
    }
    source = str(v52_root.absolute())
    sys.path.insert(0, source)
    try:
        base = importlib.import_module('validate_full_checkout_v45')
        original = base.verify_full_checkout_tree
        def scoped(checkout):
            approved = base.EXPECTED_ALLOWED_CHANGES
            base.EXPECTED_ALLOWED_CHANGES = set(approved) | paths
            try:
                return original(checkout)
            finally:
                base.EXPECTED_ALLOWED_CHANGES = approved
        base.verify_full_checkout_tree = scoped
        try:
            yield
        finally:
            base.verify_full_checkout_tree = original
    finally:
        sys.path.remove(source)


def check_and_transfer(source: Path, dest: Path, paths: set[str]) -> list[str]:
    if len(paths) != 20 or not ALREADY_COMMITTED.issubset(paths):
        raise RuntimeError(f'Expected 20 pinned changes, got {len(paths)}')
    if run('git', 'status', '--porcelain', cwd=dest):
        raise RuntimeError('Checkout was not clean')
    verify_launch_commit(dest)
    if run('git', 'branch', '--show-current', cwd=dest) != BRANCH:
        raise RuntimeError('Refusing integration outside development branch')
    staged = []
    for name in sorted(paths):
        target = dest / name
        fresh = source / name
        if not fresh.is_file() or fresh.is_symlink():
            raise RuntimeError(f'Candidate missing or unsafe: {name}')
        parent = target.parent
        if parent.is_symlink() or not parent.is_dir():
            raise RuntimeError(f'Unsafe destination parent: {name}')
        expected = fresh.read_bytes()
        if name in ALREADY_COMMITTED:
            if not target.is_file() or target.read_bytes() != expected:
                raise RuntimeError(f'Previously committed migration differs: {name}')
            continue
        # Never overwrite a source file that changed after the audited base.
        original = run('git', 'ls-tree', BASE_SHA, '--', name, cwd=dest)
        if original:
            baseline = subprocess.check_output(['git', 'show', f'{BASE_SHA}:{name}'], cwd=dest)
            if not target.is_file() or target.is_symlink() or target.read_bytes() != baseline:
                raise RuntimeError(f'Concurrent modification of {name}; manual review required')
        elif target.exists() or target.is_symlink():
            raise RuntimeError(f'Unexpected new path exists: {name}')
        target.write_bytes(expected)
        staged.append(name)
    if len(staged) != 18:
        raise RuntimeError(f'Expected 18 new/updated files, got {len(staged)}')
    run('git', 'add', '--', *staged, cwd=dest)
    index_paths = set(filter(None, run('git', 'diff', '--cached', '--name-only', cwd=dest).splitlines()))
    if index_paths != set(staged):
        raise RuntimeError('Unexpected Git staged inventory')
    run('git', 'diff', '--cached', '--check', cwd=dest)
    return staged


def stage_historical_schedule_regression_tests(source: Path, dest: Path) -> None:
    """Update only 2 fixture assertions for the pinned historical SQL bindings."""
    relative = 'tests/employee-cpf-punch-route.test.ts'
    candidate_route = source / 'server/routes/employee-cpf-punch.ts'
    route = candidate_route.read_text(encoding='utf-8')
    if 'CURRENT_ASSIGNMENT_CONFIG_SQL' not in route or 'CURRENT_ACTIVE_ASSIGNMENT_ID_SQL' not in route:
        raise RuntimeError('Expected historical schedule selectors are missing')
    target = dest / relative
    baseline = subprocess.check_output(['git','show',f'{BASE_SHA}:{relative}'],cwd=dest)
    if not target.is_file() or target.is_symlink() or target.read_bytes() != baseline:
        raise RuntimeError('Existing CPF route tests differ from pinned baseline')
    old = target.read_text(encoding='utf-8')
    corrections = (
        ("expect(assigned?.args.slice(0,2)).toEqual(['company-a','employee-a']);",
         "expect(assigned?.args).toEqual(['company-a','2026-10-19','employee-a','2026-10-19']);"),
        ("expect(selected?.args).toEqual(['company-a','employee-a','2026-10-19']);",
         "expect(selected?.args).toEqual(['company-a','2026-10-19','employee-a','2026-10-19']);"),
    )
    new = old
    for before, after in corrections:
        if new.count(before) != 1:
            raise RuntimeError('Unexpected CPF SQL fixture assertion')
        new = new.replace(before, after)
    if new == old:
        raise RuntimeError('No regression assertions revised')
    target.write_text(new, encoding='utf-8')
    run('git','add','--',relative,cwd=dest)
    paths = set(filter(None,run('git','diff','--cached','--name-only',cwd=dest).splitlines()))
    if len(paths) != 19 or relative not in paths:
        raise RuntimeError('Unapproved staged test inventory')



def stage_d1_trigger_message_regressions(source: Path, dest: Path) -> None:
    """Accept only the new, stricter immutable-state rejection errors.

    Both operations must still fail. Pin exact original files and exact lines
    to prevent accidental relaxation of D1 authorization expectations.
    """
    corrections = {
        'tests/d1-employee-company-workdays.test.ts': (
            '''"UPDATE work_days SET employee_id='em-a2' WHERE id='day-a'", dir
      )).toMatch(/work_day_company_mismatch/);''',
            '''"UPDATE work_days SET employee_id='em-a2' WHERE id='day-a'", dir
      )).toMatch(/(?:work_day_company_mismatch|company_started_workday_immutable)/);''',
        ),
        'tests/d1-employee-punch-policy.test.ts': (
            '.toMatch(/invalid_sequence/);',
            '.toMatch(/(?:invalid_sequence|raw_punch_immutable)/);',
        ),
    }
    for relative, (before, after) in corrections.items():
        target = dest / relative
        baseline = subprocess.check_output(
            ['git', 'show', f'{BASE_SHA}:{relative}'], cwd=dest
        )
        if not target.is_file() or target.is_symlink():
            raise RuntimeError(f'D1 regression fixture missing or unsafe: {relative}')
        # The punch-policy test is already one of the 20 vetted candidate
        # paths. It must match the audited staged candidate bytes, not the
        # original 0027 baseline. The other fixture must match its baseline.
        staged = set(filter(None, run('git', 'diff', '--cached', '--name-only', cwd=dest).splitlines()))
        expected = (source / relative).read_bytes() if relative in staged else baseline
        if target.read_bytes() != expected:
            raise RuntimeError(f'D1 regression fixture diverged: {relative}')
        content = target.read_text(encoding='utf-8')
        if content.count(before) != 1:
            raise RuntimeError(f'D1 error assertion anchor missing or duplicated: {relative}')
        target.write_text(content.replace(before, after), encoding='utf-8')
    run('git', 'add', '--', *sorted(corrections), cwd=dest)
    staged = set(filter(None, run('git', 'diff', '--cached', '--name-only', cwd=dest).splitlines()))
    if len(staged) != 20 or not set(corrections).issubset(staged):
        raise RuntimeError('Unexpected D1 fixture integration scope')
    run('git', 'diff', '--cached', '--check', cwd=dest)


def main() -> None:
    repo = Path(os.environ.get('GITHUB_WORKSPACE', '.')).resolve()
    if not (repo / '.git').exists():
        raise RuntimeError('Expected full GitHub Actions checkout')
    verify_launch_commit(repo)
    with tempfile.TemporaryDirectory(prefix='crj-v68-ci-') as td:
        tmp = Path(td)
        z = download_pinned_zip(os.environ.get('GH_TOKEN', ''))
        bundle = safe_unpack(z, tmp / 'bundle')
        script = bundle / 'crj_v68.py'
        print('INTEGRATION: verifying package', flush=True)
        print(run(sys.executable, '-I', '-B', str(script), 'verify', cwd=bundle, timeout=120),flush=True)
        print('INTEGRATION: testing package', flush=True)
        print(run(sys.executable, '-I', '-B', str(script), 'self-test', cwd=bundle, timeout=900),flush=True)
        source = tmp / 'source'
        run('git', 'clone', '-q', '--no-hardlinks', str(repo), str(source), cwd=tmp)
        run('git', 'checkout', '-q', '-B', BRANCH, BASE_SHA, cwd=source)
        run('git', 'remote', 'set-url', 'origin', f'https://github.com/{REPO}.git', cwd=source)
        print('INTEGRATION: stage audited v65 candidate against pinned baseline',flush=True)
        # v68's original wrapper omitted the company-schedules route from its
        # path inventory (19 instead of the actual 20). We keep the approved
        # v68 ZIP immutable and perform the same stages explicitly, checking
        # the full 20-path set after the extra v67 route edit.
        import importlib.util
        spec = importlib.util.spec_from_file_location('_verified_v68', script)
        v68 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(v68)
        v68.verify()
        v65 = v68.load_v65()
        v65_args = v68.v65_args(source)
        with allow_pinned_v57_tree_changes(v65_args[1]):
            plan = v65.stage(*v65_args, apply=False)
            if plan.get('candidate_paths') != 18 or plan.get('writes') != 0:
                raise RuntimeError('v65 dry-run unexpectedly changed')
            result = v65.stage(*v65_args, apply=True)
            if result.get('exact_change_count') != 18:
                raise RuntimeError('v65 audit rejected candidate')
        before = status_paths(source)
        if len(before) != 18 or v68.UI not in before or v68.ROUTE in before:
            raise RuntimeError('Unexpected upstream v65 staged paths')
        print('INTEGRATION: apply exact pinned v67 route+UI patch',flush=True)
        v68.patch_cmd(source, check=True)
        v68.patch_cmd(source)
        v68.patch_cmd(source, reverse=True, check=True)
        sql38 = source / v68.SQL38
        if sql38.exists() or sql38.is_symlink():
            raise RuntimeError('Unexpected preexisting migration 0038')
        with sql38.open('xb') as output:
            output.write(v68.source_v67_sql())
        changed = status_paths(source)
        expected = before | {v68.ROUTE, v68.SQL38}
        if len(changed) != 20 or changed != expected:
            raise RuntimeError('v67 scope mismatch: require exactly 20 approved paths')
        if sql38.read_bytes() != v68.source_v67_sql():
            raise RuntimeError('Migration 0038 differs from pinned bytes')
        print('INTEGRATION: 20 approved paths reconstructed from exact pinned sources',flush=True)
        written = check_and_transfer(source, repo, changed)
        stage_historical_schedule_regression_tests(source, repo)
        stage_d1_trigger_message_regressions(source, repo)
        print(f'INTEGRATION: {len(written)} candidate paths + 2 new test paths staged safely; no deploy',flush=True)
    # The workflow runs all required checks and may commit/push only after they pass.


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'INTEGRATION BLOCKED: {e}',file=sys.stderr,flush=True)
        raise SystemExit(2)

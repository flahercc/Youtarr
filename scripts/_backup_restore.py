#!/usr/bin/env python3
"""Backup/restore-specific helpers. Never source .env or recreate a DB container.

Python's standard library provides structured Compose/manifest handling and safe
archive extraction without depending on shell word splitting or tar extraction.
"""
import argparse
import hashlib
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import shlex
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import time
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent


class Console:
    """Small terminal-aware counterpart to scripts/_console_output.sh."""
    @staticmethod
    def paint(text, code, stream=None):
        stream = stream if stream is not None else sys.stdout
        # Paths/metadata must not inject terminal control sequences. Preserve
        # intentional newlines and tabs for readable multiline instructions.
        text = ''.join(c if c in '\n\t' or (ord(c) >= 32 and not 127 <= ord(c) < 160)
                       else f'\\x{ord(c):02x}' for c in str(text))
        if stream.isatty() and 'NO_COLOR' not in os.environ and os.environ.get('TERM') != 'dumb':
            return f'\033[{code}m{text}\033[0m'
        return text

    @classmethod
    def banner(cls, title, stream=None):
        stream = stream if stream is not None else sys.stdout
        print(cls.paint('\n' + title, '1;36', stream), file=stream)
        print(cls.paint('-' * 44, '36', stream), file=stream, flush=True)

    @classmethod
    def section(cls, title):
        print('\n' + cls.paint(title, '1;36'), flush=True)

    @classmethod
    def field(cls, label, value, stream=None):
        stream = stream if stream is not None else sys.stdout
        if value is not None and value != '':
            print(cls.paint(f'  {label:<16} ', '0', stream) + cls.paint(value, '0', stream),
                  file=stream, flush=True)

    @classmethod
    def info(cls, text):
        print(cls.paint('[INFO ]', '36') + ' ' + cls.paint(text, '0'), flush=True)

    @classmethod
    def success(cls, text):
        print(cls.paint('[ OK  ]', '32') + ' ' + cls.paint(text, '0'), flush=True)

    @classmethod
    def warn(cls, text, stream=None):
        stream = stream if stream is not None else sys.stdout
        print(cls.paint('[WARN ]', '33', stream) + ' ' + cls.paint(text, '0', stream), file=stream, flush=True)

    @classmethod
    def prose(cls, text, stream=None):
        stream = stream if stream is not None else sys.stdout
        width = max(40, min(88, shutil.get_terminal_size(fallback=(88, 24)).columns))
        for line in str(text).split('\n'):
            # Never break copyable shell commands or long path components.
            formatted = line if line.startswith('  ') else textwrap.fill(
                line, width=width, break_long_words=False, break_on_hyphens=False)
            print(cls.paint(formatted, '0', stream), file=stream, flush=True)

    @classmethod
    def paused(cls, error):
        stream = sys.stderr
        subject = 'Youtarr is still running' if error.application else 'a container has write access to your data'
        print('\n' + cls.paint(error.operation.capitalize() + ' paused — ' + subject, '1;33', stream),
              file=stream, flush=True)
        name = shlex.quote(error.container)
        if not error.application:
            cls.prose('\nThis container shares configuration or metadata paths. Check its role before stopping it.', stream)
        cls.prose('\nStop ' + ('the application' if error.application else 'the container') + ':', stream)
        cls.prose('  docker stop ' + name, stream)
        cls.prose('\nThen retry:', stream)
        command = ['./scripts/' + error.operation + '.sh']
        if len(sys.argv) > 1 and sys.argv[1] == error.operation:
            command += sys.argv[2:]  # Preserve the user's selectors and archive argument.
        elif error.operation == 'restore':
            command += ['/path/to/backup.tar.gz']
        cls.prose('  ' + shlex.join(command), stream)
        if error.operation == 'backup':
            cls.prose('\nAfter a successful backup:', stream)
            cls.prose('  docker start ' + name, stream)
        print('\n' + cls.paint('Important', '1;33', stream), file=stream)
        cls.prose('Use docker stop, not ./stop.sh or docker compose down. The existing containers '
                  'are needed to identify the database safely.', stream)
        if error.operation == 'restore':
            cls.prose('Keep the application stopped until recovery is complete and the intended image is selected. '
                      '--force does not bypass this check.', stream)
        if error.details:
            print('\n' + cls.paint('Details', '1;36', stream), file=stream)
            for label, value in error.details:
                cls.field(label, value, stream)
        print(file=stream, flush=True)

    @classmethod
    def error(cls, text):
        if isinstance(text, WriterRunning):
            cls.paused(text)
            return
        # Preserve the plain-text Error prefix and wrap long explanations.
        lines = str(text).split('\n')
        width = max(40, min(88, shutil.get_terminal_size(fallback=(88, 24)).columns))
        first = textwrap.fill('Error: ' + lines[0], width=width,
                              break_long_words=False, break_on_hyphens=False)
        print(cls.paint(first, '1;31', sys.stderr), file=sys.stderr, flush=True)
        if len(lines) > 1:
            cls.prose('\n'.join(lines[1:]), sys.stderr)

    @classmethod
    def target(cls, title, data):
        cls.section(title)
        modes = {'development': 'Local development', 'production': 'Production', 'external': 'External database'}
        cls.field('Installation', modes.get(data.get('mode'), data.get('mode')))
        cls.field('Project', data.get('project'))
        cls.field('Docker context', data.get('context'))
        cls.field('Database', data.get('name'))
        if data.get('host'):
            cls.field('Server', str(data['host']) + (':' + str(data['port']) if data.get('port') else ''))
        cls.field('DB account', data.get('user'))
        cls.field('DB version', data.get('version'))
        cls.field('DB container', data.get('container_name'))
        storage = data.get('storage') or {}
        if storage.get('Type') == 'volume':
            cls.field('Data volume', storage.get('Name'))
        elif storage.get('Type') == 'bind':
            cls.field('Data directory', storage.get('Source'))
        cls.field('App image', data.get('app_image'))


class ScriptArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        if message in ('the following arguments are required: archive', 'the following arguments are required: BACKUP_FILE'):
            Console.banner('Youtarr Restore', stream=sys.stderr)
            print('\n' + Console.paint('Choose a backup archive to restore:', '1;33', sys.stderr), file=sys.stderr)
            Console.prose('\n  ./scripts/restore.sh /path/to/backup.tar.gz\n\nSee all options:\n'
                          '  ./scripts/restore.sh --help\n', stream=sys.stderr)
            self.exit(2)
        Console.error(message)
        print('\n' + self.format_usage().strip(), file=sys.stderr)
        if self.prog.endswith('restore.sh'):
            print('\nExample:\n  ./scripts/restore.sh /path/to/youtarr-backup.tar.gz', file=sys.stderr)
        print(f'\nFor all options, run: {self.prog} --help', file=sys.stderr)
        self.exit(2)


class OperationError(Exception):
    pass


class RestoreCancelled(OperationError):
    pass


class WriterRunning(OperationError):
    """Keep diagnostic context separate from the short user-facing instructions."""
    def __init__(self, message, container, operation, application, details):
        super().__init__(message)
        self.container = container
        self.operation = operation
        self.application = application
        self.details = details


def require(condition, message):
    if not condition:
        raise OperationError(message)


def identifier(value):
    require(bool(value) and len(value) <= 64 and not any(ord(c) < 32 for c in value),
            'Invalid database identifier.')
    return '`' + value.replace('`', '``') + '`'


def literal(value):
    # Hex literals avoid dependence on the server's SQL backslash mode.
    return "CONVERT(X'" + value.encode().hex() + "' USING utf8mb4)"


def client_version(text, label):
    """The distribution release differs from MariaDB's internal client version."""
    release = re.search(r'\b(?:from|Distrib)\s+(\d+\.\d+)', text, re.I)
    if not release:
        release = re.search(r'\bVer\s+(\d+\.\d+)', text)
    require(release, f'Cannot recognize the {label} version format. Use a supported MySQL/MariaDB client.')
    return ('mariadb' if 'mariadb' in text.lower() else 'mysql', release[1])


def migration_table(names, case_mode):
    matches = [name for name in names if
               (name == 'SequelizeMeta' if case_mode == 0 else name.lower() == 'sequelizemeta')]
    require(len(matches) == 1, 'Selected database must have one SequelizeMeta migration-history table '
            'under the server identifier-case rules.')
    return matches[0]


def comparable_inventory(inventory, case_mode):
    result = dict(inventory)
    tables = {}
    for name, value in inventory['tables'].items():
        key = name.lower() if case_mode else name
        require(key not in tables, 'Archive table names collide under destination identifier-case rules.')
        tables[key] = value
    result['tables'] = tables
    # Only normalize table references, never column defaults or migration filenames.
    for section, positions in {'columns': (0,), 'indexes': (0,), 'foreign_keys': (0, 4)}.items():
        if section in inventory:
            rows = []
            for line in inventory[section]:
                fields = line.split('\t')
                require(len(fields) > max(positions), 'Malformed schema inventory.')
                for position in positions:
                    if case_mode:
                        fields[position] = fields[position].lower()
                if section == 'columns' and len(fields) >= 9:
                    # MariaDB renamed this three-byte charset; do not normalize
                    # column types/default expressions or four-byte utf8mb4.
                    if fields[7] == 'utf8':
                        fields[7] = 'utf8mb3'
                    if fields[8].startswith('utf8_'):
                        fields[8] = 'utf8mb3_' + fields[8][5:]
                rows.append('\t'.join(fields))
            result[section] = sorted(rows)
    return result


RESTORE_PRIVILEGES = frozenset({
    'SELECT', 'INSERT', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES',
    'LOCK TABLES', 'SHOW VIEW', 'CREATE VIEW', 'TRIGGER', 'EVENT',
    'CREATE ROUTINE', 'ALTER ROUTINE', 'EXECUTE',
})


def schema_grant_matches(pattern, database, literal_patterns, case_mode):
    if case_mode:
        pattern, database = pattern.lower(), database.lower()
    if literal_patterns:
        return pattern == database
    expression = ''
    escaped = False
    for char in pattern:
        if escaped:
            expression += re.escape(char)
            escaped = False
        elif char == '\\':
            escaped = True
        else:
            expression += { '%': '.*', '_': '.' }.get(char, re.escape(char))
    if escaped:
        expression += re.escape('\\')
    return re.fullmatch(expression, database, re.DOTALL) is not None


def effective_schema_privileges(grants, database, partial_revokes, case_mode):
    """Evaluate database/global privileges, not SHOW GRANTS formatting shorthand.

    Table/column grants do not authorize replacing a whole database. Subtract
    restrictions conservatively even when other role grants might compensate.
    """
    global_grants, schema_grants, revoked = set(), set(), set()
    for line in grants.splitlines():
        # mysql batch output escapes backslashes in quoted schema patterns.
        line = line.replace('\\\\', '\\')
        match = re.match(r'^(GRANT|REVOKE) (.+?) ON (\*|`(?:``|[^`])+`)\.\* (?:TO|FROM) ', line)
        if not match:
            require(not line.startswith('REVOKE '), 'Cannot safely interpret a privilege restriction.')
            continue
        action, privileges, scope = match.groups()
        privileges = {p.strip().upper() for p in privileges.split(',')}
        if 'ALL PRIVILEGES' in privileges or 'ALL' in privileges:
            privileges |= RESTORE_PRIVILEGES
        if scope != '*':
            schema = scope[1:-1].replace('``', '`')
            if not schema_grant_matches(schema, database, partial_revokes or action == 'REVOKE', case_mode):
                continue
        if action == 'REVOKE':
            revoked |= privileges
        elif scope == '*':
            global_grants |= privileges
        else:
            schema_grants |= privileges
    return (global_grants | schema_grants) - revoked


def overlapping(left, right):
    return left == right or left in right.parents or right in left.parents


def mountinfo_access(text, target, mount_root=None):
    """Return whether the effective mount or a nested mount permits writes."""
    mounts = []
    for line in text.splitlines():
        fields = line.split()
        require(len(fields) >= 7 and '-' in fields, 'Cannot parse container mount permissions.')
        decoded = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), fields[4])
        mounts.append((PurePosixPath(decoded), 'rw' in fields[5].split(',')))
    require(mount_root is None or any(path == mount_root for path, _ in mounts),
            'Cannot verify recursive mount permissions: the Docker mount is absent from this process namespace.')
    parents = [(path, writable) for path, writable in mounts if path == target or path in target.parents]
    require(parents, 'Cannot locate metadata in container mount permissions.')
    parent = max(parents, key=lambda item: len(item[0].parts))
    return parent[1] or any(writable and target in path.parents for path, writable in mounts)


def directory_access(path, purpose):
    try:
        path.mkdir(parents=True, exist_ok=True)
        require(path.is_dir(), f'{purpose} is not a directory: {path}')
        require(os.access(path, os.W_OK | os.X_OK),
                f'{purpose} is not writable: {path} (owner UID {path.stat().st_uid}, current UID {os.geteuid()}). '
                'Use a directory owned by the account running this operation, or the same elevated account '
                'used for the root-owned installation. See the backup guide before switching between sudo and non-sudo.')
    except PermissionError as error:
        raise OperationError(f'Cannot create/access {purpose.lower()}: {path}. '
                             'Check parent-directory ownership or choose a writable location. '
                             'A prior sudo run may have created a root-owned directory.') from error


def server_release(version):
    match = re.match(r'(\d+)\.(\d+)(?:\.\d+)?(?:[-+].*)?$', version)
    require(match, 'Unrecognized source/destination database version; supply a verified release such as 10.3.39.')
    return tuple(int(n) for n in match.groups())


def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w') as output:
        output.write(json.dumps(value, indent=2) + '\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def regular_tree(path):
    """Reject links/devices rather than archiving outside the selected paths."""
    require(not path.is_symlink(), f'Symlinks are unsupported: {path}')
    mode = path.stat().st_mode
    require(stat.S_ISREG(mode) or stat.S_ISDIR(mode), f'Unsupported file type: {path}')
    if path.is_dir():
        for child in path.iterdir():
            regular_tree(child)


def copy_item(source, destination):
    regular_tree(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, destination, copy_function=shutil.copyfile)
    else:
        shutil.copyfile(source, destination)


def file_hashes(root):
    return {p.relative_to(root).as_posix(): digest(p)
            for p in sorted(root.rglob('*')) if p.is_file() and p != root / 'manifest.json'}


def extract_archive(archive, destination, skip_db=False):
    """Validate every header before writing; do not delegate extraction to tar."""
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        require(bool(members), 'Empty backup archive.')
        seen, roots = set(), set()
        for member in members:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts and
                    '\\' not in member.name and bool(path.parts), 'Unsafe archive path.')
            require(all(not any(ord(c) < 32 for c in part) for part in path.parts),
                    'Control characters in archive path.')
            require(member.isdir() or member.isfile(), 'Archive links/devices are unsupported.')
            normalized = path.as_posix()
            require(normalized not in seen, 'Duplicate archive entry.')
            seen.add(normalized)
            roots.add(path.parts[0])
        require(len(roots) == 1, 'Archive must contain one backup root.')
        root_name = roots.pop()
        require(root_name.startswith('youtarr-backup-'), 'Unexpected backup root name.')
        # Check file/directory collisions before any extraction too.
        files = {PurePosixPath(m.name) for m in members if m.isfile()}
        for member in members:
            require(not any(p in files for p in PurePosixPath(member.name).parents),
                    'Archive file/directory collision.')
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
    root = destination / root_name
    require((root / 'env.backup').is_file(), 'Missing env.backup.')
    manifest_path = root / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'version': '1.0'}
    require(isinstance(manifest, dict), 'Invalid manifest.')
    require(manifest.get('version') in ('1.0', '2.0'), 'Unsupported archive format.')
    if manifest['version'] == '2.0':
        require(isinstance(manifest.get('checksums'), dict) and
                manifest['checksums'] == file_hashes(root), 'Archive checksum/content mismatch.')
        require(isinstance(manifest.get('included'), list), 'Missing content inventory.')
        allowed = {'env.backup', 'config/config.json', 'config/cookies.user.txt',
                   'config/complete.list', 'database/youtarr.sql',
                   'metadata/jobs', 'metadata/server/images'}
        require(set(manifest['included']) <= allowed, 'Unknown archive component.')
        for item in manifest['included']:
            path = root / item
            require(path.is_dir() if item.startswith('metadata/') else path.is_file(),
                    f'Missing or invalid archive component: {item}')
        for path in root.rglob('*'):
            if path.is_file() and path.name != 'manifest.json':
                relative = path.relative_to(root).as_posix()
                require(any(relative == item or (item.startswith('metadata/') and relative.startswith(item + '/'))
                            for item in manifest['included']), 'Unlisted archive content.')
        require('env.backup' in manifest['included'] and 'config/config.json' in manifest['included'],
                'Missing critical archive components.')
    else:
        Console.warn('Legacy archive: no verified checksums or source inventory; validation is limited.')
    config = root / 'config/config.json'
    if config.exists():
        require(isinstance(json.loads(config.read_text()), dict), 'Invalid application configuration.')
    if not skip_db:
        sql = root / 'database/youtarr.sql'
        require(sql.is_file() and sql.stat().st_size > 0, 'Missing/empty SQL; use --skip-db for local files only.')
        if manifest['version'] == '2.0':
            require(manifest.get('database') and manifest['database'].get('inventory'),
                    'Missing database inventory.')
    return root, manifest


class Operation:
    def __init__(self, args):
        self.args = args
        self.started = None
        self.remote_options = None
        self.recovery = None
        self.private = Path(tempfile.mkdtemp(prefix='youtarr-' + args.operation + '-'))
        self.log = self.private / 'diagnostics.log'
        self.db = None
        self.compose = ['docker', 'compose', '--project-directory', str(ROOT)]
        self.options = None
        self.lock = None

    def run(self, command, *, input=None, output=None, check=True, purpose='Command'):
        # Commands/configuration can contain credentials. Never echo argv/stderr.
        with self.log.open('ab') as errors:
            offset = errors.tell()
            result = subprocess.run(command, input=input, stdout=output or subprocess.PIPE,
                                    stderr=errors, check=False, cwd=ROOT)
        if check and result.returncode != 0:
            with self.log.open('rb') as errors:
                errors.seek(offset)
                diagnostic = errors.read().decode(errors='replace')
            # Classify only this command's stderr. Never echo arbitrary SQL,
            # connection strings, credentials, or messages from earlier probes.
            reason = ''
            if re.search(r'unknown (?:variable|option)', diagnostic, re.IGNORECASE):
                reason = ('The database client rejected an unsupported option. '
                          'The backup script and selected client options must be compatible with this client version. ')
            elif re.search(r'\b(?:1045|1698)\b', diagnostic):
                reason = ('Database authentication was rejected. Check the selected account and password; '
                          'use --db-user with --db-password-file for an explicit account. ')
            elif re.search(r'\b(?:1142|1227|1370)\b', diagnostic):
                reason = ('The database account lacks required privileges. Use an appropriately privileged '
                          'account with --db-user and --db-password-file. ')
            raise OperationError(purpose + ' failed. ' + reason +
                                 'Technical details were saved to: ' + str(self.log))
        return result

    def json(self, command):
        return json.loads(self.run(command).stdout)

    def containers(self):
        ids = self.run(['docker', 'ps', '-aq']).stdout.decode().split()
        return self.json(['docker', 'inspect', *ids]) if ids else []

    @staticmethod
    def labels(container):
        return container.get('Config', {}).get('Labels') or {}

    @staticmethod
    def environment(container):
        return dict(entry.split('=', 1) for entry in container['Config'].get('Env', []) if '=' in entry)

    def resolve(self):
        lock_path = ROOT / '.backup-restore.lock'
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        except PermissionError as error:
            raise OperationError(f'Cannot open the backup/restore lock: {lock_path}. '
                                 'It or its parent may belong to root after a sudo run. Use the same account '
                                 'consistently, or have its ownership corrected while no backup/restore is running. '
                                 'Do not delete an active lock or change application-data ownership automatically.') from error
        self.lock = os.fdopen(descriptor, 'w')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise OperationError('Another backup/restore is already running in this installation.') from error
        require(shutil.which('docker'), 'Docker is required, including for writer detection.')
        self.run(['docker', 'compose', 'version'])
        all_containers = self.containers()
        args = self.args
        candidates = [c for c in all_containers if
                      self.labels(c).get('com.docker.compose.service') == 'youtarr' and
                      (self.labels(c).get('com.docker.compose.project') == args.project if args.project else
                       self.labels(c).get('com.docker.compose.project.working_dir') == str(ROOT))]
        require(len(candidates) <= 1, 'Multiple application containers; select --project and Compose files.')
        self.app = candidates[0] if candidates else None
        if args.project:
            self.compose += ['-p', args.project]
        elif self.app:
            self.compose += ['-p', self.labels(self.app)['com.docker.compose.project']]
        self.select_compose_files()
        self.config = self.json(self.compose + ['config', '--format', 'json'])
        self.project = self.config['name']
        if self.app:
            require(self.labels(self.app).get('com.docker.compose.project') == self.project,
                    'Existing app and selected Compose project differ.')
        app_config = self.config.get('services', {}).get('youtarr')
        require(app_config, 'Selected Compose configuration has no youtarr service.')
        self.app_env = app_config.get('environment', {})
        self.mode = self.database_mode(all_containers)
        self.validate_app_environment()
        self.paths = self.local_paths(app_config)
        self.check_writers()
        self.show_configuration()
        self.db_name = str(self.app_env.get('DB_NAME') or 'youtarr')
        identifier(self.db_name)
        self.db_host = str(self.app_env.get('DB_HOST') or '')
        self.db_port = str(self.app_env.get('DB_PORT') or '')
        require(self.db_port.isdigit() and 0 < int(self.db_port) < 65536, 'Invalid DB_PORT.')
        self.db_user = args.db_user or str(self.app_env.get('DB_USER') or '')
        self.db_password = str(self.app_env.get('DB_PASSWORD') or '')
        if args.db_password_file:
            password_path = Path(args.db_password_file)
            require(stat.S_IMODE(password_path.stat().st_mode) & 0o077 == 0,
                    '--db-password-file must be private (chmod 600).')
            self.db_password = password_path.read_text().removesuffix('\n').removesuffix('\r')
        self.target = {'mode': self.mode, 'project': self.project,
                       'context': self.run(['docker', 'context', 'show']).stdout.decode().strip(),
                       'host': self.db_host, 'port': self.db_port, 'name': self.db_name, 'user': self.db_user,
                       'app_image': self.app['Config']['Image'] if self.app else app_config.get('image'),
                       'app_image_id': self.app.get('Image') if self.app else None}
        if not args.skip_db and self.mode != 'external':
            dbs = [c for c in all_containers if
                   self.labels(c).get('com.docker.compose.project') == self.project and
                   self.labels(c).get('com.docker.compose.service') == 'youtarr-db']
            if args.db_container:
                dbs = [c for c in dbs if args.db_container in (c['Id'], c['Name'].lstrip('/'))]
            require(len(dbs) == 1, 'Select exactly one existing database container. If containers were removed, '
                    're-create the DB explicitly with the intended storage before running this script; '
                    'backup never creates containers or volumes.')
            self.db = dbs[0]
            mounts = [m for m in self.db['Mounts'] if m['Destination'] == '/var/lib/mysql']
            require(len(mounts) == 1, 'Database must have one persistent /var/lib/mysql mount.')
            self.verify_mount(mounts[0], self.config['services']['youtarr-db'], '/var/lib/mysql')
            db_config = self.config['services']['youtarr-db']
            require(self.db['Config']['Image'] == db_config['image'], 'Database image differs from Compose configuration.')
            for key, value in db_config.get('environment', {}).items():
                if key.startswith('MYSQL_') or key.startswith('MARIADB_'):
                    require(self.environment(self.db).get(key) == str(value),
                            f'Existing database configuration differs on {key}.')
            self.target.update(container=self.db['Id'], container_name=self.db['Name'].lstrip('/'), storage={k: mounts[0].get(k)
                               for k in ('Type', 'Source', 'Name', 'Destination')})
        elif args.db_container:
            require(False, '--db-container requires bundled database operations.')
        Console.target('Backup source' if args.operation == 'backup' else 'Restore destination', self.target)
        Console.section('Local files')
        for key, label in (('config', 'Configuration'), ('jobs', 'Jobs / metadata'), ('images', 'Images')):
            Console.field(label, self.paths[key])
        if args.skip_db:
            Console.warn('Local files only (--skip-db); the database is excluded.')
        elif args.operation == 'backup' and args.skip_images:
            Console.info('Images are excluded (--skip-images).')

    def database_mode(self, containers):
        host = str(self.app_env.get('DB_HOST') or '')
        require(host, 'DB_HOST is empty in the selected application configuration.')
        service = self.config['services'].get('youtarr-db')
        if not service:
            return 'external'
        # The external startup flow merges an override with the base file, so
        # an unused bundled service may remain. Follow the app's actual host.
        aliases = {'youtarr-db'}
        if service.get('container_name'):
            aliases.add(service['container_name'])
        networks = service.get('networks') or {}
        if isinstance(networks, dict):
            for settings in networks.values():
                aliases.update((settings or {}).get('aliases') or [])
        for container in containers:
            labels = self.labels(container)
            if (labels.get('com.docker.compose.project') == self.project and
                    labels.get('com.docker.compose.service') == 'youtarr-db'):
                aliases.add(container['Name'].lstrip('/'))
                for network in container.get('NetworkSettings', {}).get('Networks', {}).values():
                    aliases.update(network.get('Aliases') or [])
        if host not in aliases:
            return 'external'
        return 'development' if self.app_env.get('DEV_MODE') == 'true' else 'production'

    def select_compose_files(self):
        """CLI selectors override deployment labels; ambient selection is fallback."""
        args = self.args
        files = list(args.compose_file)
        self.selection_source = 'explicit --compose-file'
        if not files and args.mode != 'auto':
            files = [str(ROOT / {'production': 'docker-compose.yml',
                                 'development': 'docker-compose.dev.yml',
                                 'external': 'docker-compose.external-db.yml'}[args.mode])]
            self.selection_source = 'explicit --mode ' + args.mode
        elif not files and self.app:
            recorded = self.labels(self.app).get('com.docker.compose.project.config_files', '')
            files = recorded.split(',') if recorded else []
            require(files and all(files),
                    'The existing application container has no recorded Compose files. '
                    'Supply --compose-file for each file used to start this installation '
                    '(or --mode development for the standard local dev setup).')
            self.selection_source = 'existing application container labels'
        self.selected_files = [str(Path(path).absolute()) for path in files]
        for path in self.selected_files:
            self.compose += ['-f', path]
        if not files:
            # No existing application: Compose handles COMPOSE_FILE, separators,
            # shell/.env precedence and default file discovery itself.
            self.selection_source = 'Compose defaults / COMPOSE_FILE from the shell or .env'

    def show_configuration(self):
        Console.section('Configuration')
        Console.field('Selected from', self.selection_source)
        for index, path in enumerate(self.selected_files):
            Console.field('Compose file' if index == 0 else 'Override file', path)

    def validate_app_environment(self):
        if not self.app:
            return
        actual = self.environment(self.app)
        for key in ('DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'PLATFORM', 'DATA_PATH'):
            existing = str(actual.get(key) or '')
            selected = str(self.app_env.get(key) or '')
            if existing == selected:
                continue
            container = json.dumps(self.app['Name'].lstrip('/'))
            details = ('Values are hidden because this setting contains credentials.' if key == 'DB_PASSWORD' else
                       'Container value: ' + json.dumps(existing) + '; selected value: ' + json.dumps(selected) + '.')
            recorded = self.labels(self.app).get('com.docker.compose.project.config_files', '')
            hint = ('Review ' + key + ' in your shell and destination .env, and the selected Compose files. '
                    'The startup command may have supplied an override that is absent now.')
            standard_dev = (actual.get('DEV_MODE') == 'true' and
                            recorded == str(ROOT / 'docker-compose.dev.yml'))
            if standard_dev and self.selected_files != [str(ROOT / 'docker-compose.dev.yml')]:
                command = './scripts/' + self.args.operation + '.sh'
                if self.args.operation == 'restore':
                    command += ' /path/to/backup.tar.gz'
                hint = ('This container was started with the standard local development configuration. '
                        'Retry with ' + command + ' --mode development'
                        + (' --project ' + json.dumps(self.args.project) if self.args.project else '') + '.')
            raise OperationError(
                'Cannot safely select the database: application container ' + container +
                ' uses a different ' + key + ' setting from the selected configuration.\n\nDetails\n' +
                details + '\nSelection: ' + self.selection_source +
                '; files: ' + json.dumps(self.selected_files) +
                '.\nContainer recorded files: ' + json.dumps(recorded) + '.\n' +
                '\nNext step\n' + hint + '\n\nYour existing installation may still be working correctly. '
                'No database has been started or modified. Do not change a working database port just to match backup.')

    def verify_mount(self, actual, service, destination):
        expected = [v for v in service.get('volumes', []) if v['target'] == destination]
        require(len(expected) == 1, f'No unambiguous Compose mount for {destination}.')
        expected = expected[0]
        source = expected.get('source')
        if expected['type'] == 'volume':
            source = self.config.get('volumes', {}).get(source, {}).get('name')
            require(source and actual.get('Name') == source, 'Existing and configured database volumes differ.')
        else:
            require(expected['type'] == 'bind' and actual['Source'] == source,
                    'Existing and configured bind mounts differ.')
        require(actual['Type'] == expected['type'], 'Existing and configured mount types differ.')

    def local_paths(self, service):
        platform = bool(self.app_env.get('DATA_PATH'))
        internal = {'config': '/app/config', 'jobs': '/app/config/jobs' if platform else '/app/jobs',
                    'images': '/app/config/images' if platform else '/app/server/images'}
        mounts = self.app['Mounts'] if self.app else [
            {'Destination': v['target'], 'Source': v.get('source'), 'Type': v['type']}
            for v in service.get('volumes', [])]
        result = {}
        for key, target in internal.items():
            matching = [m for m in mounts if target == m['Destination'] or target.startswith(m['Destination'] + '/')]
            require(bool(matching), f'Cannot resolve {key} mount; configure a local bind mount.')
            mount = max(matching, key=lambda m: len(m['Destination']))
            require(mount['Type'] == 'bind', f'{key} requires a host-accessible bind mount.')
            if self.app:
                self.verify_mount(mount, service, mount['Destination'])
            result[key] = Path(mount['Source']) / target[len(mount['Destination']):].lstrip('/')
            require(result[key].is_absolute(), 'Metadata paths must be absolute.')
            # Resolve must not silently follow a host symlink into unrelated files.
            require(result[key].resolve() == result[key],
                    f'The {key} bind path contains a symlink: {result[key]}; '
                    f'canonical path: {result[key].resolve()}. Automatic traversal of host path aliases is unsupported. '
                    'Review and configure the bind source using its canonical path, keeping the same data. '
                    'Merely invoking this script from another directory does not change the container mount.')
        require(result['jobs'] != result['images'] and
                result['jobs'] not in result['images'].parents and
                result['images'] not in result['jobs'].parents, 'Jobs and images paths overlap.')
        # Nested mounts could hide files from the parent bind. Separate jobs/images
        # mounts are resolved above; other nested mounts require a manual backup.
        for mount in mounts:
            destination = mount['Destination']
            for key, target in internal.items():
                if destination.startswith(target + '/'):
                    require(destination in (internal['jobs'], internal['images']),
                            f'Unsupported nested metadata mount: {destination}')
        for key in ('jobs', 'images'):
            require(result[key] != result['config'] and result[key] not in result['config'].parents,
                    'A metadata directory cannot contain the configuration directory.')
            require(result[key] != ROOT and result[key] not in ROOT.parents,
                    'A metadata directory cannot contain the repository.')
            require(result[key] not in self.private.parents, 'Temporary directory is inside metadata; change TMPDIR.')
        # A remote daemon's bind paths do not identify files on this host.
        context = self.json(['docker', 'context', 'inspect'])[0]
        endpoint = os.environ.get('DOCKER_HOST') or context['Endpoints']['docker']['Host']
        require(endpoint.startswith(('unix://', 'npipe://')), 'Remote Docker bind paths are unsupported; run on the Docker host.')
        return result

    def shared_writable_mount(self, container):
        mountinfo = None
        for mount in container.get('Mounts', []):
            if mount.get('Type') != 'bind':
                continue
            source = Path(mount['Source'])
            for path in self.paths.values():
                if not overlapping(source, path):
                    continue
                if mount.get('RW') is not False:
                    return True  # Includes writable / mounts and unknown permissions.
                # Inspect the effective namespace: read-only ancestors can contain
                # writable recursive submounts that Docker's Mounts array omits.
                if mountinfo is None:
                    pid = container['State'].get('Pid')
                    try:
                        require(isinstance(pid, int) and pid > 0, 'Missing container PID.')
                        mountinfo = Path(f'/proc/{pid}/mountinfo').read_text()
                    except (OSError, OperationError) as error:
                        raise OperationError('Cannot verify recursive read-only access for container ' +
                                             json.dumps(container['Name'].lstrip('/')) + '. The mount overlaps metadata, '
                                             'but this does not establish that it is a writer. Run on the Docker daemon host '
                                             'with access to its /proc mount information, or stop that container after '
                                             'checking its role and retry.') from error
                target = PurePosixPath(mount['Destination'])
                if source == path or source in path.parents:
                    target /= path.relative_to(source).as_posix()
                if mountinfo_access(mountinfo, target, PurePosixPath(mount['Destination'])):
                    return True
        return False

    def check_writers(self):
        for container in self.containers():
            if not (container['State'].get('Running') or container['State'].get('Restarting')):
                continue
            labels = self.labels(container)
            same_app = (labels.get('com.docker.compose.project') == self.project and
                        labels.get('com.docker.compose.service') == 'youtarr')
            shared = False if same_app else self.shared_writable_mount(container)
            if same_app or shared:
                name = container['Name'].lstrip('/')
                command_name = shlex.quote(name)
                instructions = (
                    'Application/writer container is running: ' + json.dumps(name) + '.\n' +
                    ('Youtarr must remain stopped so the database and local files do not change during backup.'
                     if self.args.operation == 'backup' else
                     'Writers must remain stopped throughout database and local-file recovery.') +
                    '\nStop this container with:\n  docker stop ' + command_name +
                    '\nThen rerun the same ' + self.args.operation + ' command, including any options.' +
                    '\nDo not use ./stop.sh or docker compose down for this workflow: they remove containers, '
                    'including the deployment information needed to identify the database safely.')
                if not same_app:
                    instructions += '\nThis container shares the selected configuration or metadata paths; '
                    instructions += 'check its role before stopping it.'
                if self.args.operation == 'backup':
                    instructions += '\nAfter backup completes successfully, restart it with:\n  docker start ' + command_name
                else:
                    instructions += '\n--force skips confirmation only; it cannot bypass this check. '
                    instructions += 'Keep the application stopped until recovery is complete and the intended image is selected.'
                modes = {'development': 'Local development', 'production': 'Production', 'external': 'External database'}
                details = [('Installation', modes.get(getattr(self, 'mode', None)))]
                details += [('Compose file', path) for path in getattr(self, 'selected_files', [])]
                raise WriterRunning(instructions, name, self.args.operation, same_app,
                                    [(label, value) for label, value in details if value])

    def connect(self):
        Console.info('Connecting to the selected database...')
        args = self.args
        self.client_container = args.client_container
        if self.db:
            require(not args.client_container, '--client-container is only for external databases.')
            self.client_container = self.db['Id']
            if not self.db['State']['Running']:
                # Mark before start, so interruption after Docker starts still cleans up.
                self.started = self.db['Id']
                self.run(['docker', 'start', self.started])
            self.db_host = '127.0.0.1'
        elif self.client_container:
            client = self.json(['docker', 'inspect', self.client_container])[0]
            require(client['State']['Running'], 'External client container must already be running.')
            self.client_container = client['Id']
        prefix = ['docker', 'exec', '-i', self.client_container] if self.client_container else []
        self.client = self.find_tool(prefix, ('mariadb', 'mysql'))
        self.dump_tool = self.find_tool(prefix, ('mariadb-dump', 'mysqldump'))
        self.options = self.private / 'client.cnf'
        extra = ''
        if args.db_options_file:
            source = Path(args.db_options_file)
            require(stat.S_IMODE(source.stat().st_mode) & 0o077 == 0,
                    '--db-options-file must be private (chmod 600).')
            extra = source.read_text() + '\n'
            allowed_tls = {'ssl', 'ssl-ca', 'ssl-capath', 'ssl-cert', 'ssl-key', 'ssl-cipher',
                           'ssl-crl', 'ssl-crlpath', 'ssl-verify-server-cert', 'ssl-mode',
                           'tls-version', 'tls-ciphersuites'}
            for line in extra.splitlines():
                line = line.strip()
                if not line or line.startswith(('#', ';')) or line == '[client]':
                    continue
                require(line.split('=', 1)[0].strip().replace('_', '-') in allowed_tls,
                        'DB options file accepts only [client] TLS options; includes and other groups are unsupported.')
        def option(value):
            return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'
        self.options.write_text('[client]\n' + extra + '[client]\n' + '\n'.join(
            key + '=' + option(value) for key, value in
            {'host': self.db_host, 'port': self.db_port, 'user': self.db_user,
             'password': self.db_password, 'protocol': 'TCP'}.items()) + '\n')
        options_path = str(self.options)
        if self.client_container:
            self.remote_options = '/tmp/youtarr-client-' + uuid.uuid4().hex + '.cnf'
            self.run(['docker', 'cp', str(self.options), self.client_container + ':' + self.remote_options])
            self.run(['docker', 'exec', self.client_container, 'chmod', '600', self.remote_options])
            options_path = self.remote_options
        # Old bundled mysqldump rejects connect-timeout in the shared [client]
        # group. Apply the readiness timeout only to the SQL client.
        self.connection = prefix + [self.client, '--defaults-file=' + options_path,
                                    '--batch', '--skip-column-names', '--binary-mode', '--skip-force', '--connect-timeout=5']
        self.dump_command = prefix + [self.dump_tool, '--defaults-file=' + options_path,
                                      '--single-transaction', '--skip-lock-tables', '--hex-blob',
                                      '--routines', '--events', '--triggers']
        deadline = time.monotonic() + args.ready_timeout
        while True:
            result = self.query('SELECT VERSION();', check=False)
            if result.returncode == 0:
                break
            require(time.monotonic() < deadline, 'Could not connect to the database within the time limit. '
                    'Check the server address, port, account and password. Technical details were saved to: ' + str(self.log))
            time.sleep(2)
        version = result.stdout.decode().strip()
        family = 'mariadb' if 'mariadb' in version.lower() else 'mysql'
        server_release = re.match(r'(\d+\.\d+)', version)
        require(server_release, 'Cannot recognize the database server version.')
        for tool, label in ((self.dump_tool, 'dump client'), (self.client, 'SQL client')):
            tool_version = self.run(prefix + [tool, '--version']).stdout.decode()
            tool_family, release = client_version(tool_version, label)
            require(tool_family == family and release == server_release[1],
                    f'The {label} is {tool_family} {release}, but the server is {family} {server_release[1]}. '
                    'Use clients matching the server engine and major/minor release, or --skip-db.')
        if family == 'mysql':
            if int(server_release[1].split('.')[0]) >= 8:
                self.dump_command += ['--column-statistics=0']
            self.dump_command += ['--set-gtid-purged=OFF', '--no-tablespaces']
        self.lower_case_table_names = int(self.query('SELECT @@lower_case_table_names;').stdout.decode().strip())
        require(self.lower_case_table_names in (0, 1, 2), 'Unsupported identifier-case setting.')
        self.target.update(engine=family, version=version, lower_case_table_names=self.lower_case_table_names)
        Console.success(f'Connected to {family} {version}.')
        self.schema = self.query('SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM '
                                 'information_schema.SCHEMATA WHERE SCHEMA_NAME=' + literal(self.db_name)).stdout.decode().strip().split('\t')

    def find_tool(self, prefix, choices):
        for name in choices:
            if not prefix and not shutil.which(name):
                continue
            if self.run(prefix + [name, '--version'], check=False).returncode == 0:
                return name
        raise OperationError('Compatible MySQL/MariaDB client tools are required; use --skip-db for local files only.')

    def query(self, sql, check=True):
        return self.run(self.connection, input=(sql + '\n').encode(), check=check, purpose='Database query')

    def inventory(self):
        tables = self.query('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=' +
                            literal(self.db_name) + ' ORDER BY TABLE_NAME;').stdout.decode().splitlines()
        result = {'tables': {}, 'migrations': []}
        for line in tables:
            name, kind = line.split('\t')
            count = self.query('SELECT COUNT(*) FROM ' + identifier(self.db_name) + '.' + identifier(name) + ';').stdout.decode().strip()
            result['tables'][name] = {'type': kind, 'rows': int(count)}
        meta = migration_table(result['tables'], self.lower_case_table_names)
        result['migrations'] = self.query('SELECT name FROM ' + identifier(self.db_name) +
                                          '.' + identifier(meta) + ' ORDER BY name;').stdout.decode().splitlines()
        schema_queries = {
            'columns': 'SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, '
                       'COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS '
                       'WHERE TABLE_SCHEMA={db} ORDER BY TABLE_NAME, ORDINAL_POSITION;',
            'indexes': 'SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, INDEX_TYPE '
                       'FROM information_schema.STATISTICS WHERE TABLE_SCHEMA={db} '
                       'ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;',
            'foreign_keys': 'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION, '
                            'REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE '
                            'WHERE TABLE_SCHEMA={db} AND REFERENCED_TABLE_NAME IS NOT NULL '
                            'ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;'
        }
        for key, sql in schema_queries.items():
            result[key] = self.query(sql.format(db=literal(self.db_name))).stdout.decode().splitlines()
        return result

    def dump(self, path):
        require(len(self.schema) == 2, 'Selected database does not exist.')
        with path.open('xb') as output:
            self.run(self.dump_command + ['--', self.db_name], output=output, purpose='Database dump')
        require(path.stat().st_size > 0, 'Database dump is empty.')

    def cleanup(self, success):
        cleanup_ok = True
        if self.remote_options:
            cleanup_ok = self.run(['docker', 'exec', self.client_container, 'rm', '-f', self.remote_options],
                                  check=False).returncode == 0
        if self.started:
            cleanup_ok = self.run(['docker', 'stop', self.started], check=False).returncode == 0 and cleanup_ok
        if self.lock:
            self.lock.close()
        if success and cleanup_ok:
            shutil.rmtree(self.private)
        else:
            if self.options:
                self.options.unlink(missing_ok=True)
            if self.log.is_file() and self.log.stat().st_size:
                Console.field('Diagnostics', self.log, stream=sys.stderr)
        if self.recovery:
            Console.field('Recovery files', self.recovery, stream=sys.stderr)
        require(cleanup_ok, 'Could not clean up an operation-owned resource; check protected diagnostics.')

    def components(self):
        return {'env.backup': ROOT / '.env',
                **{'config/' + name: self.paths['config'] / name for name in
                   ('config.json', 'cookies.user.txt', 'complete.list')},
                'metadata/jobs': self.paths['jobs'], 'metadata/server/images': self.paths['images']}

    def backup(self):
        output = Path(self.args.output_dir).absolute()
        directory_access(output, 'Backup output directory')
        self.resolve()
        require(all(output != self.paths[key] and self.paths[key] not in output.parents
                    for key in ('jobs', 'images')), 'Backup output must be outside jobs/images directories.')
        for item, source in self.components().items():
            if item == 'metadata/server/images' and self.args.skip_images:
                continue
            if source.exists() or source.is_symlink():
                regular_tree(source)
            else:
                require(item not in ('env.backup', 'config/config.json'), f'Missing critical file: {source}')
        name = 'youtarr-backup-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:12]
        root = self.private / name
        root.mkdir()
        manifest = {'version': '2.0', 'created': datetime.now(timezone.utc).isoformat(),
                    'included': [], 'omitted': {}, 'database': None, 'source': self.target}
        if not self.args.skip_db:
            self.connect()
            self.check_writers()
            sql = root / 'database/youtarr.sql'
            sql.parent.mkdir()
            Console.info('Checking database contents and creating the SQL dump...')
            inventory = self.inventory()
            self.dump(sql)
            require(self.inventory() == inventory, 'Database changed during backup; stop all writers and retry.')
            Console.success('Database dump complete; table counts and migration history verified.')
            manifest['database'] = {'inventory': inventory, 'charset': self.schema[0], 'collation': self.schema[1]}
            manifest['included'].append('database/youtarr.sql')
        else:
            manifest['omitted']['database/youtarr.sql'] = 'explicit --skip-db; local files only'
        Console.info('Copying configuration and metadata...')
        for item, source in self.components().items():
            if item == 'metadata/server/images' and self.args.skip_images:
                manifest['omitted'][item] = 'explicit --skip-images'
            elif source.exists() or source.is_symlink():
                copy_item(source, root / item)
                manifest['included'].append(item)
            else:
                require(item not in ('env.backup', 'config/config.json'), f'Missing critical file: {source}')
                manifest['omitted'][item] = 'absent at source'
        self.check_writers()
        Console.info('Calculating checksums...')
        manifest['checksums'] = file_hashes(root)
        write_json(root / 'manifest.json', manifest)
        # Place temporary output on the destination filesystem for atomic publication.
        temporary = output / ('.' + name + '.partial')
        final = output / (name + '.tar.gz')
        try:
            Console.info('Creating backup archive...')
            with tarfile.open(temporary, 'x:gz') as archive:
                archive.add(root, arcname=name)
            verification = self.private / 'verify'
            verification.mkdir()
            Console.info('Verifying archive contents and checksums...')
            extract_archive(temporary, verification, self.args.skip_db)
            with temporary.open('rb') as stream:
                os.fsync(stream.fileno())
            os.rename(temporary, final)
        finally:
            temporary.unlink(missing_ok=True)
        return 'Backup created' + (' (local files only)' if self.args.skip_db else '') + ':\n  ' + str(final)

    def restore(self):
        extraction = self.private / 'extract'
        extraction.mkdir()
        Console.info('Opening and validating the backup archive...')
        root, manifest = extract_archive(Path(self.args.archive), extraction, self.args.skip_db)
        Console.target('Archive source', manifest.get('source') or {})
        Console.field('Archive', Path(self.args.archive).absolute())
        Console.field('Created', manifest.get('created', 'Unknown (legacy archive)'))
        Console.field('Format', manifest['version'])
        self.resolve()
        replacements = []
        for item, destination in self.components().items():
            if item == 'env.backup':
                continue  # Source settings are recovery reference material, never destination selectors.
            source = root / item
            if manifest['version'] == '1.0' and item == 'metadata/jobs':
                source = root / 'metadata/jobs/info'
                destination = destination / 'info'
            if source.exists():
                require(source.is_dir() if item.startswith('metadata/') else source.is_file(),
                        f'Invalid component type: {item}')
                if destination.exists():
                    require(source.is_dir() == destination.is_dir(), f'Destination type mismatch: {destination}')
                replacements.append((source, destination))
        require(bool(replacements), 'Archive contains no restorable local components.')
        # No destination changes until all archive, target, writer and permission checks pass.
        for source, destination in replacements:
            require(not destination.is_symlink(), f'Symlink destination: {destination}')
            require(destination.parent.is_dir() and os.access(destination.parent, os.W_OK | os.X_OK),
                    f'Restore needs write access to destination parent {destination.parent}. '
                    'For a root-owned installation, use the documented sudo workflow consistently; '
                    'otherwise grant the intended restore account access. Do not recreate or move existing data.')
            if destination.exists():
                regular_tree(destination)
            reference = destination if destination.exists() else destination.parent
            self.check_restore_ownership(reference.stat(), destination)
        if not self.args.skip_db:
            self.connect()
            if manifest.get('source', {}).get('engine'):
                require(manifest['source']['engine'] == self.target['engine'],
                        'Cross-engine restore is unsupported; migrate with database tooling first.')
            self.preflight_case(manifest)
            self.preflight_version(manifest)
            self.preflight_privileges()
        Console.section('What will be replaced')
        if not self.args.skip_db:
            Console.field('Database', self.db_name)
        for _, destination in replacements:
            Console.field('Local path', destination)
        Console.info('The destination .env will be preserved.')
        Console.warn('Existing data will be replaced. Keep Youtarr stopped until restore and any recovery steps are complete.')
        if not self.args.force:
            if input(Console.paint("\nType RESTORE to confirm, or press Enter to cancel: ", '1;33')) != 'RESTORE':
                raise RestoreCancelled('Restore cancelled. Existing data was not replaced.')
        self.check_writers()
        recovery_base = Path(self.args.recovery_dir).absolute()
        require(all(recovery_base != destination and destination not in recovery_base.parents
                    for _, destination in replacements), 'Recovery directory must be outside replaced components.')
        directory_access(recovery_base, 'Restore recovery directory')
        self.recovery = Path(tempfile.mkdtemp(prefix='youtarr-recovery-', dir=recovery_base))
        Console.info('Saving existing data for recovery...')
        Console.field('Recovery files', self.recovery)
        copy_item(root / 'env.backup', self.recovery / 'source.env')
        if (ROOT / '.env').exists():
            copy_item(ROOT / '.env', self.recovery / 'destination.env')
        journal = {'target': self.target, 'state': 'preparing', 'replaced': [], 'local': []}
        staged = []
        write_json(self.recovery / 'recovery.json', journal)
        try:
            for index, (source, destination) in enumerate(replacements):
                saved = self.recovery / 'local' / str(index)
                if destination.exists():
                    copy_item(destination, saved)
                temporary = Path(tempfile.mkdtemp(prefix='.youtarr-restore-', dir=destination.parent))
                staged.append((temporary, destination))
                copy_item(source, temporary / 'new')
                # Preserve ownership/mode needed by configured non-root app containers.
                reference = destination if destination.exists() else destination.parent
                journal['local'].append({'destination': str(destination), 'saved': str(saved) if saved.exists() else None,
                                         'uid': reference.stat().st_uid, 'gid': reference.stat().st_gid,
                                         'mode': oct(stat.S_IMODE(reference.stat().st_mode)),
                                         'staged': str(temporary)})
                write_json(self.recovery / 'recovery.json', journal)
                try:
                    self.set_permissions(temporary / 'new', reference.stat())
                except PermissionError as error:
                    raise OperationError(f'Cannot preserve ownership or permissions for {destination}. '
                                         'No database or local files have been replaced. Run restore with an account '
                                         'allowed to set the destination ownership. If already using sudo, check '
                                         'filesystem restrictions such as NFS root squashing. Recovery copies and '
                                         'staging paths are recorded in the recovery journal.') from error
            if not self.args.skip_db and len(self.schema) == 2:
                self.dump(self.recovery / 'previous.sql')
                journal['previous_schema'] = {'charset': self.schema[0], 'collation': self.schema[1]}
            for saved in self.recovery.rglob('*'):
                if saved.is_file():
                    with saved.open('rb') as stream:
                        os.fsync(stream.fileno())
            journal['state'] = 'preserved'
            write_json(self.recovery / 'recovery.json', journal)
            self.check_writers()
            if not self.args.skip_db:
                schema = manifest.get('database') or {}
                charset = schema.get('charset') or (self.schema[0] if len(self.schema) == 2 else 'utf8mb4')
                collation = schema.get('collation') or (self.schema[1] if len(self.schema) == 2 else 'utf8mb4_unicode_ci')
                require(re.fullmatch(r'[A-Za-z0-9_]+', charset) and re.fullmatch(r'[A-Za-z0-9_]+', collation),
                        'Invalid charset/collation.')
                require(self.query('SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME=' +
                                   literal(collation) + ' AND CHARACTER_SET_NAME=' + literal(charset)).stdout.strip(),
                        'Source charset/collation is unsupported on destination.')
                journal['state'] = 'database replacement started'
                write_json(self.recovery / 'recovery.json', journal)
                Console.info('Replacing the selected database and importing SQL...')
                self.query('DROP DATABASE IF EXISTS ' + identifier(self.db_name) + '; CREATE DATABASE ' +
                           identifier(self.db_name) + ' CHARACTER SET ' + charset + ' COLLATE ' + collation + ';')
                # No --force on the SQL client: any failed statement aborts the import.
                with (root / 'database/youtarr.sql').open('rb') as sql, self.log.open('ab') as errors:
                    command = list(self.connection)
                    result = subprocess.run(command + ['--', self.db_name], stdin=sql,
                                            stdout=errors, stderr=errors, check=False)
                require(result.returncode == 0, 'Could not finish restoring the database.\n'
                        'Database replacement has started and the database may be incomplete. '
                        'Local files have not been replaced. Keep Youtarr stopped. '
                        'Follow "If restore fails" in docs/BACKUP_RESTORE.md using the recovery folder below.')
                Console.info('Validating the restored database...')
                actual = self.inventory()
                if (manifest.get('database') or {}).get('inventory'):
                    require(comparable_inventory(actual, self.lower_case_table_names) ==
                            comparable_inventory(manifest['database']['inventory'], self.lower_case_table_names), 'The restored database does not match the backup.\n'
                            'The database has already been replaced; local files have not been replaced. '
                            'Keep Youtarr stopped. Previous data, when present, was saved in the recovery folder below. '
                            'Follow "If restore fails" in docs/BACKUP_RESTORE.md.')
                journal['state'] = 'database imported and validated'
                write_json(self.recovery / 'recovery.json', journal)
            Console.info('Restoring configuration and metadata...')
            for temporary, destination in staged:
                self.check_writers()
                if destination.exists():
                    os.rename(destination, temporary / 'old')
                try:
                    os.rename(temporary / 'new', destination)
                except BaseException:
                    if (temporary / 'old').exists():
                        os.rename(temporary / 'old', destination)
                    raise
                journal['replaced'].append(str(destination))
                write_json(self.recovery / 'recovery.json', journal)
            self.check_writers()
            journal['state'] = 'complete'
            write_json(self.recovery / 'recovery.json', journal)
        finally:
            # The recovery copy survives success and failure. Staging is retained on
            # failure too, including the original directory if interrupted mid-swap.
            if journal['state'] == 'complete':
                for temporary, _ in staged:
                    shutil.rmtree(temporary)
        return 'Restore completed' + (' (local files only)' if self.args.skip_db else '') + '.'

    @staticmethod
    def check_restore_ownership(reference, destination):
        uid = os.geteuid()
        groups = set(os.getgroups()) | {os.getegid()}
        require(uid == 0 or (reference.st_uid == uid and reference.st_gid in groups),
                'Restore needs permission to keep the existing file owner.\n'
                f'File: {destination}\n'
                f'Details: owner UID {reference.st_uid}, group GID {reference.st_gid}; '
                f'you are running restore as UID {uid}.\n'
                'Next step: for a local installation, rerun the same command with sudo. '
                'Keep all your options and check that the printed installation and database are correct. '
                'See "Permissions and temporary space" in docs/BACKUP_RESTORE.md before switching accounts.\n'
                'No database or local files have been replaced.')

    @staticmethod
    def set_permissions(path, reference):
        entries = [path, *path.rglob('*')] if path.is_dir() else [path]
        for entry in entries:
            current = entry.stat()
            if (current.st_uid, current.st_gid) != (reference.st_uid, reference.st_gid):
                os.chown(entry, reference.st_uid, reference.st_gid)
            mode = stat.S_IMODE(reference.st_mode) & 0o777
            if entry.is_file():
                mode &= 0o666
            elif not mode & 0o100:
                mode |= 0o700
            os.chmod(entry, mode)

    def preflight_version(self, manifest):
        recorded = manifest.get('source', {}).get('version')
        supplied = self.args.source_db_version
        require(recorded or supplied, 'This older archive does not record the database server version. '
                'Verify the source release and supply --source-db-version (for example 10.3.39). '
                'Do not guess the source version.')
        source = server_release(recorded or supplied)
        require(not supplied or server_release(supplied) == source,
                'Explicit source database release conflicts with the archive.')
        destination = server_release(self.target['version'])
        require(source == destination,
                f'Source database release is {source[0]}.{source[1]}, destination is {destination[0]}.{destination[1]}. '
                'These database versions cannot be restored directly with this script. '
                'Restore into the same major/minor version first, then follow the database upgrade instructions '
                'for your installation. No database has been replaced.')

    def preflight_case(self, manifest):
        source_mode = manifest.get('source', {}).get('lower_case_table_names')
        supplied = self.args.source_lower_case_table_names
        if source_mode is None:
            require(supplied is not None, 'This older backup is missing a database setting needed for a safe restore.\n'
                    'The setting, lower_case_table_names, controls how table names are stored and compared.\n'
                    'Next step: check the original database setting and retry with '
                    '--source-lower-case-table-names 0, 1 or 2. See "Older backups" in '
                    'docs/BACKUP_RESTORE.md. Do not guess the value. No database has been replaced.')
            source_mode = supplied
        else:
            require(type(source_mode) is int and source_mode in (0, 1, 2), 'Invalid source identifier-case setting.')
            require(supplied is None or supplied == source_mode, 'Explicit source case setting conflicts with the archive.')
        inventory = (manifest.get('database') or {}).get('inventory')
        if inventory:
            comparable_inventory(inventory, self.lower_case_table_names)  # Detect collisions before DROP.
            migration_table(inventory['tables'], source_mode)
        require(source_mode == self.lower_case_table_names,
                f'Source lower_case_table_names={source_mode}, destination={self.lower_case_table_names}. '
                'Automatic transfer between different case settings is unsupported. Use a destination with '
                'the source setting or perform a separately validated database migration. No database was replaced.')

    def preflight_privileges(self):
        grants = self.query('SHOW GRANTS FOR CURRENT_USER;').stdout.decode()
        family = self.target['engine']
        partial = False
        if family == 'mysql' and int(self.target['version'].split('.')[0]) >= 8:
            partial_result = self.query('SELECT @@partial_revokes;', check=False)
            # MySQL 8.0 releases before 8.0.16 do not have this setting.
            if partial_result.returncode == 0:
                partial = partial_result.stdout.strip() == b'1'
            else:
                match = re.match(r'(\d+)\.(\d+)\.(\d+)', self.target['version'])
                require(match, 'Cannot determine server support for partial privilege revocations.')
                release = tuple(int(n) for n in match.groups())
                require(release < (8, 0, 16), 'Cannot inspect partial privilege revocations.')
            roles = self.query('SELECT CURRENT_ROLE();').stdout.decode().strip()
            if roles != 'NONE':
                # CURRENT_ROLE returns SQL-quoted role accounts; accept only that grammar.
                account = r"`(?:``|[^`])+`@`(?:``|[^`])+`"
                require(re.fullmatch(account + r'(?:,\s*' + account + r')*', roles),
                        'Cannot safely interpret active MySQL roles.')
                grants = self.query('SHOW GRANTS FOR CURRENT_USER USING ' + roles + ';').stdout.decode()
        elif family == 'mariadb':
            # Includes inherited enabled roles; merely assigned inactive roles do not count.
            # With no active role MariaDB returns one SQL NULL row. Exclude it
            # in SQL, preserving a real role whose name happens to be 'NULL'.
            roles = self.query('SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES '
                               'WHERE ROLE_NAME IS NOT NULL;').stdout.decode().splitlines()
            for role in roles:
                grants += '\n' + self.query('SHOW GRANTS FOR ' + identifier(role) + ';').stdout.decode()
        available = effective_schema_privileges(grants, self.db_name, partial, self.lower_case_table_names)
        missing = RESTORE_PRIVILEGES - available
        require(not missing, 'The database account does not have all permissions required for restore.\nMissing permissions: ' + ', '.join(sorted(missing)) +
                '.\nNext step: use --db-user with --db-password-file to select an account allowed to '
                'back up and replace this database. See "Database compatibility and permissions" in '
                'docs/BACKUP_RESTORE.md. No database has been replaced.')
        # The retained recovery dump must also succeed before DROP; this checks
        # engine-specific routine visibility privileges without guessing grant names.


def parser():
    result = ScriptArgumentParser(prog='Youtarr backup / restore',
                                  description='Back up or restore Youtarr. Video files are excluded.')
    sub = result.add_subparsers(dest='operation', required=True)
    for name in ('backup', 'restore'):
        command = sub.add_parser(
            name, prog='./scripts/' + name + '.sh',
            usage='%(prog)s ' + ('BACKUP_FILE ' if name == 'restore' else '') + '[OPTIONS]',
            description=('Restore configuration, metadata and the database from a backup archive.'
                         if name == 'restore' else 'Back up configuration, metadata and the database.'),
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog=('Examples:\n  ./scripts/restore.sh /path/to/backup.tar.gz\n'
                    '  ./scripts/restore.sh /path/to/backup.tar.gz --skip-db' if name == 'restore' else
                    'Examples:\n  ./scripts/backup.sh\n  ./scripts/backup.sh --output-dir /mnt/backups') +
                   '\n\nStop the application with docker stop <container-name> first.\n'
                   'Keep its containers; do not use ./stop.sh or docker compose down.\n'
                   'Video files are excluded. See docs/BACKUP_RESTORE.md for recovery guidance.')
        common = command.add_argument_group('Common options')
        selection = command.add_argument_group('Installation selection')
        connection = command.add_argument_group('Database connection')
        selection.add_argument('--mode', choices=('auto', 'production', 'development', 'external'), default='auto',
                             help='Installation type (default: auto); development means the local developer setup')
        selection.add_argument('--project', help='Compose project name')
        selection.add_argument('--compose-file', action='append', default=[], help='Compose file; repeat for overrides')
        selection.add_argument('--db-container', help='Exact existing bundled DB container name or ID')
        connection.add_argument('--client-container', help='Running external DB client container with network/TLS access')
        connection.add_argument('--db-user', help='Explicit privileged backup/restore account; requires --db-password-file')
        connection.add_argument('--db-password-file', help='Private password file for the explicit database account')
        connection.add_argument('--db-options-file', help='Private MySQL option file for TLS/client options')
        common.add_argument('--skip-db', action='store_true', help='Exclude the database; process local settings and metadata only')
        connection.add_argument('--ready-timeout', type=int, default=90, help='Seconds to wait for a database connection (default: 90)')
        if name == 'backup':
            common.add_argument('--output-dir', default=str(ROOT / 'backups'), help='Archive output directory (default: repository backups/)')
            common.add_argument('--skip-images', action='store_true', help='Exclude thumbnails/images from the backup')
        else:
            legacy = command.add_argument_group('Older-backup compatibility')
            command.add_argument('archive', metavar='BACKUP_FILE', help='Path to the backup .tar.gz archive')
            legacy.add_argument('--source-db-version', help='Verified source release for archives without a recorded server version')
            legacy.add_argument('--source-lower-case-table-names', type=int, choices=(0, 1, 2),
                                 help='Verified source setting for older archives that did not record it')
            common.add_argument('--force', action='store_true', help='Skip confirmation only')
            common.add_argument('--recovery-dir', default=str(ROOT / 'backups'), help='Where to save existing data for recovery (default: repository backups/)')
    return result


def main():
    require(sys.version_info >= (3, 9), 'Python 3.9 or newer is required.')
    os.umask(0o077)
    args = parser().parse_args()
    require(bool(args.db_user) == bool(args.db_password_file),
            '--db-user and --db-password-file must be supplied together.')
    require(args.ready_timeout > 0, '--ready-timeout must be positive.')
    def interrupted(signum, frame):
        raise OperationError('Interrupted; keep the app stopped and inspect retained recovery data.')
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    Console.banner('Youtarr ' + args.operation.capitalize())
    operation = Operation(args)
    success = False
    try:
        message = getattr(operation, args.operation)()
        success = True
    except RestoreCancelled as error:
        Console.info(str(error))
        return 1
    except (OperationError, OSError, ValueError, tarfile.TarError, EOFError) as error:
        # Explain the failure before cleanup reports retained diagnostics/recovery.
        Console.error(error)
        return 1
    finally:
        operation.cleanup(success)
    Console.section(args.operation.capitalize() + ' complete')
    Console.success(message)
    if args.operation == 'restore':
        Console.prose('Before starting Youtarr, check that its version is appropriate for this backup. '
                      'See "Returning to an earlier version" in docs/BACKUP_RESTORE.md if you are undoing an update.')
    Console.warn('Video files are excluded; back up/restore the output directory separately.')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OperationError, OSError, ValueError, tarfile.TarError, EOFError) as error:
        Console.error(error)
        sys.exit(1)

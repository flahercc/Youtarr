"""Disposable fixture coverage; no Docker/database calls or repository writes.

Run sequentially from the repo root:
python3 -m unittest discover -s scripts/tests -p 'test_backup_restore.py'
"""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('backup_restore', Path(__file__).parents[1] / '_backup_restore.py')
BR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BR)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.archive = self.base / 'backup.tar.gz'
        self.destination = self.base / 'extracted'
        self.destination.mkdir()

    def make_archive(self, entries):
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, data, kind in entries:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.size = len(data) if kind == tarfile.REGTYPE else 0
                info.linkname = '/tmp/outside'
                archive.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)

    def legacy(self, extra=()):
        self.make_archive([('youtarr-backup-fixture/env.backup', b'DB_NAME=source', tarfile.REGTYPE), *extra])

    def test_legacy_requires_sql_unless_explicitly_skipped(self):
        self.legacy()
        with self.assertRaisesRegex(BR.OperationError, 'Missing/empty SQL'):
            BR.extract_archive(self.archive, self.destination)

    def test_legacy_local_files_remain_supported(self):
        self.legacy()
        root, manifest = BR.extract_archive(self.archive, self.destination, True)
        self.assertEqual(manifest['version'], '1.0')
        self.assertEqual((root / 'env.backup').read_text(), 'DB_NAME=source')

    def test_empty_sql_is_rejected(self):
        self.legacy([('youtarr-backup-fixture/database/youtarr.sql', b'', tarfile.REGTYPE)])
        with self.assertRaisesRegex(BR.OperationError, 'Missing/empty SQL'):
            BR.extract_archive(self.archive, self.destination)

    def test_unsafe_archives_fail_before_any_extraction(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('youtarr-backup-fixture/link', tarfile.SYMTYPE),
                           ('youtarr-backup-fixture/hardlink', tarfile.LNKTYPE),
                           ('youtarr-backup-fixture/device', tarfile.CHRTYPE),
                           ('youtarr-backup-fixture/a/../../escape', tarfile.REGTYPE)]:
            with self.subTest(name=name, kind=kind):
                self.legacy([(name, b'', kind)])
                with self.assertRaises(BR.OperationError):
                    BR.extract_archive(self.archive, self.destination, True)
                self.assertEqual(list(self.destination.iterdir()), [])

    def test_multiple_roots_and_duplicates_rejected(self):
        for name in ['other-root/file', 'youtarr-backup-fixture/env.backup']:
            self.legacy([(name, b'', tarfile.REGTYPE)])
            with self.assertRaises(BR.OperationError):
                BR.extract_archive(self.archive, self.destination, True)
            self.assertEqual(list(self.destination.iterdir()), [])

    def test_file_directory_collision_rejected(self):
        self.legacy([('youtarr-backup-fixture/config', b'file', tarfile.REGTYPE),
                     ('youtarr-backup-fixture/config/config.json', b'{}', tarfile.REGTYPE)])
        with self.assertRaisesRegex(BR.OperationError, 'collision'):
            BR.extract_archive(self.archive, self.destination, True)
        self.assertEqual(list(self.destination.iterdir()), [])

    def v2(self, tamper=False):
        root = self.base / 'youtarr-backup-fixture'
        root.mkdir()
        (root / 'config').mkdir()
        (root / 'config/config.json').write_text('{}')
        (root / 'env.backup').write_text('DB_NAME=source')
        manifest = {'version': '2.0', 'included': ['env.backup', 'config/config.json'],
                    'checksums': BR.file_hashes(root)}
        BR.write_json(root / 'manifest.json', manifest)
        if tamper:
            (root / 'config/config.json').write_text('{"changed": true}')
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(root, arcname=root.name)

    def test_v2_round_trip_preserves_content(self):
        self.v2()
        root, manifest = BR.extract_archive(self.archive, self.destination, True)
        self.assertEqual(BR.file_hashes(root), manifest['checksums'])

    def test_checksum_failure_rejected(self):
        self.v2(tamper=True)
        with self.assertRaisesRegex(BR.OperationError, 'checksum'):
            BR.extract_archive(self.archive, self.destination, True)

    def test_copy_refuses_symlinks(self):
        source = self.base / 'source'
        source.symlink_to(self.archive)
        with self.assertRaisesRegex(BR.OperationError, 'Symlinks'):
            BR.copy_item(source, self.base / 'copy')


class TargetTests(unittest.TestCase):
    def setUp(self):
        self.args = BR.parser().parse_args(['backup'])
        self.operation = BR.Operation(self.args)
        self.addCleanup(lambda: BR.shutil.rmtree(self.operation.private, ignore_errors=True))

    def test_connection_timeout_is_not_passed_to_legacy_dump_tool(self):
        self.operation.db_host = '127.0.0.1'
        self.operation.db_port = '3306'
        self.operation.db_user = 'fixture'
        self.operation.db_password = 'fixture-password'
        self.operation.db_name = 'fixture'
        self.operation.target = {}
        version = b'mysql Ver 15.1 Distrib 10.3.39-MariaDB, for Linux'
        with patch.object(self.operation, 'find_tool', side_effect=['mysql', 'mysqldump']), \
                patch.object(self.operation, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=version)), \
                patch.object(self.operation, 'query', side_effect=[
                    subprocess.CompletedProcess([], 0, stdout=b'10.3.39-MariaDB'),
                    subprocess.CompletedProcess([], 0, stdout=b'0'),
                    subprocess.CompletedProcess([], 0, stdout=b'utf8mb4\tutf8mb4_unicode_ci')]):
            self.operation.connect()
        self.assertIn('--connect-timeout=5', self.operation.connection)
        self.assertNotIn('connect-timeout', self.operation.options.read_text())
        self.assertFalse(any('connect-timeout' in arg for arg in self.operation.dump_command))

    def test_dump_option_failure_explains_stage_without_echoing_secrets(self):
        self.operation.schema = ['utf8mb4', 'utf8mb4_unicode_ci']
        self.operation.dump_command = ['fixture-mysqldump']
        self.operation.db_name = 'fixture'
        def failed_dump(command, **kwargs):
            kwargs['stderr'].write(b"mysqldump: unknown variable 'connect-timeout=5'\nprivate-password\n")
            return subprocess.CompletedProcess(command, 1)
        with patch.object(BR.subprocess, 'run', side_effect=failed_dump):
            with self.assertRaises(BR.OperationError) as failure:
                self.operation.dump(self.operation.private / 'dump.sql')
        message = str(failure.exception)
        self.assertIn('Database dump failed', message)
        self.assertIn('unsupported option', message)
        self.assertNotIn('private-password', message)

    def test_failure_does_not_classify_stderr_from_previous_command(self):
        self.operation.log.write_text("mysqldump: unknown variable 'connect-timeout=5'\n")
        with patch.object(BR.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaises(BR.OperationError) as failure:
                self.operation.run(['fixture-command'])
        self.assertNotIn('unsupported option', str(failure.exception))

    def test_merged_external_config_follows_application_host(self):
        self.operation.project = 'youtarr'
        self.operation.config = {'services': {'youtarr-db': {'container_name': 'youtarr-db'}}}
        self.operation.app_env = {'DB_HOST': 'host.docker.internal'}
        # An unused DB service/container must not redirect an external connection.
        container = {'Name': '/youtarr-db', 'Config': {'Labels': {
            'com.docker.compose.project': 'youtarr', 'com.docker.compose.service': 'youtarr-db'}}}
        self.assertEqual(self.operation.database_mode([container]), 'external')
        self.assertEqual(self.operation.database_mode([]), 'external')

    def test_bundled_service_container_and_network_aliases(self):
        self.operation.project = 'youtarr'
        self.operation.config = {'services': {'youtarr-db': {
            'container_name': 'custom-db', 'networks': {'default': {'aliases': ['db-alias']}}}}}
        for host in ('youtarr-db', 'custom-db', 'db-alias'):
            with self.subTest(host=host):
                self.operation.app_env = {'DB_HOST': host, 'DEV_MODE': 'true'}
                self.assertEqual(self.operation.database_mode([]), 'development')
        self.operation.app_env = {'DB_HOST': 'unrelated-db'}
        self.assertEqual(self.operation.database_mode([]), 'external')

    def test_tls_options_with_and_without_group_header(self):
        import configparser
        for header in ('', '[client]\n'):
            with self.subTest(header=header):
                options = self.operation.private / 'tls.cnf'
                options.write_text(header + 'ssl-ca=/private/ca.pem\n')
                options.chmod(0o600)
                self.args.db_options_file = str(options)
                self.operation.db_host = 'external.example'
                self.operation.db_port = '3306'
                self.operation.db_user = 'fixture'
                self.operation.db_password = 'fixture-password'
                self.operation.db_name = 'youtarr'
                self.operation.target = {}
                with patch.object(self.operation, 'find_tool', side_effect=['mysql', 'mysqldump']), \
                        patch.object(self.operation, 'run', return_value=subprocess.CompletedProcess(
                            [], 0, stdout=b'mysql Ver 15.1 Distrib 10.3.39-MariaDB')), \
                        patch.object(self.operation, 'query', side_effect=[
                            subprocess.CompletedProcess([], 0, stdout=value) for value in
                            (b'10.3.39-MariaDB', b'0', b'utf8mb4\tutf8mb4_unicode_ci')]):
                    self.operation.connect()
                parsed = configparser.ConfigParser(strict=False)
                parsed.read_string(self.operation.options.read_text())
                self.assertEqual(parsed['client']['ssl-ca'], '/private/ca.pem')
                self.assertEqual(parsed['client']['host'], '"external.example"')

    def test_lock_permission_error_explains_sudo_ownership(self):
        with patch.object(BR.os, 'open', side_effect=PermissionError), \
                patch.object(self.operation, 'run') as run:
            with self.assertRaisesRegex(BR.OperationError, 'same account consistently'):
                self.operation.resolve()
        run.assert_not_called()

    def test_output_permission_error_names_directory(self):
        path = self.operation.private / 'output'
        path.mkdir()
        with patch.object(BR.os, 'access', return_value=False):
            with self.assertRaises(BR.OperationError) as failure:
                BR.directory_access(path, 'Backup output directory')
        self.assertIn(str(path), str(failure.exception))
        self.assertIn('owner UID', str(failure.exception))

    def dev_app(self):
        return {'Name': '/youtarr-dev', 'Config': {
            'Labels': {'com.docker.compose.project.config_files': str(BR.ROOT / 'docker-compose.dev.yml')},
            'Env': ['DEV_MODE=true', 'DB_PORT=3306']}}

    def test_existing_dev_selection_ignores_ambient_production_files(self):
        self.operation.app = self.dev_app()
        with patch.dict(BR.os.environ, {'COMPOSE_FILE': 'docker-compose.yml:docker-compose.arm.yml'}), \
                patch.object(self.operation, 'run') as run:
            self.operation.select_compose_files()
        self.assertEqual(self.operation.selected_files, [str(BR.ROOT / 'docker-compose.dev.yml')])
        self.assertEqual(self.operation.compose[-2:], ['-f', str(BR.ROOT / 'docker-compose.dev.yml')])
        # Selection does not consult .env/Compose environment output when labels exist.
        run.assert_not_called()
        self.operation.app_env = {'DB_PORT': '3306'}
        self.operation.validate_app_environment()

    def test_explicit_files_override_container_labels(self):
        self.operation.app = self.dev_app()
        self.args.compose_file = ['/custom path/base.yml', '/custom path/override.yml']
        self.operation.select_compose_files()
        self.assertEqual(self.operation.compose[-4:], ['-f', '/custom path/base.yml', '-f', '/custom path/override.yml'])
        self.assertEqual(self.operation.selection_source, 'explicit --compose-file')

    def test_explicit_mode_still_validates_against_existing_container(self):
        self.operation.app = self.dev_app()
        self.args.mode = 'production'
        self.operation.select_compose_files()
        self.operation.app_env = {'DB_PORT': '3321'}
        with self.assertRaises(BR.OperationError) as failure:
            self.operation.validate_app_environment()
        message = str(failure.exception)
        for expected in ('youtarr-dev', 'DB_PORT', '3306', '3321', 'docker-compose.yml',
                         'explicit --mode production', './scripts/backup.sh --mode development'):
            self.assertIn(expected, message)

    def test_same_dev_files_suggest_environment_review_not_identical_retry(self):
        self.operation.app = self.dev_app()
        self.operation.select_compose_files()
        self.operation.app_env = {'DB_PORT': '3307'}
        with self.assertRaises(BR.OperationError) as failure:
            self.operation.validate_app_environment()
        self.assertIn('Review DB_PORT', str(failure.exception))
        self.assertNotIn('Retry with', str(failure.exception))

    def test_password_mismatch_never_displays_values(self):
        self.operation.app = self.dev_app()
        self.operation.app['Config']['Env'].append('DB_PASSWORD=existing-secret')
        self.operation.select_compose_files()
        self.operation.app_env = {'DB_PORT': '3306', 'DB_PASSWORD': 'selected-secret'}
        with self.assertRaises(BR.OperationError) as failure:
            self.operation.validate_app_environment()
        message = str(failure.exception)
        self.assertIn('DB_PASSWORD', message)
        self.assertIn('Values are hidden', message)
        self.assertNotIn('existing-secret', message)
        self.assertNotIn('selected-secret', message)

    def test_missing_container_labels_fail_instead_of_selecting_production(self):
        self.operation.app = self.dev_app()
        self.operation.app['Config']['Labels'] = {}
        with self.assertRaisesRegex(BR.OperationError, 'Supply --compose-file'):
            self.operation.select_compose_files()

    def test_no_application_leaves_selection_to_compose(self):
        self.operation.app = None
        original = list(self.operation.compose)
        self.operation.select_compose_files()
        self.assertEqual(self.operation.compose, original)
        self.assertEqual(self.operation.selected_files, [])

    def test_error_precedes_cleanup_diagnostics(self):
        stderr = io.StringIO()
        with patch.object(BR, 'Operation') as factory, \
                patch.object(BR.sys, 'argv', ['backup_restore', 'backup']), \
                patch.object(BR.signal, 'signal'), patch.object(BR.os, 'umask'), \
                patch.object(BR.sys, 'stderr', stderr):
            factory.return_value.backup.side_effect = BR.OperationError('Port mismatch explanation')
            factory.return_value.cleanup.side_effect = lambda success: print(
                'Protected diagnostics retained: fixture.log', file=BR.sys.stderr)
            self.assertEqual(BR.main(), 1)
        lines = stderr.getvalue().splitlines()
        self.assertEqual(lines[0], 'Error: Port mismatch explanation')
        self.assertEqual(lines[1], 'Protected diagnostics retained: fixture.log')
        factory.return_value.cleanup.assert_called_once_with(False)

    def test_custom_named_volume_matches_resolved_name(self):
        self.operation.config = {'volumes': {'data': {'name': 'custom-data-dev'}}}
        service = {'volumes': [{'type': 'volume', 'source': 'data', 'target': '/var/lib/mysql'}]}
        actual = {'Type': 'volume', 'Name': 'custom-data-dev'}
        self.operation.verify_mount(actual, service, '/var/lib/mysql')
        actual['Name'] = 'custom-data-production'
        with self.assertRaisesRegex(BR.OperationError, 'volumes differ'):
            self.operation.verify_mount(actual, service, '/var/lib/mysql')

    def test_bind_path_with_spaces_requires_exact_match(self):
        service = {'volumes': [{'type': 'bind', 'source': '/data with spaces/mysql', 'target': '/var/lib/mysql'}]}
        self.operation.verify_mount({'Type': 'bind', 'Source': '/data with spaces/mysql'}, service, '/var/lib/mysql')
        with self.assertRaises(BR.OperationError):
            self.operation.verify_mount({'Type': 'bind', 'Source': '/different'}, service, '/var/lib/mysql')

    def test_force_cannot_bypass_running_custom_app(self):
        self.operation.args.force = True
        self.operation.project = 'custom'
        self.operation.paths = {'config': Path('/custom/config')}
        container = {'State': {'Running': True}, 'Name': '/custom-dev',
                     'Config': {'Labels': {'com.docker.compose.project': 'custom',
                                           'com.docker.compose.service': 'youtarr'}}}
        with patch.object(self.operation, 'containers', return_value=[container]):
            with self.assertRaisesRegex(BR.OperationError, 'writer container is running'):
                self.operation.check_writers()

    def test_writer_error_gives_exact_stop_and_restart_commands(self):
        self.operation.project = 'custom'
        self.operation.paths = {'config': Path('/custom/config')}
        for name in ('youtarr', 'youtarr-dev', 'custom-app'):
            with self.subTest(name=name):
                container = {'State': {'Running': True}, 'Name': '/' + name,
                             'Config': {'Labels': {'com.docker.compose.project': 'custom',
                                                   'com.docker.compose.service': 'youtarr'}}}
                with patch.object(self.operation, 'containers', return_value=[container]):
                    with self.assertRaises(BR.OperationError) as failure:
                        self.operation.check_writers()
                message = str(failure.exception)
                self.assertIn('docker stop ' + name, message)
                self.assertIn('docker start ' + name, message)
                self.assertIn('Do not use ./stop.sh or docker compose down', message)
                self.assertIn('rerun the same backup command, including any options', message)
                self.assertNotIn('--force', message)

    def test_restore_writer_error_keeps_application_stopped_for_recovery(self):
        self.operation.args.operation = 'restore'
        self.operation.project = 'custom'
        self.operation.paths = {'config': Path('/custom/config')}
        container = {'State': {'Running': True}, 'Name': '/youtarr-dev',
                     'Config': {'Labels': {'com.docker.compose.project': 'custom',
                                           'com.docker.compose.service': 'youtarr'}}}
        with patch.object(self.operation, 'containers', return_value=[container]):
            with self.assertRaises(BR.OperationError) as failure:
                self.operation.check_writers()
        message = str(failure.exception)
        self.assertIn('docker stop youtarr-dev', message)
        self.assertIn('rerun the same restore command', message)
        self.assertIn('--force skips confirmation only', message)
        self.assertNotIn('docker start', message)

    def test_other_project_sharing_metadata_is_a_writer(self):
        self.operation.project = 'custom'
        self.operation.paths = {'jobs': Path('/shared/jobs')}
        container = {'State': {'Running': True}, 'Name': '/other-app', 'Config': {'Labels': {}},
                     'Mounts': [{'Type': 'bind', 'Source': '/shared'}]}
        with patch.object(self.operation, 'containers', return_value=[container]):
            with self.assertRaises(BR.OperationError):
                self.operation.check_writers()

    def test_cleanup_only_stops_container_started_by_operation(self):
        self.operation.started = 'exact-db-id'
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(self.operation, 'run', side_effect=run):
            self.operation.cleanup(True)
        self.assertEqual(calls, [['docker', 'stop', 'exact-db-id']])

    def test_cleanup_does_not_stop_preexisting_running_db(self):
        with patch.object(self.operation, 'run') as run:
            self.operation.cleanup(True)
        run.assert_not_called()

    def test_failed_command_never_echoes_credentials(self):
        with patch.object(BR.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaises(BR.OperationError) as failure:
                self.operation.run(['client', 'secret-password'])
        self.assertNotIn('secret-password', str(failure.exception))

    def test_sql_identifier_quotes_custom_database(self):
        self.assertEqual(BR.identifier('my-db`name'), '`my-db``name`')
        with self.assertRaises(BR.OperationError):
            BR.identifier('bad\nname')

    def test_missing_argument_is_parser_error(self):
        with patch('sys.stderr', new=io.StringIO()):
            with self.assertRaises(SystemExit):
                BR.parser().parse_args(['backup', '--output-dir'])


class RestoreFailureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.archive = self.base / 'backup.tar.gz'
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, content in {'env.backup': b'DB_HOST=source-host',
                                  'config/config.json': b'{"restored": true}',
                                  'database/youtarr.sql': b'CREATE TABLE fixture (id INT);',
                                  'metadata/jobs/info/new.json': b'{}'}.items():
                member = tarfile.TarInfo('youtarr-backup-fixture/' + name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
        self.config = self.base / 'config'
        self.config.mkdir()
        (self.config / 'config.json').write_text('{"original": true}')
        (self.base / '.env').write_text('DB_HOST=destination-host')
        self.jobs = self.base / 'jobs'
        (self.jobs / 'info').mkdir(parents=True)
        (self.jobs / 'info/stale.json').write_text('{}')
        self.args = BR.parser().parse_args(['restore', str(self.archive), '--force',
                                           '--recovery-dir', str(self.base / 'recovery'),
                                           '--source-lower-case-table-names', '0', '--source-db-version', '10.3.39'])
        self.operation = BR.Operation(self.args)
        self.addCleanup(lambda: BR.shutil.rmtree(self.operation.private, ignore_errors=True))
        self.operation.paths = {'config': self.config, 'jobs': self.jobs, 'images': self.base / 'images'}
        self.operation.target = {'name': 'destination', 'version': '10.3.39-MariaDB', 'engine': 'mariadb'}
        self.operation.lower_case_table_names = 0
        self.operation.db_name = 'destination'
        self.operation.schema = ['utf8mb4', 'utf8mb4_unicode_ci']
        self.operation.connection = ['fixture-client']
        self.operation.client_container = None
        self.operation.project = 'fixture'
        for name in ('resolve', 'connect', 'check_writers', 'preflight_privileges'):
            patcher = patch.object(self.operation, name)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(BR, 'ROOT', self.base)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_ownership_failure_happens_before_connect_or_confirmation(self):
        with patch.object(self.operation, 'check_restore_ownership', side_effect=BR.OperationError(
                'Cannot preserve ownership of config/complete.list')), patch('builtins.input') as prompt:
            with self.assertRaisesRegex(BR.OperationError, 'config/complete.list'):
                self.operation.restore()
        self.operation.connect.assert_not_called()
        prompt.assert_not_called()
        self.assertIsNone(self.operation.recovery)
        self.assertEqual((self.config / 'config.json').read_text(), '{"original": true}')

    def test_version_mismatch_never_reaches_database_replacement(self):
        self.operation.target['version'] = '11.4.13-MariaDB'
        with patch.object(self.operation, 'query') as query, patch.object(self.operation, 'dump') as dump:
            with self.assertRaisesRegex(BR.OperationError, 'cannot be restored directly'):
                self.operation.restore()
        query.assert_not_called()
        dump.assert_not_called()
        self.assertIsNone(self.operation.recovery)
        self.assertEqual((self.config / 'config.json').read_text(), '{"original": true}')

    def test_case_mismatch_never_reaches_database_replacement(self):
        self.operation.lower_case_table_names = 1
        with patch.object(self.operation, 'query') as query, patch.object(self.operation, 'dump') as dump:
            with self.assertRaisesRegex(BR.OperationError, 'different case settings'):
                self.operation.restore()
        query.assert_not_called()
        dump.assert_not_called()
        self.assertIsNone(self.operation.recovery)
        self.assertEqual((self.config / 'config.json').read_text(), '{"original": true}')

    def test_privilege_failure_never_reaches_database_replacement(self):
        self.operation.preflight_privileges.side_effect = BR.OperationError('Missing DROP privilege')
        with patch.object(self.operation, 'query') as query, patch.object(self.operation, 'dump') as dump:
            with self.assertRaisesRegex(BR.OperationError, 'Missing DROP'):
                self.operation.restore()
        query.assert_not_called()
        dump.assert_not_called()
        self.assertIsNone(self.operation.recovery)

    def test_preparation_failure_preserves_local_files_and_previous_sql(self):
        def query(sql, **kwargs):
            if sql.startswith('DROP DATABASE'):
                raise BR.OperationError('preparation failed')
            return subprocess.CompletedProcess([], 0, stdout=b'utf8mb4_unicode_ci\n')
        with patch.object(self.operation, 'dump', side_effect=lambda p: p.write_text('previous database')), \
                patch.object(self.operation, 'query', side_effect=query), \
                patch.object(BR.subprocess, 'run') as importer:
            with self.assertRaisesRegex(BR.OperationError, 'preparation failed'):
                self.operation.restore()
        importer.assert_not_called()
        self.assertEqual((self.config / 'config.json').read_text(), '{"original": true}')
        self.assertEqual((self.operation.recovery / 'previous.sql').read_text(), 'previous database')
        self.assertEqual((self.base / '.env').read_text(), 'DB_HOST=destination-host')

    def test_import_failure_never_replaces_local_files(self):
        with patch.object(self.operation, 'dump', side_effect=lambda p: p.write_text('previous database')), \
                patch.object(self.operation, 'query', return_value=subprocess.CompletedProcess([], 0, stdout=b'utf8mb4_unicode_ci\n')), \
                patch.object(BR.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(BR.OperationError, 'Could not finish restoring the database'):
                self.operation.restore()
        self.assertEqual((self.config / 'config.json').read_text(), '{"original": true}')
        journal = json.loads((self.operation.recovery / 'recovery.json').read_text())
        self.assertEqual(journal['state'], 'database replacement started')
        self.assertEqual(journal['replaced'], [])

    def test_local_restore_replaces_metadata_and_preserves_destination_env(self):
        self.args.skip_db = True
        self.operation.restore()
        self.assertEqual(json.loads((self.config / 'config.json').read_text()), {'restored': True})
        self.assertFalse((self.jobs / 'info/stale.json').exists())
        self.assertTrue((self.jobs / 'info/new.json').exists())
        self.assertEqual((self.base / '.env').read_text(), 'DB_HOST=destination-host')
        self.assertEqual((self.operation.recovery / 'source.env').read_text(), 'DB_HOST=source-host')
        journal = json.loads((self.operation.recovery / 'recovery.json').read_text())
        self.assertEqual(journal['state'], 'complete')
        self.operation.connect.assert_not_called()


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.args = BR.parser().parse_args(['restore', 'fixture.tar.gz'])
        self.operation = BR.Operation(self.args)
        self.addCleanup(lambda: BR.shutil.rmtree(self.operation.private, ignore_errors=True))
        self.operation.lower_case_table_names = 0
        self.operation.db_name = 'youtarr'
        self.operation.target = {'engine': 'mysql', 'version': '8.0.40'}

    def test_other_owner_rejected_even_when_in_destination_group(self):
        from types import SimpleNamespace
        reference = SimpleNamespace(st_uid=65534, st_gid=65534)
        with patch.object(BR.os, 'geteuid', return_value=1000), \
                patch.object(BR.os, 'getegid', return_value=1000), \
                patch.object(BR.os, 'getgroups', return_value=[1000, 65534]):
            with self.assertRaises(BR.OperationError) as failure:
                self.operation.check_restore_ownership(reference, Path('/fixture/config/complete.list'))
        self.assertIn('/fixture/config/complete.list', str(failure.exception))
        self.assertIn('UID 65534', str(failure.exception))
        self.assertIn('sudo', str(failure.exception))

    def test_own_files_with_available_group_and_root_are_allowed(self):
        from types import SimpleNamespace
        with patch.object(BR.os, 'getegid', return_value=1000), \
                patch.object(BR.os, 'getgroups', return_value=[1000, 65534]):
            with patch.object(BR.os, 'geteuid', return_value=1000):
                self.operation.check_restore_ownership(SimpleNamespace(st_uid=1000, st_gid=65534), Path('/fixture'))
            with patch.object(BR.os, 'geteuid', return_value=0):
                self.operation.check_restore_ownership(SimpleNamespace(st_uid=65534, st_gid=65534), Path('/fixture'))

    def test_version_preflight_requires_matching_releases(self):
        self.operation.preflight_version({'source': {'version': '8.0.36'}})
        with self.assertRaisesRegex(BR.OperationError, 'cannot be restored directly'):
            self.operation.preflight_version({'source': {'version': '5.7.44'}})
        with self.assertRaisesRegex(BR.OperationError, 'does not record'):
            self.operation.preflight_version({})
        self.args.source_db_version = '8.0.36'
        self.operation.preflight_version({})
        with self.assertRaisesRegex(BR.OperationError, 'conflicts'):
            self.operation.preflight_version({'source': {'version': '8.4.0'}})

    def test_schema_normalizes_only_known_three_byte_charset_alias(self):
        common = {'tables': {}, 'migrations': []}
        old = dict(common, columns=['t\tc\t1\ttext\tYES\tutf8_literal\t\tutf8\tutf8_general_ci'])
        new = dict(common, columns=['t\tc\t1\ttext\tYES\tutf8_literal\t\tutf8mb3\tutf8mb3_general_ci'])
        self.assertEqual(BR.comparable_inventory(old, 0), BR.comparable_inventory(new, 0))
        changed = dict(common, columns=['t\tc\t1\ttext\tYES\tchanged_default\t\tutf8mb3\tutf8mb3_general_ci'])
        self.assertNotEqual(BR.comparable_inventory(old, 0), BR.comparable_inventory(changed, 0))

    def test_distribution_versions_not_internal_client_versions(self):
        samples = [
            ('mariadb-dump from 11.4.13-MariaDB, client 10.19 for Linux', ('mariadb', '11.4')),
            ('mariadb from 11.4.13-MariaDB, client 15.2 for Linux', ('mariadb', '11.4')),
            ('mysqldump Ver 10.19 Distrib 10.3.39-MariaDB, for Linux', ('mariadb', '10.3')),
            ('mysql Ver 8.0.40 for Linux on x86_64', ('mysql', '8.0')),
        ]
        for text, expected in samples:
            with self.subTest(text=text):
                self.assertEqual(BR.client_version(text, 'fixture'), expected)
        with self.assertRaisesRegex(BR.OperationError, 'Cannot recognize'):
            BR.client_version('mariadb client 10.19', 'dump client')

    def monitor(self, writable=False):
        return {'Name': '/monitor', 'State': {'Running': True, 'Pid': 12345}, 'Config': {'Labels': {}},
                'Mounts': [{'Type': 'bind', 'Source': '/', 'Destination': '/rootfs', 'RW': writable}]}

    def test_readonly_root_monitor_allowed(self):
        self.operation.paths = {'jobs': Path('/home/user/jobs')}
        info = '1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /rootfs ro - ext4 disk rw\n'
        with patch.object(BR.Path, 'read_text', return_value=info):
            self.assertFalse(self.operation.shared_writable_mount(self.monitor()))

    def test_writable_root_is_still_a_writer(self):
        self.operation.paths = {'jobs': Path('/home/user/jobs')}
        self.assertTrue(self.operation.shared_writable_mount(self.monitor(True)))

    def test_nested_writable_mount_blocks_but_unrelated_mount_does_not(self):
        self.operation.paths = {'jobs': Path('/home/user/jobs')}
        base = '1 0 0:1 / /rootfs ro - ext4 disk rw\n'
        for target, expected in [('/rootfs/home', True), ('/rootfs/home/user/jobs/nested', True), ('/rootfs/run', False)]:
            with self.subTest(target=target), patch.object(BR.Path, 'read_text', return_value=
                    base + '2 1 0:2 / ' + target + ' rw - ext4 other rw\n'):
                self.assertEqual(self.operation.shared_writable_mount(self.monitor()), expected)

    def test_unverifiable_readonly_access_is_described_as_uncertain(self):
        self.operation.paths = {'jobs': Path('/home/user/jobs')}
        with patch.object(BR.Path, 'read_text', side_effect=PermissionError):
            with self.assertRaisesRegex(BR.OperationError, 'does not establish that it is a writer'):
                self.operation.shared_writable_mount(self.monitor())

    def test_mountinfo_handles_escaped_spaces(self):
        info = r'1 0 0:1 / /root\040fs ro - ext4 disk rw'
        self.assertFalse(BR.mountinfo_access(info, BR.PurePosixPath('/root fs/jobs')))

    def test_missing_mount_in_process_namespace_is_not_assumed_readonly(self):
        info = '1 0 0:1 / / ro - ext4 disk rw'
        with self.assertRaisesRegex(BR.OperationError, 'absent from this process namespace'):
            BR.mountinfo_access(info, BR.PurePosixPath('/rootfs/jobs'), BR.PurePosixPath('/rootfs'))

    def test_case_rules_find_actual_migration_name(self):
        self.assertEqual(BR.migration_table(['sequelizemeta'], 1), 'sequelizemeta')
        self.assertEqual(BR.migration_table(['SequelizeMeta'], 0), 'SequelizeMeta')
        with self.assertRaises(BR.OperationError):
            BR.migration_table(['sequelizemeta'], 0)
        with self.assertRaises(BR.OperationError):
            BR.migration_table(['SequelizeMeta', 'sequelizemeta'], 1)

    def test_inventory_queries_actual_lowercase_migration_table(self):
        self.operation.lower_case_table_names = 1
        queries = []
        def query(sql):
            queries.append(sql)
            if 'TABLE_TYPE FROM' in sql:
                output = b'sequelizemeta\tBASE TABLE\n'
            elif 'COUNT(*)' in sql:
                output = b'1\n'
            elif sql.startswith('SELECT name'):
                output = b'20260101-migration.js\n'
            else:
                output = b''
            return subprocess.CompletedProcess([], 0, stdout=output)
        with patch.object(self.operation, 'query', side_effect=query):
            inventory = self.operation.inventory()
        self.assertEqual(inventory['migrations'], ['20260101-migration.js'])
        self.assertIn('SELECT name FROM `youtarr`.`sequelizemeta` ORDER BY name;', queries)

    def test_inventory_normalizes_only_table_references(self):
        inventory = {'tables': {'SequelizeMeta': {'rows': 1}}, 'migrations': ['CaseSensitive.js'],
                     'columns': ['SequelizeMeta\tname\tCaseSensitiveDefault'],
                     'foreign_keys': ['Videos\tfk_Name\tChannelId\t1\tChannels\tId']}
        result = BR.comparable_inventory(inventory, 1)
        self.assertEqual(result['migrations'], ['CaseSensitive.js'])
        self.assertEqual(result['columns'], ['sequelizemeta\tname\tCaseSensitiveDefault'])
        self.assertEqual(result['foreign_keys'], ['videos\tfk_Name\tChannelId\t1\tchannels\tId'])
        self.assertEqual(BR.comparable_inventory(inventory, 0)['tables'], inventory['tables'])

    def test_case_collision_rejected_before_mismatch(self):
        self.operation.lower_case_table_names = 1
        manifest = {'source': {'lower_case_table_names': 0},
                    'database': {'inventory': {'tables': {'Videos': {}, 'videos': {}, 'SequelizeMeta': {}}}}}
        with self.assertRaisesRegex(BR.OperationError, 'collide'):
            self.operation.preflight_case(manifest)

    def test_legacy_case_requires_verified_source_setting(self):
        with self.assertRaisesRegex(BR.OperationError, 'missing a database setting'):
            self.operation.preflight_case({'version': '1.0'})
        self.args.source_lower_case_table_names = 0
        self.operation.preflight_case({'version': '1.0'})
        with self.assertRaisesRegex(BR.OperationError, 'conflicts'):
            self.operation.preflight_case({'source': {'lower_case_table_names': 1}})

    def grant(self, scope='*.*', privileges=None):
        return 'GRANT ' + (privileges or ', '.join(sorted(BR.RESTORE_PRIVILEGES))) + ' ON ' + scope + " TO `root`@`localhost`"

    def test_expanded_global_and_schema_all_grants_accepted(self):
        for grants in [self.grant(), self.grant('`youtarr`.*', 'ALL PRIVILEGES')]:
            self.assertTrue(BR.RESTORE_PRIVILEGES <= BR.effective_schema_privileges(grants, 'youtarr', False, 0))

    def test_partial_revoke_removes_required_privilege(self):
        grants = self.grant() + '\nREVOKE DROP ON `youtarr`.* FROM `root`@`localhost`'
        self.assertNotIn('DROP', BR.effective_schema_privileges(grants, 'youtarr', True, 0))
        self.assertIn('DROP', BR.effective_schema_privileges(grants, 'other', True, 0))

    def test_schema_patterns_respect_partial_revokes_setting(self):
        grants = self.grant('`you%`.*', 'ALL PRIVILEGES')
        self.assertTrue(BR.RESTORE_PRIVILEGES <= BR.effective_schema_privileges(grants, 'youtarr', False, 0))
        self.assertFalse(BR.effective_schema_privileges(grants, 'youtarr', True, 0))
        self.assertFalse(BR.effective_schema_privileges(self.grant('`other`.*'), 'youtarr', False, 0))

    def test_mysql_active_roles_expand_effective_grants(self):
        queries = []
        def query(sql, **kwargs):
            queries.append(sql)
            values = {'SHOW GRANTS FOR CURRENT_USER;': self.grant(privileges='USAGE'),
                      'SELECT @@partial_revokes;': '0', 'SELECT CURRENT_ROLE();': '`backup`@`%`',
                      'SHOW GRANTS FOR CURRENT_USER USING `backup`@`%`;': self.grant()}
            return subprocess.CompletedProcess([], 0, stdout=values[sql].encode())
        with patch.object(self.operation, 'query', side_effect=query):
            self.operation.preflight_privileges()
        self.assertIn('SHOW GRANTS FOR CURRENT_USER USING `backup`@`%`;', queries)

    def test_mysql_root_preflight_and_missing_privilege(self):
        for grants, succeeds in [(self.grant(), True), (self.grant(privileges='SELECT'), False),
                                 (self.grant() + '\nREVOKE DROP ON `youtarr`.* FROM `root`@`localhost`', False)]:
            with self.subTest(grants=grants):
                values = [grants.encode(), b'1', b'NONE']
                with patch.object(self.operation, 'query', side_effect=[
                        subprocess.CompletedProcess([], 0, stdout=value) for value in values]):
                    if succeeds:
                        self.operation.preflight_privileges()
                    else:
                        with self.assertRaisesRegex(BR.OperationError, 'DROP'):
                            self.operation.preflight_privileges()

    def test_mariadb_no_active_role_uses_direct_account_grants(self):
        unfiltered = 'SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES;'
        filtered = 'SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES WHERE ROLE_NAME IS NOT NULL;'
        for version in ('10.3.39-MariaDB', '11.4.13-MariaDB'):
            for scope in ('*.*', '`youtarr`.*'):
                with self.subTest(version=version, scope=scope):
                    self.operation.target = {'engine': 'mariadb', 'version': version}
                    def query(sql, **kwargs):
                        # Model the server's NULL row, and its exclusion by SQL.
                        responses = {'SHOW GRANTS FOR CURRENT_USER;': self.grant(scope).encode(),
                                     unfiltered: b'NULL\n', filtered: b''}
                        self.assertIn(sql, responses, 'Unexpected role lookup for an account without active roles')
                        return subprocess.CompletedProcess([], 0, stdout=responses[sql])
                    with patch.object(self.operation, 'query', side_effect=query) as calls:
                        self.operation.preflight_privileges()
                    self.assertEqual(calls.call_args_list, [
                        unittest.mock.call('SHOW GRANTS FOR CURRENT_USER;'), unittest.mock.call(filtered)])

    def test_mariadb_real_role_named_null_is_not_discarded(self):
        self.operation.target = {'engine': 'mariadb', 'version': '11.4.13-MariaDB'}
        responses = {
            'SHOW GRANTS FOR CURRENT_USER;': self.grant(privileges='USAGE').encode(),
            'SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES WHERE ROLE_NAME IS NOT NULL;': b'NULL\n',
            'SHOW GRANTS FOR `NULL`;': self.grant('`youtarr`.*').encode(),
        }
        with patch.object(self.operation, 'query', side_effect=lambda sql:
                          subprocess.CompletedProcess([], 0, stdout=responses[sql])) as calls:
            self.operation.preflight_privileges()
        self.assertIn(unittest.mock.call('SHOW GRANTS FOR `NULL`;'), calls.call_args_list)

    def test_mariadb_enabled_inherited_roles(self):
        self.operation.target = {'engine': 'mariadb', 'version': '11.4.13-MariaDB'}
        values = [self.grant(privileges='USAGE').encode(), b'backup\ninherited\n',
                  self.grant(privileges='SELECT').encode(), self.grant('`youtarr`.*').encode()]
        with patch.object(self.operation, 'query', side_effect=[
                subprocess.CompletedProcess([], 0, stdout=value) for value in values]) as query:
            self.operation.preflight_privileges()
        self.assertIn(unittest.mock.call('SHOW GRANTS FOR `inherited`;'), query.call_args_list)


if __name__ == '__main__':
    unittest.main()

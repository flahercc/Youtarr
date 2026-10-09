# Youtarr Backup and Restore

Back up and restore your Youtarr settings, download history, metadata, images, and
database. **Video files and generated playlists are excluded**; back up your
`YOUTUBE_OUTPUT_DIR` separately. Backups contain passwords and other private data.
Store them securely and encrypt copies stored offsite.

## Quick start

Run these commands from your Youtarr directory. You need Python 3.9 or newer,
Bash, Docker, and Docker Compose v2. For root-owned files, read
[Permissions and temporary space](#permissions-and-temporary-space) first.

### Back up

1. Stop Youtarr without removing its container:

   ```bash
   docker stop youtarr
   # For local development, use: docker stop youtarr-dev
   ```

   **Use `docker stop`, not `./stop.sh` or `docker compose down`.** The scripts
   need the existing containers to identify your database. Leave the database
   container in place; it may remain running.

2. Create the backup:

   ```bash
   ./scripts/backup.sh
   ```

   The script detects your installation and prints the selected database and
   folders. After success, it prints the archive path (under `backups/` by default).

3. Restart Youtarr after a successful backup:

   ```bash
   docker start youtarr
   # For local development, use: docker start youtarr-dev
   ```

Use your actual container name for a custom installation. See
[Create a backup](#create-a-backup) for output and image options.

### Restore

**Restore replaces the selected database and included local files. Changes made
since the backup will be lost.** Only restore backups you trust.

1. Stop Youtarr with `docker stop`, as above.
2. Run restore with the archive you want to use:

   ```bash
   ./scripts/restore.sh /path/to/youtarr-backup.tar.gz
   ```

3. Check the backup source, restore destination, and replacement list. Type
   `RESTORE` to continue, or press Enter to cancel.
4. After success, check that your Youtarr version is appropriate for the backup
   before starting the app. For a restore into the same app version, use
   `docker start youtarr` (or `youtarr-dev`). If undoing an update, follow
   [Returning to an earlier version](#returning-to-an-earlier-version).

Your destination `.env` is kept. Previous data is saved in a recovery folder whose
path is printed by the script. If restore fails, **keep Youtarr stopped** and
follow [If restore fails](#if-restore-fails); rollback is not automatic.

[Older backups](#older-backups) may require extra options. For another machine,
an empty installation, or a different database setup, read
[Restore](#restore) and [Requirements](#requirements-and-supported-targets) first.

Run either script with `--help` for options and examples. Set `NO_COLOR=1` to
disable terminal colors; redirected output is already plain text.

## Requirements and supported targets

- Python 3.9 or newer on Linux/macOS, Bash, Docker, and Docker Compose v2.
  Compose must support `config --format json`; Compose v1 is unsupported.
- Run on the Docker host with locally accessible configuration/metadata bind
  mounts. Remote Docker daemons and application metadata in named volumes are
  rejected rather than silently backing up unrelated host paths.
- An existing bundled database container, running or stopped, with its verified
  storage mount. Production bind mounts, production named volumes and local
  development volumes use the same workflow, regardless of CPU architecture.
- External MariaDB/MySQL can use installed host clients or an explicitly selected
  running client container. Both the SQL client and dump tool must be installed;
  use tools matching the database type and major/minor version. TLS settings
  belong in a private MySQL option file, with certificate paths accessible where
  the clients run. No bundled database is started for external operations.

The scripts never create/recreate containers or volumes. If containers were
removed, explicitly re-create **only the database service** using its original
Compose files and verified existing mount before backing up. Do not guess which
of several volumes contains your data. For a fresh restore, provision a selected
empty destination database container first. The restore script can then create
and import the selected logical database. Corrupt engine storage needs separate
recovery; retain the old volume/directory and provision a separate destination.
The scripts never delete raw database storage.

## Permissions and temporary space

For local development installations whose `.env` IDs were ignored by older dev
Compose files, see [Development container ownership](DEVELOPMENT.md#development-container-ownership)
for a one-time ownership fix. Restart through `./scripts/start-dev.sh` to apply
your configured user IDs; restore does not change which user the app runs as.

The default app runs as root, so some installations have root-owned configuration,
jobs and image directories. Backup needs read access; restore also needs write
access to destination parent directories and permission to preserve ownership.
Even a user-owned config directory can contain files owned by another account
(for example, `complete.list` owned by root). Write access alone does not let
restore assign another account as the file owner. Restore checks ownership before
connecting to the database or asking for confirmation and names the affected file.
It does not silently change that file's owner to the user running restore.
For such installations, use a consistent elevated workflow, for example:

```bash
sudo ./scripts/backup.sh
sudo ./scripts/restore.sh /path/to/backup.tar.gz
```

Sudo may change the Docker context or shell environment. Check the printed target
and use explicit project/Compose selectors where necessary. A sudo run can create
root-owned `backups/`, recovery archives and `.backup-restore.lock`; a subsequent
ordinary-user run may not access them. Keep using the same account, or have an
administrator deliberately correct ownership of the operation's output directory
and lock while no backup/restore is active. Do not delete an active lock or blindly
change ownership of application/database files. The scripts keep archives private
and do not automatically chown data to the invoking sudo user. An alternative
`--output-dir` does not change the repository-local lock's permissions.

Python uses `TMPDIR` (or the operating system's default temporary directory) for
staging. During backup, allow roughly **twice the uncompressed SQL and included
local files** there: one staged copy and one extracted verification copy. The
output filesystem also needs space for the compressed archive. Restore needs an
uncompressed extraction under `TMPDIR`, retained copies of the previous database
and files under `--recovery-dir`, and replacement staging beside each destination.
A tmpfs-backed `/tmp` consumes memory/swap, so select disk-backed temporary storage
for larger installations:

```bash
mkdir -p /mnt/backup-disk/youtarr-tmp
chmod 700 /mnt/backup-disk/youtarr-tmp
TMPDIR=/mnt/backup-disk/youtarr-tmp ./scripts/backup.sh
# Elevated workflow, when required:
sudo env TMPDIR=/mnt/backup-disk/youtarr-tmp ./scripts/backup.sh
```

Choose a temporary directory outside jobs/images and with access for the account
running the operation. Failed operations may retain temporary files for diagnosis;
review them before deleting them. `--output-dir` and `--recovery-dir` alone do not
relocate temporary extraction.

## Keep Youtarr stopped

Use the `docker stop` commands in [Quick start](#quick-start).
The database may remain running. If the script starts a stopped database
container, it stops that container afterward, including on failure.
The scripts do not automatically stop or start Youtarr.
`--force` only skips restore confirmation; it does not allow a running app.

Keep Youtarr and any other applications that change this database or its local
files stopped until the operation finishes. For external databases, this includes
scheduled database tasks and applications on other machines; the scripts cannot
stop or detect all of them. Stopping changes keeps the database and local files
consistent with each other. Live backups are not supported.

If a monitoring container blocks the operation, see
[Monitoring containers](#monitoring-containers).

Older scripts allowed backup while Youtarr was running. Success meant the files
and database were copied, but they might represent different points in time. Such an archive
may still be usable, particularly if the application was idle, but activity during
backup could leave mismatched history, settings or metadata. Keep existing backups;
validate a restore on an isolated installation and take a new backup with the
application stopped when possible.

## Select the installation

The scripts normally detect the installation from its existing Youtarr container,
including the Compose files used to start it. This also works for external-database
installations. Use the options below if you have multiple installations or need to
select a configuration explicitly.

Host bind paths must be canonical: unresolved symlink aliases are rejected with
the resolved path in the error. Review the mount configuration and select the
canonical source pointing to the same data. This can affect macOS `/var`/`/tmp`
aliases and symlinked home directories; changing only the current working directory
does not change an existing container's mounts. Symlink support remains restricted.

Existing mounts and database settings must still agree with the selected
configuration. If they differ, the error names the setting and explains what to
check. Your installation may still work correctly: startup may have used
different files or environment settings. Do not change a working database port to satisfy
backup. For a standard dev installation, `--mode development` explicitly selects
its Compose file.

Explicit selectors are available on both scripts:

```bash
./scripts/backup.sh --mode development
./scripts/backup.sh --project my-youtarr \
  --compose-file docker-compose.yml --compose-file docker-compose.arm.yml
./scripts/backup.sh --project my-youtarr \
  --compose-file '/path with spaces/compose.yml' --db-container my-database
```

`--compose-file` is repeatable; relative paths are relative to your current
working directory. `--mode production` selects the base production file,
`--mode development` selects `docker-compose.dev.yml`, and `--mode external`
selects `docker-compose.external-db.yml`. Supply all overrides explicitly when
using these selectors. Local development is different from `start.sh --dev`,
which uses the bleeding-edge production image. Use `--project` when multiple
installations exist. The selected database, storage, application image and local
paths are printed before any database replacement.

## Create a backup

```bash
./scripts/backup.sh
./scripts/backup.sh --output-dir '/mnt/backup/youtarr backups'
./scripts/backup.sh --skip-images
```

The default output folder is `backups/` in your Youtarr directory. Relative
output paths are based on your current directory. The script checks the completed
archive before saving it under its final name; a failed backup does not publish
a final archive.

Included components:

| Component | Source |
| --- | --- |
| Environment reference | Repository `.env` |
| Application settings | Resolved config mount's `config.json` |
| Cookies and download history, when present | `cookies.user.txt`, `complete.list` |
| Database | Tables, data, migration history, and stored database objects |
| Jobs and download metadata | Resolved jobs directory, including `info/` and legacy job history |
| Images, unless `--skip-images` | Resolved image directory |

`DATA_PATH` deployments use `config/jobs` and `config/images`, matching the
application. Existing unreadable files, unsupported links and special files cause
failure. Missing `.env` or application settings also cause failure. Absent optional
components and explicit omissions are recorded. Backup does not automatically use
sudo. Fix access permissions deliberately if the operation cannot read files.

New backups include checksums to detect damaged or missing files. For confidence
in your recovery process, try restoring a backup into a separate test installation.

## Restore

Only restore backups you trust. File checks detect damage, but cannot establish
who created a backup or whether its database commands are safe.

```bash
./scripts/restore.sh /path/to/youtarr-backup.tar.gz
./scripts/restore.sh /path/to/youtarr-backup.tar.gz --mode development
```

Configure the destination's own `.env`, Compose files and writable metadata parent
directories first. Restore preserves the destination `.env`; the archive's
`env.backup` is saved as `source.env` in the recovery directory for manual review.
It never redirects the destination to archived credentials, storage or video paths.
Application settings (including service URLs/tokens) are restored, so review these
before starting an installation on another machine.

Before replacing data, the script checks the backup, selected installation,
database access, and file permissions. Older backups have fewer checks because
they lack checksums and database details.

Database restore requires the same database type (MariaDB or MySQL), major/minor
version, and table-name setting as the source. For example, MariaDB 10.3 to 10.3
is supported; 10.3 to 11.4 requires a separate database upgrade. See
[Database compatibility and permissions](#database-compatibility-and-permissions)
for details and [Older backups](#older-backups) for missing source information.

After confirmation, restore saves the previous database and local files under
`backups/youtarr-recovery-*/` (change the location with `--recovery-dir`). It then
replaces **only the selected database**, imports the backup, and checks the result
before replacing local files. Recorded database character settings are preserved
when supported; older backups use destination defaults, or
`utf8mb4/utf8mb4_unicode_ci` for a new database.

Each included local component is replaced, not merged. Jobs/images directories
therefore lose stale destination files. Omitted components are left untouched.
Legacy backups replace only `jobs/info`, since they did not include all jobs.
Restored jobs and images use the destination folder's owner and permissions,
with execute permission removed from files. Individual files' previous owners
and permissions are not preserved separately. Individual configuration files keep
their destination owner and permissions; new components use their parent folder.
Ownership and permission preparation happens before database replacement.
The script does not automatically restart the application.

`--force` skips only the interactive `RESTORE` confirmation.

### If restore fails

**Keep Youtarr stopped. Restore does not automatically undo changes after a
failure.** Read the error first:

- If it says existing data was not replaced, fix the reported problem and retry.
- If database replacement started, the database may be incomplete or already
  restored while local files are still unchanged.
- If local-file replacement started, some folders may already have been restored.

The script prints a recovery folder when one was created. Keep it and any
temporary folders until recovery is complete. The technical log may contain
private information; remove passwords or other secrets before sharing it.

### Recovering previous data

The recovery folder contains `recovery.json`, a record of progress and saved-file
locations. If the previous database was saved successfully, `previous.sql` contains
its data and `previous_schema` in the record identifies its character settings.
Saved local files and their destination paths are also listed in the record.

Manual recovery requires database administration steps. If you are unfamiliar
with them, ask for help before changing more data. Using tools compatible with
the destination database and its credentials:

1. Recreate only the selected database and import `previous.sql`, when present.
2. Restore the local files from the saved locations in `recovery.json`. An
   interrupted folder replacement may also leave the original folder named
   `old` inside its staging folder.
3. Check that the database, files, and Youtarr version belong together before
   starting the app.

A recovery folder can be incomplete if saving previous data failed. Check the
record and available files; do not assume `previous.sql` exists or is complete.
There is no previous database dump when no database existed before restore.
Recovery files remain after success too. Delete them only after verifying the
restored installation.

## Older backups

Older archives (including early format 2.0 archives) do not record the source case
setting. Verify it from the original server (`SELECT @@lower_case_table_names;`)
or its recorded configuration, then supply it explicitly. Unmodified bundled
Linux MariaDB installations normally use `0`; that is not a guarantee for customized
configurations or storage environments. Older archives that also lack the source
server version require `--source-db-version` with the verified source release:

```bash
# Only when the verified source setting was 0 and its release was 10.3.39:
./scripts/restore.sh older-backup.tar.gz --source-lower-case-table-names 0 \
  --source-db-version 10.3.39
```

Do not guess either value. These flags cannot override conflicting settings recorded in
a newer archive and are unnecessary for `--skip-db`. If the original setting cannot
be established, use an isolated, provider-managed recovery process first.


## External databases and local-files-only operations

```bash
./scripts/backup.sh --mode external --db-options-file /private/client-tls.cnf
./scripts/restore.sh backup.tar.gz --mode external \
  --client-container database-tools --db-options-file /private/client-tls.cnf

# Pair these with a provider-managed SQL backup/restore from the same point in time
./scripts/backup.sh --mode external --skip-db
./scripts/restore.sh backup.tar.gz --mode external --skip-db
```

`--skip-db` includes/restores local configuration **and metadata**. It is not a
complete database backup and is labeled local files only. Docker/Compose are still
required for mount resolution and writer detection. A container-only DB hostname
requires a client container already connected to the appropriate Docker network;
the scripts never substitute a bundled database or guess a different host.

The option file must have private permissions (`chmod 600`). Headerless TLS options
are also accepted; the script supplies the `[client]` group. Use a `[client]`
section containing only TLS options appropriate to your engine, such as CA/certificate paths
and server certificate verification. Includes are rejected. Host, port, user and
password are always set from the destination/source's currently selected Compose
configuration. For a privileged account different from the application account,
supply `--db-user root --db-password-file /private/db-password` (both flags are
required together; chmod the password file to 600). A single trailing line ending
is removed from the password file. This explicit override does not change the
application settings or destination. Temporary credential files are private and removed on cleanup;
raw diagnostic stderr is retained privately on failure and is never echoed.
`--ready-timeout SECONDS` changes the authenticated TCP readiness deadline.

## Returning to an earlier version

1. Stop the application and create a successful pre-update backup. Record the
   exact previous image tag/digest and retain the matching source for local dev.
2. To downgrade after a schema migration, stop the application and restore that
   pre-update backup. Changing only the image does not undo migrations.
3. For production, start with an explicit shell environment override:

   ```bash
   YOUTARR_IMAGE='dialmaster/youtarr:<previous-version-tag>' ./start.sh
   # For an external database:
   YOUTARR_IMAGE='dialmaster/youtarr:<previous-version-tag>' ./start-with-external-db.sh
   ```

   Replace the placeholder with the recorded image. Setting only `.env` is not
   reliable because startup exports a default before Compose reads `.env`. Avoid
   `--dev`, `latest` and `dev-latest` during recovery. Local-development startup
   sets `youtarr-dev:latest` itself: check out the matching previous source and
   rebuild that image before using `scripts/start-dev.sh`.
4. Verify settings, history and application writes. Starting a newer image against
   restored old data would immediately reapply its migrations.

Post-backup database changes are lost on restore. Restore video files separately
when needed; database history alone cannot revert downloaded/deleted files.

## Advanced troubleshooting

### Database compatibility and permissions

Restore needs permission to save the existing database and replace it. Missing
permissions are listed in the error. To use a different database account, supply
both `--db-user` and `--db-password-file`; see
[External databases and local-files-only operations](#external-databases-and-local-files-only-operations).

For administrators, the required database permissions are: `SELECT`, `INSERT`,
`CREATE`, `DROP`, `ALTER`, `INDEX`, `REFERENCES`, `LOCK TABLES`, `SHOW VIEW`,
`CREATE VIEW`, `TRIGGER`, `EVENT`, `CREATE ROUTINE`, `ALTER ROUTINE`, and `EXECUTE`.
Database-wide grants and active roles are recognized. Table-only grants and
inactive roles are insufficient; explicit restrictions can still block restore.

Stored routines, events, triggers, or objects created by another account may need
additional administrative access. The recovery dump must succeed before database
replacement. Permission checks cannot guarantee that every SQL command in an
archive will succeed. For restricted hosting accounts, pair provider-managed
database recovery with `--skip-db`.

Source and destination must use the same database type and major/minor version.
Patch versions within a series are allowed, but should be validated on a separate
installation. To move between series, restore into the original series first,
then follow a separately validated database upgrade.

The `lower_case_table_names` setting must also match. It controls how the database
stores and compares table names. Different settings require a separate database
migration; restore checks this before replacing the database.

After import, the script compares tables, row counts, columns, indexes, foreign
keys, and migration history with the backup. Known equivalent `utf8`/`utf8mb3`
character names and table-name casing are handled where appropriate; other
schema differences still cause a failure.

### Monitoring containers

Read-only monitoring containers are allowed when the script can verify that they
cannot change Youtarr's files, including through nested mounts. A writable mount
of the host's root folder also gives access to Youtarr's files and blocks the
operation.

Verification needs access to the container's `/proc/<pid>/mountinfo` on the
Docker host. This may be unavailable with Docker Desktop or restricted host
permissions. If access cannot be verified, check the named container's purpose
and stop it before retrying, or run where that information is accessible.
Restart a stopped monitor after the operation is safely complete.

### Archive validation

Format 2.0 records checksums, included/omitted components, source engine/version,
charset/collation, application image and image ID when discoverable, table types,
row counts, columns, indexes, foreign keys and migration history. Table counts and migration history are compared
before/after dumping; they do not replace the requirement to keep Youtarr and other applications stopped. SQL compatibility and recovery should still be verified on an isolated system.

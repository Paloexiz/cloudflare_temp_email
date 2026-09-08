"""Restore a private D1 logical snapshot locally; never contact production."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def identifier(name):
    return '"' + name.replace('"', '""') + '"'


def literal_expression(name):
    c = identifier(name)
    return (f"CASE typeof({c}) WHEN 'text' THEN 'CAST(X''' || hex({c}) || ''' AS TEXT)' "
            f"WHEN 'blob' THEN 'X''' || hex({c}) || '''' "
            f"WHEN 'real' THEN printf('%!.26g',{c}) ELSE quote({c}) END")


def verify(path):
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    schema, tables = snapshot['schema'], snapshot['tables']
    if not {s['type'] for s in schema} <= {'table', 'index'}:
        raise ValueError('Unexpected schema object')
    if set(tables) != {s['name'] for s in schema if s['type'] == 'table'}:
        raise ValueError('Snapshot table set differs from schema')
    if 'sqlite_sequence' not in tables:
        raise ValueError('Missing autoincrement sequence')
    statements = ['PRAGMA foreign_keys=OFF;']
    statements += [s['sql'] + ';' for s in schema
                   if s['type'] == 'table' and s['name'] != 'sqlite_sequence']
    for table, rows in tables.items():
        columns = [c['column_name'] for c in snapshot['columns'] if c['table_name'] == table]
        if not columns:
            raise ValueError('Missing column metadata')
        if table == 'sqlite_sequence':
            statements.append('DELETE FROM sqlite_sequence;')
        for row in rows:
            if len(row) != len(columns):
                raise ValueError('Row width differs from column metadata')
            statements.append(f'INSERT INTO {identifier(table)} ({",".join(map(identifier, columns))}) '
                              f'VALUES ({",".join(row)});')
    statements += [s['sql'] + ';' for s in schema if s['type'] == 'index' and s['sql']]
    sql = '\n'.join(statements) + '\n'
    db = sqlite3.connect(':memory:')
    try:
        # Authorizer forbids file attachment or extension loading even if a snapshot is tampered with.
        def authorize(action, arg1, arg2, database, trigger):
            if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and arg2 == 'load_extension':
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        db.set_authorizer(authorize)
        db.executescript(sql)
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Database integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Foreign key check failed')
        for table, rows in tables.items():
            columns = [c['column_name'] for c in snapshot['columns'] if c['table_name'] == table]
            if [r[1] for r in db.execute(f'PRAGMA table_info({identifier(table)})')] != columns:
                raise ValueError(f'Column metadata differs from schema: {table}')
            restored = db.execute(f'SELECT {",".join(map(literal_expression, columns))} FROM {identifier(table)}').fetchall()
            if sorted(map(tuple, rows)) != sorted(restored):
                raise ValueError(f'Content mismatch: {table}')
        expected_indexes = sorted((s['name'], s['sql']) for s in schema if s['type'] == 'index' and s['sql'])
        actual_indexes = sorted(db.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").fetchall())
        if actual_indexes != expected_indexes:
            raise ValueError('Index definitions differ')
        version = db.execute("SELECT value FROM settings WHERE key='db_version'").fetchone()[0]
        report = {'method': snapshot['method'], 'capturedAt': snapshot['capturedAt'],
                  'bookmark': snapshot['bookmark'], 'databaseVersion': version,
                  'tableCounts': {t: len(rows) for t, rows in tables.items()},
                  'indexes': len(expected_indexes), 'integrityCheck': 'ok',
                  'allRecordsRoundTrip': True, 'foreignKeyCheck': 'ok',
                  'validationBoundary': 'Native local SQLite restore; no remote restore performed',
                  'snapshotSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                  'sqlSha256': hashlib.sha256(sql.encode('utf-8')).hexdigest()}
        output = path.with_name('ai-agent-d1-backup.sql')
        if output.exists():
            if output.read_text(encoding='utf-8') != sql:
                raise ValueError('Existing backup differs; refusing overwrite')
        else:
            output.write_text(sql, encoding='utf-8', newline='')
        path.with_name('ai-agent-backup-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2))
    finally:
        db.close()


if __name__ == '__main__':
    verify(Path(sys.argv[1]).resolve())

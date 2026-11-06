import { describe, expect, it } from 'vitest';
import { parseTocLine, postSql, preludeSql, projectRef, rollbackList } from './window-rollback';

const TOC = `;
; Archive created at 2026-11-06 10:00:00 UTC
;
7; 2615 16390 SCHEMA - app postgres
8; 2615 16391 SCHEMA - app_private postgres
9; 2615 2200 SCHEMA - public pg_database_owner
5001; 0 0 COMMENT - SCHEMA public pg_database_owner
10; 2615 16392 SCHEMA - storage supabase_admin
3; 3079 16400 EXTENSION - pgcrypto
400; 1255 17000 FUNCTION app current_company_id() postgres
401; 1255 17001 FUNCTION app_private handle_new_user() postgres
402; 1259 17002 TABLE public patients postgres
403; 1259 17003 TABLE auth users supabase_auth_admin
4000; 0 17002 TABLE DATA public patients postgres
4001; 0 17003 TABLE DATA auth users supabase_auth_admin
4002; 0 0 SEQUENCE SET public audit_log_id_seq postgres
4100; 2620 17010 TRIGGER auth users on_auth_user_created postgres
4101; 2620 17011 TRIGGER public patients audit postgres
4102; 2620 17012 TRIGGER storage objects update_objects_updated_at supabase_storage_admin
4200; 2606 17020 FK CONSTRAINT public patients patients_user_fkey postgres
4300; 0 0 ACL - SCHEMA app postgres
4301; 0 0 ACL - SCHEMA public pg_database_owner
4302; 0 0 ACL app FUNCTION current_company_id() postgres
4303; 0 0 ACL public TABLE patients postgres
4400; 826 17030 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres
4401; 826 17031 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES supabase_admin
4402; 826 17032 DEFAULT ACL - DEFAULT PRIVILEGES FOR FUNCTIONS postgres
`;

describe('parseTocLine', () => {
  it('splits a multi-word description from the namespace and tag', () => {
    expect(parseTocLine('4000; 0 17002 TABLE DATA public patients postgres')).toMatchObject({ desc: 'TABLE DATA', namespace: 'public', rest: 'patients postgres' });
    expect(parseTocLine('4400; 826 17030 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres')).toMatchObject({ desc: 'DEFAULT ACL', namespace: 'public' });
    expect(parseTocLine('4200; 2606 17020 FK CONSTRAINT public patients patients_user_fkey postgres')).toMatchObject({ desc: 'FK CONSTRAINT', namespace: 'public' });
  });
  it('skips comments and blanks', () => {
    expect(parseTocLine('; Archive created')).toBeNull();
    expect(parseTocLine('')).toBeNull();
  });
});

describe('rollbackList', () => {
  const list = rollbackList(TOC, { owner: 'postgres', triggers: ['auth users on_auth_user_created'] }).map((l) => l.split(';')[0]);

  it("keeps our schemas' objects, data, sequences, constraints, ACLs and our own default privileges, in dump order", () => {
    expect(list).toEqual(['7', '8', '400', '401', '402', '4000', '4002', '4100', '4101', '4200', '4300', '4302', '4303', '4400']);
  });
  it('recreates app and app_private but not public, and leaves auth, storage, extensions and other roles alone', () => {
    for (const id of ['9', '5001', '4301', '10', '3', '403', '4001', '4102', '4401', '4402']) expect(list).not.toContain(id);
  });
  it('adds an outside trigger only when it is listed', () => {
    expect(rollbackList(TOC, { owner: 'postgres', triggers: [] }).some((l) => l.startsWith('4100;'))).toBe(false);
  });
});

describe('rollback SQL', () => {
  it('drops the release 4 role, the schemas it adds to and our public objects, in one script that stops on error', () => {
    const sql = preludeSql();
    expect(sql.startsWith('\\set ON_ERROR_STOP on')).toBe(true);
    expect(sql).toContain("execute 'drop owned by tenant_definer cascade'");
    expect(sql).toContain("execute 'drop role tenant_definer'");
    expect(sql).toContain('drop schema if exists app cascade');
    expect(sql).toContain('drop schema if exists app_private cascade');
    expect(sql).not.toMatch(/drop schema if exists public/);
    expect(sql).toContain('alter default privileges for role %I in schema public revoke all on %s from %s');
  });
  it('fails the transaction unless the ledger is back before 0089 and the role is gone', () => {
    expect(postSql()).toContain("where name >= '0089'");
    expect(postSql()).toContain("rolname = 'tenant_definer'");
  });
});

describe('projectRef', () => {
  it('reads the ref from a direct or session pooler URL, else the host', () => {
    expect(projectRef('postgresql://postgres:x@db.abc123.supabase.co:5432/postgres')).toBe('abc123');
    expect(projectRef('postgresql://postgres.abc123:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres')).toBe('abc123');
    expect(projectRef('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe('127.0.0.1');
  });
});

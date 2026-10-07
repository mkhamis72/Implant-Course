import { describe, it, expect } from 'vitest';
import { deriveDev2Config } from './dev2-stack';

const source = [
  'project_id = "implant-course"',
  '[api]',
  'enabled = true',
  'port = 54321',
  '[db]',
  'port = 54322',
  'shadow_port = 54320',
  '[studio]',
  'enabled = true',
  'port = 54323',
  '[local_smtp]',
  'enabled = true',
  '# smtp_port = 54325',
  '[auth]',
  'enabled = true',
  'site_url = "http://localhost:3000"',
  '# port = 587',
  '[edge_runtime]',
  'inspector_port = 8083',
  'enabled = false',
].join('\n');

describe('deriveDev2Config', () => {
  const out = deriveDev2Config(source).split('\n');
  it('renames the project and shifts every stack port by 100, commented ones too', () => {
    expect(out).toContain('project_id = "implant-course-dev2"');
    expect(out).toContain('port = 54421');
    expect(out).toContain('port = 54422');
    expect(out).toContain('shadow_port = 54420');
    expect(out).toContain('# smtp_port = 54425');
    expect(out).toContain('inspector_port = 8183');
  });
  it('leaves external ports and the app URL alone', () => {
    expect(out).toContain('# port = 587');
    expect(out).toContain('site_url = "http://localhost:3000"');
  });
  it('disables only Studio', () => {
    expect(out[out.indexOf('[studio]') + 1]).toBe('enabled = false');
    expect(out[out.indexOf('[api]') + 1]).toBe('enabled = true');
  });
});

import { describe, it, expect } from 'vitest';
import { routeConsole } from './route';

const C = 'console.example.com';

describe('routeConsole', () => {
  it.each([
    ['console.example.com', '/console', C, 'console'],
    ['Console.Example.com:443', '/console/companies/academy', C, 'console'],
    ['console.example.com', '/', C, 'console-root'],
    ['console.example.com', '/patients', C, 'not-found'],
    ['console.example.com', '/login', C, 'not-found'],
    ['console.example.com', '/consolex', C, 'not-found'],
    ['academy.example.com', '/patients', C, 'company'],
    ['academy.example.com', '/console', C, 'not-found'],
    ['academy.example.com', '/console/login', C, 'not-found'],
    ['academy.example.com', '/consoles', C, 'company'],
    [null, '/console', C, 'not-found'],
    ['academy.example.com', '/console', null, 'not-found'],
    ['academy.example.com', '/patients', null, 'company'],
  ] as const)('%s %s (console host %s) → %s', (host, path, consoleHost, expected) => {
    expect(routeConsole(host, path, consoleHost)).toBe(expected);
  });
});

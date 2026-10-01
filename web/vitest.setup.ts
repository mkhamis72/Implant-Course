import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library only auto-unmounts when Vitest globals are enabled; they are not here.
afterEach(() => cleanup());

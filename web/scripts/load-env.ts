import { existsSync } from 'node:fs';
import { config } from 'dotenv';
import { resolveEnvFile } from './env-file';

config({ path: resolveEnvFile(process.env, existsSync) });

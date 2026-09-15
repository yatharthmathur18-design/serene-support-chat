import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Load private secrets (if you previously stored OPENCODE_API_KEY there)
const priv = path.join(os.homedir(), '.serene', 'secrets.env');
dotenv.config({ path: priv });
dotenv.config(); // then local .env (doesn't override priv)

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const FUNCTIONS_DIR = path.join(process.cwd(), 'supabase', 'functions');
const CONFIG_CONTENT = 'verify_jwt = false\n';

interface ExecOptions {
  stdio?: 'inherit' | 'pipe';
  encoding?: BufferEncoding;
}

function log(message: string) {
  console.log(`[reset] ${message}`);
}

function execCommand(command: string, options: ExecOptions = {}): string {
  try {
    const result = execSync(command, {
      stdio: options.stdio || 'pipe',
      encoding: options.encoding || 'utf-8',
      ...options,
    });
    return typeof result === 'string' ? result : '';
  } catch (error: any) {
    throw error;
  }
}

function getFunctionsList(): string[] {
  log('Scanning functions directory...');
  
  if (!fs.existsSync(FUNCTIONS_DIR)) {
    console.error(`[reset] ERROR: Functions directory not found: ${FUNCTIONS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true });
  const functionDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .map((entry) => entry.name);

  log(`Found ${functionDirs.length} functions: ${functionDirs.join(', ')}`);
  return functionDirs;
}

function enforceConfig(functions: string[]) {
  log('Enforcing verify_jwt = false in config.toml...');
  
  for (const functionName of functions) {
    const functionPath = path.join(FUNCTIONS_DIR, functionName);
    const configPath = path.join(functionPath, 'config.toml');

    let needsUpdate = false;

    if (!fs.existsSync(configPath)) {
      needsUpdate = true;
    } else {
      const existingContent = fs.readFileSync(configPath, 'utf-8');
      if (!existingContent.includes('verify_jwt = false')) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      fs.writeFileSync(configPath, CONFIG_CONTENT, 'utf-8');
      log(`  ✅ ${functionName}: config.toml updated`);
    } else {
      log(`  ⏭️  ${functionName}: config.toml already correct`);
    }
  }
  
  log('Config enforcement complete\n');
}

function deleteFunction(functionName: string): boolean {
  log(`delete ${functionName}...`);
  
  try {
    execCommand(`supabase functions delete ${functionName} --yes`, {
      stdio: 'pipe',
    });
    log(`  ✅ ${functionName} deleted`);
    return true;
  } catch (error: any) {
    const errorMsg = error.message || String(error);
    
    // Check if function doesn't exist (not an error, just skip)
    if (
      errorMsg.includes('not found') ||
      errorMsg.includes('does not exist') ||
      errorMsg.includes('404')
    ) {
      log(`  ⏭️  ${functionName} not found (skip delete)`);
      return true;
    }
    
    // Real error
    console.error(`  ❌ Failed to delete ${functionName}:`);
    console.error(errorMsg);
    return false;
  }
}

function deployFunction(functionName: string): boolean {
  log(`deploy ${functionName}...`);
  
  try {
    execCommand(`supabase functions deploy ${functionName}`, {
      stdio: 'inherit',
    });
    log(`  ✅ ${functionName} deployed\n`);
    return true;
  } catch (error: any) {
    console.error(`  ❌ Failed to deploy ${functionName}:`);
    console.error(error.message || String(error));
    return false;
  }
}

function listFunctions() {
  log('Fetching current functions list...\n');
  try {
    execCommand('supabase functions list', { stdio: 'inherit' });
  } catch (error: any) {
    log('Warning: could not list functions');
    console.error(error.message || String(error));
  }
}

function main() {
  console.log('================================================');
  console.log('  Supabase Edge Functions - HARD RESET');
  console.log('================================================\n');

  // Step 1: Get functions list
  const functions = getFunctionsList();
  
  if (functions.length === 0) {
    log('No functions found. Exiting.');
    return;
  }

  // Step 2: Enforce config
  enforceConfig(functions);

  // Step 3: Delete and deploy each function sequentially
  log('Starting reset process (delete + deploy)...\n');
  
  for (const functionName of functions) {
    // Delete (non-fatal if not found)
    const deleted = deleteFunction(functionName);
    
    if (!deleted) {
      log(`Stopping due to delete error on ${functionName}`);
      process.exit(1);
    }

    // Deploy (fatal on error)
    const deployed = deployFunction(functionName);
    
    if (!deployed) {
      log(`Stopping due to deploy error on ${functionName}`);
      process.exit(1);
    }
  }

  // Step 4: List functions
  log('Reset complete! Final functions list:\n');
  listFunctions();

  console.log('\n================================================');
  log('done ✨');
  console.log('================================================\n');
}

main();

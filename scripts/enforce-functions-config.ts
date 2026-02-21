import * as fs from 'fs';
import * as path from 'path';

const FUNCTIONS_DIR = path.join(process.cwd(), 'supabase', 'functions');
const CONFIG_CONTENT = 'verify_jwt = false\n';

function enforceFunctionsConfig() {
  console.log('[enforce-functions-config] Checking functions...\n');

  if (!fs.existsSync(FUNCTIONS_DIR)) {
    console.error(`[enforce-functions-config] Functions directory not found: ${FUNCTIONS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true });
  const functionDirs = entries.filter(
    (entry) => entry.isDirectory() && entry.name !== '_shared'
  );

  const updated: string[] = [];
  const skipped: string[] = [];

  for (const dir of functionDirs) {
    const functionName = dir.name;
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
      updated.push(functionName);
      console.log(`✅ ${functionName}: config.toml created/updated`);
    } else {
      skipped.push(functionName);
      console.log(`⏭️  ${functionName}: config.toml already correct`);
    }
  }

  console.log(`\n[enforce-functions-config] Summary:`);
  console.log(`  Updated: ${updated.length}`);
  console.log(`  Skipped: ${skipped.length}`);
  console.log(`  Total: ${functionDirs.length}`);

  if (updated.length > 0) {
    console.log(`\n[enforce-functions-config] Updated functions:`);
    updated.forEach((fn) => console.log(`  - ${fn}`));
  }
}

enforceFunctionsConfig();

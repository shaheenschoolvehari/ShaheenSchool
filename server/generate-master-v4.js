const fs = require('fs');

const files = [
  'create-user-roles.js',
  'create-settings-table.js',
  'create-system-settings.js',
  'create-classes-tables.js',
  'update-classes-table.js',
  'create-subjects-table.js',
  'create-students-table.js',
  'update-students-schema.js',
  'update-students-family-system.js',
  'create-hrm-tables.js',
  'update-employees-table.js',
  'enhance-employees-for-teachers.js',
  'create-attendance-tables.js',
  'create-fee-tables.js',
  'add-opb-head.js',
  'add-family-fee-column.js',
  'create-academic-table.js',
  'add-userid-col.js',
  'add-print-tracking.js',
  'seed-school-settings.js',
  'seed-backup-settings.js'
];

let output = `require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

console.log('======================================================');
console.log('   MASTER SEEDER & SCHEMA INITIALIZATION SCRIPT       ');
console.log('======================================================');

async function runMasterSeeder() {
  console.log('Starting execution...');
`;

for (let f of files) {
  let c = fs.readFileSync(f, 'utf-8');
  c = c.replace(/const pool = require\(.*?db.*?\);?/gi, '');
  c = c.replace(/require\(['"]dotenv['"]\)\.config\(\);?/gi, '');
  c = c.replace(/const bcrypt = require\(.*?\);?/gi, '');
  c = c.replace(/pool\.end\(\);?/gi, '// pool.end() removed for master seeder;');
  c = c.replace(/process\.exit\(\d*\);?/gi, '// process.exit removed');
  c = c.replace(/^([A-Za-z0-9_]+)\(\)(?:\.catch\(.*?\))?;?$/gm, 'await $1();');
  
  output += `
  // ====== FROM: ${f} ======
  await (async () => {
    try {
${c}
    } catch(err) {
      console.error('[Error Details in ${f}]:', err.message);
    }
  })();`;
}

output += `
  console.log('======================================================');
  console.log('   MASTER SEEDER COMPLETED SUCCESSFULLY               ');
  console.log('======================================================');
  process.exit(0);
}

runMasterSeeder();`;

fs.writeFileSync('master-seeder.js', output, 'utf-8');
console.log('Done!');

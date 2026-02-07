const bcrypt = require('bcrypt');
const db = require('../db/init');

const SALT_ROUNDS = 12;

async function createUser(email, password, name) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const stmt = db.prepare(`
    INSERT INTO users (email, password_hash, name)
    VALUES (?, ?, ?)
  `);

  try {
    const result = stmt.run(email, passwordHash, name);
    console.log(`User created successfully!`);
    console.log(`  ID: ${result.lastInsertRowid}`);
    console.log(`  Email: ${email}`);
    console.log(`  Name: ${name}`);
    return result.lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      console.error(`Error: User with email "${email}" already exists`);
    } else {
      console.error('Error creating user:', err.message);
    }
    process.exit(1);
  }
}

// Create first user: david@useaffix.ai
async function main() {
  const email = process.argv[2] || 'david@useaffix.ai';
  const password = process.argv[3] || 'AffixAdmin2024!';
  const name = process.argv[4] || 'David';

  await createUser(email, password, name);
  process.exit(0);
}

main();

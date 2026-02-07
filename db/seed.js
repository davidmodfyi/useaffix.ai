const bcrypt = require('bcrypt');
const db = require('./init');

const SALT_ROUNDS = 12;

async function seedDefaultUser() {
  // Check if any users exist
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();

  if (count.count === 0) {
    console.log('No users found, creating default user...');

    const email = process.env.DEFAULT_USER_EMAIL || 'david@useaffix.ai';
    const password = process.env.DEFAULT_USER_PASSWORD || 'AffixAdmin2024!';
    const name = process.env.DEFAULT_USER_NAME || 'David';

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const stmt = db.prepare(`
      INSERT INTO users (email, password_hash, name)
      VALUES (?, ?, ?)
    `);

    try {
      const result = stmt.run(email, passwordHash, name);
      console.log(`Default user created: ${email} (ID: ${result.lastInsertRowid})`);
    } catch (err) {
      console.error('Failed to create default user:', err.message);
    }
  } else {
    console.log(`Database has ${count.count} user(s), skipping seed.`);
  }
}

module.exports = { seedDefaultUser };

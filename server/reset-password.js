#!/usr/bin/env node

/*
  Reset a TMR account password from the command line.

  Usage:
    node reset-password.js <username> <newPassword>
    node reset-password.js --username <username> --password <newPassword>
    node reset-password.js --username <username> --generate

  Notes:
  - This updates the stored password hash (bcrypt) and deletes all sessions for the user.
  - Passing passwords via CLI args can leak into shell history / process listings.
    Prefer --generate, or pass via env var TMR_NEW_PASSWORD.
*/

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./db');

function printUsage(exitCode = 0) {
  // Keep this stdout-only so it’s easy to copy/paste.
  console.log(`TMR password reset\n\nUsage:\n  node reset-password.js <username> <newPassword>\n  node reset-password.js --username <username> --password <newPassword>\n  node reset-password.js --username <username> --generate\n\nOptional:\n  --username, -u   Username\n  --password, -p   New password (or set env TMR_NEW_PASSWORD)\n  --generate, -g   Generate a strong password and print it\n  --help, -h       Show help\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { username: '', password: '', generate: false };
  const positional = [];

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--generate' || a === '-g') {
      args.generate = true;
      continue;
    }
    if (a === '--username' || a === '-u') {
      args.username = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (a === '--password' || a === '-p') {
      args.password = String(argv[i + 1] || '');
      i += 1;
      continue;
    }

    // Ignore unknown flags (helps when users paste extra args)
    if (String(a).startsWith('-')) continue;

    positional.push(a);
  }

  if (!args.username && positional.length >= 1) args.username = String(positional[0] || '');
  if (!args.password && positional.length >= 2) args.password = String(positional[1] || '');

  if (!args.password && process.env.TMR_NEW_PASSWORD) {
    args.password = String(process.env.TMR_NEW_PASSWORD);
  }

  args.username = String(args.username || '').trim();
  args.password = String(args.password || '');

  return args;
}

function dbAsync(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function generatePassword() {
  // URL-safe base64, ~24 chars.
  return crypto.randomBytes(18).toString('base64url');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) printUsage(0);

  if (!args.username) {
    console.error('Error: username required');
    printUsage(1);
  }

  let newPassword = args.password;
  if (args.generate) {
    newPassword = generatePassword();
  }

  if (!newPassword || newPassword.length < 8) {
    console.error('Error: password must be at least 8 characters (or use --generate)');
    process.exit(1);
  }

  const user = await dbAsync(db.getUserByUsername, args.username);
  if (!user) {
    console.error('Error: user not found:', args.username);
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await dbAsync(db.updateUserPasswordHash, user.id, hash);

  // Log out all devices.
  try {
    await dbAsync(db.deleteSessionsByUser, user.id);
  } catch (_) {
    // ignore
  }

  console.log(JSON.stringify({ ok: true, user: { id: user.id, username: user.username }, generated: Boolean(args.generate) }, null, 2));
  if (args.generate) {
    console.log(`\nNEW PASSWORD (store this somewhere safe):\n${newPassword}\n`);
  }
}

main().catch((err) => {
  console.error('Reset failed:', err && err.message ? err.message : String(err));
  process.exit(1);
});

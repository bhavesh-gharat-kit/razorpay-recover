/**
 * scripts/create-admin-user.ts
 *
 * Interactive script to create an ADMIN user in the database.
 *
 *   npm run create:admin
 *   npm run create:admin -- --email=you@example.com --password=hunter2
 *
 * Password is bcrypt-hashed at cost 12 (matches `BCRYPT_COST` in
 * lib/auth/password.ts). Upsert-style: if the email already exists, the
 * password is updated and the role is promoted to ADMIN.
 */

import { PrismaClient, UserRole } from "@prisma/client";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();

function parseArgs(): { email?: string; password?: string } {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return { email: args.email, password: args.password };
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input, output });

  if (!hidden) {
    const answer = await rl.question(question);
    rl.close();
    return answer;
  }

  // Basic hidden input — muted stdout while typing.
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
  const original = rlAny._writeToOutput.bind(rlAny);
  rlAny._writeToOutput = (s: string) => {
    if (s.startsWith(question) || s === "\n" || s === "\r\n") {
      original(s);
    } else {
      original("*".repeat(s.length));
    }
  };
  const answer = await rl.question(question);
  rlAny._writeToOutput = original;
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function main() {
  const cliArgs = parseArgs();

  const email = (cliArgs.email ?? (await prompt("Email: "))).trim().toLowerCase();
  const password = cliArgs.password ?? (await prompt("Password: ", true));

  if (!email || !password) {
    console.error("Both email and password are required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.ADMIN },
    create: { email, passwordHash, role: UserRole.ADMIN },
  });

  console.log(`\n  ADMIN user ready: ${user.email} (id: ${user.id})`);
}

main()
  .catch((e) => {
    console.error("Failed to create admin user:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

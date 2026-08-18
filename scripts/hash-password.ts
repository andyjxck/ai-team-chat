import bcrypt from "bcryptjs";
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const password = await ask("Enter password to hash: ");
  if (!password || password.length < 4) {
    console.error("Password must be at least 4 characters.");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  console.log("\nAdd this to your .env.local:");
  console.log(`LOCAL_USER_PASSWORD_HASH=${hash}`);
  rl.close();
}

main();

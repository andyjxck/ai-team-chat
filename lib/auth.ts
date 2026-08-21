import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// Helper function to generate a password hash.
// Use this in a separate script or your local environment to get the hash for LOCAL_USER_PASSWORD_HASH.
// Example: node -e "require('bcryptjs').hash('your-secret-password', 10).then(hash => console.log(hash))"
export async function generatePasswordHash(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Local",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // These environment variables are for local development and testing only.
        // In a production environment, you should use a proper database for user management.
        const expectedEmail = process.env.LOCAL_USER_EMAIL;
        const passwordHash = process.env.LOCAL_USER_PASSWORD_HASH;

        if (!expectedEmail || !passwordHash) {
          throw new Error("Local user credentials not configured. Please set LOCAL_USER_EMAIL and LOCAL_USER_PASSWORD_HASH environment variables.");
        }

        if (credentials?.email !== expectedEmail) {
          throw new Error("Invalid credentials.");
        }

        if (!credentials?.password) {
          throw new Error("Invalid credentials.");
        }
        
        const valid = await bcrypt.compare(credentials.password, passwordHash);
        if (!valid) {
          throw new Error("Invalid credentials.");
        }

        return {
          id: "local-user",
          name: "You", // This can be customized if needed
          email: expectedEmail,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
};

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Local",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const expectedEmail = process.env.LOCAL_USER_EMAIL;
        const passwordHash = process.env.LOCAL_USER_PASSWORD_HASH;

        if (!expectedEmail || !passwordHash) {
          return null;
        }

        if (
          credentials?.email !== expectedEmail ||
          !credentials?.password
        ) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, passwordHash);
        if (!valid) return null;

        return {
          id: "local-user",
          name: "You",
          email: expectedEmail,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
};

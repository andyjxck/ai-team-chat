"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { UploadProvider } from "./upload-provider";
import { UploadPill } from "./upload-pill";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <SessionProvider>
        <UploadProvider>
          {children}
          <UploadPill />
        </UploadProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

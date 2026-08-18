import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.andrewblewett.aiteamchat",
  appName: "AI Team Chat",
  webDir: "out",
  server: {
    // For dev: point to the local Next.js dev server.
    // The iOS Simulator can access your Mac's localhost directly.
    // For production builds: remove this and use `webDir: "out"` with static export.
    url: process.env.CAPACITOR_DEV_URL ?? "http://localhost:3000",
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: "#0a0a0a",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0a0a0a",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0a",
  },
};

export default config;

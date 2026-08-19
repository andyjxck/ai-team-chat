import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Self-Evolution Logic:
 * This logger will eventually be hooked into our autonomous error correction loop.
 * For now, it provides granular auditing of every team action.
 */
export function logSystemAction(agentId: string, action: string, metadata: any = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[SYSTEM_EVOLUTION][${timestamp}][AGENT:${agentId.toUpperCase()}]: ${action}`, metadata);
  // Future: This will push to a db log for the self-healing scripts to analyze.
}

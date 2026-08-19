"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";

const AGENT_GRADIENTS: Record<string, string> = {
  maya: "avatar-gradient-maya",
  leo: "avatar-gradient-leo",
  sally: "avatar-gradient-sally",
  evie: "avatar-gradient-evie",
  lex: "avatar-gradient-lex",
  zack: "avatar-gradient-zack",
  kevin: "avatar-gradient-kevin",
  beepbop: "avatar-gradient-beepbop",
  system: "avatar-gradient-system",
};

// Map agent IDs to image paths
const AGENT_IMAGES: Record<string, string> = {
  maya: "/agents/maya.jpg",
  leo: "/agents/leo.jpg",
  sally: "/agents/sally.jpg",
  evie: "/agents/evie.jpg",
  lex: "/agents/lex.jpg",
  zack: "/agents/zack.jpg",
  kevin: "/agents/kevin.jpg",
  beepbop: "/agents/beepbop.jpg",
};

export function Avatar({
  id,
  emoji,
  name,
  size = "md",
  ring = false,
  className,
}: {
  id: string;
  emoji?: string | null;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  ring?: boolean;
  className?: string;
}) {
  const gradient = AGENT_GRADIENTS[id] ?? "avatar-gradient-default";
  const imageSrc = AGENT_IMAGES[id];
  const sizes = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
    xl: "h-16 w-16 text-xl",
  };

  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white",
        !imageSrc && gradient,
        sizes[size],
        ring && "ring-2 ring-background",
        className,
      )}
    >
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={name ?? id}
          fill
          sizes={size === "xs" ? "24px" : size === "sm" ? "32px" : size === "md" ? "40px" : size === "lg" ? "48px" : "64px"}
          className="object-cover"
        />
      ) : (
        emoji || initials
      )}
    </div>
  );
}

export function AvatarGroup({
  members,
  max = 4,
  size = "sm",
}: {
  members: { id: string; avatar: string | null; name: string }[];
  max?: number;
  size?: "xs" | "sm" | "md";
}) {
  const shown = members.slice(0, max);
  const remaining = members.length - max;

  const sizes = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
  };

  return (
    <div className="flex -space-x-2">
      {shown.map((m) => (
        <Avatar
          key={m.id}
          id={m.id}
          emoji={m.avatar}
          name={m.name}
          size={size}
          ring
        />
      ))}
      {remaining > 0 && (
        <div className={cn(
          "flex items-center justify-center rounded-full bg-secondary text-secondary-foreground ring-2 ring-background font-semibold",
          sizes[size],
        )}>
          +{remaining}
        </div>
      )}
    </div>
  );
}

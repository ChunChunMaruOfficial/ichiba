import clsx from "clsx";
import type { PhotoUrls } from "@/lib/api";

/**
 * Profile photo in a round frame; without a photo, the nickname's first letter pressed as a cinnabar seal.
 * `ring` draws the cinnabar-to-amber ring around it (profiles, look highlights), like a story ring.
 */
export function Avatar({ username, avatar, className, ring }: { username: string; avatar?: PhotoUrls | null; className?: string; ring?: boolean }) {
  const face = avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatar.m} alt="" className="size-full rounded-full object-cover" />
  ) : (
    <span className="grid size-full place-items-center rounded-full bg-shu font-bold uppercase text-on-shu" style={{ fontSize: "42cqw" }}>
      {username.slice(0, 1)}
    </span>
  );
  return (
    <span className={clsx("relative block shrink-0 rounded-full [container-type:inline-size]", ring && "bg-[conic-gradient(from_200deg,var(--shu),var(--amber),var(--shu))] p-[3px]", className)} aria-hidden>
      <span className={clsx("block size-full rounded-full", ring && "bg-paper p-[3px]")}>{face}</span>
    </span>
  );
}

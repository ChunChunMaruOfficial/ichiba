"use client";

import { redirect } from "next/navigation";

/** Following lives inside Favorites (mobile bottom nav merges them, frame 05). */
export default function FollowingPage() {
  redirect("/favorites?tab=following");
}

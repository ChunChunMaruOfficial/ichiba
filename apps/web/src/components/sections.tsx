"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { items as itemsLabel } from "@/lib/labels";
import type { Card, Cover, SellerSummary } from "@/lib/types";
import { ItemCard } from "./item-card";
import { useSession } from "./session";
import { useToast } from "./toast";
import { Button, IconChevronRight } from "./ui";

export function SectionHeader({ title, count, href, linkLabel = "Все" }: { title: string; count?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
        {title}
        {count && <span className="ml-2 text-base font-normal text-muted">{count}</span>}
      </h2>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-ink-2 hover:text-ink">
          {linkLabel} <IconChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

/** Horizontal row of photos (sections on Home, recommendations on Product). */
export function CardRow({ items, variant = "grid" }: { items: Card[]; variant?: "feed" | "grid" }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      {items.map((c) => (
        <div key={c.id} className="w-[44vw] shrink-0 snap-start sm:w-56">
          <ItemCard card={c} variant={variant} />
        </div>
      ))}
    </div>
  );
}

function CoverImg({ cover, alt }: { cover: Cover | null; alt: string }) {
  return cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover.urls.s} alt={alt} loading="lazy" className="size-full object-cover" />
  ) : (
    <div className="size-full bg-skeleton" />
  );
}

export function FollowButton({ seller, onChange, size = "md" }: { seller: Pick<SellerSummary, "username" | "isFollowing">; onChange?: (v: boolean) => void; size?: "sm" | "md" }) {
  const { requireAuth } = useSession();
  const toast = useToast();
  return (
    <Button
      size={size}
      variant={seller.isFollowing ? "secondary" : "primary"}
      onClick={() =>
        requireAuth(
          async () => {
            const next = !seller.isFollowing;
            if (!next && !window.confirm(`Отписаться от @${seller.username}?`)) return;
            onChange?.(next);
            try {
              await api(`/follows/${seller.username}`, { method: next ? "POST" : "DELETE" });
            } catch {
              onChange?.(!next);
              toast("Не удалось сохранить изменение", { tone: "error" });
            }
          },
          { reason: `чтобы подписаться на @${seller.username}` },
        )
      }
    >
      {seller.isFollowing ? "Вы подписаны ✓" : "Подписаться"}
    </Button>
  );
}

/** "Гардеробы" section: nickname, counts, 2×2 collage, follow (frame 06). */
export function WardrobeCards({ wardrobes, onFollowChange }: { wardrobes: Array<SellerSummary & { collage: (Cover | null)[] }>; onFollowChange: (username: string, v: boolean) => void }) {
  const router = useRouter();
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      {wardrobes.map((w) => (
        <div key={w.id} className="w-64 shrink-0 snap-start rounded-2xl border border-line bg-surface p-3">
          <button onClick={() => router.push(`/u/${w.username}`)} className="grid aspect-square w-full grid-cols-2 gap-1 overflow-hidden rounded-xl" aria-label={`Гардероб @${w.username}`}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="overflow-hidden bg-skeleton">
                <CoverImg cover={w.collage[i] ?? null} alt="" />
              </div>
            ))}
          </button>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/u/${w.username}`} className="block truncate font-semibold hover:underline">
                @{w.username}
              </Link>
              <p className="text-xs text-muted">
                {itemsLabel(w.activeCount)} · {w.soldCount} продано
              </p>
            </div>
            <FollowButton seller={w} size="sm" onChange={(v) => onFollowChange(w.username, v)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CategoryTiles({ categories }: { categories: Array<{ slug: string; label: string; count: number; cover: Cover | null }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {categories.map((c) => (
        <Link key={c.slug} href={`/search?category=${c.slug}`} className="group relative aspect-[4/5] overflow-hidden rounded-2xl bg-skeleton">
          <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-105">
            <CoverImg cover={c.cover} alt="" />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-10 text-white">
            <p className="font-semibold">{c.label}</p>
            <p className="text-xs opacity-80">{c.count}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

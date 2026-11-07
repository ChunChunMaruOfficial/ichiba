import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { authorHref, type Author } from "@/lib/journal-authors";

export function Avatar({ author, size = 40, className }: { author: Author; size?: number; className?: string }) {
  // A reader's photo lives on the photo host, which next/image isn't set up for: a plain <img>, already small.
  if (author.photo?.startsWith("http")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={author.photo} alt="" width={size} height={size} className={clsx("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return author.photo ? (
    <Image src={author.photo} alt="" width={size} height={size} className={clsx("rounded-full object-cover", className)} />
  ) : (
    <span className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-kraft font-semibold text-kraft-ink", className)} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {author.name.replace(/^@/, "").trim()[0]?.toUpperCase()}
    </span>
  );
}

/** The author's name, role and photo in one line: under the title of every article. */
export function Byline({ author, children }: { author: Author; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Avatar author={author} />
      <div className="min-w-0">
        <Link href={authorHref(author)} className="font-medium text-ink hover:underline">
          {author.name}
        </Link>
        <span className="text-muted"> · {author.role}</span>
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Who wrote it, at the end: the bio and the public pages that confirm the person. */
export function AuthorCard({ author }: { author: Author }) {
  return (
    <section aria-label="Об авторе" className="mt-12 flex gap-4 rounded-3xl bg-surface p-5 md:p-6">
      <Avatar author={author} size={56} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Автор</p>
        <p className="mt-0.5 font-semibold">
          <Link href={authorHref(author)} className="hover:underline">
            {author.name}
          </Link>
          <span className="font-normal text-muted"> · {author.role}</span>
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{author.bio}</p>
        {author.links?.length ? (
          <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
            {author.links.map((l) => (
              <a key={l.href} href={l.href} className="text-indigo hover:underline" rel={l.href.startsWith("http") ? "me noopener" : undefined}>
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </section>
  );
}

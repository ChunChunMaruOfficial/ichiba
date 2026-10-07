import Link from "next/link";
import { Chochin } from "@/components/shop/chochin";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-16 md:px-6 md:py-24">
      <div className="waves flex flex-col items-center rounded-[32px] px-6 py-16 text-center">
        {/* Two lanterns at a shop door; 迷子 «lost» on one of them. */}
        <div className="flex items-start gap-8" aria-hidden>
          <Chochin ch="迷" className="h-36" />
          <Chochin ch="子" className="mt-4 h-32" delay={-2.2} />
        </div>
        <p className="mt-5 text-sm font-medium tracking-[0.14em] text-muted">404</p>
        <h1 className="mt-2 text-3xl font-bold">Такой страницы нет</h1>
        <p className="mt-2 text-ink-2">Возможно, вещь уже продали и удалили, или ссылка неверная.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="inline-flex h-11 items-center btn-wa btn-wa-ink rounded-xl px-5 font-semibold">
            На главную
          </Link>
          <Link href="/search" className="inline-flex h-11 items-center btn-wa btn-wa-paper rounded-xl px-5 font-semibold">
            Поиск
          </Link>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Такой страницы нет</h1>
      <p className="mt-2 text-ink-2">Возможно, вещь удалили или ссылка неверная.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="inline-flex h-11 items-center rounded-xl bg-accent px-5 font-semibold text-accent-ink hover:bg-accent-hover">
          На главную
        </Link>
        <Link href="/search" className="inline-flex h-11 items-center rounded-xl border border-line-strong px-5 font-semibold">
          Поиск
        </Link>
      </div>
    </div>
  );
}

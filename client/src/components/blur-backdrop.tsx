/**
 * The photo itself, blown up and blurred, behind a photo that doesn't fill its frame (Instagram/Telegram-style), so
 * the empty bands take the photo's own colours instead of a flat fill. The small variant is enough at this blur.
 */
export function BlurBackdrop({ src }: { src: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" loading="lazy" decoding="async" className="size-full scale-125 object-cover blur-2xl saturate-[1.15]" />
      {/* A soft veil keeps the photo in front of its own blur. */}
      <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgb(0_0_0/0.18))]" />
    </span>
  );
}

import { Glyph } from "./glyph";

/**
 * The shop's crest, 丸に市 «市 in a ring»: the way old Japanese shops marked their noren, lanterns and wrapping.
 * Single colour (currentColor), so it can be ink on paper, washi on indigo or a faint watermark.
 */
export function Kamon({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path fill="currentColor" fillRule="evenodd" d="M50 2a48 48 0 1 1 0 96A48 48 0 0 1 50 2Zm0 8.5a39.5 39.5 0 1 0 0 79a39.5 39.5 0 0 0 0-79Z" />
      <Glyph ch="市" cx={50} cy={51} size={52} />
    </svg>
  );
}

"use client";

import clsx from "clsx";
import { useState } from "react";
import type { ChatPin } from "@/lib/types";
import { IconUnpin } from "./icons";

/**
 * Pinned messages above the chat, as in Telegram: tap jumps to the shown one and moves on to the next
 * (older) pin; the bars on the left show which of them is on screen.
 */
export function PinnedBar({ pins, onJump, onUnpin }: { pins: ChatPin[]; onJump: (id: string) => void; onUnpin: (pin: ChatPin) => void }) {
  const [at, setAt] = useState(0);
  if (!pins.length) return null;
  const i = Math.min(at, pins.length - 1);
  const pin = pins[i];
  const bars = Math.min(pins.length, 4);
  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface/80 px-4 py-1.5 backdrop-blur">
      <button
        type="button"
        onClick={() => {
          onJump(pin.messageId);
          setAt((i + 1) % pins.length);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-label={`Закреплённое сообщение ${i + 1} из ${pins.length}: ${pin.message.text}. Показать в чате`}
      >
        <span aria-hidden className="flex h-9 w-[3px] shrink-0 flex-col gap-0.5">
          {Array.from({ length: bars }, (_, b) => (
            <span key={b} className={clsx("flex-1 rounded-full", b === Math.min(i, bars - 1) ? "bg-shu" : "bg-shu/25")} />
          ))}
        </span>
        {pin.message.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pin.message.thumb} alt="" width={36} height={36} className="size-9 shrink-0 rounded object-cover" />
        )}
        <span className="min-w-0 leading-tight">
          <span className="block text-[13px] font-semibold text-shu">
            Закреплённое сообщение{pins.length > 1 && <span className="tabular"> #{pins.length - i}</span>}
            {!pin.forAll && <span className="ml-1.5 font-normal text-muted">· только у вас</span>}
          </span>
          <span className="block truncate text-sm text-ink-2">{pin.message.text}</span>
        </span>
      </button>
      <button type="button" onClick={() => onUnpin(pin)} aria-label="Открепить" title="Открепить" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
        <IconUnpin className="size-[18px]" />
      </button>
    </div>
  );
}

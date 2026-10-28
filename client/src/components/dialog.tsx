"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Button, Field, Input, Modal } from "./ui";

/**
 * The site's own confirm / prompt, in place of the browser's: a paper sheet with the same open/close motion as every
 * modal, a clear title and verb buttons («Удалить», not «OK»). Both return a promise, so a call reads like the old
 * window.confirm: `if (!(await confirm({ … }))) return;`.
 */

interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  /** The action's verb: «Удалить», «Отписаться». */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Irreversible or destructive: the button turns red. */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  initial?: string;
  /** The value must equal this to confirm (typing a nickname before deleting an account). */
  mustEqual?: string;
  multiline?: boolean;
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

const DialogContext = createContext<{ confirm: (o: ConfirmOptions) => Promise<boolean>; prompt: (o: PromptOptions) => Promise<string | null> } | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  // The last dialog stays rendered while its sheet slides away.
  const [shown, setShown] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const next: Pending = { kind: "confirm", opts, resolve };
        setPending(next);
        setShown(next);
        setOpen(true);
      }),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initial ?? "");
        const next: Pending = { kind: "prompt", opts, resolve };
        setPending(next);
        setShown(next);
        setOpen(true);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(ok);
    else pending.resolve(ok ? value.trim() : null);
    setPending(null);
    setOpen(false);
  };

  const d = shown;
  const blocked = d?.kind === "prompt" && (d.opts.mustEqual ? value.trim() !== d.opts.mustEqual : false);

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {d && (
        <Modal open={open} onClose={() => finish(false)} title={d.opts.title} width="max-w-[420px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!blocked) finish(true);
            }}
          >
            {d.opts.message && <div className="-mt-1 text-[15px] leading-relaxed text-ink-2">{d.opts.message}</div>}
            {d.kind === "prompt" && (
              <div className="mt-4">
              <Field label={d.opts.label ?? ""} htmlFor="dialog-value">
                {d.opts.multiline ? (
                  <textarea
                    id="dialog-value"
                    autoFocus
                    rows={3}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={d.opts.placeholder}
                    className="w-full rounded-xl border border-line-strong bg-paper px-3.5 py-2.5 text-[15px] outline-none focus:border-ink pointer-coarse:text-base"
                  />
                ) : (
                  <Input id="dialog-value" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={d.opts.placeholder} />
                )}
              </Field>
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => finish(false)}>
                {d.opts.cancelLabel ?? "Отмена"}
              </Button>
              <Button type="submit" variant={d.opts.danger ? "danger" : "primary"} disabled={blocked} autoFocus={d.kind === "confirm"}>
                {d.opts.confirmLabel ?? "Продолжить"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog outside DialogProvider");
  return ctx;
}

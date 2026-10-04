"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";
import { Button, Field, Modal, Textarea } from "./ui";

/** Complaint about an item or a user (frame 20). */
export function ReportModal({ open, onClose, targetType, targetId, title }: { open: boolean; onClose: () => void; targetType: "LISTING" | "USER" | "REVIEW"; targetId: string; title?: string }) {
  const { data: reasons } = useSWR<{ LISTING: string[]; USER: string[]; REVIEW: string[] }>(open ? "/reports/reasons" : null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async () => {
    if (!reason) return setError("Выберите причину");
    setBusy(true);
    try {
      await api("/reports", { body: { targetType, targetId, reason, comment: comment || null } });
      toast("Жалоба отправлена — модератор проверит");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={targetType === "LISTING" ? "Пожаловаться на вещь" : targetType === "REVIEW" ? "Пожаловаться на отзыв" : "Пожаловаться на пользователя"}>
      <p className="-mt-2 mb-4 truncate text-sm text-muted">{title}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Причина</legend>
        {(reasons?.[targetType] ?? []).map((r) => (
          <label key={r} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-sm has-[:checked]:border-ink">
            <input type="radio" name="report-reason" className="accent-[var(--accent)]" checked={reason === r} onChange={() => (setReason(r), setError(null))} />
            {r}
          </label>
        ))}
      </fieldset>
      <div className="mt-4">
        <Field label="Комментарий (необязательно)" htmlFor="report-comment">
          <Textarea id="report-comment" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-20" maxLength={1000} />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <Button block className="mt-5" loading={busy} onClick={submit}>
        Отправить жалобу
      </Button>
    </Modal>
  );
}

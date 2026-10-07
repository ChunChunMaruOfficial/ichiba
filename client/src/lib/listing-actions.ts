"use client";

import { useCallback } from "react";
import { useToast } from "@/components/toast";
import { api, ApiError } from "./api";

/** Owner actions shared by Product and Wardrobe (frame 09 INTERACTIONS). `onDone` refreshes the caller's data. */
export function useListingActions(onDone: () => void) {
  const toast = useToast();

  const call = useCallback(
    async (fn: () => Promise<unknown>, success: string, undo?: { label: string; run: () => Promise<unknown> }) => {
      try {
        await fn();
        onDone();
        toast(success, undo && { action: { label: undo.label, onClick: () => void undo.run().then(onDone) } });
        return true;
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Не удалось сохранить изменение · Повторите", { tone: "error" });
        return false;
      }
    },
    [onDone, toast],
  );

  return {
    /** No confirmation; undo in the toast. */
    hide: (id: string) =>
      call(() => api(`/listings/${id}/hide`, { method: "POST" }), "Вещь скрыта", { label: "Отменить", run: () => api(`/listings/${id}/publish`, { method: "POST" }) }),
    unhide: (id: string) => call(() => api(`/listings/${id}/publish`, { method: "POST" }), "Вещь снова в продаже"),
    markSold: (id: string) =>
      window.confirm("Продали вне платформы? Вещь пропадёт из поиска, активные запросы будут отклонены.")
        ? call(() => api(`/listings/${id}/sold`, { method: "POST" }), "Отмечено как проданное")
        : Promise.resolve(false),
    remove: (id: string) =>
      window.confirm("Удалить вещь? Фото и описание удалятся. Завершённые сделки останутся в истории.")
        ? call(() => api(`/listings/${id}`, { method: "DELETE" }), "Вещь удалена")
        : Promise.resolve(false),
  };
}

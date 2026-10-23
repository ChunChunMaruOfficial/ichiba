"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { ButtonLink, EmptyState, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

/**
 * A deal has no page of its own: it lives in the conversation with the other side. Old links, notifications and
 * emails point here, so this opens (or creates) that conversation and goes there, keeping #review.
 */
export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireAuth reason="чтобы открыть сделку">{() => <ToChat id={id} />}</RequireAuth>;
}

function ToChat({ id }: { id: string }) {
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ id: string }>("/threads", { body: { requestId: id } })
      .then((t) => alive && router.replace(`/messages/${encodeURIComponent(t.id)}${window.location.hash}`))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id, router]);
  if (missing)
    return (
      <EmptyState title="Сделка не найдена">
        <ButtonLink href="/purchases">Мои покупки</ButtonLink>
      </EmptyState>
    );
  return (
    <div className="flex justify-center py-24 text-muted">
      <Spinner />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useMeta, useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button, Field, Input, inputClass, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function SettingsPage() {
  return <RequireAuth reason="чтобы открыть настройки">{(me) => <Settings me={me} />}</RequireAuth>;
}

function Settings({ me }: { me: Me }) {
  const meta = useMeta();
  const { refresh, logout } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [city, setCity] = useState(me.city ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setFields({});
    try {
      await api("/users/me", { method: "PATCH", body: { city: city || null, bio: bio || null, phone: phone || null } });
      await refresh();
      toast("Изменения сохранены");
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить", { tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Настройки</h1>
      <p className="mt-1 text-muted">@{me.username}{me.email ? ` · ${me.email}` : ""}</p>
      <form
        className="mt-8 flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Город" htmlFor="city" hint="Подставляется в новые вещи">
          <select id="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass()}>
            <option value="">Не указан</option>
            {meta?.cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="О себе" htmlFor="bio" error={fields.bio} hint={`${bio.length}/160 · видно в гардеробе`}>
          <Textarea id="bio" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} className="min-h-20" />
        </Field>
        <Field label="Телефон" htmlFor="phone" hint="Покажем другой стороне только после подтверждения сделки">
          <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+375 29 …" />
        </Field>
        <Button type="submit" loading={saving} className="self-start">
          Сохранить
        </Button>
      </form>
      <button
        className="mt-12 text-sm text-ink-2 underline underline-offset-4 hover:text-ink"
        onClick={async () => {
          await logout();
          router.push("/");
        }}
      >
        Выйти из аккаунта
      </button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Accent } from "@/lib/tts";

export interface SettingsValues {
  dailyNewLimit: number;
  dailyReviewLimit: number;
  accent: Accent;
  autoSpeak: boolean;
}

export default function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    values.dailyNewLimit !== initial.dailyNewLimit ||
    values.dailyReviewLimit !== initial.dailyReviewLimit ||
    values.accent !== initial.accent ||
    values.autoSpeak !== initial.autoSpeak;

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `服务端返回 ${res.status}`);
      }
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 1500);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "保存失败");
    }
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field
        label="每日新词数"
        hint="每天引入多少个新词。调大进度快但复习压力会累积，20 是比较稳的值。"
      >
        <NumberInput
          value={values.dailyNewLimit}
          min={1}
          max={200}
          onChange={(v) => setValues((s) => ({ ...s, dailyNewLimit: v }))}
        />
      </Field>

      <Field label="每日复习上限" hint="一天最多复习多少个到期旧词，防止某天积压太多背不完。">
        <NumberInput
          value={values.dailyReviewLimit}
          min={1}
          max={999}
          onChange={(v) => setValues((s) => ({ ...s, dailyReviewLimit: v }))}
        />
      </Field>

      <Field label="发音口音" hint="取决于系统里装了哪几套语音，没有对应口音时自动退回其他英文音色。">
        <select
          value={values.accent}
          onChange={(e) =>
            setValues((s) => ({ ...s, accent: e.target.value as Accent }))
          }
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          <option value="uk">英式</option>
          <option value="us">美式</option>
        </select>
      </Field>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={values.autoSpeak}
          onChange={(e) => setValues((s) => ({ ...s, autoSpeak: e.target.checked }))}
          className="mt-0.5 accent-[var(--color-brand)]"
        />
        <span>
          <span className="text-sm">翻面时自动朗读</span>
          <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
            手机浏览器要求首次朗读由点击触发，所以打开后仍需点一次喇叭才会生效。
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || state === "saving"}
          className="rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-[var(--color-on-brand)] transition hover:opacity-90 disabled:opacity-40"
        >
          {state === "saving" ? "保存中…" : "保存"}
        </button>
        {state === "saved" && (
          <span className="text-sm text-[var(--color-brand)]">已保存</span>
        )}
        {state === "error" && (
          <span className="text-sm text-[var(--color-rate-again)]">{error}</span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      <p className="text-xs text-[var(--color-muted)]">{hint}</p>
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        // 输入框清空时 Number("") 是 0，别让它把值写成 0
        if (Number.isFinite(n) && e.target.value !== "") onChange(n);
      }}
      className="w-28 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums"
    />
  );
}

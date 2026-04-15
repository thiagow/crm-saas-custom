"use client";

import type { sessions } from "@/db/schema";
import { revokeAllOtherSessions, revokeSession } from "@/lib/auth/session-actions";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { useState, useTransition } from "react";

type Session = typeof sessions.$inferSelect;

interface Props {
  sessions: Session[];
}

function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo desconhecido";
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return "Dispositivo móvel";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Navegador";
}

function parseBrowserLabel(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) return "Chrome";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) return "Safari";
  if (/edg/i.test(userAgent)) return "Edge";
  return "";
}

export function SecuritySessionList({ sessions }: Props) {
  const [isPending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRevoke(sessionToken: string) {
    setRevoking(sessionToken);
    setError(null);
    startTransition(async () => {
      try {
        await revokeSession({ sessionToken });
      } catch {
        setError("Falha ao revogar sessão. Tente novamente.");
      } finally {
        setRevoking(null);
      }
    });
  }

  function handleRevokeAll() {
    setError(null);
    startTransition(async () => {
      try {
        await revokeAllOtherSessions();
      } catch {
        setError("Falha ao revogar sessões. Tente novamente.");
      }
    });
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <p className="text-sm text-zinc-500">Nenhuma sessão ativa encontrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {sessions.map((s) => {
          const device = parseDeviceLabel(s.userAgent);
          const browser = parseBrowserLabel(s.userAgent);
          const isMobile = s.userAgent ? /mobile|android|iphone|ipad/i.test(s.userAgent) : false;
          const isRevoking = revoking === s.sessionToken;

          return (
            <div key={s.sessionToken} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
                  {isMobile ? (
                    <SmartphoneIcon className="h-4 w-4" />
                  ) : (
                    <MonitorIcon className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">
                    {browser ? `${device} · ${browser}` : device}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {s.ipAddress ? `${s.ipAddress} · ` : ""}
                    Iniciado {formatDistanceToNow(s.createdAt, { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleRevoke(s.sessionToken)}
                disabled={isPending || isRevoking}
                className="flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-red-800 hover:bg-red-950/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRevoking ? "Revogando..." : "Revogar"}
              </button>
            </div>
          );
        })}
      </div>

      {sessions.length > 1 && (
        <button
          type="button"
          onClick={handleRevokeAll}
          disabled={isPending}
          className="w-full rounded-md border border-red-900/60 bg-red-950/20 px-4 py-2.5 text-sm text-red-400 transition-colors hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Revogando todas..." : "Revogar todas as sessões"}
        </button>
      )}

      <p className="text-xs text-zinc-600 text-center">
        Sessões JWT expiram naturalmente em 30 dias. A revogação impede a renovação imediata.
      </p>
    </div>
  );
}

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  head: () => ({ meta: [
    { title: "Autorizar acesso — e-Qualifica" },
    { name: "description", content: "Confirme ou recuse o acesso de um aplicativo à sua conta e-Qualifica." },
    { property: "og:title", content: "Autorizar acesso — e-Qualifica" },
    { property: "og:description", content: "Autorização segura de aplicativos conectados ao e-Qualifica." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s['authorization_id'] === "string" ? s['authorization_id'] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("authorization_id ausente");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const oauth = (supabase.auth as unknown as {
      oauth: {
        getAuthorizationDetails: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
      };
    }).oauth;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-2xl">Autorização indisponível</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Não foi possível carregar esta solicitação: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

type AuthDetails = {
  client?: { name?: string } | null;
  redirect_url?: string;
  redirect_to?: string;
};

function Consent() {
  const details = Route.useLoaderData() as AuthDetails | null;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "o aplicativo solicitante";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const oauth = (supabase.auth as unknown as {
      oauth: {
        approveAuthorization: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
        denyAuthorization: (id: string) => Promise<{ data: AuthDetails | null; error: { message: string } | null }>;
      };
    }).oauth;
    const { data, error: err } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não retornou um redirecionamento.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-2xl">Conectar {clientName} à sua conta</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Ao aprovar, {clientName} poderá consultar suas análises, documentos, comparações e
        achados, e registrar notas de revisão — sempre com as mesmas permissões da sua conta.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-8 flex gap-3">
        <Button disabled={busy} onClick={() => decide(true)}>
          Aprovar
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
          Recusar
        </Button>
      </div>
    </main>
  );
}

import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/equalifica-logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NavArrows } from "@/components/NavArrows";


export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s['next'] === "string" ? { next: s['next'] } : {},

  head: () => ({
    meta: [
      { title: "Acesso — e-Qualifica" },
      {
        name: "description",
        content:
          "Entre ou cadastre-se para acessar as análises de conferência registral.",
      },
      { property: "og:title", content: "Acesso — e-Qualifica" },
      {
        property: "og:description",
        content: "Área restrita da plataforma de conferência registral.",
      },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email("Informe um e-mail válido.").max(255),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(72),
});

function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const next = safeNext(search.next);
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const returnUrl = () =>
    next ? `${window.location.origin}${next}` : window.location.origin;

  const goBack = () => {
    if (next) {
      window.location.href = next;
      return;
    }
    navigate({ to: "/painel", replace: true });
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session && await verifyAccess(data.session.user.id)) goBack();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  async function verifyAccess(userId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("is_authorized_user", { _user_id: userId });
    if (!error && data === true) return true;
    await supabase.auth.signOut();
    toast.error("Este e-mail não está autorizado a acessar o sistema. Contate um administrador.");
    return false;
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error("Não foi possível entrar: credenciais inválidas.");
      return;
    }
    if (data.user && await verifyAccess(data.user.id)) goBack();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]!.message);
      return;
    }
    if (fullName.trim().length < 3) {
      toast.error("Informe seu nome completo.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      ...parsed.data,
      options: {
        emailRedirectTo: returnUrl(),
        data: { full_name: fullName.trim() },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      setAwaitingConfirm(true);
      toast.success("Cadastro criado. Confirme o e-mail para acessar.");
      return;
    }
    if (data.user && await verifyAccess(data.user.id)) goBack();
  }

  async function handleGoogle() {
    const { lovable } = await import("@/integrations/lovable/index");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: returnUrl(),
    });
    if (result.error) {
      toast.error("Falha ao entrar com Google.");
      return;
    }
    if (result.redirected) return;
    goBack();
  }

  async function handleApple() {
    const { lovable } = await import("@/integrations/lovable/index");
    const result = await lovable.auth.signInWithOAuth("apple", {
      redirect_uri: returnUrl(),
    });
    if (result.error) {
      toast.error("Falha ao entrar com Apple.");
      return;
    }
    if (result.redirected) return;
    goBack();
  }


  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col items-center justify-center bg-ink p-12 text-center text-ink-foreground lg:flex">
        <div className="flex flex-1 flex-col items-center justify-center">
          <Link to="/" className="flex flex-col items-center">
            <div className="border border-solid border-accent p-1.5">
              <img
                src={logoAsset.url}
                alt="e-Qualifica"
                className="h-44 w-44 object-contain"
              />
            </div>
          </Link>

          <div className="mt-[38px] flex flex-col items-center">
            <div className="rule-gold w-32" />
            <h1 className="mt-8 max-w-md text-4xl leading-tight">
              Trilha de auditoria integral para cada conclusão técnica.
            </h1>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-foreground/70">
              O acesso é individual e nominal. Cada extração, comparação e achado
              fica vinculado ao usuário responsável.
            </p>
          </div>
        </div>
        <p className="eyebrow text-ink-foreground/50">Área restrita</p>
      </aside>


      <main className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <NavArrows showHome={false} />
            <div className="border border-solid border-accent p-0.5">
              <img src={logoAsset.url} alt="e-Qualifica" className="h-12 w-12 object-contain" />
            </div>
            <Link
              to="/"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Voltar ao início
            </Link>
          </div>

          <p className="eyebrow mt-6">Acesso à plataforma</p>
          <h2 className="mt-3 text-3xl">Entrar</h2>


          {awaitingConfirm ? (
            <div className="panel mt-8 p-6">
              <h3 className="text-lg">Confirme seu e-mail</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Enviamos um link de confirmação para <strong>{email}</strong>.
                Após confirmar, retorne e faça login.
              </p>
              <Button
                className="mt-5 w-full"
                variant="outline"
                onClick={() => setAwaitingConfirm(false)}
              >
                Voltar
              </Button>
            </div>
          ) : (
            <Tabs defaultValue="entrar" className="mt-8">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="entrar">Entrar</TabsTrigger>
                <TabsTrigger value="criar">Criar conta</TabsTrigger>
              </TabsList>

              <TabsContent value="entrar">
                <form onSubmit={handleSignIn} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="senha">Senha</Label>
                    <Input
                      id="senha"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Entrando..." : "Entrar"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="criar">
                <form onSubmit={handleSignUp} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome completo</Label>
                    <Input
                      id="nome"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-novo">E-mail</Label>
                    <Input
                      id="email-novo"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="senha-nova">Senha</Label>
                    <Input
                      id="senha-nova"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Criando..." : "Criar conta"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}

          {!awaitingConfirm && (
            <>
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="eyebrow">ou</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                <Button variant="outline" className="w-full" onClick={handleGoogle}>
                  Continuar com Google
                </Button>
                <Button variant="outline" className="w-full" onClick={handleApple}>
                  Continuar com Apple
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

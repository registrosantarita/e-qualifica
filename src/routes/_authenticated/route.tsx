import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NavArrows } from "@/components/NavArrows";
import { souAdmin } from "@/lib/admin.functions";
import logoAsset from "@/assets/equalifica-logo.png.asset.json";



export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const access = await supabase.rpc("is_authorized_user", { _user_id: data.user.id });
    if (access.error || access.data !== true) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const souAdminFn = useServerFn(souAdmin);
  const admin = useQuery({
    queryKey: ["sou-admin"],
    queryFn: () => souAdminFn({}),
    staleTime: 5 * 60 * 1000,
  });


  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <NavArrows showHome={false} />
            <Link to="/" className="flex items-center gap-3">
              <div className="border border-solid border-accent p-0.5">
                <img
                  src={logoAsset.url}
                  alt="e-Qualifica"
                  className="h-8 w-8 object-contain"
                />
              </div>

              <div className="leading-tight">
                <p className="font-display text-sm text-foreground">
                  e-Qualifica
                </p>
                <p className="eyebrow hidden sm:block">
                  Qualificação Registral Assistida
                </p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {admin.data?.admin && (
              <Link
                to="/admin"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Administração
              </Link>
            )}
            <Link
              to="/painel"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              GeoConfronto
            </Link>
            <Link
              to="/qualificacao"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              CheckTítulo
            </Link>
            <Link
              to="/indexacao"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              CheckIndex
            </Link>
            <Link
              to="/questioncheck"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              QuestionCheck
            </Link>

            <Link
              to="/normas"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Acervo normativo
            </Link>


            <Link
              to="/creditos"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Créditos
            </Link>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {user.email}
            </span>

            <Button variant="outline" size="sm" onClick={signOut}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

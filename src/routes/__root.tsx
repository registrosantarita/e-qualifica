import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { registerPwa } from "@/lib/pwa";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">Erro 404</p>
        <h1 className="mt-3 text-4xl text-foreground">Página não encontrada</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          O endereço acessado não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">Falha de carregamento</p>
        <h1 className="mt-3 text-2xl text-foreground">Esta página não carregou</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Falha ao carregar esta página."}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Ir para o início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "e-Qualifica — Qualificação registral assistida" },
      {
        name: "description",
        content:
          "e-Qualifica — plataforma de conferência registral, geométrica e normativa: extração, normalização e comparação auditável de memoriais descritivos.",
      },
      { property: "og:type", content: "website" },
      {
        name: "google-site-verification",
        content: "Giaaaiz1v53nMDHNGaSGPwLRGNpF9sp2FIHT4XM2QtY",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#1e2a44" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "e-Qualifica" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Marcellus&family=Karla:ital,wght@0,300..800;1,300..800&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon-eq-v2.png?v=2", type: "image/png", sizes: "64x64" },
      { rel: "shortcut icon", href: "/favicon-eq-v2.png?v=2", type: "image/png" },
      { rel: "manifest", href: "/manifest.webmanifest?v=2" },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon-eq-v2.png?v=2",
        sizes: "180x180",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://code-to-creation-co.lovable.app/#organization",
              name: "e-Qualifica",
              url: "https://code-to-creation-co.lovable.app/",
              logo: "https://code-to-creation-co.lovable.app/apple-touch-icon.png",
              description:
                "Plataforma de conferência registral, geométrica e normativa de memoriais descritivos, plantas e títulos.",
            },
            {
              "@type": "WebSite",
              "@id": "https://code-to-creation-co.lovable.app/#website",
              name: "e-Qualifica",
              url: "https://code-to-creation-co.lovable.app/",
              inLanguage: "pt-BR",
              publisher: { "@id": "https://code-to-creation-co.lovable.app/#organization" },
              description:
                "e-Qualifica — extração, normalização e comparação auditável de memoriais descritivos, plantas e escrituras.",
            },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    registerPwa();
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED")
        return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);


  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}

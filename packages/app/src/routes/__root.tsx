/// <reference types="vite/client" />
import { useState, type ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { Providers } from '../components/providers';
import { getSession } from '../lib/session';
import { THEME_BOOT_SCRIPT, serverTheme } from '../lib/theme';
import appCss from '../styles/app.css?url';

export const Route = createRootRoute({
  // `beforeLoad`, not `loader`: every child route gates on the session, so it
  // has to be resolved before any of them decide whether to redirect.
  beforeLoad: async () => ({ session: await getSession() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'robot platform' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preload', href: '/fonts/GeistVariable.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'preload', href: '/fonts/GeistMonoVariable.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
    ],
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />,
});

function RootDocument({ children }: { children: ReactNode }) {
  const { session } = Route.useRouteContext();
  const pref = session?.user.theme ?? 'dark';
  // Frozen at the first render on purpose: `shellComponent` is a live client
  // component, so a `router.invalidate()` after `auth.setTheme` re-renders it.
  // If React kept owning `data-theme`, that re-render would patch the attribute
  // back to the server's guess and undo the correct value `chooseTheme` just
  // wrote — choosing "System" from Light on a light-preferring machine flipped
  // the app to dark, because `serverTheme('system')` is `dark`. With the value
  // frozen, `chooseTheme` and `THEME_BOOT_SCRIPT` are the only writers after
  // the first paint.
  const [rendered] = useState(() => serverTheme(pref));

  return (
    // `suppressHydrationWarning` is required, not cosmetic: for a `system`
    // preference the server has to guess (it renders `dark`) and the boot
    // script below rewrites `data-theme` to the real OS answer before paint —
    // which is before hydration. React would otherwise compare the attribute it
    // rendered against the one already in the DOM and warn on every light-mode
    // `system` load. The rewritten value is the correct one and React leaves it
    // alone; only the warning is suppressed, and only on this element.
    <html lang="en" data-theme={rendered} suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Only `system` can be wrong on the server, and only then is a
            pre-paint correction worth a blocking inline script. */}
        {pref === 'system' ? <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /> : null}
      </head>
      <body>
        <Providers>{children}</Providers>
        <Scripts />
      </body>
    </html>
  );
}

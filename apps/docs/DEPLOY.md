# Deploying the docs site

`apps/docs` is a Next.js app that publishes the SNA documentation to
`https://docs.skills-native.app`. We deploy to Vercel.

## Initial project setup

1. **Import the repo** into Vercel from
   `github.com/neuradex/sna`.
2. **Root Directory**: set to `apps/docs` in the Vercel project
   settings → General → Root Directory. Vercel handles the pnpm
   workspace install at the repo root automatically when this is set.
3. **Framework Preset**: Next.js (auto-detected).
4. **Build Command**: `pnpm build` (from `apps/docs`). Configured in
   `vercel.json` already, no override needed.
5. **Install Command**: `pnpm install --frozen-lockfile`. Vercel
   detects the pnpm workspace and installs at the repo root.
6. **Node.js Version**: 22.x or later.

## Domain

1. Add `docs.skills-native.app` in Project → Settings → Domains.
2. Vercel will prompt for a DNS record. In the registrar for
   `skills-native.app`, add a CNAME:
   ```
   docs   CNAME   cname.vercel-dns.com
   ```
3. Wait for DNS propagation + automatic TLS issuance.

## Local check before deploy

```bash
pnpm --filter docs build
pnpm --filter docs start
```

If the build fails locally it will fail on Vercel. The `postinstall`
step runs `fumadocs-mdx` to materialize the content collection — make
sure `.source/` is gitignored (it is, by the template).

## Preview deploys

Every PR gets a Vercel preview URL by default. The PR template surfaces
this automatically. Use it to review content changes before merge.

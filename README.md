# PactFlow

**Agree in writing, deliver in stages, pay on proof, and remember what worked.**

PactFlow is a collaboration platform for one-off software and design work between a Client
and a Freelancer. It wraps the whole engagement in a single, versioned record: a brief, AI-drafted
quotations, a side-by-side comparison, a dual-approved agreement, milestone-gated delivery with
watermarked previews, PayPal payment, and — after the work is done — a shared history both
parties can build on next time.

The platform exists because the three moments where freelance projects fall apart are all
moments of ambiguity: what was agreed, what was delivered, and what was paid. PactFlow makes
each of those a state the backend enforces, not a claim in a chat thread.

---

## The three pillars

| Pillar | What it does |
| --- | --- |
| **Agreement Intelligence** | AI drafts a quotation from the brief, a comparison workspace scores the offers, agreements are versioned and require **both** parties to approve, and scope changes go through a vote-and-dispute workflow before any new version takes effect. |
| **Controlled Delivery & Payment** | Deliverables are uploaded as PDFs with a SHA-256 hash, previewed as watermarked derivatives, and released as the original only through a signed, expiring URL — and only once the payment for that milestone is captured. PayPal Orders v2 in `mock` or `sandbox` mode, with idempotent webhooks. |
| **Relationship Intelligence** | Every engagement appends to a shared, append-only history; both parties record working preferences the other must confirm; an AI summary cites the history entries it drew from and can be flagged for correction; templates and repeat invitations carry the relationship forward. |

## The hard rule

**The AI never moves the project forward on its own.** Every AI output — quotation draft,
comparison summary, pricing suggestion, collaboration summary — is stored as a recommendation
with its citations and an `engine` field (`llm` or `heuristic`). A human action is required to
turn any of it into state. With no `LLM_API_KEY` configured the platform runs entirely on a
deterministic heuristic engine, so the demo is reproducible offline and no feature is gated
behind a paid API.

---

## Running it

Requires Node.js 20+.

```bash
npm install
cp .env.example .env        # Windows: Copy-Item .env.example .env
npm run db:push             # create prisma/dev.db from the schema
npm run db:seed             # demo data (see below)
npm run dev                 # http://localhost:3000
```

`.env.example` is fully commented; the important defaults:

- `DATABASE_URL="file:./dev.db"` — SQLite, no server to install.
- `STORAGE_DRIVER="local"` — deliverables live under `.data/storage`. Set the `S3_*` values and
  `STORAGE_DRIVER="s3"` to use object storage instead.
- `PAYPAL_MODE="mock"` — an in-process stand-in for Orders v2 that redirects to a local approve
  screen. `PAYPAL_MODE="sandbox"` plus credentials calls the real PayPal sandbox.
- `LLM_API_KEY=""` — empty means the heuristic engine.

### Demo accounts

The seeder creates a complete, mid-flight engagement. Every account uses the password
`Password123!`.

| Email | Who they are |
| --- | --- |
| `client@pactflow.dev` | Northwind Studio — the Client |
| `freelancer@pactflow.dev` | Ada Lovelace — the Freelancer on the active work |
| `grace@pactflow.dev` | Grace Hopper — a second Freelancer, with a submitted quotation to compare |

`npm run db:reset` rebuilds and reseeds from scratch.

### A five-minute tour

1. Sign in as the **Client** and open *Briefs*. The seeded brief is `OPEN` with two invitations,
   one of them already accepted.
2. Open *Compare quotations* — the comparison workspace shows both offers side by side, the AI
   summary cites each quotation, and *Accept* is a human decision.
3. Accept a quotation and you land on the **Agreement**: version 1 is `ACTIVE` because both
   parties have approved it. Start a **scope change** to watch the vote/dispute workflow.
4. Go to *Delivery*. Upload a PDF and open the **watermarked preview** — the original is not
   reachable yet. Approve the work, then the milestone, then *Continue to PayPal*. In `mock` mode
   you land on `/payments/mock-approve`; approving there captures the payment and the signed
   download becomes available.
5. Sign in as the **Freelancer** for the other side of every screen, including the discussion
   thread on the agreement.
6. Open *Collaboration*. The pair profile lists confirmed preferences, templates and the repeat
   invitation; the AI summary cites its sources and can be flagged.

## Test suite

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest: unit + property + integration
npm run test:props    # fast-check properties only
npm run e2e           # playwright (see below)
```

`npm run test` runs the domain layer directly against a throw-away SQLite file
(`prisma/test.db`, recreated from the schema by a Vitest global setup) so your demo data is never
touched. The property suites use fast-check with 100 generated cases per property.

Playwright drives a real server and needs it prepared first:

```bash
npm run e2e:prepare   # reset and reseed the e2e database
npm run e2e
```

The end-to-end suite covers the full journey in `e2e/`: sign-in and lockout, brief → invitation →
quotation → agreement → both approvals, delivery → watermarked preview → approval → mock PayPal →
signed download, and the scope-change vote that produces a new agreement version.

---

## Deploying

`render.yaml` is a Render Blueprint for the whole app: create a Blueprint from this repository and
Render provisions the service, generates the secrets, and prompts for the rest.

Two details matter before you deploy:

- **SQLite needs a disk.** The blueprint mounts a 1 GB disk at `/var/data` and points both
  `DATABASE_URL` and `LOCAL_STORAGE_DIR` inside it. Without the mount, the database and every
  uploaded deliverable would disappear on the next deploy. Persistent disks need a paid instance
  type, so the free plan cannot run this service as configured.
- **The demo data is seeded once.** `prisma/seed.ts` uses plain `create` calls, so the start command
  seeds only when the `/var/data/.seeded` marker is absent. Delete that file to reseed.

Set `APP_URL` to the service URL (`https://<service>.onrender.com`) on the first deploy. Nothing
else is required: `PAYPAL_MODE=mock` plus an empty `LLM_API_KEY` keeps the deployment
self-contained and reproducible.

---

## How it is built

```
src/
  app/
    (auth)/                 sign in, register
    (dashboard)/            briefs, quotations, agreements, delivery, collaboration
    api/                    one route per transition; all of them thin
    payments/mock-approve/  the stand-in PayPal approve screen
  components/               client islands (editors, workspaces, action bars)
  lib/
    briefs/ quotations/ agreements/ change-requests/
    milestones/ deliverables/ payments/ webhooks/      ← the domain
    collaboration/ ai/ pdf/ storage/ notifications/    ← supporting services
    auth/ access/ audit/ http/ state/                  ← cross-cutting
  prisma/schema.prisma      the data model
e2e/                        Playwright specs
```

The layering is deliberate:

- **Domain modules own every state transition.** Each one validates the actor, asserts the
  transition against the table in `src/lib/state`, writes the audit entry and its notifications in
  the same transaction, and throws a typed error (`ConflictError`, `ForbiddenError`, …) otherwise.
  Nothing in `app/` decides what is legal.
- **Routes are transport.** They authenticate, parse with Zod, call one domain function, and
  serialise. Work that must happen *after* a response — notification delivery, for instance — is
  scheduled by the route, never by the domain, so a domain call is a single deterministic pass
  over the database.
- **Pages are server components** that read through the same domain helpers; client islands only
  send mutations and then reload. After a write, the UI performs a real document load rather than
  a client-router transition, because the server is the only thing that knows what the write did.

### Notable details

- **Dual approval.** An agreement version is `ACTIVE` only when both parties have approved it;
  every version keeps the approvals that produced it.
- **Scope changes.** A change request is voted on by both parties, can be disputed or reclassified,
  and only produces a new agreement version once resolved — the milestone it touches cannot be
  delivered against in the meantime.
- **Previews are derivatives.** Uploads keep their original bytes and hash; the preview is a
  separately generated, watermarked file served from its own storage key. The download endpoint
  issues a signed, expiring URL and refuses until the payment for that milestone is `CAPTURED`.
- **Webhooks are idempotent.** `WebhookEvent.paypalEventId` is unique, so the constraint is the
  idempotency registry; a repeat delivery is acknowledged with `200`, recorded as
  `WEBHOOK_DUPLICATE` in the audit log, and changes no payment state.
- **The history is append-only.** Collaboration history entries are never rewritten; the AI
  summary points at the entries it used and the pair can flag it for regeneration.

### Third-party UI

- **AG Grid** (MIT) renders the comparison workspace in `src/components/comparison-grid.tsx`. The
  attribute column is pinned while the bid columns scroll, every column is resizable, and the grid
  is filtered and exported client-side, so comparing bids never costs a round trip. It is loaded
  with `ssr: false` because AG Grid manipulates the DOM as soon as it mounts.
- **Bryntum Gantt** is deliberately not bundled. The only build published to the public registry is
  the commercial trial tier, and its install hook is an obfuscated script that recursively rewrites
  every `.js` file under the project root — not something to ship in a demo. The intended next step
  is to mount the milestone timeline on a licensed `@bryntum/gantt` from Bryntum's own registry.

### Scheduled work

`GET`/`POST /api/cron` runs `checkOverdueMilestones`, `expireStaleChangeRequests` and
`remindStaleDeliverables`. It accepts either a `CRON_SECRET` bearer token or a signed-in platform
operator (see `OPERATOR_EMAILS`). `GET /api/audit` is operator-only.

## Data model

Prisma with SQLite in development. The graph is one line: `User` → `Brief` → `Invitation` →
`Quotation` → `Agreement` → `AgreementVersion` → `Milestone` → `Deliverable` / `Payment`, with
`CollaborationHistory`, `ChangeRequest`, `DiscussionMessage`, `AuditLog` and `Notification`
hanging off it. `prisma/schema.prisma` is the source of truth; `npm run db:pg-schema` will emit a
PostgreSQL-compatible schema if you want to move off SQLite.

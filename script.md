# PactFlow — Complete Hackathon Walkthrough Script
> Silent video · Target ≤ 3 minutes · Two browser windows (Client left, Freelancer right)  
> No narration needed — follow click-by-click.

---

## Accounts Setup (Open in 2 browser profiles or tabs)

| Account | Email | Password | Role |
|---|---|---|---|
| **CLIENT** | `client@pactflow.dev` | `Password123!` | Buyer / Project Owner |
| **FREELANCER** | `freelancer@pactflow.dev` | `Password123!` | Service Provider |
| **PAYPAL SANDBOX** | Your sandbox personal payer email | Your sandbox password | PayPal Checkout |

---

## PART 1 — Client Creates & Publishes New Brief  (~0:00 – 0:30)

### Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 1 | `/login` | Enter `client@pactflow.dev` / `Password123!` → click **Sign in** | Client Dashboard opens |
| 2 | Left nav | Click **Briefs** | Briefs list page |
| 3 | Top right | Click **New brief** button | New brief form opens |
| 4 | Form: The work | **Title**: Type `Brand Identity & Packaging Refresh for Specialty Coffee Subscription`<br>**Description**: Type `Modernize brand identity and core packaging system for 4000+ monthly DTC subscribers.`<br>**Deliverables**: Type `Brand guidelines` in row 1 → click **Add deliverable** → type `Packaging design system` in row 2 | All fields filled |
| 5 | Form: Budget | **Minimum**: Type `2500`<br>**Maximum**: Type `4000`<br>**Target completion**: Select any future date (e.g. `2026-12-31`) | Budget range set |
| 6 | Bottom right | Click **Save draft** button | Brief detail page opens (`DRAFT` badge) |
| 7 | Page header | Click **Publish brief** button | Status badge flips from `DRAFT` to `OPEN` |
| 8 | Right sidebar | In **Invite a freelancer**, type `freelancer@pactflow.dev` → click **Send invitation** button | Green alert: invitation sent |

---

## PART 2 — Freelancer Quotes with AI & Submits  (~0:30 – 0:55)

### Switch to Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 9 | `/login` | Enter `freelancer@pactflow.dev` / `Password123!` → click **Sign in** | Freelancer Dashboard opens |
| 10 | Left nav | Click **Briefs** | Briefs page |
| 11 | "Invitations to you" | Locate the new brief → click green **Accept** button | Invitation accepted |
| 12 | Brief card / detail | Click **Draft a quotation** (or **Start a quotation**) | Quotation options page |
| 13 | "Draft with AI" card | Click **Generate draft** button | AI reads brief & generates priced line items |
| 14 | Quotation edit page | Review the AI-generated line items and timeline → click **Submit quotation** button | Status badge flips to `SUBMITTED` |

---

## PART 3 — Client Selects Proposal → Engagement  (~0:55 – 1:15)

### Switch to Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 15 | Brief page | Refresh the page → under **Quotations**, click **View** on the submitted quotation | Quotation detail opens |
| 16 | Header actions | Click **Select this proposal** button | Redirects to new **Engagement** page (`DISCOVERY` status) |

---

## PART 4 — Discovery Terms & Discussion  (~1:15 – 1:35)

### Switch to Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 17 | Left nav | Click **Engagements** → click on the new engagement | Engagement page opens |
| 18 | Right sidebar | In **Discovery terms** card, leave as "Unpaid" → click **Save terms** button | Freelancer accepts discovery terms |
| 19 | Discussion card | In **Discovery discussion**, type `Terms accepted, ready to align on requirements.` → click **Post message** button | Message appears with Freelancer badge |

### Switch to Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 20 | Engagement page | In **Discovery discussion**, type `Need milestone-based delivery and PayPal checkout.` → click **Post message** button | Message appears with Client badge |

---

## PART 5 — AI Requirements Draft (BRD) & Resolution  (~1:35 – 2:00)

### Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 21 | Top right header | Click **Requirements** button | Requirements editor opens (`Edit → version 1`) |
| 22 | Top right of card | Click **Draft with AI** button | Live AI generates requirements with source badges |
| 23 | Editor form | Scroll down to **Assumptions** — notice `ASM-1` has `needs confirmation` flag | Sourced AI provenance displayed |
| 24 | Bottom of form | Click **Save as version 1** button | Review page opens with *Pending approval* and blocker notice |

### Switch to Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 25 | Engagement page | Click **Requirements** button | Requirements review page opens |
| 26 | Header actions | Click **Propose changes** button | Requirements editor opens (`Edit → version 2`) |
| 27 | Assumptions section | Check the **Confirm ASM-1** checkbox | Assumption blocker resolved |
| 28 | Bottom of form | Click **Save as version 2** button | Review page opens with zero blockers |
| 29 | Right sidebar | Under Requirements Approval, click **Approve requirements v2** button | Freelancer approval marked green |

### Switch to Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 30 | Requirements page | Refresh page → in right sidebar, click **Approve requirements v2** button | Both approved! Green banner: *"Both of you approved the same version. The SOW can now be generated."* |

---

## PART 6 — SOW → Agreement Activation  (~2:00 – 2:15)

### Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 31 | Requirements page | Click **Review SOW** button | SOW page opens showing requirement trace table |
| 32 | Bottom of page | Click **Submit SOW for approval** button | Redirects to Agreement v1 (`PENDING_APPROVAL`) |
| 33 | Right sidebar | Click **Approve version 1** button | Client approval recorded |

### Switch to Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 34 | Left nav | Click **Agreements** → click on the agreement | Agreement page opens |
| 35 | Right sidebar | Click **Approve version 1** button | Agreement badge immediately flips to **ACTIVE** |

---

## PART 7 — Scope Change with AI Evidence  (~2:15 – 2:30)

### Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 36 | Agreement page | Click **Discussion** tab | Agreement discussion opens |
| 37 | Discussion header | Click **Propose a scope change** button | Scope change form opens |
| 38 | Form | Type `We also need a 3D animated video commercial for Instagram ads.` → click **Submit proposal** button | Proposal submitted |
| 39 | Discussion feed | Look at the proposal card: Note the **Outside scope** AI badge citing the baseline requirements ID | AI provenance & protection demonstrated |

---

## PART 8 — Delivery · PayPal Payment · Freelancer Payout  (~2:30 – 2:50)

### Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 40 | Left nav | Click **Delivery** | Delivery rooms page |
| 41 | View switch | Look at Timeline view → click **Rows** button (or open the active milestone directly) | Active project milestones displayed dynamically |
| 42 | Milestones list | Click on the active milestone (e.g. `Brand guidelines` or line item milestone) | Milestone Delivery Room opens (`PENDING` badge) |
| 43 | Upload card | Click **Choose File** → pick sample `.pdf` → click **Upload PDF** button | PDF uploaded and hashed (`UPLOADED` badge, watermark preview generated) |
| 44 | Actions | Click **Mark delivered** button | Milestone status flips to `DELIVERED` |

### Switch to Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 45 | Left nav | Click **Delivery** → open the same milestone Delivery Room | Milestone detail opens (`DELIVERED` badge) |
| 46 | Review card | Click **Approve work** button | Work approved |
| 47 | Payment card / Header | Click **Approve milestone** button → click **Checkout** button in top header (or **Pay with PayPal**) | PayPal Checkout screen opens |
| 48 | Checkout card | Click **Pay with PayPal** button | Redirects to PayPal Sandbox (or mock approval) |
| 49 | PayPal Sandbox | Log in with sandbox personal account → click **Complete Purchase** / **Pay Now** | Payment processed & redirected back |
| 50 | Return page | PactFlow displays green alert: *"Payment captured — original unlocked"* | Payment captured |
| 51 | Delivery Room | Notice **Freelancer payout** card on the right → shows gross amount, platform fee, and payout status | Automated payout completed |

### Switch to Window: FREELANCER

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 52 | Delivery Room | Refresh milestone page | Right sidebar **Freelancer payout** card displays verified payout |
| 53 | Deliverables | Review confirmed delivery | Deliverable is approved and completed |

---

## PART 9 — Collaboration History & AI Summary  (~2:50 – 3:00)

### Window: CLIENT

| # | Where | Exact Action | Result / Screen |
|---|---|---|---|
| 54 | Left nav | Click **Collaboration** | Collaboration history page |
| 55 | History list | Click on the completed project history card | Project history details open |
| 56 | Top tabs | Click **AI summary** tab | AI-generated working preferences & performance summary displayed |

---

## Top 6 Showcase Moments to Pause on (2 seconds each):
1. **AI Quotation Generation** *(Step 13)* — AI pricing line items from brief.
2. **AI Requirements (BRD)** *(Step 22–23)* — Sourced requirements with `ASM-1` confirmation blocker.
3. **Dual Approval Activation** *(Step 30 & 35)* — Mutual agreement gating before work starts.
4. **AI Scope Protection** *(Step 39)* — Automatic detection of out-of-scope work citing requirement IDs.
5. **Bryntum Gantt Timeline** *(Step 41)* — Interactive milestone delivery roadmap.
6. **PayPal Capture & Instant Payout** *(Step 49–52)* — Client pays via PayPal Sandbox and payout reflects to Freelancer.

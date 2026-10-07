# Staff access to customer organisations — design

**Date:** 2026-10-07. **Status:** agreed in conversation with Marko, spec for review.

Today, ops is view-only. A staff member (an account in `OPS_EMAILS`) can work on a customer's websites only after being added as a member of that customer's organisation. Marko's team configures extractors for customers, so staff need to do the real work inside a customer's organisation, without membership, safely and visibly.

## 1. Decisions (Marko, 2026-10-07)

- **What staff may do:** everything except destructive and organisation-level actions (option 2).
- **Banner:** a visible banner whenever staff work inside a customer's organisation.
- **Log:** every change made as staff is logged. The log is visible to staff in ops **and** to the customer on their Settings page.
- **Mechanism:** approach A. The staff member's own session points at the customer's organisation, with a staff flag. No membership is created and nothing is left behind in the customer's data.

## 2. How it works

### 2.1 The session

- **New columns:** `sessions` gains two nullable columns:
  - `staff_org_id` (uuid, the customer organisation the session entered as staff);
  - `staff_entered_at` (timestamp).
- **Inside a customer org:** while `staff_org_id` is set, the session's organisation is that customer organisation. `resolveOrg` and every org-scoped read and write work unchanged, so staff see exactly what the customer sees.
- **The real organisation is kept:** the session's own `org_id` stays the staff member's own organisation. Leaving clears the two staff columns.
- **Valid only for staff:** a staff session counts only while the user's email is still in `OPS_EMAILS`, checked on every request, and for at most **8 hours** after `staff_entered_at`. When either fails, the request is served as if the staff columns were empty: back in the staff member's own organisation. The app then shows the ops shell.
- **On the request context:** `ctx.session` exposes `staff: { orgId, enteredAt } | null`. The session's `org` is the customer organisation while staff mode is valid.

### 2.2 Entering and leaving

- **`ops.enterOrg({ sourceId })`** (`opsProcedure`): finds the website's organisation, sets `staff_org_id` and `staff_entered_at` on the caller's session, writes the log entry "Started working as staff", and returns the in-app path of the website's Verification tab.
- **`ops.leaveOrg()`:** allowed for any signed-in session in staff mode. It clears the columns and writes "Stopped working as staff". Signing out ends the session as today; that is logged too.
- **In the app:**
  - **Entering:** on the ops website page, "Open in the app" becomes **Work on this website**, enabled for staff whether or not they are members. It opens a confirmation:
    - title "Work on {website} as staff?";
    - body "You'll act inside {customer}'s organisation. Deleting things and managing the organisation are blocked. Everything you change is recorded and shown to {customer}.";
    - buttons **Start working** (primary) and **Cancel**.
  - **The banner:** while inside, every page under the customer shell shows a full-width banner above the top bar, in the warn rail style (a 2 px warn left rail, no wash): "Working as Robot staff in {customer}", with **Back to ops** on the right. The org switcher is hidden. "Switch to customer view" in the ops shell is unchanged; it switches the session's own organisation.
  - **Expiry:** after 8 hours the next request lands back in ops, with a one-time toast "Your staff session in {customer} ended after 8 hours."

### 2.3 What is blocked

These are blocked while working as staff. The server refuses them with `FORBIDDEN` "Not available while working as staff"; the app shows the control disabled, with that sentence as its tooltip.

- **Organisation:**
  - `orgs.rename`, `orgs.delete`;
  - every `orgs.members.*` mutation;
  - creating or switching organisations (`orgs.create`, `orgs.switch` or equivalents).
- **Deletions:** `projects.delete`, `sources.delete` and `datasets.deleteField`, plus `datasets.deleteAxis` (a column delete).
- **Identity changes** on the staff member's own account are allowed, since it's their account (`auth.updateName`, `auth.setTheme`).

The list lives in one module (`packages/api/src/auth/staff-guard.ts`) as procedure paths, checked by one middleware on every procedure. A procedure not on the list is allowed. A test fails if any listed path doesn't exist, so the list can't rot silently.

### 2.4 The staff activity log

- **New table `staff_actions`:**
  - `id`;
  - `org_id`: the customer organisation;
  - `user_id`: the staff member;
  - `at`;
  - `action`: the procedure path;
  - `summary`: a plain sentence;
  - `project_id` and `source_id`, both nullable;
  - `run_id`, nullable, for anything that starts or plans a run.

  It is append-only: there is no update or delete procedure. Rows go away only when the organisation is deleted (cascade). Deleting the staff member's user keeps their rows, with `user_id` set null and their email kept in an `actor_email` column.
- **What writes it:** one middleware writes a row after every successful **mutation** made in staff mode, plus the enter, leave and sign-out events. Queries are never logged.
- **The summary sentence** comes from a table in `packages/api/src/auth/staff-actions.ts` keyed by procedure path, filled from the procedure's input and result. Examples:
  - "Ran an extraction on Nike";
  - "Planned an extraction on Nike (budget 50 products)";
  - "Verified Nike";
  - "Accepted a new location for Price on Nike";
  - "Renamed field Price to Sale price";
  - "Added website Zalando";
  - "Changed Nike's settings".

  An unmapped mutation logs "Made a change on {website or project}" with its path. A test lists every mutation procedure and fails if one is unmapped, so new procedures get a sentence.
- **Cost:** an entry tied to a run shows that run's cost when it's read (from the run's recorded cost), so a finished extraction shows "· $1.24" without the entry being updated.
- **Where it is shown:**
  - **Ops, website page:** a "Staff activity" section with the latest 10 entries for that website, and a link to all.
  - **Ops, Staff activity page:** a new sidebar item under All websites. It's a table of every entry (when, staff member, customer, website, sentence, cost), filterable by customer and staff member, newest first, paginated 50 at a time.
  - **Customer, organisation Settings:** a "Robot staff activity" section listing entries for their organisation only, newest first, 20 at a time, with the columns when, staff member (name and email), website, sentence and cost. It is visible to every member of the organisation and shows "No staff activity yet." when empty.

## 3. Security

- **The real gate is the server.** `ops.enterOrg` requires an operator. A staff session is honoured only while the email is in `OPS_EMAILS` and within 8 hours. The deny-list and the log are middleware on every procedure, never left to individual screens.
- **No customer data is created or kept** by staff access itself: no membership, no role. The log is the only record, and it is shown to the customer.
- **Downloads and screenshots** (the export and `/captures/*` routes) follow the session's organisation, so staff can open them while inside and not after leaving.
- **Signing out** ends staff mode with the session.

## 4. Testing

- **API:**
  - enter, then a project read sees the customer's data;
  - every deny-listed procedure gets FORBIDDEN in staff mode and works for members;
  - an allowed mutation writes one log row with the right sentence;
  - queries write nothing;
  - leaving restores the staff member's own organisation;
  - removing the email from `OPS_EMAILS` or passing 8 hours restores it too;
  - a non-operator cannot enter;
  - the customer sees the entries, and another organisation doesn't;
  - every mutation has a sentence (the coverage test);
  - every deny-list path exists.
- **App:**
  - the banner and Back to ops;
  - the confirmation copy;
  - disabled blocked controls with their tooltip;
  - the expiry toast;
  - the ops Staff activity page and section;
  - the customer Settings list and its empty state.
- **Smoke:** against the running servers with a throwaway identity. A full staff-mode run needs an operator, so it runs on the isolated :4100/:3100 pair with `OPS_EMAILS` set to a throwaway account. That run covers entering, the banner, one allowed edit (rename a website), one blocked action (Delete website disabled), leaving, and the customer's Settings showing both entries. It never clicks Verify or Extract.

## 5. Not in this design

- **Per-customer consent or requests for access:** all operators can enter any customer organisation.
- **Different permission levels among staff.**
- **Email notifications to customers about staff activity.**
- **Read-only staff browsing as a separate mode:** ops covers reading.

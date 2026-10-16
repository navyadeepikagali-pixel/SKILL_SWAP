# Skill Swap

Skill Swap is a MERN application for exchanging technical, academic, creative, wellness, and professional skills. It includes email-verified authentication, a MongoDB-backed skill catalog and tutor discovery, persistent connections and real-time chat, timezone-aware session scheduling, completion-based credit settlement, usage limits and subscriptions, reviews, disputes, and an administrator dashboard.

## Project structure

```text
backend/
  src/
    config/       Environment validation and reusable MongoDB connection
    controllers/  Authentication, profiles, sessions, wallet, reviews, disputes, and admin handlers
    middleware/   Cookie authentication, usage limits, admin authorization, and API errors
    models/       Mongoose domain, catalog, chat, finance, subscription, and audit models
    routes/       Authentication, profile, catalog, session, finance, and admin endpoints
    services/     Authentication, email, chat, session, wallet, usage, and audit operations
    realtime.js   Authenticated Socket.IO events and room authorization
    utils/        Cookie and JSON response helpers
    app.js        Express app factory (also injectable for tests)
    seed.js       Idempotent MongoDB category and skill catalog seed
    server.js     HTTP server startup and graceful shutdown
  test/            MongoDB-backed integration tests
frontend/
  src/
    App.jsx         Landing, auth, profile, catalog, tutor, admin, and chat pages
    api.js          Shared Axios client with cookie credentials
    styles.css      Responsive application styles
    chat.css        Responsive chat and messaging styles
```

## Requirements and install

- Node.js 20 or later and npm
- MongoDB running as a **replica set** (local or Atlas) for transaction-backed account verification and initial credit grants
- For production email verification, an SMTP account or Brevo API account. Local development can use password-only authentication without an email provider.

From the project root:

```bash
npm install
```

Copy `.env.example` to `backend/.env`, then set a MongoDB replica-set URI and a unique random JWT secret (at least 32 characters). `EMAIL_PROVIDER=none` enables password-only authentication without an external email service in development. On Windows PowerShell, use `Copy-Item .env.example backend/.env`. Never commit `backend/.env`.

```dotenv
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/skill_swap?replicaSet=rs0
JWT_SECRET=<at-least-32-random-characters>
CLIENT_URL=http://localhost:5173
EMAIL_PROVIDER=none
```

For optional email OTP in development or production, set `EMAIL_PROVIDER=brevo` and configure a verified sender and Brevo API key, or set `EMAIL_PROVIDER=smtp` and configure:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<your-email-address>
SMTP_PASS=<provider-app-password>
```

For a local replica-set MongoDB, configure `replication.replSetName: rs0` in `mongod.cfg`, restart MongoDB, then initialize once in `mongosh`:

```javascript
rs.initiate()
```

Use MongoDB Atlas by setting `MONGODB_URI` to its replica-set connection string instead. Never expose `.env` values to the frontend or commit the file.

### Email delivery (Brevo or SMTP)

With `EMAIL_PROVIDER=none`, registration and login use email plus password and no emails are sent. Registration grants the standard initial credits in a MongoDB transaction; email is not verified, so use a strong password and only use this mode for local development. Email OTP routes are disabled, and password reset is unavailable without an email provider. `EMAIL_PROVIDER=none` is rejected in production. For email OTP, use `EMAIL_PROVIDER=brevo` with a Brevo API key and verified sender (`BREVO_API_KEY`, `EMAIL_FROM`, optionally `EMAIL_FROM_NAME`), or `EMAIL_PROVIDER=smtp` with SMTP credentials. For Gmail, enable two-step verification and create an App Password; use `smtp.gmail.com`, port `587`, and `SMTP_SECURE=false` (STARTTLS), or port `465` and `SMTP_SECURE=true`. Restart the backend after updating `backend/.env`. The app does not pretend an email was sent or bypass verification when email delivery is enabled and fails. A per-IP request limit protects authentication endpoints. OTPs and reset links are never included in API responses or server logs.

## Run and test

Start the backend and frontend together:

```bash
npm run dev
```

The root development command starts both Node processes directly, without nesting `npm run` commands inside `concurrently`; this avoids Windows `cmd.exe` lookup errors when launching the workspaces. Backend watch mode is scoped to `backend/src` so changes to native dependencies under `node_modules` do not trigger backend restarts.

- React app: http://localhost:5173
- API health check: `GET http://localhost:5000/api/health`
- API: http://localhost:5000/api
- Public catalog: http://localhost:5173/categories
- Chat: http://localhost:5173/chat (requires a verified, signed-in account)

The Vite development server proxies API and Socket.IO traffic to the backend, and both bind for access from other devices on the same local network. Open `http://<computer-lan-ip>:5173` on the other device. Keep the host computer running and allow Node.js through the private-network firewall. Local-network access is for development only; use the production deployment steps for public internet access. For a non-default remote API origin, set `VITE_API_URL` in `frontend/.env.local` to the API URL ending in `/api`; the backend must allow the frontend origin through `CLIENT_URL`.

Seed the default categories and skills after configuring the backend environment and starting MongoDB:

```bash
npm run seed -w backend
```

The seed command is safe to rerun; it upserts categories and skills by their normalized slugs.

Build the frontend with `npm run build`. Run backend tests with `npm test`. The automated auth tests use `mongodb-memory-server` as an isolated one-node replica set and stub the email service; no real SMTP credentials are used in tests.

## Authentication API

Auth endpoints use the consistent JSON envelope:

```json
{ "success": true, "message": "Operation successful", "data": {} }
```

Errors return `{ "success": false, "message": "Safe error message" }` (validation attempts may additionally include a count of remaining OTP attempts).

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Validate details, hash password, persist pending verification, send OTP |
| `POST` | `/api/auth/verify-email` | Consume OTP once, activate account, initialize 100 credits and ledger entry |
| `POST` | `/api/auth/resend-otp` | Resend OTP after the one-minute cooldown |
| `POST` | `/api/auth/login` | Validate credentials and email a one-time sign-in code |
| `POST` | `/api/auth/verify-login-otp` | Consume a sign-in code and issue the HTTP-only authentication cookie |
| `POST` | `/api/auth/resend-login-otp` | Resend a pending sign-in code after the one-minute cooldown |
| `POST` | `/api/auth/logout` | Clear the authentication cookie |
| `GET` | `/api/auth/me` | Return the current user's safe profile (requires cookie) |
| `POST` | `/api/auth/forgot-password` | Request an email reset link without disclosing account existence |
| `POST` | `/api/auth/reset-password` | Consume one-time reset token and change password |

The JWT is held only in an HTTP-only cookie; it is not returned to JavaScript or stored in browser local storage. Production sets the cookie `Secure` flag; `SameSite` defaults to `lax`. Set `AUTH_COOKIE_SAME_SITE=none` only for a cross-site HTTPS deployment. The React client must use `withCredentials` and the server's `CLIENT_URL` must exactly match its origin.

Registration and sign-in codes are cryptographically generated six-digit values, stored only as keyed hashes, expire in five minutes, and are limited to five failed attempts. Every sign-in requires the correct password followed by a fresh email code; the authentication cookie is issued only after the code is verified. The one-minute resend cooldown and rate limits are server-enforced. Successful registration verification creates the user and `signup-grant` ledger row in one MongoDB transaction, so retries cannot duplicate the initial 100 credits. Password reset links contain 32 random bytes, expire in 15 minutes, are stored hashed, and are consumed in a transaction together with the password update.

## Data models

The domain models are implemented under `backend/src/models/`: `User`, `Category`, `Skill`, `SkillSuggestion`, `Post`, `ConnectionRequest`, `Conversation`, `Message`, `Session`, `SessionParticipant`, `CreditTransaction`, `Notification`, `Review`, `Dispute`, `AuditLog`, `UsagePolicy`, `UsageRecord`, `UsageEvent`, `SubscriptionPlan`, `Subscription`, and `PaymentRecord`. `RegistrationOtp`, `LoginOtp`, and `PasswordResetToken` provide separate expiring authentication state. Models define references, timestamps, enums/validation, and relevant indexes. Users are not restricted to either a teacher or learner role; their teaching and learning skills are independent references.

## Phase 3 APIs

All responses use the JSON success/error envelope described above. The catalog is public and read-only for ordinary visitors; profile skills and tutor discovery require the HTTP-only authentication cookie. Admin catalog mutations require an authenticated database user with `accountType: "admin"`.

### Profiles and skill lists

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/me` | Read the authenticated user's profile and completion status |
| `PATCH` | `/api/users/me` | Update whitelisted profile fields |
| `GET` | `/api/users/me/skills` | Read teaching and learning skill lists |
| `PUT` | `/api/users/me/skills` | Replace skill lists with active catalog skill IDs |
| `DELETE` | `/api/users/me/skills/:skillId` | Remove an owned skill from either list |
| `GET` | `/api/users/:id` | Read an active, verified, public profile; private fields are omitted |

Profile updates accept `name`, `profileImage`, `bio`, `location`, `languages`, `interests`, `experienceLevel`, `preferredLearningMode`, `availableTimeSlots`, and `isProfilePublic`. Protected account, email-verification, permission, password, and credit fields are never mass-assigned.

### Categories and skills

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/categories` | List active categories |
| `GET` | `/api/categories/:slug` | Read one active category |
| `GET` | `/api/categories/:slug/skills` | List active skills in that category and active descendants |
| `POST` | `/api/categories` | Admin: create a category |
| `PATCH` | `/api/categories/:id` | Admin: edit name, description, parent, or active state |
| `DELETE` | `/api/categories/:id` | Admin: safely deactivate a category |
| `POST` | `/api/skills` | Admin: create a catalog skill |
| `PATCH` | `/api/skills/:id` | Admin: edit a skill |
| `DELETE` | `/api/skills/:id` | Admin: safely deactivate a skill |
| `POST` | `/api/skills/suggestions` | Authenticated user: suggest a missing skill for review |
| `GET` | `/api/skills/suggestions` | Admin: list pending suggestions |
| `PATCH` | `/api/skills/suggestions/:id` | Admin: approve or reject a suggestion |

Deactivation preserves catalog references and user history. Approved suggestions become regular catalog skills. Public skill creation is intentionally restricted to administrators.

### Tutor discovery

`GET /api/tutors` and `GET /api/tutors/search` accept `q` or `name`, `category` (slug or ID), `skill` or `subject` (slug, name, or ID), `experience`, `language`, `mode`, `dayOfWeek`, `availability`, `minRating`, `maxRating`, `page`, `limit` (1–50), and `sort` (`newest`, `name`, or `rating`). Search defaults to excluding the authenticated user; pass `includeSelf=true` only when self-results are desired. Results only include active, verified accounts with public profiles and include pagination and rating aggregates.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/tutors` | List/filter tutor profiles |
| `GET` | `/api/tutors/search` | Search tutor profiles with the same filters |
| `GET` | `/api/tutors/:id` | Read a public tutor profile and existing reviews |

### Admin access

Provision an administrator through the controlled server-side command described in [Administrator provisioning](#administrator-provisioning). Public registration and profile APIs cannot grant administrator access. Do not promote accounts by directly editing MongoDB.

The React admin catalog page can then create, edit, and deactivate categories and skills, and review skill suggestions. Admin authorization is checked against the database user on each request, not a role supplied by the client.

## Phase 4 connections and chat

All connection and chat REST routes require the existing HTTP-only authentication cookie. Only the learner and intended tutor can access a conversation. A connection is unique per learner, tutor, and selected teaching skill; repeating Connect returns its existing conversation instead of creating duplicates. The conversation and its initial learner-authored introduction are persisted together. Connections remain pending until the tutor accepts or rejects them.

### Connection and conversation API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/connections` | Start or retrieve a connection using `{ "tutorId": "...", "skillId": "..." }` |
| `GET` | `/api/connections` | List the signed-in user's connection requests |
| `PATCH` | `/api/connections/:id/accept` | Accept a pending request as its tutor |
| `PATCH` | `/api/connections/:id/reject` | Decline a pending request as its tutor |
| `GET` | `/api/conversations` | List conversations and per-user unread counts |
| `GET` | `/api/conversations/:conversationId` | Read a conversation as a participant |
| `GET` | `/api/conversations/:conversationId/messages` | Read a message page (`limit` 1–100; pass `before` and `beforeId` for older messages) |
| `POST` | `/api/conversations/:conversationId/messages` | Persist a message using `{ "text": "...", "clientMessageId": "..." }` |
| `PATCH` | `/api/conversations/:conversationId/read` | Mark incoming messages as read |
| `PATCH` | `/api/messages/:messageId` | Edit the caller's own message |
| `DELETE` | `/api/messages/:messageId` | Soft-delete the caller's own message; deleted text is redacted in responses |

Every newly created chat message and its deduplicated `new_message` notification are committed with the conversation unread/activity update in a MongoDB transaction. Notification events are delivered to the recipient's authenticated user room; unread counts are also available in the conversation list. Message sends use a client-generated `clientMessageId` so network retries do not duplicate messages or notifications.

### Socket.IO events

Socket.IO runs on the same Node server and authenticates from the same HTTP-only JWT cookie; browser clients use `withCredentials`. A successful connection automatically joins the user's private notification room. Join a conversation with `conversation:join` before sending or using conversation-scoped events; room access is checked against MongoDB participant membership. Client identity is always derived from the verified cookie, never an event payload.

| Direction | Event | Payload / effect |
| --- | --- | --- |
| Client → server | `conversation:join` | `{ conversationId }`; joins only if the authenticated user is a participant |
| Client → server | `conversation:leave` | `{ conversationId }`; leaves that conversation room |
| Client → server | `message:send` | `{ conversationId, text, clientMessageId }`; persists before broadcast |
| Client → server | `message:read` | `{ conversationId }`; updates read state |
| Client → server | `message:edit`, `message:delete` | `{ messageId, text? }`; owner-authorized persisted changes |
| Client → server | `typing:start`, `typing:stop` | `{ conversationId }`; relayed only to conversation participants |
| Server → client | `message:new`, `message:edit`, `message:delete`, `message:read` | Persisted message/read-state updates |
| Server → client | `notification:new` | Persisted connection or new-message notification, delivered to its recipient |
| Server → client | `connection:new`, `connection:update` | Connection lifecycle changes |
| Server → client | `typing:start`, `typing:stop`, `user:online`, `user:offline` | Conversation-scoped ephemeral typing and best-effort presence |

### Verify the flow locally

1. Start MongoDB as the configured replica set, set `EMAIL_PROVIDER=none` for local password-only auth or configure the selected email provider, run `npm run dev`, then seed the catalog with `npm run seed -w backend`.
2. Register and email-verify two separate accounts. Add a teaching skill to one account and sign in to the other.
3. Find the tutor in tutor search, choose the matching skill, and press **Connect**. The tutor should see a pending request and a persisted introduction in Messages.
4. Sign in as the tutor in a second browser profile, accept or decline the request, and exchange messages. The other account should receive live messages/notifications; offline messages should appear in history and unread counts when it signs back in.
5. Retry a message with the same `clientMessageId` to confirm the API returns the original message rather than creating a duplicate.

The chat tests run as part of `npm test` and use an in-memory MongoDB replica set, including authenticated Socket.IO clients; no real SMTP credentials are used by the tests.

## Remaining phase boundary

Phase 4 adds persistent connections, authenticated real-time direct conversations, message history and management, read/unread tracking, notifications, and presence.

## Phase 5 session scheduling and calendar

Scheduling is available only inside an accepted tutor/learner connection. The tutor proposes a pending session from the conversation's **Schedule session** button; the learner explicitly accepts or rejects it. Date and local start time are converted server-side to a UTC instant using the supplied IANA timezone. The original timezone is retained for display. No chat text is parsed to create a booking.

`SESSION_ALLOWED_DURATIONS` is a comma-separated subset of `30,45,60`. The booking database must support MongoDB transactions (replica set or Atlas). Each proposal/acceptance transaction writes a booking-version field on both participant records in sorted ID order before checking overlapping pending/scheduled intervals. Those writes serialize conflicting booking operations even when they race; transaction write conflicts are retried by the MongoDB driver. The interval check includes tutor and learner, checks start **and** end times, and excludes rejected/cancelled sessions. Proposed times must fit the tutor's weekly availability and avoid private time-off ranges; these checks run both when proposing and accepting. Users' unrelated time-off details are never returned to other participants.

### Session and availability API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Tutor proposes in an accepted conversation; requires `Idempotency-Key` or `idempotencyKey` |
| `GET` | `/api/sessions` | List own sessions; filters: `period`, `status`, `role`, `category`, `skill`, `conversation`, `page`, `limit` |
| `GET` | `/api/sessions/:id` | Read a session as its tutor or learner |
| `PATCH` | `/api/sessions/:id/accept` | Learner accepts; availability and overlaps are revalidated transactionally |
| `PATCH` | `/api/sessions/:id/reject` | Learner rejects a pending proposal |
| `PATCH` | `/api/sessions/:id/cancel` | Participant cancels with `{ "reason": "..." }` before it starts |
| `GET` | `/api/sessions/calendar?from=<ISO>&to=<ISO>` | Retrieve own sessions overlapping the range (maximum 366 days) |
| `PATCH` | `/api/sessions/:id/reschedule` | Propose `{ date, startTime, timezone, durationMinutes }` with an idempotency key |
| `PATCH` | `/api/sessions/:id/reschedule/accept` | Other participant confirms; time is applied only after fresh checks |
| `PATCH` | `/api/sessions/:id/reschedule/reject` | Other participant rejects the proposed time |
| `GET` | `/api/sessions/availability` | Read the signed-in user's own weekly availability and time off |
| `PUT` | `/api/sessions/availability` | Replace own `availableTimeSlots` and `unavailableTimeRanges` |
| `GET` | `/api/notifications` | Retrieve persisted notifications, including while offline |

Availability uses weekly slots (`dayOfWeek`, `startTime`, `endTime`, `timezone`) and private absolute `unavailableTimeRanges` with ISO timestamps carrying an explicit `Z` or offset. Session status is server-controlled: pending → scheduled/rejected/cancelled, and scheduled → cancelled. Passing the scheduled time never marks a session complete. Rescheduling retains the old confirmed time until the other participant confirms. This phase does not create credit transactions or modify balances.

Session proposals and lifecycle updates are persisted with notifications before Socket.IO broadcasts (`session:proposed`, `session:accepted`, `session:rejected`, `session:cancelled`, `session:reschedule-proposed`, `session:reschedule-accept`, `session:reschedule-reject`). Events are restricted to participant conversation/user rooms. The Sessions page supports pending proposals, upcoming/past, status, role and category filters, a calendar, availability editing, cancellation, and mutual rescheduling. Session details are visible only to their participants.

### Verify scheduling with two accounts

1. Configure MongoDB as a replica set and `SESSION_ALLOWED_DURATIONS`, then start the app with `npm run dev`. Email delivery is optional in development.
2. Sign in as the learner, connect with a tutor who has added weekly availability, and wait for the tutor to accept the connection.
3. Sign in as the tutor in a second browser profile, open **Messages**, select the connection, and use **Schedule session**. Submit an available date/time, timezone, duration, mode, and optional notes.
4. Return to the learner account. Its persisted notification, chat session card, and **My sessions** page show the pending proposal. Accept it and verify both users see the confirmed booking. An overlapping competing proposal should return HTTP `409`.
5. Propose a different time from either participant's session card. The confirmed time remains unchanged until the other account confirms. Also test cancellation with a reason.
6. Leave an account offline while a new proposal is sent, then log it back in and check Notifications for the persisted update.

Backend integration tests cover booking authorization, invalid and DST-ambiguous times, notifications and realtime broadcasts, private availability/time-off, overlap and concurrent-proposal protection (including learner overlap), acceptance/rejection/cancellation, mutual rescheduling, calendar access, and unchanged credit balances.

## Remaining phase boundary

Phase 5 provides persistent scheduling proposals, participant confirmation, cancellation, availability, calendars, notifications, and mutual rescheduling.

## Phase 6 completion, credits, and wallet

Credit settlement requires MongoDB transactions; configure a replica set or use Atlas. `SESSION_CREDIT_PRICE` is a server-only positive integer, defaults to `10`, and is snapshotted on each new booking. The browser cannot select the session price, participant identities, or credit amounts. Existing bookings without a price use the configured fallback. One-to-one completion is the only booking kind currently created and settled. Although the model has group-related fields, group bookings are not implemented, so the API rejects group settlement instead of charging only part of a group.

### Completion workflow and APIs

1. After the scheduled end time, the tutor opens session details and chooses **Mark session complete**. This requests the learner's confirmation; it does not by itself settle credits.
2. The intended learner confirms completion or submits a dispute with a reason. Only the learner can perform either action, and a dispute blocks settlement.
3. On learner confirmation, the server atomically debits the learner, credits the tutor, writes both immutable ledger records, updates the session settlement state, and persists notifications. If the learner cannot afford the price, neither balance changes; the completion is still recorded, settlement is marked failed with the required and available amounts, and a new settlement attempt can be made after the learner earns credits.
4. `POST /api/sessions/:id/settle` may retry a failed insufficient-credit settlement, but it cannot bypass the completion checks. Send a fresh `Idempotency-Key` for each deliberate retry. Duplicate/concurrent requests cannot transfer twice.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions/:id/request-completion` | Tutor requests completion confirmation after the session end |
| `GET` | `/api/sessions/:id/completion` | Participant-only completion, confirmation, price, and settlement state |
| `POST` | `/api/sessions/:id/confirm-completion` | Intended learner confirms; triggers settlement |
| `POST` | `/api/sessions/:id/dispute` | Intended learner blocks settlement with a reason |
| `POST` | `/api/sessions/:id/settle` | Participant retries settlement only after valid mutual confirmation |
| `GET` | `/api/wallet` | Own authoritative balance, teaching earned, learning spent, one-time signup grant, adjustments, pending/failed settlements |
| `GET` | `/api/wallet/transactions?page=1&limit=20` | Own paginated immutable credit ledger |
| `GET` | `/api/wallet/transactions/:id` | Own transaction details only |
| `GET` | `/api/admin/settlements?page=1&limit=20` | Admin-only read-only settlement audit |
| `GET` | `/api/admin/settlements/:sessionId/reconciliation` | Admin-only debit/earning reconciliation for a session |

The signup grant remains exactly 100 credits and is granted once in the existing verification transaction. A standard session costs 10 credits: with 100 credits each, the learner ends at 90 and tutor at 110. Session status and settlement status are separate; passing the scheduled time does not complete a session. Completion/settlement notifications are committed in MongoDB before Socket.IO emits `session:completion-requested`, `session:completion-confirmed`, `session:disputed`, `session:settled`, or `session:settlement-failed`. Offline users can retrieve the persisted notifications later.

The ledger records direction, positive amount, balance before/after, counterparty, immutable reference, and linked session. Ledger update/delete operations are rejected. Reconciliation reports discrepancies without altering balances or ledger history; any future correction must be an explicit audited compensating transaction.

### Verify Phase 6 locally

1. Set `SESSION_CREDIT_PRICE=10`, configure the MongoDB replica set as described above, then run `npm run dev`. Email delivery is optional in development.
2. Use two verified accounts with an accepted connection and available booking slot. Create and accept a session, and wait until its scheduled end.
3. As tutor, open **My sessions → session details** and select **Mark session complete**. Check that the learner receives a completion notification.
4. As learner, choose **Confirm completion**. Verify the learner wallet decreases by 10, tutor wallet increases by 10, both see session-linked transactions and settlement notifications, and refresh/retry does not change balances again.
5. For insufficient balance, set the learner balance below the configured price through the administrative/test fixture only: settlement should fail without a partial transfer. Add credits through a valid teaching session, then retry with a new idempotency key.
6. As learner, choose **Raise a dispute** instead of confirming. Verify no ledger entries are created. Cancelled, rejected, unconfirmed, and disputed sessions are not settleable.
7. An administrator can inspect **Settlement audit** and use **Reconcile** to check that session debits equal tutor credits.

The backend suite uses a MongoDB in-memory replica set and tests the 100 → 90 / 100 → 110 example, authorization, insufficient balances, dispute/cancel/unconfirmed rejection, idempotency and concurrent requests, wallet privacy, ledger immutability, notifications, and audit reconciliation. Group settlement is intentionally unavailable until group booking and per-participant completion are implemented.

## Phase 7 usage limits, plans, and subscriptions

Selected discovery actions have server-enforced, persistent quotas. The default policy applies to tutor searches (`GET /api/tutors` and `GET /api/tutors/search`) and new connection requests (`POST /api/connections`); it does not apply to login/logout, recovery, support/safety operations, existing conversations/messages, session management/cancellation, or wallet actions. The default is five uses per action in a UTC-day window and a 12-hour cooldown after the allowance is reached. The allowance resets at the later of the UTC-day boundary and the stored cooldown expiry; rejected requests do not increment usage or extend a cooldown. Users can inspect status/history at `/usage`; admins can configure the supported actions, daily limit, cooldown, and plan catalog at `/admin/usage`.

Clients should send a unique `Idempotency-Key` for every restricted tutor search and connection request. Retries must reuse the same key. The React app does this for searches and connections. The server atomically reserves usage in MongoDB transactions, records the reservation, and compensates it when validation or the underlying action fails. A repeated key does not count twice. Usage records/events and cooldowns persist in MongoDB; the status endpoint reports the authoritative cooldown expiry.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/usage/status` | Authenticated user's plan, per-action allowance/usage, cooldown, and reset status |
| `GET` | `/api/usage/history?page=1&limit=20` | Authenticated user's paginated consumed-action history |
| `GET` | `/api/plans` | Public active plan catalog and provider readiness |
| `GET` | `/api/subscriptions/me` | Own active entitlement, subscription history, and payment history |
| `POST` | `/api/subscriptions/checkout` | Create provider checkout or a clearly marked `demo_unpaid` record; requires an idempotency key |
| `POST` | `/api/subscriptions/cancel` | Cancel an owned active subscription through the configured provider, retaining history |
| `POST` | `/api/subscriptions/webhook` | Public provider webhook; verifies the adapter's signature before applying events |
| `GET`, `PUT` | `/api/admin/usage/policy` | Admin-only usage policy read/update |
| `GET`, `POST`, `PATCH` | `/api/admin/usage/plans` | Admin-only plan listing, creation, and update/deactivation |
| `GET` | `/api/admin/usage/statistics` | Admin-only aggregate usage statistics |
| `GET` | `/api/admin/usage/restrictions` | Admin-only paginated restriction records |

An active paid entitlement is derived from a verified, active `Subscription` and its active plan. Expired records are marked `expired` when entitlement state is next read; cancellation removes access immediately, while the historical subscription and payment remain. Usage limits are separate from the credit ledger and never mutate credit balances. Free access is provisioned idempotently on first plans/status access; paid plans are managed from the admin page and are not embedded as hardcoded frontend prices or entitlements.

No payment processor is configured in this project. In that state the upgrade page labels the action **Demo checkout (no payment)**, writes only a `demo_unpaid` payment record, and does not create a subscription or grant entitlements. To connect a real provider, implement and inject the `paymentProvider` adapter into `createApp` with `name`, `createCheckout({ paymentId, userId, plan, idempotencyKey })`, `verifyWebhook(rawBody, signature)`, and `parseWebhook(rawBody)` methods. `createCheckout` must return a trusted provider reference and HTTPS redirect URL; the adapter must validate the provider's signed raw webhook body and return a provider event containing the matching payment ID/reference and a `paid`, `failed`, or `refunded` state. Optional `cancelSubscription({ providerReference, subscriptionId })` must resolve only after provider confirmation. The API stores no payment-card data, never activates access from a browser redirect, and processes duplicate verified webhook events idempotently. Configure the provider's credentials and signing secret in server environment variables when implementing that adapter; do not put them in frontend configuration or `.env.example` until a concrete integration defines their names.

To verify Phase 7 locally, run `npm run dev`, register and verify a user, then open **Usage & access** and **Upgrade plan**. Use tutor search/connection actions up to the configured allowance and confirm the next action receives HTTP 429 with code `USAGE_LIMIT_REACHED`, the correct cooldown expiry, and the upgrade link. As an administrator, open **Usage admin** to change policy and create/edit/deactivate a plan. With no provider, use the demo checkout and confirm it says no payment occurred, the billing history shows `demo_unpaid`, the plan stays Free, and credits are unchanged. Provider integrations should additionally test signed/invalid webhook payloads, duplicate events, cancellation, and expiry. Run `npm test` and `npm run build` for the automated checks.

## Phase 8 reviews, disputes, admin and audit

Phase 8 reuses `Review`, completed `Session` records, the immutable credit ledger, `Notification`, category management, and the Phase 7 plan/usage settings. New `Dispute` records preserve an append-only status history; `AuditLog` records are immutable and omit credentials and request bodies. Administrators are provisioned out of band; public registration never accepts or assigns an administrator role.

### Administrator provisioning

Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 16 characters), and `ADMIN_NAME` in the ignored backend environment file or a protected deployment secret store, then explicitly run:

```bash
npm run provision-admin -w backend
```

The command creates an active, verified admin with a bcrypt password hash and zero credits. It fails if the email already exists; it will not promote an existing user or overwrite a password. Clear the provisioning secret after use. Admin pages are guarded in React for navigation only; all admin APIs independently enforce the authenticated database account's `accountType: "admin"`.

### Reviews and session history

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/reviews` | Learner submits one 1–5-star review for a completed, learner-confirmed, undisputed session |
| `GET` | `/api/reviews/tutors/:tutorId?page=1&limit=20` | Public tutor review list, average and count |
| `GET` | `/api/reviews/me?page=1&limit=20` | Authenticated user's review history |
| `GET` | `/api/sessions` | Participant-only session history, with personal charged/earned amounts derived from ledger entries |
| `PATCH` | `/api/notifications/:id/read` | Mark an owned notification read |
| `PATCH` | `/api/notifications/read-all` | Mark all of the authenticated user's notifications read |

Reviews cannot be changed or deleted in this phase. A unique `{session, author}` index and a transaction covering the review and tutor notification prevent duplicate reviews and incomplete notification writes. Only the learner can review the tutor for a session, and the API verifies persisted completion/confirmation state. Session status, local scheduled time/timezone, participants, credit ledger activity, and review eligibility are shown in the existing **My sessions** area.

### Disputes, resolution, and ledger safety

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/disputes` | A session participant opens a dispute with reason, description, and optional evidence metadata |
| `GET` | `/api/disputes/me?page=1&limit=20` | Own disputes only; internal notes are excluded |
| `GET` | `/api/disputes/:disputeId` | Own dispute details only; internal notes are excluded |
| `GET` | `/api/admin/disputes?status=OPEN&page=1&limit=20` | Admin queue |
| `GET` | `/api/admin/disputes/:disputeId` | Admin case view with related session, up to 100 conversation messages, and immutable session ledger rows |
| `PATCH` | `/api/admin/disputes/:disputeId/review` | Move an open case to `UNDER_REVIEW` and optionally add an internal note |
| `PATCH` | `/api/admin/disputes/:disputeId/resolve` | Resolve or reject once, with a required summary and optional audited adjustment |

Opening a dispute marks the session disputed and blocks any unsettled completion transfer. It never transfers, freezes, reverses, edits, or deletes credits automatically. An administrator may include an optional participant credit/debit adjustment when deciding the case. The API applies the balance change and creates a new immutable `admin-adjustment` ledger entry in one MongoDB transaction; debits require sufficient balance, an `Idempotency-Key` is mandatory for adjustments, and the dispute can be decided only once. The original settlement records remain unchanged. Dispute notifications are persisted before real-time notification events. Evidence is metadata only—there is no file upload or external evidence storage integration.

### Admin dashboard and audit endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/dashboard` | MongoDB-derived user, session, credit-ledger, review, usage-policy, and plan aggregates |
| `GET` | `/api/admin/users?q=&status=&verified=&page=1&limit=20` | Search/filter paginated accounts |
| `GET` | `/api/admin/users/:userId/sessions?page=1&limit=20` | Authorized administrator view of a user's session history |
| `PATCH` | `/api/admin/users/:userId/status` | Suspend/reactivate with a required reason; cannot alter roles, balances, or delete financial history |
| `GET` | `/api/admin/categories?active=&q=&page=1&limit=20` | List active and inactive MongoDB categories |
| `GET` | `/api/admin/audit-logs?action=&outcome=&page=1&limit=20` | Paginated immutable administrative audit history |

Suspension is enforced by login and authentication middleware, so suspended accounts lose access to protected APIs; their sessions, reviews, credits, subscriptions, and audit history are retained. Role changes and permanent user/ledger deletion are intentionally not exposed. Admin login success/failure for known admin accounts and authenticated authorization denials are logged without passwords or tokens. Admin category mutations, skill changes, usage policy/plan changes, user actions, dispute actions, and settlement audit reads are audited. Audit metadata includes resource/action, outcome, timestamp, HTTP method/status and changed field names, not submitted values.

The **Admin dashboard**, **User management**, **Disputes**, **Audit logs**, **Catalog admin**, **Settlement audit**, and **Usage admin** pages are responsive and use the authenticated API. Existing Phase 7 plan administration remains authoritative; no checkout or payment provider is added by Phase 8. Demo checkout remains explicitly unpaid and does not grant entitlements.

Phase 8 uses the same MongoDB models and replica-set transaction requirement as settlement. No destructive migration is required: Mongoose creates the new `Dispute` and `AuditLog` collections/indexes when first used. After provisioning an administrator, verify regular users receive `403` from `/api/admin/*`, and use a separate verified learner/tutor pair to complete a session, submit a review, open a dispute, inspect it as admin, and resolve it with or without a compensating adjustment. Run `npm test` and `npm run build`.

## Production deployment

The backend can serve the built frontend and API together on one origin, which keeps login cookies and Socket.IO same-origin and supports direct links to app pages. Build and run the included Docker image on a public host with persistent secret management:

```bash
docker build -t skill-swap .
docker run --env-file backend/.env -p 5000:5000 skill-swap
```

Before running a production container, set `NODE_ENV=production` and `MONGODB_URI` to an externally reachable MongoDB replica-set URI in the protected environment. Set `CLIENT_URL` to the public HTTPS origin, or use a platform that provides `RENDER_EXTERNAL_URL`. Keep `JWT_SECRET` and email-provider credentials private. The deployment host must provide HTTPS, persistent MongoDB replica-set storage, backups, and protected environment variables. Do not use the local temporary demo database in production.

### Deploy on Render

The root `render.yaml` defines a single Docker web service that serves the frontend, REST API, and Socket.IO together. To publish it:

1. Push this project to a private GitHub repository, then connect that repository to Render and create a Blueprint from `render.yaml`.
2. Enter the MongoDB Atlas replica-set URI when Render requests `MONGODB_URI`. Keep the database user limited to this application database. Configure Atlas network access for the Render service; use fixed outbound IPs when available, otherwise use a strong, unique database password and restrict the database user's privileges.
3. Render generates `JWT_SECRET` and supplies the public service URL. The backend uses that URL as its allowed origin when `CLIENT_URL` is not separately set.
4. The Blueprint enables password-only accounts because email delivery is intentionally not configured. This means production accounts have no email verification or self-service password recovery. Public registration requires a password of at least 12 characters. Set `ALLOW_PASSWORD_ONLY_AUTH=true` only if this tradeoff is intended; adding a verified email provider is recommended before opening registration publicly.
5. Wait for the `/api/health` check to pass, then open the `onrender.com` URL shown in the Render dashboard. Free web services may sleep when idle and take a little time to wake up.

Do not commit `backend/.env`, database credentials, or API keys. A public deployment requires pushing the application source to the hosting provider; the URL is assigned only after the provider completes the deployment.

1. Provision MongoDB Atlas or a secured MongoDB replica set. Set `MONGODB_URI` to the production connection string; transactions are required for account verification and credit settlement.
2. Configure the backend's protected environment with `NODE_ENV=production`, the platform-assigned `PORT`, the exact public frontend origin in `CLIENT_URL` (HTTPS, no path or trailing slash), a unique `JWT_SECRET` of at least 32 characters, and credentials for the selected email provider. For Brevo, set `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, and a verified `EMAIL_FROM`; for SMTP, set `EMAIL_PROVIDER=smtp` and all four SMTP values. Never add these values to frontend build variables.
3. Deploy the included Docker image and set the backend environment variables in the platform's secret manager, rather than committing an env file. The container listens on the platform-provided `PORT` and serves the frontend, API, and Socket.IO from the same origin. If hosting frontend and backend on separate sites, use HTTPS for both, set `VITE_API_URL` at frontend build time to the backend API origin ending in `/api`, and configure `AUTH_COOKIE_SAME_SITE=none` so the secure HTTP-only cookie can be sent cross-site.
4. Run `npm run seed -w backend` against the configured database if the category/skill catalog is empty. Provision an initial administrator through `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in the protected backend environment using `npm run provision-admin -w backend`; remove those provisioning values after successful creation.
5. Configure the deployment's health check to call `GET /api/health`. Before accepting traffic, run `npm test` and `npm run build`; use the hosting platform's TLS, secret store, database network restrictions, backups, and log-retention controls.

`CLIENT_URL` is validated at backend startup and must be an origin-only HTTPS URL in production. The health endpoint is a liveness check, not a MongoDB readiness check. The application returns safe generic errors for unexpected API failures. Registration/password recovery require a configured email provider; subscription payments are not integrated, and demo checkout never grants paid access. Group sessions and uploaded dispute evidence are not implemented. No frontend test runner or linter is configured in this project; current automated integration coverage is backend-only.

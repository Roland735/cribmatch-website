# Agent Management Deployment Runbook

## 1. Pre-deployment checks

1. Ensure MongoDB backup exists for `users`, `listings`, and `pricingsettings`.
2. Confirm environment variables:
   - `MONGODB_URI`
   - `NEXTAUTH_URL`
   - `APP_BASE_URL` (recommended for WhatsApp internal listing search)
3. Install dependencies:
   - `npm ci`

## 2. Run database migration

1. Execute migration:
   - `node scripts/migrations/20260319-agent-management.mjs`
2. Validate migration:
   - `users.agentProfile` exists for all users.
   - `listings.listerType` exists and is immutable in schema.
   - `pricingsettings.agentPriceDiscountPercent` exists.

## 3. Build and quality gates

1. Run unit tests:
   - `npm run test`
2. Run lint:
   - `npm run lint`
3. Build:
   - `npm run build`

## 4. Post-deploy verification

1. REST checks with Postman:
   - Import `postman/agent-management.postman_collection.json`.
   - Execute all requests in sequence.
2. Web checks:
   - Confirm listing cards show **Agent Listing** or **Direct Landlord**.
   - Confirm listing detail page shows agent fee and price breakdown modal.
3. WhatsApp checks:
   - Submit a search flow.
   - Confirm each result line starts with listing type label and includes agent fee for agent listings.
4. Admin checks:
   - Open `/admin/agents`.
   - Verify pending queue, status updates, and reason capture.

## 5. Rollback strategy

1. Disable agent registration endpoint via route-level feature flag if needed.
2. Restore MongoDB backup for affected collections.
3. Revert deployment to previous app version.
4. Re-run smoke tests on `/listings`, `/admin`, and WhatsApp webhook flow.

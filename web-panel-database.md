# Shared Firestore database: who owns the rules

The app and the web admin panel share one Firebase project (`nutrade-a25c7`) **and one
Firestore database, `(default)`**. A Firestore database has exactly one set of security
rules, so a `firebase deploy --only firestore:rules` from either repo replaces whatever the
other side deployed.

Splitting the panel into its own `web` database was considered and **rejected** - the panel
reads app data (listings, users, payments, transactions, payouts) on nearly every screen,
and a second database cannot see across to `(default)`.

Instead, the rules have a single owner.

| | App repo | Web admin panel (this repo) |
|---|---|---|
| Database | `(default)` | `(default)` - the same one |
| Owns the rules | **yes** - `firestore.rules` | **no** |
| Deploys rules | `firebase deploy --only firestore:rules` | never - cannot |
| Deploys functions | its own codebase | `firebase deploy --only functions:web` |

## Why this repo cannot overwrite the app's rules

`firebase.json` here has **no `firestore` key at all**:

```json
{
  "functions": [
    { "source": "functions", "codebase": "web", "ignore": ["node_modules", "..."] }
  ]
}
```

With no `firestore` entry, `firebase deploy --only firestore:rules` fails with a missing
target instead of silently replacing the app's rules, and a bare `firebase deploy` skips
Firestore entirely.

`firestore.rules` and `firestore.web.rules` are still in the repo but are **dead files** -
nothing references them and nothing can deploy them. They should be deleted; until then,
do not treat either as the live ruleset. The live one lives in the app repo.

**Do not add a `firestore` block to `firebase.json` in this repo.** That is the whole
safeguard. If the panel ever needs a rules change, ask the app repo to make it.

## What the app's ruleset must contain for the panel to work

The app's `firestore.rules` is now the only ruleset, so it has to cover the panel's needs
too. Admin identity is by custom claim (`role == 'admin'` or `admin == true`), granted via
the app's `bootstrapAdmin` endpoint.

### Written by the panel

`admin_security_codes` is the only collection the panel writes:

```
match /admin_security_codes/{codeId} {
  allow read, write: if isAdmin() && request.auth.uid == codeId;
}
```

This record is a **fallback, not the critical path**. `VerifySecurityCodeAsync` in
`Services/FirebaseAuthService.cs` checks the in-memory code first and only falls back to
the Firestore hash, and `saveSecurityCodeHash` swallows its own write failures. A denied
write degrades silently; normal sign-in still works. The record buys resilience across a
page reload, nothing more.

### Read by the panel

All read-only, all requiring admin read. Several are whole-collection listeners, so an
owner-only read rule is not sufficient for the admin case:

| Path | Used by |
|---|---|
| `users` | Users Management, Verifications, uid to email map on the Revenue Desk |
| `listings` | Listing Moderation (active + `pending_approval` listeners) |
| `listings/{id}/bids` | bid history in the listing detail modal |
| `payments` | Dashboard payments ledger |
| `transactions` | Revenue Desk |
| `payoutRequests` | Revenue Desk payout queue |
| `disputes` | Revenue Desk dispute queue |
| `bidIntents` | Revenue Desk forfeited deposits |
| `counters/revenue` | Dashboard revenue counter |

### users: fields the panel reads

`uid`, `email`, `displayName`, `firstName`, `lastName`, `program`, `role`,
`verificationStatus`, `verified`, `photoUrl`, `rejectionReason`, `verificationReason`,
`verifiedAt`, `reviewedBy`, `createdAt`, `submittedAt`, `canPost`, `canBid`, `canChat`,
`emailVerified`.

The panel does **not** read `studentId` or any ID-document field, so tightening
`users` reads to `isAdmin() || isOwner(userId)` costs the panel nothing.

## Writes and dates

- **Approve and reject only through the app's callables**, never a direct write to
  `listings`. `approveListing` / `rejectListing` in `asia-southeast1` set the auction clock
  and feed slot and notify the seller; the app's rules refuse direct writes anyway. See
  `getAppCallable()` in `wwwroot/js/firebaseInterop.js`.
- **Write dates as Firestore Timestamps, not ISO strings.** `saveSecurityCodeHash` uses
  `Timestamp.fromDate()` / `FieldValue.serverTimestamp()`, and `timestampValue` on the REST
  fallback. Reads flatten Timestamps back to ISO in `sanitizeFirestoreData()` because the
  C# layer parses strings - that direction is fine and should stay.

## Cloud Functions: don't reuse the app's names

Function names share one namespace per project and region, so deploying a function with an
app function's name replaces the app's.

This repo exports exactly one function, `sendAdminSecurityCode`, under its own codebase
(`"codebase": "web"`). `approveListing`, `rejectListing`, `createQrPayment` and
`paymongoWebhook` were all removed - the app owns those. PayMongo's dashboard points at the
app's `paymongoWebhook` in `asia-southeast1`.

Deploy from this repo with:

```
firebase deploy --only functions:web
```

## Admin accounts

Admins are recognised by custom claim only - not by email, an `admins` collection, or
`role` on the profile document. Grant the claim once:

```
curl -X POST https://asia-southeast1-nutrade-a25c7.cloudfunctions.net/bootstrapAdmin \
  -H "Content-Type: application/json" -H "X-Bootstrap-Secret: <secret>" \
  -d '{"email":"<admin email>"}'
```

The admin then signs out and back in so their token carries the claim.

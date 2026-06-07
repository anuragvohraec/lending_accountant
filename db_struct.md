# MunimJi Database Structure

Uses PouchDB (IndexedDB) with document ID prefixes for querying. All dates are ISO 8601 (`yyyy-mm-dd`) or ISO datetime (`yyyy-mm-ddTHH:MM:SS.sssZ`) unless noted.

## Document Types

### 1. Party (`party_*`)

```
_id:       "party_" + ts36 + random4          (string, auto)
name:      "Ramesh Kumar"                     (string, required)
phone:     "+91-9876543210"                   (string, optional, default "")
address:   "42, Gandhi Nagar, Delhi"          (string, optional, default "")
identity:  "Aadhar: 1234-5678-9012"           (string, optional, default "")
riskCategory: "low" | "medium" | "high" | "critical"
                                               (string, optional, default "low")
status:    "active" | "closed" | "defaulted"   (string, optional, default "active")
interestRate: 2.5                             (number, optional, default 0)
notes:     "Referral from Suresh"             (string, optional, default "")
createdAt: "2026-01-15T10:30:00.000Z"         (string, ISO, auto on create)
updatedAt: "2026-06-06T09:15:22.123Z"         (string, ISO, set on every save)
```

### 2. Money Source (`money_source_*`)

```
_id:             "money_source_" + ts36 + random4   (string, auto)
name:            "HDFC Current Account"             (string, required)
owner:           "Amit Patel"                      (string, optional, default "")
type:            "cash" | "bank" | "partner" | "other"
                                                    (string, optional, default "cash")
openingBalance:  100000                            (number, optional, default 0)
currentBalance:  85000                             (number, optional, default 0)
status:          "active" | "inactive"             (string, optional, default "active")
notes:           "Joint account with Rajesh"       (string, optional, default "")
createdAt:       "2026-01-01T09:00:00.000Z"        (string, ISO, auto on create)
updatedAt:       "2026-06-06T11:20:33.456Z"        (string, ISO, set on every save)
```

### 3. Transaction (`txn_*`)

Three subtypes sharing the `txn_*` prefix, distinguished by `category` + `type`.

#### 3a. Principal Transaction (debit/credit)

```
_id:        "txn_" + ts36 + random4            (string, auto)
partyId:    "party_l4x2k8f9a1b3"              (string, required)
category:   "principal"                        (string, optional — omitted/"" treated as "principal")
type:       "debit" | "credit"                 (string, required)
amount:     50000                              (number, required, >0)
date:       "2026-06-01"                       (string, ISO date, required)
tags:       "urgent, monthly"                  (string, optional, default "")
notes:      "Loan for shop renovation"         (string, optional, default "")
sourceAllocations: [                           (array, optional, omitted if empty)
  { sourceId: "money_source_abc123", amount: 30000 },
  { sourceId: "money_source_def456", amount: 20000 }
]
createdAt:  "2026-06-01T10:30:00.000Z"        (string, ISO, auto on create)
updatedAt:  "2026-06-06T09:15:22.123Z"        (string, ISO, set on every save)
```

`sourceAllocations[]` element:
```
sourceId:  "money_source_abc123"               (string — money source doc ID)
amount:    30000                               (number — allocated portion)
```

#### 3b. Interest Charge Transaction

```
_id:        "txn_" + ts36 + random4            (string, auto)
partyId:    "party_l4x2k8f9a1b3"              (string, required)
category:   "interest"                         (string, required)
type:       "charge"                           (string, required)
amount:     1250.50                            (number, required, >0)
date:       "2026-06-06"                       (string, ISO date, required)
notes:      "Interest charged from 01/06/26 to 06/06/26"   (string, required)
breakdown:  [ ... ]                            (array of objects, required)
createdAt:  "2026-06-06T10:30:00.000Z"        (string, ISO, auto on create)
updatedAt:  "2026-06-06T10:30:00.000Z"        (string, ISO, set on every save)
```

##### Interest Breakdown Entry

Each element of `breakdown[]`:

```
amount:      416.67                            (number — interest amount for this slice)
date:        "2026-05-15"                      (string, ISO date — transaction group date)
fromDate:    "2026-05-15"                      (string, ISO date — period start)
toDate:      "2026-06-01"                      (string, ISO date — period end)
days:        17                                (number — days in this slice)
outstanding: 50000                             (number — principal outstanding during slice)
debit:       0                                 (number — debit on this date, 0 if none)
credit:      10000                             (number — credit on this date, 0 if none)
```

#### 3c. Interest Payment Transaction

```
_id:        "txn_" + ts36 + random4            (string, auto)
partyId:    "party_l4x2k8f9a1b3"              (string, required)
category:   "interest"                         (string, required)
type:       "payment"                          (string, required)
amount:     1000                               (number, required, >0)
date:       "2026-06-05"                       (string, ISO date, required)
notes:      "Interest payment for May"         (string, optional, default "Interest payment")
createdAt:  "2026-06-05T16:45:00.000Z"        (string, ISO, auto on create)
updatedAt:  "2026-06-05T16:45:00.000Z"        (string, ISO, set on every save)
```

### 4. Source Transaction / Ledger Entry (`srctxn_*`)

```
_id:         "srctxn_" + ts36 + random4         (string, auto)
sourceId:    "money_source_f7g2h3j8k1l4"       (string, required)
type:        "debit" | "credit"                 (string, required)
amount:      25000                              (number, required, >0)
date:        "2026-04-15"                       (string, ISO date, required)
description: "Bank interest charged"            (string, required)
createdAt:   "2026-04-15T14:30:00.000Z"        (string, ISO, auto on create)
```

### 5. Collateral (`collateral_*`)

```
_id:             "collateral_" + ts36 + random4   (string, auto)
partyId:         "party_l4x2k8f9a1b3"            (string, required)
type:            "gold" | "electronics" | "vehicle" | "document" | "other"
                                                  (string, optional, default "other")
description:     "22k Gold Chain 50g"             (string, required)
serialNumber:    "SN-12345-ABCD"                  (string, optional, default "")
weight:          "50g"                            (string, optional, default "")
estimatedValue:  250000                           (number, optional, default 0)
status:          "held" | "released"              (string, optional, default "held")
notes:           "Hallmarked BIS 916"             (string, optional, default "")
dateAdded:       "2026-02-10T11:00:00.000Z"      (string, ISO, auto on create)
lastUpdated:     "2026-06-06T08:45:12.789Z"      (string, ISO, set on every save)
_attachments:    { image: { content_type, data } } (PouchDB attachment, optional)
```

Images are stored as PouchDB attachments (`_attachments.image`) rather than inline base64.
Legacy documents with an inline `image` field (base64 data URL) are auto-migrated on edit.

### 6. Audit Log (`audit_*`)

```
_id:         "audit_" + ts36 + random4           (string, auto)
action:      "create" | "update" | "delete"      (string, required)
entityType:  "party" | "transaction" | "money_source" | "source_transaction" | "collateral"
                                                  (string, required)
entityId:    "party_l4x2k8f9a1b3"               (string, required)
details:     "Created party: Ramesh Kumar"       (string, optional, default "")
timestamp:   "2026-06-06T12:00:00.000Z"         (string, ISO, auto)
```

### 7. App Settings (single doc, `app_settings`)

```
_id:                "app_settings"                   (string, fixed)
pin:                "1234"                          (string, optional, default "")
webauthnCredentialId: "MJG8LzNj..." | null          (string/null, optional, default null)
webauthnRpId:       "localhost" | null               (string/null, optional, default null)
backupReminder:     true                             (boolean, optional, default true)
lastBackup:         "2026-06-01T00:00:00.000Z" | null (string/null, optional, default null)
couchUrl:           "http://192.168.1.100:5984/munimji"
                                                    (string, optional, stored only when configured)
couchUsername:      "admin"                          (string, optional)
couchPassword:      "secret123"                      (string, optional)
```

CouchDB fields (`couchUrl`, `couchUsername`, `couchPassword`) are only present after the user configures sync in Settings.

---

## ID Prefix Summary

| Prefix | Document Type | Saved By |
|---|---|---|
| `party_` | Party | `database.js:saveParty` |
| `money_source_` | Money Source | `database.js:saveMoneySource` |
| `txn_` | Transaction (all 3 subtypes) | `database.js:saveTransaction` |
| `srctxn_` | Source Transaction | `database.js:saveSourceTransaction` |
| `collateral_` | Collateral | `database.js:saveCollateral` |
| `audit_` | Audit Log | `database.js:addAuditLog` (via `audit.js:logAction`) |
| `app_settings` | Settings (single doc) | `database.js:saveSettings` |

## Category Convention

Transactions use `category` to distinguish types for aggregation:

- **`undefined` / `""` / `"principal"`** — Principal debit/credit transactions (money lent or returned). Backward-compatible: old records without `category` are treated as principal.
- **`"interest"`** — Interest charges (`type: "charge"`) and payments (`type: "payment"`).

## Notes

- All monetary values are stored as regular JavaScript numbers (IEEE 754 double). Visual rounding to nearest rupee is done only in display helpers (`formatCurrency`, `formatCurrencyFull`); the database retains full decimal precision.
- `sourceAllocations` on principal transactions links the amount to specific money sources. The sum of allocations may differ from `amount` if the user manually overrides the amount field.
- Interest is calculated as `outstanding × rate × days / 3000` where `rate` is percent per month.

Create a fully offline-first Progressive Web App (PWA) for a small lending and finance business.
The app is targetted for mobile devices and must work reliably without internet connectivity. Use bright VIBGYOR colors, use bright theme rather than dark.Use catchy relevant vectors arts as background.
The application should focus heavily on speed, simplicity, trustworthiness, local data storage, and ease of use for non-technical users.

Core Product Goal

The app manages:

Money sources/accounts from where loan money is issued
Lending accounts for parties/customers
Debit/Credit transactions
Interest calculations
Security/collateral management
Analytics/dashboard
Fast search and account history

The UI should feel like a professional finance ledger system mixed with a modern offline accounting app.

Technical Requirements
Build as a Progressive Web App (PWA)
Must work fully offline
No backend/server required initially
Store all data locally on device
Use IndexedDB for storage, use PouchDB so that we can synch it later with a remote CouchDB.
Use service workers for offline caching
App should install on desktop/mobile
Fast startup and instant navigation
Optimized for low-end devices too
Responsive design
Data export/import backup support (JSON or encrypted backup)
Future-ready architecture so cloud sync can later be added
Suggested Stack

You may choose modern technologies suitable for offline PWAs:

Modern Javascript ES6 or newer
IndexedDB based,use PouchDB so that we can synch it later with a remote CouchDB.
Service Worker
Tailwind for UI
Charts library for analytics


Main Modules
1. Money Source Management

Create a module to manage money sources/accounts.

Each money source should contain:

Account/source name
Partner/person owner
Account type
Cash
Bank account
Partner account
Other
Opening balance
Current balance
Notes
Active/inactive status

Features:

Add/Edit/Delete money source
Ledger view for each source
Transaction history
Current available balance
Ability to know how much money from this source is currently lent outside
Search/filter/sort sources

2. Lending Party Accounts
Create customer/party lending accounts.

Each party account should contain:

Full name
Phone number
Address
Identity details
Notes
Risk category
Created date
Status (active/closed/defaulted)

Features:

Open account
Search accounts instantly
View complete account timeline
Ledger style transaction view
Notes on every transaction
Filter by active accounts
Fast account opening workflow
3. Debit/Credit Transactions

Each party can have multiple debit and credit transactions over time.

Debit = Money given to party
Credit = Money returned by party

Each transaction should contain:

Date and time
Amount
Transaction type
Notes
Money source used
Interest applicable
Supporting photo/document if needed

Features:

Running balance calculation
Undo/edit transaction
Chronological timeline
Smart validation
Transaction tagging
Partial repayments
Multi-source lending support

Important:
If loan money was given from multiple money sources, repayment tracking must maintain how much amount belongs to which source.

Example:

₹20,000 from Cash
₹30,000 from Partner A account

Then repayment summary should show:

Remaining due against Cash source
Remaining due against Partner A source
4. Interest Calculation Engine

Implement a flexible interest engine.

Requirements:

Interest rate configurable per account
Interest calculated by date range
Support monthly percentage interest
Support custom calculation date
Accurate running interest calculation
Show:
Principal
Interest accumulated
Total payable
Paid amount
Remaining amount

Features:

Recalculate historical interest
Interest breakdown timeline
Interest preview before transaction save
Support changing interest rate over time if needed

The calculation system should be modular and future extensible.

5. Security / Collateral Management

Each party may provide one or multiple securities/collateral items.

Security examples:

Gold items
Electronics
Vehicles
Documents
Other valuables

Each security item should contain:

Photos
Serial number
Description
Weight/quantity
Estimated value
Date added
Notes
Status
Held
Partially released
Released

Features:

Add multiple securities over time
Release securities gradually
Track remaining collateral value
View all security items linked to account
Photo gallery
Camera upload support
Security history timeline

Important dashboard info:
When opening an account, user should instantly see:

Total money lent
Total due
Remaining security value
Loan-to-security ratio
6. Dashboard & Analytics

Create a finance dashboard.

Dashboard should show:

Total money lent
Total outstanding
Total interest earned
Overdue accounts
Recent transactions
Money source balances
Active loans
High-risk accounts
Security value totals

Analytics:

Monthly lending trends
Repayment trends
Interest income graphs
Source-wise distribution
Party-wise outstanding
Cash flow analytics

Use charts and summary cards.

7. Search & Productivity

Implement extremely fast search.

Search should work for:

Party name
Phone number
Account ID
Security serial number
Notes
Transaction notes

Features:

Instant search
Fuzzy matching
Keyboard shortcuts
Recent accounts
Quick actions
Global search bar
Smart filters
8. UX/UI Requirements

Design philosophy:

Fast finance workflow
Minimal clicks
Ledger-first UX
Clean typography
Large readable numbers
Trustworthy professional appearance

UI Ideas:

Dashboard homepage
Sidebar navigation
Ledger tables
Expandable account cards
Transaction timeline
Security gallery
Mobile-friendly forms
Floating quick-add button

Important:
The app should feel usable even by someone who is not tech-savvy.

9. Data Safety Features

Because this app stores sensitive finance data, implement:

Local encryption support
PIN lock / app lock
Auto backup reminders
Export/import backups
Soft delete with recovery
Audit logs
Data integrity checks
10. Future Extensibility

Structure the codebase so future features can be added:

Cloud sync
Multi-user support
GST/accounting
SMS reminders
PDF receipts
WhatsApp integration
Interest automation
Barcode/QR support
Multi-device sync

Use clean architecture and modular services.

Deliverables Expected

Generate:

Complete frontend architecture
IndexedDB schema
Component hierarchy
State management design
PWA setup
UI screens
Database models
Interest calculation engine design
Offline sync strategy
Folder structure
Reusable components
Clean scalable codebase

The final app should feel like a professional offline finance management system specifically designed for secured lending businesses.

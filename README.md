# Nanogramics POS

Nanogramics POS is a desktop point-of-sale and business-management application built for day-to-day retail operations. It is developed by [Nanogramics](https://nanogramics.tech) and is currently used by Lajpal Brand Hub. The application is designed to keep operational workflows local, auditable, and practical for a shop environment; customer-facing receipts retain Lajpal Brand Hub branding where applicable.

> **Current version:** 0.1  
> **Project status:** Active development  
> **Application type:** Windows desktop POS and business-management system

## Contents

- [Overview](#overview)
- [Project status](#project-status)
- [Technology and architecture](#technology-and-architecture)
- [Implemented capabilities](#implemented-capabilities)
- [Operational workflows](#operational-workflows)
- [Roles, permissions, and auditability](#roles-permissions-and-auditability)
- [Data storage](#data-storage)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Development setup](#development-setup)
- [Environment configuration](#environment-configuration)
- [Privacy and security](#privacy-and-security)
- [Backups](#backups)
- [Current limitations](#current-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License and attribution](#license-and-attribution)

## Overview

Nanogramics POS is intended for retail teams that need a local desktop system for sales, stock control, shop and warehouse coordination, user access control, and operational reporting. The Electron shell hosts a browser-based renderer while Node.js services handle the application process, database access, authentication, migrations, reporting, and printing-related operations.

The repository is a development codebase. It does not include live business records, customer data, credentials, or production database files.

## Project status

The repository contains implemented retail workflows and automated tests, alongside active-development areas and visual/branding verification work. Version 0.1 is the documented public project version; the package manifest may contain a separate internal package version used by the build tooling.

### Implemented

- Electron desktop application startup and secure preload bridge.
- Local SQLite database initialization and schema/migration handling.
- User authentication with bcrypt-based password hashing.
- Role- and permission-aware backend handlers.
- Retail sales, online-order, and wholesale billing screens and handlers.
- Product, category, stock, pricing, and inventory workflows.
- Shop/warehouse stock transfers and stock-movement history.
- Returns and exchanges with related adjustment processing.
- Reports, audit records, receipt generation, thermal receipt printing support, and invoice PDF rendering.
- Settings and user-management workflows.
- Light/dark theme support and Lajpal Brand Hub receipt branding where applicable.
- Automated Node.js tests for database, migration, inventory, shop, reporting, receipt, UI, and branding behavior.

### Partially implemented or experimental

- Online-order functionality is present in the application but depends on the configured local workflow and any external service integration available in the deployment environment.
- Backup and restore helpers are implemented, but production backup scheduling, retention, and off-device storage remain deployment responsibilities.
- Some UI and branding verification artifacts are development aids rather than product documentation or release assets.

### Planned or deployment-dependent

- Production-grade distribution, signing, release automation, and update delivery.
- Formal operational documentation, deployment runbooks, and environment-specific integrations.
- A maintained public screenshot set and end-user training material.

## Technology and architecture

| Layer | Technology | Role |
| --- | --- | --- |
| Desktop shell | Electron | Windows desktop runtime and application lifecycle |
| Main process | Node.js/CommonJS | IPC handlers, authorization, database orchestration, reports, and printing/PDF operations |
| Renderer | HTML, CSS, browser JavaScript | POS screens and user interactions |
| Build tooling | Vite | Renderer build pipeline |
| Packaging | electron-builder | Windows packaging and installer generation |
| Database | SQLite via `sqlite3` | Local operational storage |
| Authentication | `bcryptjs` | Password hashing and verification |
| Tests | Node.js test tooling and project test scripts | Regression and behavior checks |

At a high level:

```text
Renderer UI (frontend/) 
        │ preload IPC bridge
        ▼
Electron main process (main.js)
        │ service modules
        ▼
Backend services (backend/)
        │ parameterized queries and migrations
        ▼
Local SQLite database (runtime data, not committed)
```

## Implemented capabilities

- Sales and checkout with product selection, quantities, pricing, totals, and receipt-oriented completion.
- Online-order handling through the application’s online sales workflow.
- Wholesale billing workflow with wholesale-specific sales behavior.
- Product and category management, stock quantities, stock adjustments, and inventory search/filtering.
- Shop and warehouse stock-transfer processing with movement classification and history.
- Return and exchange processing linked to invoice lookup and stock adjustments.
- Operational reports, user-performance views, adjustment reports, invoice PDFs, and thermal receipts.
- Settings, business configuration, user management, permissions, and theme controls.
- Audit logging for important operational and administrative actions.

## Operational workflows

### Offline sales

The renderer submits a completed cart through the preload bridge to authenticated main-process handlers. The backend validates permissions, writes the sale and related stock changes to SQLite, and returns receipt-ready information for the UI and printing/PDF paths.

### Online orders

The online sales module provides a dedicated workflow for entering and processing online orders. It shares product, pricing, stock, authentication, and receipt behavior with the local application. Availability of any external online channel is deployment-dependent and is not assumed by this repository.

### Wholesale billing

The wholesale module provides a separate billing workflow for wholesale transactions while using the same local application services and inventory safeguards.

### Inventory and stock management

Inventory workflows cover products, categories, quantities, stock adjustments, searchable inventory views, and related reporting. Schema upgrades are additive and are applied through the backend migration logic.

### Shop and warehouse transfers

The shop workflow supports transfers between warehouse and shop locations and records stock movement history. The repository documentation identifies movement classes including `warehouse_to_shop` and `shop_to_warehouse`.

### Returns and exchanges

Returns and exchanges support invoice lookup, item/quantity validation, adjustment processing, and related reporting. The backend keeps these operations permission-controlled and transactional where applicable.

### Reports, receipts, and invoices

The application includes operational reporting, adjustment reports, audit views, thermal receipt generation/printing support, and invoice PDF rendering. Generated PDFs, receipts, reports, and runtime exports are deployment artifacts and must not be committed to the repository.

## Roles, permissions, and auditability

Authentication is handled through the local user store. Passwords are hashed with `bcryptjs`; plaintext passwords are not part of the intended storage model. Backend handlers enforce authenticated sessions and permission checks for protected operations. The application also records audit events for relevant actions, providing an operational history for review.

Administrators should define least-privilege roles and avoid sharing accounts. The exact permission set should be reviewed in the Settings and user-management screens of the deployed version.

## Data storage

Operational data is stored locally in SQLite. The database implementation creates and migrates application tables at runtime, and the repository includes migration code rather than a live database. Database files, WAL/SHM files, backups, and business records are intentionally excluded from version control.

Do not copy a production database into an issue, pull request, public artifact, or source repository. Use anonymized fixtures or temporary test databases for development.

## Repository structure

```text
.
├── backend/                 Main-process services, database, migrations, reports, and tests
├── frontend/                Renderer HTML, CSS, JavaScript, and renderer tests
├── build/                   Required application icon assets
├── main.js                  Electron main-process entry point and IPC handlers
├── preload.js               Renderer/main-process IPC bridge
├── vite.config.js           Vite renderer configuration
├── package.json             Dependencies, scripts, and packaging configuration
├── package-lock.json        Locked dependency tree
├── BRANDING-VERIFICATION.md Branding verification notes
└── UI-AUDIT.md              UI review notes
```

Generated directories such as `node_modules/`, `dist/`, `tmp/`, and runtime database files are local-only artifacts and are excluded by `.gitignore`.

## Requirements

- Windows development environment suitable for Electron 29 and electron-builder.
- Node.js and npm versions compatible with the dependency lockfile.
- Sufficient local permissions to install native npm dependencies used by SQLite.
- A writable runtime data location for the local SQLite database and generated operational files.

## Development setup

From the repository root:

```bash
npm install
npm run dev
```

Available project commands:

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Electron application |
| `npm run dev` | Start Electron in development mode |
| `npm run build:renderer` | Build the renderer with Vite |
| `npm test` | Run tests when a test script is configured in the checked-out package manifest |
| `npm run build` | Build the renderer and package a Windows application |
| `npm run build-win` | Build the renderer and package a Windows application |
| `npm run dist` | Build the renderer and create the Windows distribution |

If `npm test` is not present in the package manifest, run the repository’s test files with the Node.js test runner after reviewing the checked-out scripts and test requirements. Do not use production data for tests.

## Environment configuration

This application is primarily local and should not require secrets for its core desktop workflow. If a deployment adds an integration that requires environment variables, create a local `.env` file from placeholders and keep it untracked:

```dotenv
# Example placeholders only — do not commit real values
INTEGRATION_API_URL=https://example.invalid/api
INTEGRATION_API_KEY=replace-with-local-secret
```

Never commit `.env`, passwords, API keys, tokens, private keys, or database connection credentials. The example values above are not working credentials.

## Privacy and security

- Treat SQLite files and generated reports as confidential business data.
- Do not commit customer, employee, supplier, inventory, order, or sales records.
- Use strong, unique user passwords and least-privilege permissions.
- Keep the operating system, Node.js runtime, Electron, and npm dependencies updated according to the deployment policy.
- Review external integrations before enabling them and limit their credentials to the minimum required scope.
- Do not publish screenshots, logs, invoices, receipts, or exports containing personal or business information.
- Review changes for secrets before committing and inspect the staged file list before every push.

## Backups

Use the application’s backup/restore helpers where appropriate, but also maintain an independently stored backup policy for production data. Backups should be encrypted, access-controlled, tested through periodic restoration, and retained according to the business’s requirements. Keep backup files outside the Git repository.

## Current limitations

- This is an active-development desktop application; release stability and packaging should be validated for each deployment.
- The repository does not provide a hosted multi-tenant backend or a guaranteed external online-order service.
- Production code signing, update distribution, monitoring, and formal release automation are deployment concerns.
- Runtime data is local SQLite data; multi-device synchronization and centralized administration are not established by this repository.
- The package manifest does not currently define a dedicated `npm test` script, so test execution should follow the checked-out test files and project tooling.

## Roadmap

The evidence in the repository supports the following maintenance priorities:

1. Add a documented, repeatable test command to the package scripts.
2. Formalize release packaging, signing, update delivery, and version management.
3. Document deployment-specific online integrations without placing credentials in the repository.
4. Add end-user and administrator operating documentation.
5. Establish a maintained, privacy-reviewed screenshot and demonstration set.
6. Strengthen backup verification, retention, and recovery runbooks.

These are development priorities, not promises of currently available functionality.

## Contributing

1. Create a focused branch for the change.
2. Review the relevant backend, frontend, migration, and test code before editing.
3. Add or update tests for behavior changes.
4. Keep customer data, databases, credentials, generated files, and local configuration out of commits.
5. Update this README in the same task when architecture, setup, dependencies, modules, requirements, or implemented behavior materially changes.
6. Review `git status`, the complete diff, and the staged file list before committing.

## License and attribution

The package metadata identifies the project as `PROPRIETARY`. No open-source license is claimed here. Use, redistribution, and commercial rights should be confirmed with the project owner.

<h2 align="center">Nanogramics POS Screenshots</h2>

<p align="center">
  <img
    src="https://drive.google.com/thumbnail?id=1LQEe4XsN66FOHOP06i6KpgJG4Iz9iL7w&sz=w1200"
    alt="Nanogramics POS Screenshot 1"
    width="850"
  />
</p>

<p align="center">
  <img
    src="https://drive.google.com/thumbnail?id=1fMixHWsXewuwDNtP3Kq_vJuYEZALe7Ot&sz=w1200"
    alt="Nanogramics POS Screenshot 2"
    width="850"
  />
</p>

<p align="center">
  <img
    src="https://drive.google.com/thumbnail?id=19MNFsK9dSBGKWUe_nAY7s3a8jg1YZZ5W&sz=w1200"
    alt="Nanogramics POS Screenshot 3"
    width="850"
  />
</p>

<p align="center">
  <img
    src="https://drive.google.com/thumbnail?id=1gxdM8XlVWuzWE1sd_Xamv5clG2SCZwQr&sz=w1200"
    alt="Nanogramics POS Screenshot 4"
    width="850"
  />
</p>

<p align="center">
  <img
    src="https://drive.google.com/thumbnail?id=1VwUKIZyWP5aZDPnryQEvKLyG6ZG7BCLi&sz=w1200"
    alt="Nanogramics POS Screenshot 5"
    width="850"
  />
</p>

Developed by **Nanogramics**  
Website: [nanogramics.tech](https://nanogramics.tech)  
Current business deployment: **Lajpal Brand Hub**

---

© Nanogramics. Nanogramics POS is developed for business operations and is subject to the applicable proprietary terms and deployment agreements.

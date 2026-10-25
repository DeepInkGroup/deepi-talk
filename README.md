# Deepi Talk

A minimal one-to-one messenger. Every user receives a permanent, server-generated ID with two uppercase letters and six digits, such as `TN123456`. People find each other by ID and chat. IDs cannot be chosen or changed.

Built with React, Vinext, and Cloudflare D1. Sites supplies ChatGPT sign-in. Every chat read and write checks the signed-in participant. Profiles, messages, and personal saved messages persist in D1; drafts stay in the current browser tab. Conversations refresh every six seconds and the open chat refreshes every three seconds.

- **Saved Messages:** a private space for notes and bookmarked messages. Use the bookmark next to a chat message, or write directly in Saved Messages. Removing a saved copy leaves the original chat message intact.
- **Profile:** edit your display name and optional bio, view your permanent ID, and copy it. Other people can view your name, ID, and bio from a conversation.
- **Permanent IDs:** generated with cryptographic randomness, checked for uniqueness, and protected by the API and database triggers. Earlier custom handles are converted once when their owner next opens the app; conversations remain intact.

## Development

Use Node 24 or newer. A self-contained local preview is available with:

```sh
npm install
npm run preview:local
```

Open `http://127.0.0.1:5173`. This preview bundles the real React component and runs the real API handlers against persistent local SQLite. It uses the starter's simulated ChatGPT sign-in for one local account. Its database lives in the ignored `.sites-runtime/preview.sqlite` file and is separate from hosted D1. The preview listens only on loopback and is for development.

For the full Cloudflare preview, run `npm run build`, apply the schema once, then run `npm run dev`:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_messenger.sql
npm run dev
```

The local SQLite preview applies pending migrations automatically, preserving existing messages. For a full Cloudflare preview, apply all unapplied SQL files from `drizzle/` in journal order using the Wrangler command above. Do not replay an applied migration. Hosted Sites provision the D1 binding declared in `.openai/hosting.json` and apply migrations at publication. Publish through Sites to use real ChatGPT identities across devices. No hosted deployment is live yet.

`npm run check:chat` checks the production route handlers against isolated SQLite storage, including ID generation, collision retries, permanent IDs, legacy conversion, profiles, two-user messaging, third-user isolation, saved notes, bookmarks, and history pagination. `node node_modules/typescript/bin/tsc --noEmit` checks types. Both passed. The local page, JavaScript, styles, and simulated sign-in were verified over HTTP; browser visual checks and the full Cloudflare build remain unverified in this session.

New Sites are private by default. Other people need access to the Site before they can register and message. The app also supports authenticated users when the owner changes Site sharing.

# Deepi Talk

A minimal one-to-one messenger. Every user receives a permanent, server-generated ID with two uppercase letters and six digits, such as `TN123456`. People find each other by ID and chat. IDs cannot be chosen or changed.

Built with React, Vinext, and Cloudflare D1. Sites supplies ChatGPT sign-in. Every chat read and write checks the signed-in participant. Profiles, messages, and personal saved messages persist in D1; drafts stay in the current browser tab. Conversations refresh every six seconds and the open chat refreshes every three seconds.

- **Saved Messages:** a private space for notes and bookmarked messages. Use the bookmark next to a chat message, or write directly in Saved Messages. Removing a saved copy leaves the original chat message intact.
- **Profile:** edit your display name and optional bio, view your permanent ID, and copy it. Other people can view your name, ID, and bio from a conversation.
- **File and image sharing:** attach a file, drop it into a chat, or paste an image. Add an optional caption. Supported images appear in the chat with a larger preview; other files download. Each file can be up to 10 MB. Attachments also work in Saved Messages.
- **Profile photos:** choose a JPG, PNG, or WebP photo in your profile. It is cropped to a square and resized to at most 512 pixels before upload. Use Save changes to apply it, or Remove to return to your initial. Uploaded avatar files are limited to 2 MB; source photos can be up to 10 MB before resizing.
- **Emojis:** use the smile button to insert an emoji at the cursor, or paste any Unicode emoji into a message.
- **Editing:** edit your own messages and attachment captions with the pencil button. Recipients see an edited marker. Private notes can be edited too; bookmarked copies remain snapshots.
- **Image download locks:** lock downloads before sending an image, or change the lock with the lock icon later. Recipients can still view the image, but download buttons and the download endpoint enforce the sender's setting. Screenshots, developer tools, and previously downloaded copies cannot be prevented.
- **Consistent emoji artwork:** the picker and message text use Twemoji artwork, with native Unicode as a loading fallback. Attribution is in `THIRD_PARTY_NOTICES.md`. This is a replacement emoji set, not Apple's exact artwork.
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

The media migration adds file metadata and nullable attachment/photo references without rewriting existing messages. Hosted files use the `BUCKET` R2 binding. Local files persist in the ignored `.sites-runtime/uploads/` directory alongside the preview database. Downloads require sign-in and check ownership, conversation membership, or a private saved copy. Profile photos are visible to signed-in users while attached to a profile. File types are detected from image signatures; other content is served as an attachment with MIME sniffing disabled. Upload sizes are enforced while reading the request stream.

`npm run check:chat` checks the production route handlers against isolated SQLite and object storage. It covers ID generation, collision retries, permanent IDs, legacy conversion, profiles, two-user messaging, third-user isolation, saved notes, bookmarks, history pagination, file bytes, MIME handling, upload limits, photo ownership/removal, saved attachments, and emoji round trips. `node node_modules/typescript/bin/tsc --noEmit` checks types. The local page, browser bundle, styles, sign-in, and upload/download API were verified over HTTP. Browser visual checks and the full Cloudflare build remain unverified in this session.

New Sites are private by default. Other people need access to the Site before they can register and message. The app also supports authenticated users when the owner changes Site sharing.

## GitHub, Render, and GitHub Pages

See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact Git commands and deployment steps. `render.yaml` configures a live Node 24 service with persistent storage and real account/session authentication. `npm run build:render` builds the frontend, and `npm run start:render` starts the production adapter. `npm run check:render` verifies real two-user HTTP behavior and persistence across restarts.

The GitHub Pages workflow deploys a launch page pointing to the Render app; set the repository variable `APP_URL` to the real HTTPS Render URL first. Pages does not run the chat API. Local preview records are separate from the Render database and are never pushed to Git.

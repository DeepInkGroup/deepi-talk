# Update GitHub and deploy Deepi Talk

Render runs the live messenger, including accounts, messages, and uploads. GitHub Pages serves a small launch page that sends visitors to the live Render URL. GitHub Pages cannot run a database or the messaging API.

## 1. Push the changes

Open PowerShell on your computer:

```powershell
cd "U:\Apps\Deepi Talk\deepi-talk"
npm run check:chat
npm run build:render
npm run check:render
git status
git add .
git commit -m "Add message editing, image download locks, emoji artwork, and Render deployment"
git push origin main
```

Your remote is `https://github.com/DeepInkGroup/deepi-talk.git`. The database, uploaded files, passwords, sessions, and local runtime state are excluded from Git. Review `git status` before committing. If this session still cannot reach GitHub, run the Git commands in your own PowerShell window.

## 2. Create the Render service

1. Open [Render](https://dashboard.render.com/), choose **New > Blueprint**, and connect `DeepInkGroup/deepi-talk`.
2. Render reads the included `render.yaml`. Review and apply the configuration in Render. It uses a paid Starter web service and a 1 GB persistent disk. No service or billing change is made by editing this repository.
3. Wait for the deployment and health check to succeed. Open the actual `https://...onrender.com` URL shown by Render.
4. Create an account with an email and password, then choose your display name. Your public ID is assigned automatically. Another person can register and find you by that ID.

For manual **New > Web Service** setup, use:

| Setting | Value |
| --- | --- |
| Repository | `DeepInkGroup/deepi-talk` |
| Branch | `main` |
| Root directory | Leave blank |
| Runtime | Node, version 24 |
| Build command | `npm ci --include=dev && npm run build:render` |
| Start command | `npm run start:render` |
| Health check path | `/healthz` |
| Environment variable | `DATA_DIR=/var/data/deepi` |
| Persistent disk mount | `/var/data`, at least 1 GB |

The server binds to `0.0.0.0` and Render's `PORT`. It uses `RENDER_EXTERNAL_URL` as its public origin. For a custom domain, set `APP_ORIGIN` to that exact HTTPS origin, with no trailing path, for example `https://talk.example.com`.

The Render adapter uses real email/password accounts and HTTP-only sessions. Passwords are salted and hashed with scrypt; only hashed session tokens are stored. It ignores incoming Sites identity headers. The original Sites/Cloudflare deployment keeps its own ChatGPT sign-in integration. Local preview still uses its development identity.

The Render account email is an unverified login identifier. Email verification and password-reset email delivery are not included. Use one service instance with the attached disk; SQLite and uploads are stored under `DATA_DIR`. Keep database-consistent backups and copies of uploaded files. A free service without persistent storage is unsuitable for keeping this app's accounts, messages, and photos across restarts or deployments.

Reference: [Render web services](https://render.com/docs/web-services), [persistent disks](https://render.com/docs/disks), [environment variables](https://render.com/docs/environment-variables).

## 3. Create the GitHub Pages launch page

After Render is live:

1. Open the GitHub repository's **Settings > Secrets and variables > Actions > Variables**.
2. Add a repository variable named **`APP_URL`** whose value is the actual HTTPS URL of the Render app. This URL is public configuration, not a secret.
3. Open **Settings > Pages** and set **Build and deployment > Source** to **GitHub Actions**.
4. Open **Actions > Deploy GitHub Pages > Run workflow**, choose `main`, and run it. Future pushes to `main` rebuild the page automatically.
5. When deployment succeeds, use the URL returned by the Pages deployment. For this repository, the default project-site URL is expected to be `https://deepinkgroup.github.io/deepi-talk/`. It is not live until the deployment succeeds.

The workflow fails with a clear setup message if `APP_URL` is missing. The resulting page redirects visitors to the Render app and retains an Open messenger link for browsers with JavaScript disabled. Sign-in stays on Render, avoiding third-party-cookie issues between GitHub Pages and Render.

Private-repository Pages availability depends on your GitHub plan. If Pages is unavailable, use a plan that supports it or deliberately change repository visibility after reviewing its contents. The workflow does not change repository visibility.

Reference: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Feature behavior

- Senders can edit their own message text and image captions. Recipients see an edited marker. Creation time and unread ordering stay unchanged. Private notes can be edited; saved copies of someone else's message remain snapshots.
- For an image, use **Lock image downloads** before sending, or use the lock icon on an image you sent. Recipients can view it, but the app hides download controls and the download API rejects their requests, including requests through Saved Messages. The sender retains download access. Viewing an image necessarily delivers image bytes to the browser; the lock cannot prevent screenshots, developer-tool extraction, or copies already downloaded before it was locked.
- Emoji artwork uses open-licensed Twemoji for a consistent replacement on different devices. Unicode text is retained in the database, and native emoji are the fallback if the artwork cannot load. This is not Apple's proprietary emoji artwork. Attribution is in `THIRD_PARTY_NOTICES.md` and the emoji picker.

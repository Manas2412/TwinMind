# Deploying TwinMind to EC2

This repo ships with a production-grade deployment pipeline:

- **`Dockerfile`** — multi-stage build, Next.js standalone output, non-root, ~150MB final image.
- **`docker-compose.yml`** — Next.js app + Caddy reverse proxy with auto Let's Encrypt TLS.
- **`Caddyfile`** — TLS termination, gzip/zstd, long-cache for `_next/static/*`, SSE pass-through for `/api/chat`.
- **`.github/workflows/ci.yml`** — lint + type-check + build on every PR.
- **`.github/workflows/deploy.yml`** — on push to `main`: build image, push to GHCR, SSH to EC2, `docker compose pull && up -d`, healthcheck-gated rollout.

The pipeline is **registry-mediated** (GHCR), not source-pushed: GitHub Actions builds the image once, EC2 only pulls and restarts. EC2 never sees source code or runs `npm install`.

---

## One-time setup

### 1. Provision the EC2 instance

Anything from `t3.small` upward will run this comfortably.

| Setting | Value |
|---|---|
| AMI | Ubuntu 24.04 LTS (any recent LTS works) |
| Instance type | `t3.small` (2 vCPU / 2 GB) minimum |
| Storage | 16 GB gp3 |
| Security group inbound | `22/tcp` (your IP), `80/tcp` (0.0.0.0/0), `443/tcp` (0.0.0.0/0) |
| Elastic IP | Allocate & associate (so DNS doesn't drift on reboot) |

Point your domain's `A` record at the Elastic IP. TLS issuance fails if DNS isn't resolving when Caddy first starts.

### 2. Install Docker on EC2

SSH in, then:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Let your SSH user run docker without sudo
sudo usermod -aG docker $USER
exit          # reconnect so the group change takes effect
```

Verify:

```bash
docker version
docker compose version
```

### 3. Create the deploy directory

```bash
mkdir -p ~/twinmind
```

The deploy workflow uploads `docker-compose.yml` + `Caddyfile` here on every run, so no manual copying is needed.

### 4. Create a GHCR personal access token (PAT)

GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token.

- Scope: `read:packages` is enough (workflow pushes; EC2 only pulls).
- Copy the token; you'll paste it as the `GHCR_TOKEN` secret next.

> Why a PAT and not the workflow's `GITHUB_TOKEN`? The token in the workflow is short-lived and not usable from the EC2 box. The EC2 box needs its own credential to pull private GHCR images.

### 5. Configure GitHub secrets and variables

Repo → Settings → **Environments** → New environment → name it **`production`**. Then under that environment add:

**Secrets** (encrypted, never echoed in logs):

| Name | Value |
|---|---|
| `EC2_HOST` | EC2 public DNS or Elastic IP |
| `EC2_USER` | SSH username, e.g. `ubuntu` |
| `EC2_SSH_KEY` | Full contents of the private SSH key (including `-----BEGIN…END-----`) |
| `GHCR_USER` | Your GitHub username (lowercase) |
| `GHCR_TOKEN` | The PAT from step 4 |

**Variables** (visible in logs, used for non-sensitive config):

| Name | Value |
|---|---|
| `APP_DOMAIN` | `twinmind.example.com` (the domain Caddy serves) |
| `ACME_EMAIL` | Contact email for Let's Encrypt notifications |

### 6. Push to `main`

That's it. The workflow will build the image, push it to `ghcr.io/<your-username>/<repo>:sha-<short>`, SSH into EC2, and bring up the stack. First run takes ~3–4 minutes (Caddy issues TLS certs); subsequent deploys finish in under a minute.

---

## Day-to-day operations

### Watch a deploy

GitHub → Actions → **Deploy to EC2** → latest run. The "Pull image & restart on EC2" step streams compose logs and waits for the app's healthcheck to flip to `healthy` before declaring success.

### Manually trigger a deploy

Actions → Deploy to EC2 → **Run workflow** → pick `main`.

### Tail logs on EC2

```bash
ssh ubuntu@<EC2_HOST>
cd ~/twinmind
docker compose logs -f app           # Next.js app
docker compose logs -f caddy         # TLS / proxy
```

### Roll back

Each image is tagged `sha-<short>`. To pin to a previous version:

```bash
ssh ubuntu@<EC2_HOST>
cd ~/twinmind
sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=ghcr.io/<owner>/<repo>:sha-<previous>|' .env
docker compose pull app && docker compose up -d
```

### Local dry run

To exercise the production image locally before pushing:

```bash
docker build -t twinmind:local .
docker run --rm -p 3000:3000 twinmind:local
# → http://localhost:3000
```

To exercise the full stack with TLS locally, edit `Caddyfile` to use `:80 { ... tls internal }` and run `docker compose --env-file .env up`.

---

## Architecture

```
        ┌──────────────┐    push        ┌──────────────┐
        │   GitHub     │ ─────────────▶ │     GHCR     │
        │   Actions    │                │  (registry)  │
        └─────┬────────┘                └──────┬───────┘
              │ ssh                            │ pull
              ▼                                ▼
        ┌────────────────────────────────────────────┐
        │                 EC2 host                    │
        │  ┌──────────┐    proxy    ┌─────────────┐  │
        │  │  Caddy   │ ──────────▶ │ Next.js app │  │
        │  │ :80/:443 │             │   :3000     │  │
        │  └──────────┘             └─────────────┘  │
        │  TLS via Let's Encrypt                      │
        └────────────────────────────────────────────┘
```

**Why this shape:**

- **GHCR over Docker Hub** — free for private images on this repo, no rate limits, lives next to the source.
- **Caddy over nginx + certbot** — auto cert issue and renewal, no cron, no shell scripts. Configuration is one file.
- **Standalone Next.js output** — image excludes `node_modules`, drops final size from ~1 GB to ~150 MB, faster pulls and quicker rollouts.
- **Healthcheck-gated rollout** — workflow polls `twinmind-app` health for up to 60 s after restart; failed boots are caught and logged before the workflow goes green.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `dial tcp: lookup <domain>` in Caddy logs | DNS not pointing at EC2 | Update A record, wait for propagation, restart Caddy (`docker compose restart caddy`) |
| Cert issuance loops with rate-limit error | You exceeded Let's Encrypt's 5-failures-per-hour cap during DNS setup | Wait an hour, or switch to staging issuer in `Caddyfile` while testing |
| `unauthorized: authentication required` on `docker compose pull` | EC2 lost GHCR creds (e.g. host rebooted with no daemon login persisted) | Re-run the deploy workflow (it re-logs in) |
| App boots but `/api/transcribe` returns 502 | The user hasn't pasted a Groq API key in Settings | Expected — keys are client-supplied; the proxy returns 401 without one |
| `address already in use` on 80/443 | Another web server (apache2, nginx) is running | `sudo systemctl disable --now apache2 nginx` |

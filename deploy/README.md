# Deploying to a VPS

One server can host this and every future tool. Roughly 20 minutes end to end.

## 1. Create the server

Any Ubuntu 24.04 VPS works. [Hetzner](https://console.hetzner.cloud) **CX22**
(2 vCPU / 4 GB / 40 GB, ~€4.50/mo) is the best value.

- Image: **Ubuntu 24.04**
- Add your SSH key during creation (avoids password login entirely)
- Note the server's IPv4 address

## 2. Point DNS at it

At your domain registrar (Namecheap → Domain List → peachstrides.com →
Advanced DNS), add:

| Type | Host | Value |
|---|---|---|
| A | `mailer` | *your server's IPv4* |

That gives you `mailer.peachstrides.com`. Wait a few minutes for it to resolve.

> Caddy gets the HTTPS certificate automatically, but only once DNS actually
> points at the box — do this step *before* running setup.

## 3. Bootstrap the server

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://raw.githubusercontent.com/dejodammy/PeachStrideTools/master/deploy/setup.sh -o setup.sh
bash setup.sh mailer.peachstrides.com
```

This installs Node 22, Caddy (with automatic HTTPS), Chromium, a non-root `app`
user, the systemd service, automatic security updates, and a firewall.

## 4. Add your sender accounts

```bash
sudo -u app cp /home/app/PeachStrideTools/server/.env.example /home/app/PeachStrideTools/server/.env
sudo -u app nano /home/app/PeachStrideTools/server/.env
```

Fill in `MAIL_ACCOUNT_1_*` (and `_2_` if you use two). Then:

```bash
systemctl start bulk-mailer
systemctl status bulk-mailer
```

Visit `https://mailer.peachstrides.com`.

## 5. Turn on automatic deploys (optional but recommended)

So that `git push` deploys, exactly like Render did.

On your **local machine**, make a deploy key:

```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

Put the **public** half on the server:

```bash
ssh root@YOUR_SERVER_IP "mkdir -p /home/app/.ssh && cat >> /home/app/.ssh/authorized_keys && chown -R app:app /home/app/.ssh && chmod 700 /home/app/.ssh && chmod 600 /home/app/.ssh/authorized_keys" < deploy_key.pub
```

Then in GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `SSH_HOST` | your server IP |
| `SSH_USER` | `app` |
| `SSH_KEY` | contents of the **private** `deploy_key` file |

Delete your local copy of `deploy_key` afterwards. Every push to `master` now
redeploys automatically.

## Day-to-day

```bash
# logs (live)
journalctl -u bulk-mailer -f

# restart
sudo systemctl restart bulk-mailer

# deploy by hand
bash ~/PeachStrideTools/deploy/deploy.sh
```

## Adding a second tool later

1. Clone it to `/home/app/<tool>`
2. Copy `bulk-mailer.service` → `/etc/systemd/system/<tool>.service`, adjust
   `WorkingDirectory` and give it a different port
3. Add a block to `/etc/caddy/Caddyfile`:
   ```
   othertool.peachstrides.com {
       reverse_proxy localhost:5001
   }
   ```
4. `systemctl reload caddy`

No extra hosting cost.

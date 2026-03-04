# WebCraft AI v3.0 — Try Before You Buy

## Cara Kerja (Flow)

```
User buka app → langsung bisa chat TANPA daftar
       ↓
Generate 1 website GRATIS → preview langsung muncul
       ↓
Mau Download / Deploy / Generate lagi?
       ↓
Pilih paket → Transfer → Kirim Session ID ke admin WA
       ↓
Admin jalankan 1 command → user langsung unlock
       ↓
Setelah unlock → terserah user (download, deploy, edit bebas)
```

## Paket Harga

| Paket | Harga | Yang Dapat |
|---|---|---|
| Starter | Rp 49.000 | Download + deploy 1 website ini |
| Pro | Rp 99.000 | Unlimited generate 30 hari |
| Agency | Rp 299.000 | Unlimited + 5 klien |

## Deploy ke Railway

1. Upload folder ini ke GitHub repo baru
2. Buka railway.app → New Project → GitHub
3. Set Environment Variables:
   - `ANTHROPIC_API_KEY` = sk-ant-KEY-KAMU
   - `ADMIN_KEY` = password-rahasia-kamu
4. Deploy → dapat URL publik

## Cara Unlock User Setelah Bayar

Jalankan command ini di terminal:

```bash
curl -X POST https://URL-KAMU/api/unlock \
  -H "Content-Type: application/json" \
  -d '{"sid":"SESSION-ID-USER","plan":"starter","adminKey":"password-kamu"}'
```

Plan options: `starter` | `pro` | `agency`

## Yang Perlu Diganti di index.html

Cari `<!-- EDIT: -->` di file index.html:
- Nomor rekening bank
- Nomor WhatsApp admin
- Link WA di fungsi `openWA()`

## Test Lokal

```bash
ANTHROPIC_API_KEY=sk-ant-xxx ADMIN_KEY=test123 node server.js
# Buka http://localhost:3000
```

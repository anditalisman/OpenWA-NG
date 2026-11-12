<p align="center">
  <img src="dashboard/public/pamgm_logo.png" alt="Logo PAMGM" width="160"/>
</p>

<h1 align="center">OpenWA PAMGM</h1>
<p align="center">
  <strong>WhatsApp API Gateway internal PAMGM, berbasis OpenWA</strong>
</p>

<p align="center">
  <a href="#-mulai-cepat">Mulai Cepat</a> •
  <a href="#-deployment-produksi-pamgm">Deployment</a> •
  <a href="#-autentikasi">Autentikasi</a> •
  <a href="#-contoh-api">API</a> •
  <a href="#-sinkronisasi-dengan-upstream">Upstream</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-22_LTS-brightgreen.svg" alt="Node"/>
  <img src="https://img.shields.io/badge/NestJS-11-red.svg" alt="NestJS"/>
  <img src="https://img.shields.io/badge/engine-whatsapp--web.js-25D366.svg" alt="Engine"/>
  <img src="https://img.shields.io/badge/database-PostgreSQL-336791.svg" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"/>
</p>

---

## Tentang repo ini

**OpenWA PAMGM** adalah fork dari [OpenWA](https://github.com/rmyndharis/OpenWA) (WhatsApp API Gateway open source berbasis NestJS) yang disesuaikan untuk kebutuhan internal PAMGM. Inti gateway-nya sama dengan upstream: REST API, multi-session, webhook, dashboard React, dan MCP. Yang berbeda ada di cara deploy, cara login, dan cara API key dibagikan.

| Bagian               | Upstream OpenWA                            | OpenWA PAMGM (fork ini)                                                                                |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Database**         | SQLite, atau PostgreSQL bawaan via profile | PostgreSQL **eksternal** yang sudah ada; container Postgres dan MinIO bawaan dihapus dari compose      |
| **Redis**            | Opsional (profile `redis`)                 | Selalu ikut jalan sebagai service inti, agar redeploy Dokploy tanpa flag tetap membuatnya              |
| **Login dashboard**  | Tempel API key                             | **Email + password** per pengguna (`DASHBOARD_USERS`), dengan reset password lewat email               |
| **API key**          | Dibuat admin                               | Bisa juga diminta sendiri lewat email kantor (self-service), lengkap dengan pemulihan dan reCAPTCHA v3 |
| **Cakupan API key**  | Key tanpa daftar session melihat semua     | Key non-admin tanpa daftar session hanya melihat session yang **dibuatnya sendiri**                    |
| **Jaringan & waktu** | DNS bawaan Docker, UTC                     | DNS internal PTAMGM (`10.10.222.101`) dengan fallback `8.8.8.8`, `TZ=Asia/Makassar`                    |
| **Tampilan**         | Branding OpenWA                            | Branding PAMGM di dashboard                                                                            |

---

## ⚠️ Sebelum menghubungkan nomor

OpenWA bukan API resmi Meta. Koneksi ke WhatsApp memakai klien hasil rekayasa balik ([`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) dan [`baileys`](https://github.com/WhiskeySockets/Baileys)), sehingga **selalu ada risiko nomor dibatasi atau diblokir**.

- **Pakai nomor khusus**, jangan nomor pribadi atau nomor utama kantor.
- **Engine default di PAMGM adalah `whatsapp-web.js`.** Engine ini menjalankan Chromium sungguhan sehingga risiko blokirnya lebih rendah, tapi butuh RAM sekitar 300–500 MB per session. `baileys` jauh lebih hemat RAM, tapi lebih mudah dikenali WhatsApp.
- **Hangatkan nomor baru** beberapa hari dengan pemakaian wajar sebelum dipakai mengirim otomatis.
- **Jangan kirim massal ke nomor yang belum pernah berinteraksi.** Kirim ke penerima yang memang menunggu pesan (notifikasi, balasan layanan), dan gunakan rate limiter (`RATE_LIMIT_*`).
- **Siapkan jalur cadangan** (SMS atau email) untuk hal yang kritis seperti OTP.
- Nomor yang sudah dibatasi WhatsApp tidak bisa dipulihkan dari gateway; banding harus lewat WhatsApp sendiri.

Analisis risiko lengkap dari upstream ada di [`docs/16-risk-management.md`](./docs/16-risk-management.md).

---

## 🎯 Fitur

- **REST API** untuk WhatsApp: teks, media (gambar, video, dokumen, audio), reaksi, edit pesan, kirim massal, status kirim dan baca
- **Multi-session**: banyak nomor WhatsApp dalam satu instance
- **Webhook** real-time dengan tanda tangan HMAC dan filter opsional
- **Dashboard React** untuk session, webhook, API key, chat, template, log, dan infrastruktur
- **Grup, kontak, label, channel, profil, panggilan masuk**
- **Proxy per session**, rate limiting, whitelist CIDR, audit log
- **MCP server** opsional untuk agen AI
- **Swagger** di `/api/docs` (di produksi hanya aktif jika `ENABLE_SWAGGER=true`)

Detail per fitur dan per engine: [`docs/06-api-specification.md`](./docs/06-api-specification.md) dan [`docs/29-engine-capability-matrix.md`](./docs/29-engine-capability-matrix.md).

---

## 🚀 Mulai Cepat

### Pengembangan lokal

```bash
git clone https://github.com/anditalisman/OpenWA-NG.git
cd OpenWA-NG

# Pasang dependency sesuai lockfile (termasuk dashboard).
# postinstall juga memasang patch whatsapp-web.js dan baileys, jadi jangan dilewati.
npm ci

# Jalankan API + dashboard (konfigurasi dibuat otomatis saat pertama jalan)
npm run dev
```

| Layanan         | Alamat                         |
| --------------- | ------------------------------ |
| API             | http://localhost:2785/api      |
| Swagger         | http://localhost:2785/api/docs |
| Dashboard (dev) | http://localhost:2886 (Vite)   |

Untuk menjalankan stack Docker lokal dengan SQLite:

```bash
docker compose -f docker-compose.dev.yml up -d
# Dashboard + API: http://localhost:2785
```

---

## 🏭 Deployment Produksi PAMGM

Produksi dideploy dengan **Dokploy** memakai `docker-compose.yml` di root repo. File ini sudah versi PAMGM:

- **Tanpa** container Postgres dan MinIO bawaan. Database memakai server PostgreSQL eksternal.
- **Redis** selalu dibuat sebagai service inti (tanpa `--profile`), karena tombol redeploy Dokploy hanya menjalankan `docker compose up -d`.
- `openwa-api` memakai DNS internal PTAMGM `10.10.222.101` untuk me-resolve host internal (Postgres, relay SMTP), dengan `8.8.8.8` sebagai fallback untuk host luar (server WhatsApp, registry versi WhatsApp Web, npm saat build).
- `TZ=Asia/Makassar`, supaya waktu log sama dengan stack PAMGM lain.
- Data session WhatsApp disimpan di volume `openwa_openwa-data` (`/app/data`).

Versi lengkap dari upstream (Postgres, Redis, dan MinIO bawaan lewat profile) tetap tersedia di `docker-compose.full.yml` sebagai referensi.

```bash
docker compose up -d --build
```

### Variabel lingkungan minimum

Isi di `.env` (atau environment Dokploy). Daftar lengkap ada di [`.env.example`](./.env.example).

```bash
# Database: PostgreSQL eksternal
DATABASE_TYPE=postgres
DATABASE_HOST=<host-postgres-internal>
DATABASE_PORT=5432
DATABASE_NAME=openwa
DATABASE_USERNAME=<user>
DATABASE_PASSWORD=<password>

# Redis: container ikut jalan, tapi aplikasi baru memakainya jika diaktifkan
REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379

# URL publik (dipakai di link email reset password dan verifikasi API key)
BASE_URL=https://<domain-api>
DASHBOARD_URL=https://<domain-dashboard>

# Akun dashboard (lihat bagian Autentikasi)
DASHBOARD_USERS=admin@ptamgirimenang.com:admin

# SMTP untuk email reset password dan API key self-service
SMTP_HOST=<relay-smtp>
SMTP_PORT=587
SMTP_FROM="OpenWA PAMGM <no-reply@...>"
```

### Hal yang perlu dijaga

- **Jangan hapus volume `openwa_openwa-data`** (misalnya dengan `docker compose down -v`). Isinya login WhatsApp setiap session. Selama volume ini ada, restart atau redeploy tidak perlu scan QR ulang; session hanya terputus sebentar.
- **Patch `whatsapp-web.js` dan `baileys` wajib terpasang.** Image Docker memasangnya sendiri saat build. Di luar Docker, patch ini dipasang oleh `npm ci` lewat postinstall, jadi jangan menjalankannya dengan `--ignore-scripts`.
- Pasang reverse proxy dengan TLS di depan port `2785` untuk akses dari luar.

---

## 🔐 Autentikasi

### Login dashboard (email + password)

Dashboard hanya menerima login dengan email dan password; API key yang ditempel di halaman login akan ditolak.

- Daftar akun diatur lewat `DASHBOARD_USERS`, dipisahkan koma, dengan format `email:role[:sessionId|sessionId...]`. Role: `admin`, `operator`, atau `viewer`.
  ```bash
  DASHBOARD_USERS=admin@ptamgirimenang.com:admin,cs@ptamgirimenang.com:operator:<session-id>
  ```
- Pengguna non-admin hanya melihat session yang tercantum di belakang emailnya.
- Akun dibuat atau diperbarui setiap kali aplikasi start. Email yang dihapus dari daftar akan dinonaktifkan dan dikeluarkan dari login.
- Password **tidak pernah** ditulis di konfigurasi. Setiap pengguna mengatur password sendiri lewat **"Lupa password?"** di halaman login, yang mengirim link sekali pakai ke emailnya (butuh SMTP dan `DASHBOARD_URL`).
- Durasi login diatur `DASHBOARD_SESSION_TTL_HOURS` (default 12 jam), masa berlaku link reset `DASHBOARD_PASSWORD_RESET_TTL_MINUTES` (default 30 menit).

### API key untuk aplikasi

API key dikirim lewat header `X-API-Key` (atau `Authorization: Bearer ...`).

- **Dibuat admin** di menu API Keys pada dashboard, dengan role `admin`, `operator`, atau `viewer`.
- **Cakupan session**: key `operator` atau `viewer` bisa dibatasi ke session tertentu. Key non-admin **tanpa** daftar session hanya bisa melihat dan mengelola session yang dibuat oleh key itu sendiri, bukan seluruh session di server.

### API key self-service (opsional)

Pegawai bisa meminta API key sendiri tanpa menunggu admin. Fitur ini mati secara default.

1. Buka `/request-api-key` di dashboard (ada link dari halaman login), isi nama dan email kantor.
2. Jika domain email ada di `SELF_SERVICE_ALLOWED_EMAIL_DOMAINS`, link verifikasi dikirim ke email tersebut. Jawaban halaman selalu sama, sehingga daftar domain tidak bisa ditebak dari luar.
3. Link verifikasi (sekali pakai) menerbitkan key ber-role `operator` yang hanya mencakup session yang dibuatnya sendiri.

Key yang hilang bisa dipulihkan lewat `/forgot-api-key`: setelah link di email diklik, semua key self-service milik email itu dicabut dan diganti key baru, dan akses ke session lama ikut dipindahkan ke key baru. Kedua formulir publik ini bisa dilindungi Google reCAPTCHA v3.

```bash
SELF_SERVICE_API_KEYS_ENABLED=true
SELF_SERVICE_ALLOWED_EMAIL_DOMAINS=ptamgirimenang.com
SELF_SERVICE_TOKEN_TTL_MINUTES=30

RECAPTCHA_ENABLED=true
RECAPTCHA_SITE_KEY=<site-key>
RECAPTCHA_SECRET_KEY=<secret-key>
RECAPTCHA_MIN_SCORE=0.5
```

Aplikasi menolak start jika `SELF_SERVICE_API_KEYS_ENABLED=true` tapi SMTP, daftar domain, atau URL dasar belum diisi.

---

## 📡 Contoh API

### Buat session

```bash
curl -X POST http://localhost:2785/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: API_KEY_ANDA" \
  -d '{"name": "cs-bot"}'
```

### Start session dan ambil QR

```bash
curl -X POST http://localhost:2785/api/sessions/{sessionId}/start \
  -H "X-API-Key: API_KEY_ANDA"

# Scan QR ini dari WhatsApp > Perangkat tertaut
curl http://localhost:2785/api/sessions/{sessionId}/qr \
  -H "X-API-Key: API_KEY_ANDA"
```

### Kirim pesan teks

```bash
curl -X POST http://localhost:2785/api/sessions/{sessionId}/messages/send-text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: API_KEY_ANDA" \
  -d '{
    "chatId": "628123456789@c.us",
    "text": "Halo dari OpenWA PAMGM!"
  }'
```

### Pasang webhook

```bash
curl -X POST http://localhost:2785/api/sessions/{sessionId}/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: API_KEY_ANDA" \
  -d '{
    "url": "https://aplikasi-anda/webhook",
    "events": ["message.received", "session.status"],
    "secret": "rahasia-hmac"
  }'
```

Tambahkan objek `filters` jika webhook hanya perlu dikirim untuk kondisi tertentu, misalnya pengirim atau tipe pesan. Skema lengkap ada di [`docs/06-api-specification.md`](./docs/06-api-specification.md).

### MCP untuk agen AI (opsional)

Aktifkan dengan `MCP_ENABLED=true`. Endpoint `POST /mcp` memakai port dan autentikasi API key yang sama dengan REST. Secara default hanya **25 read-only tools** (alat baca) yang dipasang; `MCP_READONLY=false` memasang seluruh **51 tools**, termasuk alat tulis (kirim pesan, operasi grup). Gunakan key khusus ber-role `operator` yang dibatasi ke session tertentu, dan jangan buka `/mcp` ke internet. Detail: [`docs/24-mcp-integration.md`](./docs/24-mcp-integration.md).

---

## 🔄 Sinkronisasi dengan upstream

Fork ini mengikuti [`rmyndharis/OpenWA`](https://github.com/rmyndharis/OpenWA). Karena kode fork sudah cukup berbeda, perbaikan dari upstream diambil bertahap:

- **Cherry-pick per PR** untuk perbaikan engine yang relevan dengan produksi (whatsapp-web.js di atas PostgreSQL). Jika kode fork terlalu berbeda, perbaikannya di-port manual, dan pesan commit menyebut nomor PR upstream-nya, misalnya `fix(wwjs): ... (#2023)`.
- **Merge penuh** sesekali, untuk mengejar perubahan besar sekaligus.

```bash
git remote add upstream https://github.com/rmyndharis/OpenWA.git
git fetch upstream
```

Pesan commit di repo ini ditulis **satu baris dalam bahasa Indonesia**, dengan prefix conventional commit (`fix(...)`, `feat(...)`, `docs(...)`, dan seterusnya).

---

## 🛠 Teknologi

| Lapisan   | Teknologi                                                |
| --------- | -------------------------------------------------------- |
| Runtime   | Node.js 22 LTS                                           |
| Framework | NestJS 11, TypeScript                                    |
| Engine WA | whatsapp-web.js (default) / baileys, lewat `ENGINE_TYPE` |
| Database  | PostgreSQL (produksi), SQLite (pengembangan)             |
| Cache     | Redis                                                    |
| ORM       | TypeORM                                                  |
| Dashboard | React + Vite, dibundel ke image API pada port yang sama  |
| Container | Docker + Docker Compose, dideploy lewat Dokploy          |

Keamanan container (socket proxy Docker, proses non-root) sama dengan upstream; lihat [`SECURITY.md`](./SECURITY.md).

---

## 📚 Dokumentasi

Dokumentasi teknis di folder [`docs/`](./docs/README.md) berasal dari upstream dan berbahasa Inggris:

| Dokumen                                                           | Isi                                   |
| ----------------------------------------------------------------- | ------------------------------------- |
| [Arsitektur](./docs/03-system-architecture.md)                    | Desain sistem                         |
| [Keamanan](./docs/04-security-design.md)                          | Desain keamanan                       |
| [Database](./docs/05-database-design.md)                          | Model data dan migrasi                |
| [Spesifikasi API](./docs/06-api-specification.md)                 | Referensi API lengkap                 |
| [Runbook operasional](./docs/11-operational-runbooks.md)          | Upgrade, backup, pemulihan            |
| [Troubleshooting](./docs/12-troubleshooting-faq.md)               | Masalah umum dan solusinya            |
| [Matriks kemampuan engine](./docs/29-engine-capability-matrix.md) | Perbedaan whatsapp-web.js dan baileys |

Perubahan per versi tercatat di [`CHANGELOG.md`](./CHANGELOG.md).

---

## 📄 Lisensi

Dirilis dengan **Lisensi MIT**, sama seperti upstream. Lihat [LICENSE](./LICENSE).

OpenWA dibuat oleh [Yudhi Armyndharis](https://github.com/rmyndharis) dan komunitas OpenWA. Fork ini dikelola untuk kebutuhan internal PAMGM.

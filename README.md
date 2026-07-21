# AG Switchboard Account

Fork dari AG Multi-Account Switchboard untuk Antigravity IDE.

Fokus fork ini adalah mempermudah penggunaan banyak akun Google di Antigravity, terutama untuk menambahkan banyak akun sekaligus tanpa harus menambahkannya satu per satu dari panel.

## Fitur Utama

- Switch akun Antigravity dari satu panel.
- Pantau quota akun dan model yang tersedia.
- Tambah banyak akun dari file email.
- Import banyak akun dari file refresh token.
- Build dan install langsung sebagai file VSIX.
- Token disimpan di VS Code/Antigravity SecretStorage.
- Tidak membaca file email dan password Google.

## Cara Paling Cepat

Alur normal untuk user biasa:

1. Download file VSIX dari halaman release.
2. Install VSIX ke Antigravity IDE.
3. Isi Google OAuth credential satu kali.
4. Jalankan command untuk collect akun dari file email.
5. Login dan approve akun di browser incognito/private yang terbuka.
6. Buka panel AG Switchboard dan gunakan akun yang sudah masuk.

## Install Dari VSIX

1. Buka halaman release:
   https://github.com/ArmnskBamban/Ag_Swychboard_Account/releases/latest
2. Download file `.vsix`.
3. Buka Antigravity IDE.
4. Tekan `Ctrl + Shift + P`.
5. Jalankan command `Extensions: Install from VSIX...`.
6. Pilih file `.vsix` yang sudah didownload.
7. Reload Antigravity jika diminta.
8. Buka icon `AG Switchboard` di Activity Bar.

## Setup Google OAuth Credential

Extension membutuhkan OAuth credential agar bisa membuka login Google resmi dan menukar hasil login menjadi token akun Antigravity.

Credential ini tidak dimasukkan ke source code supaya aman untuk GitHub public dan release VSIX.

### Cara Mendapatkan Client ID dan Client Secret

1. Buka Google Cloud Console:
   https://console.developers.google.com/auth/clients
2. Pilih project yang sudah ada, atau buat project baru.
3. Jika diminta setup Google Auth/OAuth consent screen, isi data dasar:
   - App name: `AG Switchboard`
   - User support email: email kamu
   - Audience/User type: `External` untuk akun Google biasa
   - Test users: masukkan email Google yang akan dipakai, jika app masih testing
4. Masuk ke menu `Clients`.
5. Klik `Create Client`.
6. Pilih application type `Desktop app`.
7. Isi name, contoh: `AG Switchboard Desktop`.
8. Klik `Create`.
9. Google akan menampilkan `Client ID` dan `Client Secret`.
10. Simpan nilainya, atau download file JSON dari client tersebut.

### Cara Mengisi Di Antigravity

1. Tekan `Ctrl + Shift + P`.
2. Jalankan `Preferences: Open User Settings (JSON)`.
3. Tambahkan setting berikut:

```json
{
  "ag-switchboard.oauthClientId": "isi_client_id_dari_google",
  "ag-switchboard.oauthClientSecret": "isi_client_secret_dari_google"
}
```

Contoh bentuk `Client ID`:

```txt
1234567890-abcxyz.apps.googleusercontent.com
```

Contoh bentuk `Client Secret`:

```txt
GOCSPX-xxxxxxxxxxxxxxxxxxxx
```

Jangan upload nilai asli `Client ID`, `Client Secret`, `client_secret.json`, `emails.txt`, atau file token ke GitHub.

## Tambah Banyak Akun Dari File Email

Ini flow yang paling mudah jika kamu punya banyak akun Google.

1. Buat file `emails.txt`.
2. Isi satu email per baris:

```txt
account1@gmail.com
account2@gmail.com
account3@gmail.com
```

3. Di Antigravity, tekan `Ctrl + Shift + P`.
4. Jalankan command:

```txt
AG Switchboard: Collect Accounts from Email List
```

5. Pilih file `emails.txt`.
6. Browser incognito/private akan terbuka untuk tiap email.
7. Login dan approve akses Google.
8. Setelah berhasil, akun langsung masuk ke AG Switchboard.

Catatan:

- Extension hanya memberi hint email ke halaman Google.
- User tetap menyelesaikan login resmi di browser Google.
- Jika file berbentuk `email|data_lain` atau CSV, extension memakai kolom pertama sebagai email.
- Jika akun yang login tidak sama dengan email di file, akun tersebut akan ditolak agar tidak salah input.

## Import Banyak Akun Dari File Token

Gunakan cara ini jika kamu sudah punya refresh token.

Format file yang didukung:

```txt
refresh_token
email@example.com|refresh_token
```

Langkah pakai:

1. Tekan `Ctrl + Shift + P`.
2. Jalankan command:

```txt
AG Switchboard: Import Accounts from Token File
```

3. Pilih file `.txt` atau `.csv`.
4. Extension akan validasi token.
5. Akun yang valid akan disimpan ke AG Switchboard.

Jika format `email|refresh_token` dipakai, extension akan memastikan token tersebut benar-benar milik email itu.

## Tambah Satu Akun

Dari Command Palette:

```txt
AG Switchboard: Add Account
```

Gunakan ini untuk login satu akun lewat Google OAuth resmi.

Atau jika sudah punya refresh token:

```txt
AG Switchboard: Add Account via Token
```

## Command Penting

| Command | Fungsi |
| --- | --- |
| `AG Switchboard: Add Account` | Tambah satu akun lewat Google OAuth |
| `AG Switchboard: Add Account via Token` | Tambah satu akun dari refresh token |
| `AG Switchboard: Collect Accounts from Email List` | Tambah banyak akun dari file email |
| `AG Switchboard: Import Accounts from Token File` | Import banyak akun dari file token |
| `AG Switchboard: Refresh Quota` | Refresh quota akun |
| `AG Switchboard: Remove Account` | Hapus akun dari Switchboard |
| `AG Switchboard: Open Usage Statistics` | Buka statistik usage |
| `AG Switchboard: Fix Missing Conversations` | Perbaiki conversation Antigravity yang hilang dari sidebar |

## Jalankan Manual Dari Source

Gunakan ini jika ingin mengembangkan extension dari source code.

```bash
git clone https://github.com/ArmnskBamban/Ag_Swychboard_Account.git
cd Ag_Swychboard_Account
npm ci
npm.cmd run compile
```

Lalu:

1. Buka folder repo di Antigravity atau VS Code.
2. Tekan `F5`.
3. Pilih `Run AG Switchboard Extension`.
4. Extension Development Host akan terbuka.
5. Test extension dari window baru tersebut.

Jika PowerShell menolak menjalankan `npm`, pakai `npm.cmd` seperti contoh di atas.

## Build VSIX Sendiri

```bash
npm.cmd run package
```

Output akan menjadi file seperti:

```txt
ag-multi-account-switchboard-3.2.3.vsix
```

File VSIX itu bisa diinstall lewat:

```txt
Extensions: Install from VSIX...
```

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `Google OAuth credentials are not configured` | Isi `ag-switchboard.oauthClientId` dan `ag-switchboard.oauthClientSecret` di User Settings JSON |
| `redirect_uri_mismatch` | Pastikan OAuth client dibuat dengan type `Desktop app` |
| Login Google menampilkan app belum diverifikasi | Tambahkan email ke `Test users` di OAuth consent screen |
| Browser terbuka tapi lama loading | Tunggu sebentar, reload tab, atau jalankan ulang command |
| Akun sudah ditambahkan tapi panel lama connecting | Jalankan `Developer: Reload Window` |
| `npm.ps1 cannot be loaded` di Windows | Pakai `npm.cmd run compile` atau ubah PowerShell execution policy |
| GitHub menolak push karena secret | Hapus credential/token dari commit, jangan bypass push protection |

## Catatan Keamanan

- Extension tidak memakai file `email|password`.
- Extension tidak mengetik password Google otomatis.
- Login dilakukan lewat halaman Google resmi.
- Token akun disimpan di SecretStorage milik Antigravity/VS Code.
- Tidak ada server tambahan dari extension ini.
- File credential dan token lokal jangan dipublish.

## License

MIT. Lihat file `LICENSE`.

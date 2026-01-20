# Trench-Sports-FrontEnd

Node.js + Vite (React + TS) starter that can be deployed to **AWS Elastic Beanstalk**.
The app includes a minimal Web Bluetooth UI for connecting to your adapter (BLE).

## 1) Local setup

```bash
npm install
npm run dev
```

Create a `.env` file for your BLE UUIDs:

```bash
VITE_BLE_SERVICE_UUID=YOUR_SERVICE_UUID
VITE_BLE_CHAR_UUID_TX=YOUR_NOTIFY_CHARACTERISTIC_UUID   # optional
VITE_BLE_CHAR_UUID_RX=YOUR_WRITE_CHARACTERISTIC_UUID    # optional
```

## 2) Production build (local)

```bash
npm run build
npm start
```

Then open `http://localhost:8080`.

## 3) Deploy to Elastic Beanstalk

**Important:** Web Bluetooth only works in a secure context (HTTPS), so you must attach HTTPS to your EB environment.

**Upload option A (recommended):** let EB build on deploy

- This repo includes `.ebextensions/01_env.config` which sets `NPM_USE_PRODUCTION=false`,
  so EB installs devDependencies and can run the Vite build.

Steps (EB CLI):

```bash
pip install awsebcli
eb init
eb create trench-sports-frontend
eb deploy
```

**Upload option B:** build locally and deploy `dist/` (no devDependencies on the server)

- Run `npm run build`
- Make sure `dist/` is included in your zip/source bundle
- Remove `.ebextensions/01_env.config` if you want EB to omit devDependencies

## HTTPS notes for Web Bluetooth

- Web Bluetooth requires HTTPS.
- You can add an ACM certificate to your Load Balancer listener and force HTTPS redirects.

## Health check

- `GET /health` returns `ok`.

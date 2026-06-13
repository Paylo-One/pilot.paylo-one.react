# Management OS Mobile

Expo companion application for the Management OS. It is a native frontend, not
a wrapper around the Next.js application.

From the repository root:

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env.local
npm run dev:mobile
```

Set `EXPO_PUBLIC_API_BASE_URL` to an API origin reachable by the simulator or
physical device. The initial screens remain honest empty/error states until the
documented mobile API contracts exist.

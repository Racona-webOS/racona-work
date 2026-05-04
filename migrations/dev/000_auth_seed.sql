-- Dev környezet: minimális auth séma
-- Éles rendszerben az auth sémát a better-auth kezeli.
-- Ez a fájl NEM kerül bele az éles .raconapkg csomagba (migrations/dev/ almappa).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id             SERIAL PRIMARY KEY,
    full_name      VARCHAR(255),
    email          VARCHAR(255) UNIQUE NOT NULL,
    image          TEXT,
    email_verified BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS auth.accounts (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_account_id VARCHAR(255),
    provider_id         VARCHAR(100) DEFAULT 'credential',
    is_active           BOOLEAN DEFAULT true
);

-- Dev seed: egy tesztfelhasználó
INSERT INTO auth.users (full_name, email, email_verified)
VALUES ('Dev User', 'dev@example.com', true)
ON CONFLICT (email) DO NOTHING;

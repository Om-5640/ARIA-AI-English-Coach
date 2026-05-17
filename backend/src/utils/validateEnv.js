const REQUIRED = ['GROQ_API_KEY'];

const REQUIRED_IN_PRODUCTION = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PUBLIC_APP_ORIGIN',
];

export function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const keys = isProd ? [...REQUIRED, ...REQUIRED_IN_PRODUCTION] : REQUIRED;
  const missing = keys.filter(k => !process.env[k]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (isProd) {
    if (process.env.PUBLIC_APP_ORIGIN === '*') {
      throw new Error('PUBLIC_APP_ORIGIN must not be "*" in production — set it to your HTTPS origin.');
    }
    if (process.env.STORAGE_DRIVER !== 'supabase') {
      throw new Error('STORAGE_DRIVER must be "supabase" in production.');
    }
  }
}

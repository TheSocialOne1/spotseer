/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the ngrok tunnel host reach dev-mode HMR/chunk endpoints during phone testing.
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io"],
  // Local-dev embedded Postgres ships WASM; load it with plain Node require.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;

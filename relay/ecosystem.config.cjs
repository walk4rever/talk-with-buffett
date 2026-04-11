// server.ts loads .env.relay via dotenv relative to cwd, so we anchor cwd
// to this config file's directory — works both locally and on the server
// (wherever the relay/ folder is rsynced to).
const BASE_CWD = __dirname;

const services = [
  {
    enabled: true,
    name: "asr-relay",
    script: "npm",
    args: "start",
    port: 3001,
  },
];

module.exports = {
  apps: services.filter((s) => s.enabled).map((s) => ({
    name: s.name,
    script: s.script,
    args: s.args,
    cwd: BASE_CWD,
    env: {
      NODE_ENV: "production",
      PORT: s.port,
    },
    restart_delay: 3000,
    max_restarts: 10,
    autorestart: true,
  })),
};

// Waits until a TCP port accepts connections: `node scripts/wait-port.mjs 51214 [timeoutSeconds]`.
// Used by `npm run dev` so the API starts only after the local Postgres (prisma dev) is up.
import net from 'node:net';

const port = Number(process.argv[2]);
const deadline = Date.now() + Number(process.argv[3] ?? 120) * 1000;

const tryOnce = () =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.end(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

let announced = false;
while (!(await tryOnce())) {
  if (Date.now() > deadline) {
    console.error(`Port ${port} did not open in time — is the database running?`);
    process.exit(1);
  }
  if (!announced) console.log(`Waiting for the database on port ${port}…`);
  announced = true;
  await new Promise((r) => setTimeout(r, 500));
}

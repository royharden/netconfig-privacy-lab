import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { verifyVault } from './custody';

async function main(): Promise<void> {
  const mode = process.argv[2], vault = process.argv[3];
  if (!['--g1', '--preflight'].includes(mode ?? '') || !vault) throw new Error('usage: freeze-check --g1|--preflight VAULT');
  const pin = await readFile('gold/heldout/MANIFEST.sha256', 'utf8');
  const { receipt } = await verifyVault(vault, pin, mode === '--preflight');
  await mkdir('evaluation', { recursive: true });
  await writeFile(`evaluation/${mode === '--g1' ? 'g1' : 'preflight'}-receipt.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
}
main().catch(() => { console.error('freeze-check refused: custody validation failed; no labels displayed'); process.exitCode = 1; });

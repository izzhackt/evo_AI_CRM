import { GET as getWahaConfigStatus } from '../route';

export async function GET() {
  return getWahaConfigStatus();
}

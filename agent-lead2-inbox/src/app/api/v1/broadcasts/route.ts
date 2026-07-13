import { firstLaunchDisabledResponse } from '@/lib/first-launch-disabled-response';

export async function GET() {
  return firstLaunchDisabledResponse('broadcasts');
}

export async function POST() {
  return firstLaunchDisabledResponse('broadcasts');
}

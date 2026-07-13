import { firstLaunchDisabledResponse } from '@/lib/first-launch-disabled-response';

export async function GET() {
  return firstLaunchDisabledResponse('broadcasts');
}

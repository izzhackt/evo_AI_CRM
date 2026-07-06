import { firstLaunchDisabledResponse } from '@/lib/first-launch-disabled-response';

export async function POST() {
  return firstLaunchDisabledResponse('meta_transport');
}

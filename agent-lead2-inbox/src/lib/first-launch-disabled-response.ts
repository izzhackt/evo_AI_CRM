import { NextResponse } from 'next/server';

import {
  FIRST_LAUNCH_DISABLED_STATUS,
  firstLaunchDisabledPayload,
  type FirstLaunchDisabledFeature,
} from './first-launch-disabled';

export function firstLaunchDisabledResponse(
  feature: FirstLaunchDisabledFeature,
) {
  return NextResponse.json(firstLaunchDisabledPayload(feature), {
    status: FIRST_LAUNCH_DISABLED_STATUS,
  });
}

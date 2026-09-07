import "server-only";

import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { createStudentPortalInviteAuthProvider } from "./student-portal-invite-auth-provider.ts";
import type { StudentPortalInviteCoordinatorDependencies } from "./student-portal-invite-coordinator.ts";
import type { StudentPortalInviteReconcilerDependencies } from "./student-portal-invite-reconciler.ts";
import { createStudentPortalInviteStore } from "./student-portal-invite-store.ts";

export class StudentPortalInviteRuntimeConfigurationError extends Error {
  constructor() {
    super("Student Portal invite runtime is not configured.");
    this.name = "StudentPortalInviteRuntimeConfigurationError";
  }
}

export function readStudentInviteOtpExpirySeconds(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const value = environment.EVO_STUDENT_INVITE_OTP_EXPIRY_SECONDS;
  if (!value || !/^(?:[1-9][0-9]{1,5})$/.test(value)) {
    throw new StudentPortalInviteRuntimeConfigurationError();
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 604800) {
    throw new StudentPortalInviteRuntimeConfigurationError();
  }
  return seconds;
}

export function createStudentPortalInviteCoordinatorDependencies(): StudentPortalInviteCoordinatorDependencies {
  const serviceClient = createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
  return Object.freeze({
    store: createStudentPortalInviteStore(serviceClient),
    auth: createStudentPortalInviteAuthProvider(serviceClient),
    otpExpirySeconds: readStudentInviteOtpExpirySeconds(),
    nodeEnv: process.env.NODE_ENV,
  });
}

export function createStudentPortalInviteReconcilerDependencies(): StudentPortalInviteReconcilerDependencies {
  const serviceClient = createPlatformSupabaseServiceClient(
    getPlatformSupabaseBackendConfig(),
  );
  return Object.freeze({
    store: createStudentPortalInviteStore(serviceClient),
    auth: createStudentPortalInviteAuthProvider(serviceClient),
    otpExpirySeconds: readStudentInviteOtpExpirySeconds(),
  });
}

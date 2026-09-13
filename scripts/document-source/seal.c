#define _GNU_SOURCE
#include <node_api.h>
#include "seal-policy.h"

NAPI_MODULE_INIT() {
  (void)exports;
  seal_execution();
  napi_value sealed;
  if (napi_get_boolean(env, true, &sealed) != napi_ok) _exit(71);
  return sealed;
}

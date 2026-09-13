/* Applied before loading document parsers. Stacks with, never replaces, the
 * launcher's allowlist. TSYNC covers Node's already-created runtime threads. */
#ifndef EVO_DOCUMENT_SEAL_POLICY_H
#define EVO_DOCUMENT_SEAL_POLICY_H
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define EVO_SEAL_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define EVO_SEAL_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported document runtime architecture
#endif

static void seal_execution(void) {
  struct sock_filter instructions[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EVO_SEAL_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_execve, 3, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_execveat, 2, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_seccomp, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
  };
  const struct sock_fprog program = {
    .len = (unsigned short)(sizeof(instructions) / sizeof(instructions[0])), .filter = instructions,
  };
  // TSYNC can return a positive unsynchronized thread ID, not just -1.
  if (syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &program) != 0) _exit(71);
}
#endif

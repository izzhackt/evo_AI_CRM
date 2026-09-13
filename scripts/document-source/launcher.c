/* Fixed, unprivileged document-source-v1 supervisor. Never accept an executable/path. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define RUNTIME "/opt/evo-document-runtime"
#define MAX_OUTPUT 4096
#define WALL_MS 15000
#define AS_LIMIT ((rlim_t)2 * 1024 * 1024 * 1024)
/* Bookworm's build headers predate ABI3. Exact Linux6.2 UAPI value;
 * runtime ABI>=3 is still mandatory and checked before creating the ruleset. */
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#if defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define EXPECTED_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported document runtime architecture
#endif

static const char unavailable[] = "{\"status\":\"rejected\",\"code\":\"source_unavailable\"}\n";
static int64_t monotonic_ms(void) {
  struct timespec time;
  if (clock_gettime(CLOCK_MONOTONIC, &time)) return -1;
  return (int64_t)time.tv_sec * 1000 + time.tv_nsec / 1000000;
}
static void stop_child(void) { _exit(71); }
static void limit(int resource, rlim_t value) {
  const struct rlimit bound = {value, value};
  struct rlimit actual;
  if (setrlimit(resource, &bound) || getrlimit(resource, &actual)
      || actual.rlim_cur != value || actual.rlim_max != value) stop_child();
}
static void landlock_path(int ruleset, const char *path, uint64_t rights) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) stop_child();
  const struct landlock_path_beneath_attr rule = {.allowed_access = rights, .parent_fd = fd};
  if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) stop_child();
  close(fd);
}
static void filesystem_policy(void) {
  int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 3) stop_child();
  const uint64_t read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  const struct landlock_ruleset_attr attr = {.handled_access_fs =
    LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | read |
    LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |
    LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |
    LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
    LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE};
  int fd = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (fd < 0) stop_child();
  landlock_path(fd, RUNTIME, read);
  landlock_path(fd, "/usr/local/bin/node", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE);
  landlock_path(fd, "/usr/lib", read);
#if defined(__x86_64__)
  landlock_path(fd, "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE);
#elif defined(__aarch64__)
  landlock_path(fd, "/usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE);
#endif
  landlock_path(fd, "/etc/ld.so.cache", LANDLOCK_ACCESS_FS_READ_FILE);
  if (syscall(SYS_landlock_restrict_self, fd, 0)) stop_child();
  close(fd);
}

/* No arbitrary syscall numbers, compatibility ABI, network, ptrace or new processes.
 * clone3 returns ENOSYS so glibc uses the argument-checkable legacy clone ABI.
 * Same-process libuv/libvips threads share the process's AS and CPU accounting. */
#define ALLOW(name) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##name, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
static void syscall_policy(void) {
  const unsigned thread_flags = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |
    CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID |
    CLONE_CHILD_CLEARTID | CLONE_CHILD_SETTID | CLONE_DETACHED;
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EXPECTED_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 8),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, ~thread_flags),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_VM | CLONE_THREAD),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, CLONE_VM | CLONE_THREAD, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_prctl, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, PR_SET_NAME, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_prlimit64, 0, 8),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 5),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2]) + 4),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    /* libuv uses FIONBIO on its already-owned stdio/event pipes. No device ioctl. */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONBIO, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    ALLOW(read), ALLOW(write), ALLOW(close), ALLOW(fstat), ALLOW(newfstatat), ALLOW(statx),
    ALLOW(lseek), ALLOW(pread64), ALLOW(readv), ALLOW(writev),
    ALLOW(mmap), ALLOW(mprotect), ALLOW(munmap), ALLOW(mremap), ALLOW(brk), ALLOW(madvise),
    ALLOW(rt_sigaction), ALLOW(rt_sigprocmask), ALLOW(rt_sigreturn), ALLOW(sigaltstack),
    ALLOW(set_tid_address), ALLOW(set_robust_list), ALLOW(rseq), ALLOW(futex),
    ALLOW(sched_yield), ALLOW(sched_getaffinity), ALLOW(getcpu),
    ALLOW(clock_gettime), ALLOW(gettimeofday), ALLOW(times), ALLOW(nanosleep), ALLOW(clock_nanosleep),
    ALLOW(epoll_create1), ALLOW(epoll_ctl), ALLOW(epoll_pwait), ALLOW(eventfd2), ALLOW(pipe2),
    ALLOW(getrandom), ALLOW(fcntl), ALLOW(dup), ALLOW(dup3),
    ALLOW(openat), ALLOW(faccessat), ALLOW(faccessat2), ALLOW(readlinkat), ALLOW(getcwd),
    ALLOW(getdents64), ALLOW(uname), ALLOW(getpid), ALLOW(getppid), ALLOW(gettid),
    ALLOW(getuid), ALLOW(geteuid), ALLOW(getgid), ALLOW(getegid), ALLOW(getgroups),
    ALLOW(getrlimit), ALLOW(execve), ALLOW(exit), ALLOW(exit_group),
#if defined(__x86_64__)
    ALLOW(arch_prctl), ALLOW(access), ALLOW(readlink), ALLOW(epoll_wait), ALLOW(dup2),
    ALLOW(time), ALLOW(stat), ALLOW(lstat),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
  };
  const struct sock_fprog program = {.len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter};
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) stop_child();
}

#ifdef EVO_DOCUMENT_TEST
/* Compiled only into the separately named diagnostic binary in the test image. */
#include <sys/socket.h>
#include <sys/mman.h>
static void diagnostic(const char *name) {
  if (!strcmp(name, "policy")) {
    int network = socket(AF_INET, SOCK_STREAM, 0);
    int unix_network = socket(AF_UNIX, SOCK_STREAM, 0);
    int outside = open("/tmp/evo-document-outside", O_RDONLY);
    int parent_env = open("/proc/self/environ", O_RDONLY);
    int inherited = fcntl(63, F_GETFD);
    int fork_denied = syscall(SYS_clone, SIGCHLD, 0, 0, 0, 0);
    struct rlimit as, cpu, core, files;
    getrlimit(RLIMIT_AS, &as); getrlimit(RLIMIT_CPU, &cpu);
    getrlimit(RLIMIT_CORE, &core); getrlimit(RLIMIT_NOFILE, &files);
    int ok = network == -1 && unix_network == -1 && outside == -1 && parent_env == -1 && inherited == -1
      && fork_denied == -1 && getenv("EVO_DOCUMENT_TEST_SECRET") == NULL
      && as.rlim_cur == AS_LIMIT && as.rlim_max == AS_LIMIT && cpu.rlim_cur == 10 && cpu.rlim_max == 10
      && core.rlim_max == 0 && files.rlim_max == 64;
    if (!ok) stop_child();
    const char result[] = "{\"policy\":\"enforced\",\"memory\":2147483648,\"cpu\":10,\"fd\":64}\n";
    write(STDOUT_FILENO, result, sizeof(result) - 1); _exit(0);
  }
  if (!strcmp(name, "memory")) {
    void *allocated = mmap(NULL, AS_LIMIT + 4096, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (allocated != MAP_FAILED || errno != ENOMEM) stop_child();
    const char result[] = "{\"memory\":\"bounded\"}\n";
    write(STDOUT_FILENO, result, sizeof(result) - 1); _exit(0);
  }
  if (!strcmp(name, "cpu")) { volatile uint64_t number = 1; for (;;) number = number * 3 + 1; }
  if (!strcmp(name, "wall")) { struct timespec delay = {.tv_sec = 60}; for (;;) nanosleep(&delay, NULL); }
  if (!strcmp(name, "output")) { char excess[MAX_OUTPUT + 1]; memset(excess, 'x', sizeof(excess)); write(1, excess, sizeof(excess)); _exit(0); }
  stop_child();
}
#endif

static void child(int output_fd, pid_t supervisor, const char *test_mode) {
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != supervisor) stop_child();
  if (dup2(output_fd, STDOUT_FILENO) < 0) stop_child();
  int null_fd = open("/dev/null", O_WRONLY | O_CLOEXEC);
  if (null_fd < 0 || dup2(null_fd, STDERR_FILENO) < 0) stop_child();
  if (syscall(SYS_close_range, 3U, ~0U, 0)) stop_child();
  if (clearenv() || chdir(RUNTIME) || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) stop_child();
  limit(RLIMIT_AS, AS_LIMIT); limit(RLIMIT_CPU, 10); limit(RLIMIT_CORE, 0); limit(RLIMIT_NOFILE, 64);
  filesystem_policy(); syscall_policy();
#ifdef EVO_DOCUMENT_TEST
  if (test_mode) diagnostic(test_mode);
#else
  (void)test_mode;
#endif
  char *const argv[] = {"/usr/local/bin/node", "--max-old-space-size=256", "--disable-wasm-trap-handler",
    "--v8-pool-size=1", RUNTIME "/inspect.mjs", NULL};
  char *const env[] = {"LANG=C.UTF-8", "TZ=UTC", "UV_THREADPOOL_SIZE=1", "MALLOC_ARENA_MAX=2", NULL};
  execve(argv[0], argv, env);
  stop_child();
}

int main(int argc, char **argv) {
  const char *test_mode = NULL;
#ifdef EVO_DOCUMENT_TEST
  if (argc == 2) test_mode = argv[1];
  else if (argc != 1) return 64;
  /* A high pre-opened descriptor demonstrates that child cleanup is real. */
  int inherited = open("/tmp/evo-document-outside", O_RDONLY);
  if (inherited >= 0) { if (dup2(inherited, 63) < 0) return 71; close(inherited); }
#else
  (void)argv;
  if (argc != 1) return 64;
#endif
  pid_t caller = getppid();
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != caller) return 71;
  signal(SIGPIPE, SIG_IGN);
  int descriptors[2];
  if (pipe2(descriptors, O_CLOEXEC | O_NONBLOCK)) return 71;
  int64_t started = monotonic_ms();
  if (started < 0) return 71;
  pid_t supervisor = getpid(), pid = fork();
  if (pid < 0) return 71;
  if (!pid) child(descriptors[1], supervisor, test_mode);
  close(descriptors[1]);
  char output[MAX_OUTPUT + 1];
  size_t count = 0;
  int status = 0, done = 0, eof = 0, failed = 0;
  while (!done || !eof) {
    int64_t now = monotonic_ms();
    if (now < 0 || now - started >= WALL_MS) { failed = 1; break; }
    ssize_t amount = read(descriptors[0], output + count, sizeof(output) - count);
    if (amount > 0) { count += (size_t)amount; if (count > MAX_OUTPUT) { failed = 1; break; } }
    else if (!amount) eof = 1;
    else if (errno != EAGAIN && errno != EINTR) { failed = 1; break; }
    if (!done) {
      pid_t waited = waitpid(pid, &status, WNOHANG);
      if (waited == pid) done = 1;
      else if (waited < 0 && errno != EINTR) { failed = 1; break; }
    }
    if (!done || !eof) { struct pollfd pollfd = {.fd = descriptors[0], .events = POLLIN | POLLHUP}; poll(&pollfd, 1, 20); }
  }
  if (!done) { kill(pid, SIGKILL); while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} }
  close(descriptors[0]);
#ifdef EVO_DOCUMENT_TEST
  if (test_mode && (!strcmp(test_mode, "cpu") || !strcmp(test_mode, "wall"))) {
    struct rusage usage;
    if (getrusage(RUSAGE_CHILDREN, &usage)) return 71;
    char report[160];
    int size = snprintf(report, sizeof(report), "{\"signal\":%d,\"deadline\":%s,\"cpuMilliseconds\":%ld}\n",
      WIFSIGNALED(status) ? WTERMSIG(status) : 0, failed ? "true" : "false",
      usage.ru_utime.tv_sec * 1000 + usage.ru_utime.tv_usec / 1000 + usage.ru_stime.tv_sec * 1000 + usage.ru_stime.tv_usec / 1000);
    return write(1, report, size) < 0 ? 74 : 0;
  }
#endif
  if (failed || !WIFEXITED(status) || WEXITSTATUS(status) || !count) {
    return write(1, unavailable, sizeof(unavailable) - 1) < 0 ? 74 : 0;
  }
  return write(1, output, count) < 0 ? 74 : 0;
}

/* Linux query worker boundary. Build with cc -O2 -Wall -Wextra -Werror.
 * Configuration is supplied only by the trusted broker, never by SQL.
 * There is intentionally no writable filesystem grant and no fallback mode.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <sys/xattr.h>
#include <unistd.h>

#if defined(__x86_64__)
#define QUERY_AUDIT_ARCH AUDIT_ARCH_X86_64
#define QUERY_ELF_LOADER "/lib64/ld-linux-x86-64.so.2"
#elif defined(__aarch64__)
#define QUERY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#define QUERY_ELF_LOADER "/lib/ld-linux-aarch64.so.1"
#else
#error Unsupported sandbox architecture
#endif

/* Stable ABI layout, including the ABI 6 scopes missing in older headers. */
struct query_ruleset { uint64_t fs, net, scoped; };
#define QUERY_FS_ALL ((1ULL << 16) - 1)
#define QUERY_READ ((1ULL << 2) | (1ULL << 3))
#define QUERY_NET_ALL 3ULL
#define QUERY_SCOPED_ALL 3ULL
#define MAX_PATHS 128

static void fail(const char *operation) {
  fprintf(stderr, "query-sandbox: %s: %s\n", operation, strerror(errno));
  exit(91);
}
static void usage(void) {
  fputs("query-sandbox: invalid trusted launcher configuration\n", stderr);
  exit(92);
}
static unsigned long long number(const char *value) {
  char *end = NULL;
  errno = 0;
  unsigned long long result = strtoull(value, &end, 10);
  if (errno || !*value || *end || *value == '-' || !result || result == RLIM_INFINITY) usage();
  return result;
}
static void limit(int kind, rlim_t value) {
  struct rlimit r = {value, value};
  if (setrlimit(kind, &r)) fail("setrlimit");
  struct rlimit actual;
  if (getrlimit(kind, &actual) || actual.rlim_cur != value || actual.rlim_max != value)
    fail("verify rlimit");
}
static void grant(int ruleset, const char *path, int executable) {
  if (path[0] != '/' || !strcmp(path, "/")) usage();
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) fail("open required read path");
  struct stat st;
  if (fstat(fd, &st)) fail("stat read path");
  if (executable) {
    if (!S_ISREG(st.st_mode) || (st.st_mode & (S_ISUID | S_ISGID))) {
      errno = EPERM; fail("runtime must be an ordinary executable");
    }
    /* Privileged executable metadata can clear PDEATHSIG on exec, even when
     * no_new_privs prevents acquiring its privilege. No such runtime is used.
     */
    errno = 0;
    if (getxattr(path, "security.capability", NULL, 0) >= 0 ||
        (errno != ENODATA && errno != ENOTSUP)) {
      errno = EPERM; fail("runtime must not have file capabilities");
    }
  }
  struct landlock_path_beneath_attr rule = {
    .allowed_access = (S_ISDIR(st.st_mode) ? QUERY_READ : QUERY_READ & ~(1ULL << 3)) |
                      (executable ? 1ULL : 0ULL),
    .parent_fd = fd
  };
  if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0))
    fail("Landlock read rule");
  if (close(fd)) fail("close read path");
}

/* A default-deny filter is deliberately independent of Landlock's TCP-only
 * networking coverage. No socket/IPC/process-inspection system call is allowed.
 * clone3 reports ENOSYS so libc uses clone, whose flags must create a thread.
 */
#define ALLOW(name) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##name, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
static void restrict_syscalls(void) {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, QUERY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef SYS_clone3
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
#endif
    /* prlimit64 otherwise permits changing another same-UID worker's limits.
     * Only libc's own-process read form (pid=0, new_limit=NULL) is needed.
     */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_prlimit64, 0, 8),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 5),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2]) + 4),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    /* libuv sets nonblocking stdio with FIONBIO. Neither permitted request
     * creates an authority-bearing descriptor or controls a device.
     */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, 0, 6),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONBIO, 2, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONREAD, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 6),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_THREAD | CLONE_VM | CLONE_SIGHAND),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, CLONE_THREAD | CLONE_VM | CLONE_SIGHAND, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    ALLOW(read), ALLOW(write), ALLOW(readv), ALLOW(writev), ALLOW(close),
    ALLOW(fstat), ALLOW(newfstatat), ALLOW(statx), ALLOW(lseek),
    ALLOW(pread64), ALLOW(pwrite64), ALLOW(openat), ALLOW(readlinkat),
    ALLOW(getdents64), ALLOW(fcntl), ALLOW(dup), ALLOW(dup3),
    ALLOW(mmap), ALLOW(mprotect), ALLOW(munmap), ALLOW(mremap),
    ALLOW(madvise), ALLOW(brk), ALLOW(msync),
    ALLOW(rt_sigaction), ALLOW(rt_sigprocmask), ALLOW(rt_sigreturn),
    ALLOW(sigaltstack), ALLOW(tgkill), ALLOW(futex), ALLOW(set_robust_list),
    ALLOW(set_tid_address), ALLOW(rseq), ALLOW(sched_yield),
    ALLOW(sched_getaffinity), ALLOW(sched_getparam), ALLOW(sched_getscheduler),
    ALLOW(sched_get_priority_max), ALLOW(sched_get_priority_min),
    ALLOW(clock_gettime), ALLOW(clock_getres), ALLOW(clock_nanosleep),
    ALLOW(nanosleep), ALLOW(gettimeofday), ALLOW(getpid), ALLOW(getppid),
    ALLOW(gettid), ALLOW(getuid), ALLOW(geteuid), ALLOW(getgid), ALLOW(getegid),
    ALLOW(getgroups), ALLOW(getrandom), ALLOW(uname), ALLOW(sysinfo),
    ALLOW(getrusage), ALLOW(getrlimit),
    ALLOW(epoll_create1), ALLOW(epoll_ctl), ALLOW(epoll_pwait),
    ALLOW(eventfd2), ALLOW(pipe2), ALLOW(ppoll), ALLOW(pselect6),
    ALLOW(getsockname), ALLOW(getsockopt),
    ALLOW(restart_syscall), ALLOW(execve), ALLOW(exit), ALLOW(exit_group),
    ALLOW(getcwd), ALLOW(faccessat), ALLOW(faccessat2), ALLOW(statfs), ALLOW(fstatfs),
#ifdef SYS_arch_prctl
    ALLOW(arch_prctl),
#endif
#ifdef SYS_open
    ALLOW(open), ALLOW(stat), ALLOW(lstat), ALLOW(access), ALLOW(readlink),
    ALLOW(poll), ALLOW(select), ALLOW(epoll_wait), ALLOW(dup2), ALLOW(time),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
  };
  struct sock_fprog program = {.len = sizeof(filter) / sizeof(filter[0]), .filter = filter};
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail("seccomp");
}

int main(int argc, char **argv) {
  const char *paths[MAX_PATHS];
  int count = 0, index = 1;
  unsigned long long uid = 0, gid = 0, parent = 0, memory = 0, cpu = 0, threads = 0;
  for (; index < argc && strcmp(argv[index], "--"); index += 2) {
    if (index + 1 >= argc) usage();
    const char *option = argv[index], *value = argv[index + 1];
    if (!strcmp(option, "--uid")) uid = number(value);
    else if (!strcmp(option, "--gid")) gid = number(value);
    else if (!strcmp(option, "--parent-pid")) parent = number(value);
    else if (!strcmp(option, "--memory-bytes")) memory = number(value);
    else if (!strcmp(option, "--cpu-seconds")) cpu = number(value);
    else if (!strcmp(option, "--threads")) threads = number(value);
    else if (!strcmp(option, "--read") && count < MAX_PATHS) paths[count++] = value;
    else usage();
  }
  if (++index >= argc || argv[index][0] != '/' || !uid || uid >= UINT32_MAX ||
      !gid || gid >= UINT32_MAX || !parent || parent > INT32_MAX ||
      !memory || !cpu || !threads || !count) usage();
  /* A trusted expected parent closes the race where the broker died before
   * this executable even started. Recheck after installing the death signal.
   */
  if ((unsigned long long)getppid() != parent) { errno = ESRCH; fail("broker parent disappeared"); }

  /* Anonymous broker pipes only. Node uses unnamed Unix stream socketpairs
   * for stdio, so validate those as well; named/network sockets and files are
   * never accepted. sendmsg/recvmsg remain denied, preventing FD transfer.
   */
  for (int fd = 0; fd < 3; fd++) {
    struct stat st;
    if (fstat(fd, &st)) fail("stat stdio");
    if (S_ISFIFO(st.st_mode)) continue;
    struct sockaddr_un local = {0}, peer = {0};
    socklen_t local_len = sizeof(local), peer_len = sizeof(peer), type_len = sizeof(int);
    int type = 0;
    if (!S_ISSOCK(st.st_mode) || getsockname(fd, (struct sockaddr *)&local, &local_len) ||
        getpeername(fd, (struct sockaddr *)&peer, &peer_len) ||
        getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_len) ||
        local.sun_family != AF_UNIX || peer.sun_family != AF_UNIX || type != SOCK_STREAM ||
        local_len != offsetof(struct sockaddr_un, sun_path) ||
        peer_len != offsetof(struct sockaddr_un, sun_path)) {
      errno = EINVAL; fail("stdio must be anonymous broker pipes");
    }
  }
  if (syscall(SYS_close_range, 3U, ~0U, 0)) fail("close inherited descriptors");
  if (chdir("/")) fail("clear working directory");
  if (clearenv() || setenv("LANG", "C.UTF-8", 1) || setenv("TZ", "UTC", 1) ||
      setenv("HOME", "/nonexistent", 1)) fail("sanitize environment");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("no new privileges");
  if (geteuid() == 0) {
    /* Containers may omit CAP_SETPCAP. Drop the bounding set when allowed;
     * no_new_privs plus zero permitted/inheritable/ambient sets prevent any
     * retained bounding bit from granting authority through exec.
     */
    int retained = 0;
    for (unsigned cap = 0; cap < 64; cap++) {
      int present = prctl(PR_CAPBSET_READ, cap, 0, 0, 0);
      if (present < 0 && errno == EINVAL) break;
      if (present < 0) fail("read capability bounding set");
      if (present && prctl(PR_CAPBSET_DROP, cap, 0, 0, 0)) {
        if (errno != EPERM) fail("drop capability bounding set");
        retained++;
      }
    }
    if (retained) fputs("query-sandbox: bounding bits retained; no_new_privs enforced\n", stderr);
    if (setgroups(0, NULL) || setresgid(gid, gid, gid) || setresuid(uid, uid, uid))
      fail("drop identity");
  } else if (getuid() != uid || geteuid() != uid || getgid() != gid || getegid() != gid) {
    errno = EPERM; fail("nonroot identity mismatch");
  }
  /* Changing credentials clears PDEATHSIG, so install it after the UID drop.
   * This remains effective while native SQL is busy and not reading its pipe.
   */
  if (prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0)) fail("broker death signal");
  if ((unsigned long long)getppid() != parent) { errno = ESRCH; fail("broker parent disappeared"); }
  struct __user_cap_header_struct header = {_LINUX_CAPABILITY_VERSION_3, 0};
  struct __user_cap_data_struct caps[2] = {{0}};
  if (syscall(SYS_capset, &header, caps)) fail("clear capabilities");
  if (syscall(SYS_capget, &header, caps)) fail("read capabilities");
  if (caps[0].effective || caps[0].permitted || caps[0].inheritable ||
      caps[1].effective || caps[1].permitted || caps[1].inheritable) {
    errno = EPERM; fail("capabilities remain");
  }
  if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0)) fail("clear ambient capabilities");
  if (prctl(PR_SET_DUMPABLE, 0)) fail("disable dumpability");
  uid_t real_uid, effective_uid, saved_uid;
  gid_t real_gid, effective_gid, saved_gid;
  if (getresuid(&real_uid, &effective_uid, &saved_uid) ||
      getresgid(&real_gid, &effective_gid, &saved_gid) ||
      real_uid != uid || effective_uid != uid || saved_uid != uid ||
      real_gid != gid || effective_gid != gid || saved_gid != gid ||
      prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1) {
    errno = EPERM; fail("verify restricted identity");
  }
  limit(RLIMIT_CORE, 0);
  limit(RLIMIT_FSIZE, 0);
  limit(RLIMIT_NOFILE, 64);
  limit(RLIMIT_AS, memory);
  limit(RLIMIT_CPU, cpu);
  limit(RLIMIT_NPROC, threads);

  int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 7) { errno = ENOTSUP; fail("Landlock ABI 7 required"); }
  struct query_ruleset attributes = {QUERY_FS_ALL, QUERY_NET_ALL, QUERY_SCOPED_ALL};
  int ruleset = syscall(SYS_landlock_create_ruleset, &attributes, sizeof(attributes), 0);
  if (ruleset < 0) fail("create Landlock domain");
  for (int i = 0; i < count; i++) grant(ruleset, paths[i], 0);
  grant(ruleset, argv[index], 1);
  /* ELF's interpreter also needs execute permission. Loading another ELF via
   * this ordinary interpreter does not apply that file's set-ID metadata.
   */
  grant(ruleset, QUERY_ELF_LOADER, 1);
  char self[64];
  snprintf(self, sizeof(self), "/proc/%ld", (long)getpid());
  grant(ruleset, self, 0);
  if (syscall(SYS_landlock_restrict_self, ruleset, 0)) fail("enter Landlock domain");
  if (close(ruleset)) fail("close Landlock ruleset");
  restrict_syscalls();
  fprintf(stderr, "query-sandbox: ready abi=%d uid=%llu as=%llu cpu=%llu nproc=%llu nproc_scope=uid\n",
          abi, uid, memory, cpu, threads);
  execv(argv[index], &argv[index]);
  fail("exec worker");
}

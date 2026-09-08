/* Executable OS-boundary test, independent of DuckDB's SQL restrictions. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/ptrace.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <unistd.h>

static int failures;
static void check(int ok, const char *name) {
  printf("%s %s\n", ok ? "PASS" : "FAIL", name);
  if (!ok) failures++;
}
static int denied_open(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd >= 0) close(fd);
  return fd < 0 && (errno == EACCES || errno == EPERM);
}
static void *thread_work(void *value) { return value; }
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "--spin")) {
    puts("SPINNING");
    fflush(stdout);
    for (;;) __asm__ volatile("" ::: "memory");
  }
  if (argc != 5) return 92;
  char *other_args[] = {argv[4], "--unexpected-exec", NULL};
  char *empty_env[] = {NULL};
  check(execve(argv[4], other_args, empty_env) < 0 && (errno == EACCES || errno == EPERM),
        "readable non-runtime executable denied");
  check(fcntl(atoi(argv[3]), F_GETFD) < 0 && errno == EBADF, "inherited descriptor closed");
  check(getenv("QUERY_SANDBOX_SENTINEL") == NULL, "environment sanitized");
  check(denied_open(argv[1]), "foreign file denied");
  char proc[128];
  snprintf(proc, sizeof(proc), "/proc/%s/environ", argv[2]);
  check(denied_open(proc), "parent environment denied");
  snprintf(proc, sizeof(proc), "/proc/%s/fd/0", argv[2]);
  check(denied_open(proc), "parent descriptors denied");
  const int domains[] = {AF_INET, AF_INET6, AF_UNIX};
  const int types[] = {SOCK_STREAM, SOCK_DGRAM, SOCK_RAW};
  for (unsigned i = 0; i < sizeof(domains) / sizeof(domains[0]); i++) {
    for (unsigned j = 0; j < sizeof(types) / sizeof(types[0]); j++) {
      int fd = socket(domains[i], types[j], 0);
      check(fd < 0 && errno == EPERM, "new socket denied");
      if (fd >= 0) close(fd);
    }
  }
  int pair[2];
  check(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) < 0 && errno == EPERM,
        "socketpair denied");
#ifdef SYS_fork
  pid_t forked = syscall(SYS_fork);
  if (forked == 0) _exit(94);
  check(forked < 0 && errno == EPERM, "fork denied");
#endif
  check(ptrace(PTRACE_PEEKDATA, atoi(argv[2]), NULL, NULL) < 0 && errno == EPERM,
        "ptrace denied");
  check(kill(atoi(argv[2]), 0) < 0 && errno == EPERM, "parent signal denied");
  check(syscall(SYS_process_vm_readv, atoi(argv[2]), NULL, 0, NULL, 0, 0) < 0 && errno == EPERM,
        "process memory denied");
  char output[4096];
  snprintf(output, sizeof(output), "%s.out", argv[1]);
  int out = open(output, O_CREAT | O_WRONLY | O_EXCL, 0600);
  check(out < 0 && (errno == EACCES || errno == EPERM), "filesystem write denied");
  if (out >= 0) close(out);
  struct rlimit limit;
  check(!getrlimit(RLIMIT_AS, &limit) && limit.rlim_cur != RLIM_INFINITY &&
        limit.rlim_cur == limit.rlim_max, "hard virtual memory limit active");
  struct rlimit ignored, lower = {1024, 1024};
  check(syscall(SYS_prlimit64, atoi(argv[2]), RLIMIT_AS, NULL, &ignored) < 0 && errno == EPERM,
        "foreign process resource limits inaccessible");
  check(syscall(SYS_prlimit64, atoi(argv[2]), RLIMIT_AS, &lower, NULL) < 0 && errno == EPERM,
        "foreign process resource limit mutation denied");
  check(syscall(SYS_prlimit64, 0, RLIMIT_AS, &lower, NULL) < 0 && errno == EPERM,
        "own resource limit mutation denied");
  void *large = mmap(NULL, limit.rlim_max + 4096, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  check(large == MAP_FAILED && errno == ENOMEM, "virtual memory ceiling enforced");
  if (large != MAP_FAILED) munmap(large, limit.rlim_max + 4096);
  pthread_t thread;
  void *result = NULL;
  int error = pthread_create(&thread, NULL, thread_work, &failures);
  check(error == 0, "runtime thread creation supported");
  if (!error) {
    pthread_join(thread, &result);
    check(result == &failures, "thread execution supported");
  }
  check(getuid() != 0 && geteuid() != 0, "nonroot identity");
  FILE *status = fopen("/proc/self/status", "r");
  check(status != NULL, "own process status available");
  if (status) {
    char line[256];
    unsigned long long effective = ~0ULL, permitted = ~0ULL, inheritable = ~0ULL, ambient = ~0ULL;
    while (fgets(line, sizeof(line), status)) {
      if (sscanf(line, "CapEff: %llx", &effective) == 1) continue;
      if (sscanf(line, "CapPrm: %llx", &permitted) == 1) continue;
      if (sscanf(line, "CapInh: %llx", &inheritable) == 1) continue;
      (void)sscanf(line, "CapAmb: %llx", &ambient);
    }
    fclose(status);
    check(!(effective | permitted | inheritable | ambient), "capabilities cleared");
  }
  return failures ? 1 : 0;
}

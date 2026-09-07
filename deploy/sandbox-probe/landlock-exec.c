/*
 * landlock-exec — restrict this process to a named set of paths, then exec.
 *
 * Why this exists. The first platform probe found that Railway's container
 * denies mount-propagation changes (`bwrap: Failed to make / slave: Permission
 * denied`, `unshare: cannot change root filesystem propagation: Permission
 * denied`) even though the userns sysctls are permissive — a seccomp filter is
 * active (`Seccomp: 2`) and the container holds no CAP_SYS_ADMIN. That rules
 * out every mount-namespace sandbox, bubblewrap included.
 *
 * Landlock needs none of that. It is an unprivileged LSM: a process asks the
 * kernel to permanently narrow its own filesystem (and, from ABI 4, TCP)
 * access, with no capability, no namespace, and no mount operation. The
 * restriction is inherited by children and cannot be lifted, which is exactly
 * the shape a per-workspace query process needs.
 *
 * Usage:
 *   landlock-exec <rw-path>[:...] <ro-path>[:...] -- <command> [args...]
 *
 * Everything outside those paths becomes unreachable to this process and to
 * anything it execs. With ABI 4 or later, TCP bind and connect are denied
 * outright.
 *
 * Both lists matter in practice. A runtime needs more than its own workspace to
 * start at all — `/proc/self`, `/dev/urandom`, `/etc` — and a process that
 * cannot read them does not fail with a clear error, it blocks. The first run of
 * this helper granted too little and the child hung until the probe killed it,
 * which reads identically to "the sandbox does not work". Grant what the runtime
 * needs, and grant it explicitly.
 *
 * Exit codes are distinguishable on purpose, because "the sandbox is
 * unavailable" and "the sandbox engaged and the workload failed" are different
 * findings and a probe that conflates them is useless:
 *   90  Landlock unsupported by this kernel
 *   91  Landlock supported but a restriction call failed
 *   92  usage error
 *   otherwise: whatever the exec'd command returns
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif
#ifndef LANDLOCK_ACCESS_NET_BIND_TCP
#define LANDLOCK_ACCESS_NET_BIND_TCP (1ULL << 0)
#endif
#ifndef LANDLOCK_ACCESS_NET_CONNECT_TCP
#define LANDLOCK_ACCESS_NET_CONNECT_TCP (1ULL << 1)
#endif

/* ABI 1. Everything a filesystem sandbox can talk about at that level. */
#define FS_ABI1                                                               \
  (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE |               \
   LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |               \
   LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |           \
   LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |               \
   LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |               \
   LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |             \
   LANDLOCK_ACCESS_FS_MAKE_SYM)

#define FS_READ_EXEC                                                          \
  (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE |                \
   LANDLOCK_ACCESS_FS_READ_DIR)

static int create_ruleset(const struct landlock_ruleset_attr *attr,
                          size_t size, __u32 flags) {
  return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}

static int add_rule(int fd, enum landlock_rule_type type, const void *attr,
                    __u32 flags) {
  return (int)syscall(__NR_landlock_add_rule, fd, type, attr, flags);
}

static int restrict_self(int fd, __u32 flags) {
  return (int)syscall(__NR_landlock_restrict_self, fd, flags);
}

/*
 * Grant `access` on everything beneath `path`.
 *
 * A path that does not exist is skipped rather than fatal: the read-only list
 * names directories that are present on some images and not others (/lib64 on
 * a multiarch image, say), and failing the whole sandbox over an absent
 * directory would make the mechanism look unavailable when it is not.
 */
static int allow_path(int ruleset_fd, const char *path, __u64 access) {
  struct landlock_path_beneath_attr rule = {0};
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) {
    if (errno == ENOENT) return 0;
    fprintf(stderr, "landlock-exec: open %s: %s\n", path, strerror(errno));
    return -1;
  }
  rule.parent_fd = fd;
  rule.allowed_access = access;
  int rc = add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
  int saved = errno;
  close(fd);
  if (rc) {
    fprintf(stderr, "landlock-exec: add_rule %s: %s\n", path, strerror(saved));
    return -1;
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr,
            "usage: landlock-exec <rw-path[:...]> <ro-path[:...]> -- cmd...\n");
    return 92;
  }
  char *rw_list = strdup(argv[1]);
  char *ro_list = strdup(argv[2]);
  if (!rw_list || !ro_list) return 91;
  if (strcmp(argv[3], "--") != 0) {
    fprintf(stderr, "landlock-exec: expected -- before the command\n");
    return 92;
  }
  char **command = &argv[4];

  int abi = create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 0) {
    fprintf(stderr, "landlock-exec: unsupported (%s)\n", strerror(errno));
    return 90;
  }
  fprintf(stderr, "landlock-exec: abi=%d\n", abi);

  /*
   * The handled mask must name only rights this ABI knows about. Naming a
   * newer bit on an older kernel is rejected outright, so the mask is built up
   * by level rather than declared once.
   */
  __u64 fs = FS_ABI1;
  if (abi >= 2) fs |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) fs |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) fs |= LANDLOCK_ACCESS_FS_IOCTL_DEV;

  struct landlock_ruleset_attr attr = {0};
  attr.handled_access_fs = fs;
  /*
   * Handling TCP without adding any net rule denies all of it. Landlock has no
   * say over UDP or raw sockets, so this is a narrowing rather than a network
   * namespace — worth stating plainly wherever this is relied on.
   */
  if (abi >= 4)
    attr.handled_access_net =
        LANDLOCK_ACCESS_NET_BIND_TCP | LANDLOCK_ACCESS_NET_CONNECT_TCP;

  int ruleset_fd = create_ruleset(&attr, sizeof(attr), 0);
  if (ruleset_fd < 0) {
    fprintf(stderr, "landlock-exec: create_ruleset: %s\n", strerror(errno));
    return 91;
  }

  /*
   * Read and execute for the runtime; full access for the workspace and the
   * scratch paths. Order is irrelevant to Landlock — the rights of the closest
   * enclosing rule apply — so a writable directory nested inside a read-only
   * one still gets its own rights.
   */
  for (char *save = NULL, *tok = strtok_r(ro_list, ":", &save); tok;
       tok = strtok_r(NULL, ":", &save)) {
    if (allow_path(ruleset_fd, tok, fs & FS_READ_EXEC)) return 91;
  }
  for (char *save = NULL, *tok = strtok_r(rw_list, ":", &save); tok;
       tok = strtok_r(NULL, ":", &save)) {
    if (allow_path(ruleset_fd, tok, fs)) return 91;
  }

  /*
   * NO_NEW_PRIVS is mandatory for an unprivileged restrict_self, and is the
   * right thing regardless: without it a setuid binary reachable inside the
   * allowed paths could regain what was just given up.
   */
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
    fprintf(stderr, "landlock-exec: no_new_privs: %s\n", strerror(errno));
    return 91;
  }
  if (restrict_self(ruleset_fd, 0)) {
    fprintf(stderr, "landlock-exec: restrict_self: %s\n", strerror(errno));
    return 91;
  }
  close(ruleset_fd);

  execvp(command[0], command);
  fprintf(stderr, "landlock-exec: exec %s: %s\n", command[0], strerror(errno));
  return 91;
}

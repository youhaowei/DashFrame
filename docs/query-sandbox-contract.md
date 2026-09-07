# Hosted query sandbox implementation contract

This change implements an execution boundary, not hosted admission or tenancy routing.
The host must resolve an authenticated workspace before obtaining an engine handle.
Connector execution, vault access, metadata and persisted files remain in the trusted
host. Neither SQL nor the worker protocol can ask the host to read a path or URL.

Each engine owns one Linux child process and one in-memory DuckDB catalog. Processes
are never reassigned to another workspace. Its API is initialize, registerArrowTable,
queryArrow, unregisterTable and dispose; cancellation terminates the process and all
pending operations. Recovery requires a fresh engine and explicit re-registration.

Before the JavaScript runtime starts, a native launcher must apply Landlock (ABI 7
minimum), no-new-privileges, zero capabilities, a nonroot identity, syscall restrictions,
explicit resource limits and descriptor/environment sanitation. Required policy failures
abort startup. Runtime files are an immutable allowlist; durable workspace files and
host configuration are not granted. Network access and cross-process IPC are denied.
No launcher fallback, in-process fallback or unsupported-platform downgrade is allowed.

Only bounded, versioned messages for Arrow registration, parameterized SQL and table
removal cross private pipes. Bounds cover queued operations, bytes, time and diagnostics.
Results are untrusted and cannot select host resources. A crash, timeout, cancellation,
malformed response or output overflow closes the engine; partial results are not returned.
Desktop continues to use its existing native engine directly.

Local acceptance must run the real native dependency: join/aggregate correctness;
independent catalogs with the same table name; forbidden files, environment, network
and other-process access; startup rejection when a required mechanism is unavailable;
timeout/crash/cleanup without exposing host authority. Native probes must test the OS
boundary separately from DuckDB's locked external-access settings. Resource support is
reported explicitly, and local limits do not establish Railway resource enforcement.

Production integration remains blocked until this exact launcher/policy passes on
Railway, per-workspace host dispatch exists, and independent review plus repository
gates pass. No WorkOS, production service, domain, data or migration changes belong here.
